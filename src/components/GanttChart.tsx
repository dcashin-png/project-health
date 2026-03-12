"use client";

import { useMemo, useState } from "react";
import type { ProjectHealth } from "@/lib/types";

type ZoomLevel = "days" | "months";

interface GanttChartProps {
  projects: ProjectHealth[];
}

// Color map for status bars
const statusBarColors: Record<string, string> = {
  planning: "#93c5fd",      // blue-300
  development: "#c084fc",   // purple-400
  "in progress": "#c084fc",
  shipping: "#34d399",      // green-400
  launched: "#34d399",
  "paused/issues": "#fbbf24", // yellow-400
  triage: "#d1d5db",        // gray-300
  open: "#d1d5db",
};

function getBarColor(status?: string): string {
  if (!status) return "#93c5fd";
  return statusBarColors[status.toLowerCase()] || "#93c5fd";
}

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d + "T00:00:00");
  return isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GanttChart({ projects }: GanttChartProps) {
  const [zoom, setZoom] = useState<ZoomLevel>("months");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [squadFilter, setSquadFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");

  // Collect unique filter values
  const { statuses, squads, teams } = useMemo(() => {
    const statuses = new Set<string>();
    const squads = new Set<string>();
    const teams = new Set<string>();
    for (const p of projects) {
      if (p.project.status) statuses.add(p.project.status);
      if (p.project.growthSquad) squads.add(p.project.growthSquad);
      for (const t of p.project.productTeams || []) teams.add(t);
    }
    return {
      statuses: [...statuses].sort(),
      squads: [...squads].sort(),
      teams: [...teams].sort(),
    };
  }, [projects]);

  // Filter projects
  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.project.status !== statusFilter) return false;
      if (squadFilter !== "all" && p.project.growthSquad !== squadFilter) return false;
      if (teamFilter !== "all" && !(p.project.productTeams || []).includes(teamFilter)) return false;
      // Only show projects that have at least one date
      const hasDate = p.project.experimentStartDate || p.project.experimentEndDate || p.project.launchStartDate;
      return !!hasDate;
    });
  }, [projects, statusFilter, squadFilter, teamFilter]);

  // Calculate timeline bounds
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    const dates: Date[] = [];
    for (const p of filtered) {
      const s = parseDate(p.project.experimentStartDate);
      const e = parseDate(p.project.experimentEndDate);
      const l = parseDate(p.project.launchStartDate);
      if (s) dates.push(s);
      if (e) dates.push(e);
      if (l) dates.push(l);
    }

    if (dates.length === 0) {
      const now = new Date();
      return {
        timelineStart: new Date(now.getFullYear(), now.getMonth(), 1),
        timelineEnd: new Date(now.getFullYear(), now.getMonth() + 3, 0),
        totalDays: 90,
      };
    }

    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Add padding
    const padDays = zoom === "days" ? 7 : 30;
    const start = new Date(min);
    start.setDate(start.getDate() - padDays);
    const end = new Date(max);
    end.setDate(end.getDate() + padDays);

    return {
      timelineStart: start,
      timelineEnd: end,
      totalDays: Math.max(daysBetween(start, end), 1),
    };
  }, [filtered, zoom]);

  // Pixel dimensions
  const dayWidth = zoom === "days" ? 28 : 4;
  const timelineWidth = totalDays * dayWidth;
  const rowHeight = 40;
  const labelWidth = 280;

  // Generate grid lines and headers
  const gridLines = useMemo(() => {
    const lines: Array<{ x: number; label: string; isMajor: boolean }> = [];
    const cursor = new Date(timelineStart);

    if (zoom === "days") {
      while (cursor <= timelineEnd) {
        const x = daysBetween(timelineStart, cursor) * dayWidth;
        const isMonday = cursor.getDay() === 1;
        const isFirst = cursor.getDate() === 1;
        if (isFirst) {
          lines.push({ x, label: formatMonthYear(cursor), isMajor: true });
        } else if (isMonday) {
          lines.push({ x, label: formatDate(cursor), isMajor: false });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      // Monthly view — line at the 1st of each month
      cursor.setDate(1);
      if (cursor < timelineStart) cursor.setMonth(cursor.getMonth() + 1);
      while (cursor <= timelineEnd) {
        const x = daysBetween(timelineStart, cursor) * dayWidth;
        lines.push({ x, label: formatMonthYear(cursor), isMajor: true });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    return lines;
  }, [timelineStart, timelineEnd, zoom, dayWidth, totalDays]);

  // Today marker
  const todayX = daysBetween(timelineStart, new Date()) * dayWidth;
  const showToday = todayX >= 0 && todayX <= timelineWidth;

  const noDateCount = projects.filter(
    (p) => !p.project.experimentStartDate && !p.project.experimentEndDate && !p.project.launchStartDate
  ).length;

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Zoom */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
          {(["days", "months"] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                zoom === z ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {z === "days" ? "Days" : "Months"}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Growth Squad filter */}
        <select
          value={squadFilter}
          onChange={(e) => setSquadFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="all">All squads</option>
          {squads.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Product Team filter */}
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} projects shown
          {noDateCount > 0 && ` · ${noDateCount} hidden (no dates)`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No projects with experiment dates match the current filters.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: labelWidth + timelineWidth + 20 }}>
              {/* Header */}
              <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
                <div
                  className="shrink-0 px-3 py-2 text-xs font-medium text-gray-500 border-r border-gray-200"
                  style={{ width: labelWidth }}
                >
                  Project
                </div>
                <div className="relative" style={{ width: timelineWidth, height: 32 }}>
                  {gridLines.map((line, i) => (
                    <div
                      key={i}
                      className="absolute top-0 text-[10px] text-gray-400 whitespace-nowrap"
                      style={{ left: line.x, paddingLeft: 4, fontWeight: line.isMajor ? 600 : 400 }}
                    >
                      {line.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Rows */}
              {filtered.map((p) => {
                const expStart = parseDate(p.project.experimentStartDate);
                const expEnd = parseDate(p.project.experimentEndDate);
                const launchStart = parseDate(p.project.launchStartDate);

                // Bar position
                let barLeft = 0;
                let barWidth = 0;
                if (expStart && expEnd) {
                  barLeft = daysBetween(timelineStart, expStart) * dayWidth;
                  barWidth = Math.max(daysBetween(expStart, expEnd) * dayWidth, 8);
                } else if (expStart) {
                  barLeft = daysBetween(timelineStart, expStart) * dayWidth;
                  barWidth = zoom === "days" ? 28 : 20; // small indicator
                }

                // Launch icon position
                let launchX: number | null = null;
                if (launchStart) {
                  launchX = daysBetween(timelineStart, launchStart) * dayWidth;
                }

                return (
                  <div
                    key={p.project.key}
                    className="flex border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    style={{ height: rowHeight }}
                  >
                    {/* Label */}
                    <div
                      className="shrink-0 px-3 flex items-center gap-2 border-r border-gray-100 overflow-hidden"
                      style={{ width: labelWidth }}
                    >
                      <a
                        href={p.project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-gray-800 hover:underline truncate"
                        title={p.project.name}
                      >
                        {p.project.name}
                      </a>
                      {p.project.status && (
                        <span
                          className="shrink-0 inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: getBarColor(p.project.status) }}
                          title={p.project.status}
                        />
                      )}
                    </div>

                    {/* Timeline */}
                    <div className="relative flex-1" style={{ width: timelineWidth }}>
                      {/* Grid lines */}
                      {gridLines.map((line, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0"
                          style={{
                            left: line.x,
                            width: 1,
                            backgroundColor: line.isMajor ? "#e5e7eb" : "#f3f4f6",
                          }}
                        />
                      ))}

                      {/* Today line */}
                      {showToday && (
                        <div
                          className="absolute top-0 bottom-0 z-10"
                          style={{ left: todayX, width: 2, backgroundColor: "#ef4444" }}
                        />
                      )}

                      {/* Experiment bar */}
                      {barWidth > 0 && (
                        <div
                          className="absolute top-2 rounded"
                          style={{
                            left: barLeft,
                            width: barWidth,
                            height: rowHeight - 16,
                            backgroundColor: getBarColor(p.project.status),
                            opacity: 0.85,
                          }}
                          title={`Experiment: ${p.project.experimentStartDate || "?"} → ${p.project.experimentEndDate || "?"}`}
                        />
                      )}

                      {/* Start-only marker (no end date) */}
                      {expStart && !expEnd && (
                        <div
                          className="absolute top-2 rounded-l"
                          style={{
                            left: barLeft,
                            width: barWidth,
                            height: rowHeight - 16,
                            backgroundColor: getBarColor(p.project.status),
                            opacity: 0.5,
                            backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.4) 3px, rgba(255,255,255,0.4) 6px)",
                          }}
                          title={`Experiment start: ${p.project.experimentStartDate} (no end date)`}
                        />
                      )}

                      {/* Launch start icon */}
                      {launchX !== null && (
                        <div
                          className="absolute z-20 flex items-center justify-center"
                          style={{
                            left: launchX - 8,
                            top: (rowHeight - 20) / 2,
                            width: 20,
                            height: 20,
                          }}
                          title={`Launch: ${p.project.launchStartDate}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 1L10 6H14L11 9L12 14L8 11L4 14L5 9L2 6H6L8 1Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 bg-gray-50 text-[10px] text-gray-500">
            <div className="flex items-center gap-1">
              <div className="w-6 h-2.5 rounded bg-blue-300 opacity-85" />
              <span>Experiment period</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-2.5 rounded bg-blue-300 opacity-50" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 4px)" }} />
              <span>Start only (no end date)</span>
            </div>
            <div className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L10 6H14L11 9L12 14L8 11L4 14L5 9L2 6H6L8 1Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1" />
              </svg>
              <span>Expected launch</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-0.5 h-3 bg-red-500" />
              <span>Today</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
