"use client";

import { useMemo, useRef, useState, useEffect } from "react";
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

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

// --- Multi-select dropdown component ---
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const allSelected = selected.size === 0;

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const buttonLabel = allSelected
    ? `All ${label}`
    : selected.size === 1
      ? [...selected][0]
      : `${selected.size} ${label}`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="truncate max-w-[140px]">{buttonLabel}</span>
        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] max-h-[260px] overflow-y-auto">
          <button
            onClick={() => onChange(new Set())}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${allSelected ? "font-medium text-gray-900" : "text-gray-600"}`}
          >
            All
          </button>
          <div className="border-t border-gray-100" />
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                className="rounded border-gray-300 text-gray-900 focus:ring-gray-500"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function GanttChart({ projects }: GanttChartProps) {
  const [zoom, setZoom] = useState<ZoomLevel>("months");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedSquads, setSelectedSquads] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

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
      if (selectedStatuses.size > 0 && (!p.project.status || !selectedStatuses.has(p.project.status))) return false;
      if (selectedSquads.size > 0 && (!p.project.growthSquad || !selectedSquads.has(p.project.growthSquad))) return false;
      if (selectedTeams.size > 0 && !(p.project.productTeams || []).some((t) => selectedTeams.has(t))) return false;
      const hasDate = p.project.experimentStartDate || p.project.experimentEndDate || p.project.launchStartDate;
      return !!hasDate;
    });
  }, [projects, selectedStatuses, selectedSquads, selectedTeams]);

  // Auto-detect date range from data (used as defaults & when inputs are empty)
  const autoRange = useMemo(() => {
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
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 3, 0),
      };
    }
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const padDays = zoom === "days" ? 7 : 30;
    min.setDate(min.getDate() - padDays);
    max.setDate(max.getDate() + padDays);
    return { start: min, end: max };
  }, [filtered, zoom]);

  // Effective timeline bounds (user override or auto)
  const timelineStart = parseDate(rangeStart) || autoRange.start;
  const timelineEnd = parseDate(rangeEnd) || autoRange.end;
  const totalDays = Math.max(daysBetween(timelineStart, timelineEnd), 1);

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
      {/* Controls row 1: zoom + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
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

        <MultiSelect label="statuses" options={statuses} selected={selectedStatuses} onChange={setSelectedStatuses} />
        <MultiSelect label="squads" options={squads} selected={selectedSquads} onChange={setSelectedSquads} />
        <MultiSelect label="teams" options={teams} selected={selectedTeams} onChange={setSelectedTeams} />

        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} projects shown
          {noDateCount > 0 && ` · ${noDateCount} hidden (no dates)`}
        </span>
      </div>

      {/* Controls row 2: date range */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Date range:</span>
        <input
          type="date"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value)}
          placeholder={toDateString(autoRange.start)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(e.target.value)}
          placeholder={toDateString(autoRange.end)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        />
        {(rangeStart || rangeEnd) && (
          <button
            onClick={() => { setRangeStart(""); setRangeEnd(""); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Reset
          </button>
        )}
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

                let barLeft = 0;
                let barWidth = 0;
                if (expStart && expEnd) {
                  barLeft = daysBetween(timelineStart, expStart) * dayWidth;
                  barWidth = Math.max(daysBetween(expStart, expEnd) * dayWidth, 8);
                } else if (expStart) {
                  barLeft = daysBetween(timelineStart, expStart) * dayWidth;
                  barWidth = zoom === "days" ? 28 : 20;
                }

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
                      {/* Houston experiment status indicator */}
                      {p.experiments && p.experiments.length > 0 && (() => {
                        const exp = p.experiments[0];
                        const statusIcon = exp.status === "active" ? "●" : exp.status === "finished" ? "✓" : exp.status === "paused" ? "⏸" : exp.status === "draft" ? "○" : "◐";
                        const statusColor = exp.status === "active" ? "text-green-500" : exp.status === "finished" ? "text-purple-500" : exp.status === "paused" ? "text-yellow-500" : "text-gray-400";
                        const rollout = exp.rolloutPercent !== null ? `${exp.rolloutPercent}%` : "";
                        const srmFlag = exp.srmIssue ? " ⚠SRM" : "";
                        return (
                          <span className={`shrink-0 text-[10px] ${statusColor}`} title={`Houston: ${exp.name} — ${exp.status}${rollout ? ` @ ${rollout}` : ""}${srmFlag}`}>
                            {statusIcon}{rollout && <span className="ml-0.5 text-gray-400">{rollout}</span>}
                            {exp.srmIssue && <span className="text-red-500 ml-0.5">⚠</span>}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="relative flex-1" style={{ width: timelineWidth }}>
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

                      {showToday && (
                        <div
                          className="absolute top-0 bottom-0 z-10"
                          style={{ left: todayX, width: 2, backgroundColor: "#ef4444" }}
                        />
                      )}

                      {expStart && expEnd && barWidth > 0 && (
                        <div
                          className="absolute top-2 rounded"
                          style={{
                            left: barLeft,
                            width: barWidth,
                            height: rowHeight - 16,
                            backgroundColor: getBarColor(p.project.status),
                            opacity: 0.85,
                          }}
                          title={`Experiment: ${p.project.experimentStartDate} → ${p.project.experimentEndDate}`}
                        />
                      )}

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
            <div className="flex items-center gap-1">
              <span className="text-green-500">●</span>
              <span>Houston active</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-purple-500">✓</span>
              <span>Finished</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-red-500">⚠</span>
              <span>SRM issue</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
