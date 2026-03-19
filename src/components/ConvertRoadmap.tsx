"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";

interface RoadmapItem {
  key: string | null;
  summary: string;
  url: string | null;
  status: string | null;
  productCategory: string | null;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  expectedLaunchDate: string | null;
  gaLaunchDate: string | null;
  startDate: string | null;
  category: string;
}

function isExperiment(item: RoadmapItem): boolean {
  return item.productCategory?.toLowerCase() === "experiment";
}

// For experiments: bar = experimentStart -> experimentEnd
// For non-experiments: bar = startDate -> expectedLaunchDate
function getBarDates(item: RoadmapItem): { start: string | null; end: string | null } {
  if (isExperiment(item)) {
    return { start: item.experimentStartDate, end: item.experimentEndDate };
  }
  return { start: item.startDate, end: item.expectedLaunchDate };
}

type ZoomLevel = "days" | "months";

const categoryColors: Record<string, string> = {
  "Path to Paid": "#3b82f6",
  "Upgrades": "#8b5cf6",
  "Purchase Experience": "#10b981",
  "Tiger Team / Infrastructure": "#f59e0b",
};

const statusColors: Record<string, string> = {
  "Done": "#22c55e",
  "In Progress": "#3b82f6",
  "In Review": "#a855f7",
  "Open": "#9ca3af",
  "Triage": "#9ca3af",
  "Reopened": "#f59e0b",
};

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

function formatShortDate(d: string | null): string {
  if (!d) return "\u2014";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ConvertRoadmap() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>("months");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const measureContainer = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.offsetWidth);
    }
  }, []);

  useEffect(() => {
    measureContainer();
    window.addEventListener("resize", measureContainer);
    return () => window.removeEventListener("resize", measureContainer);
  }, [measureContainer]);

  useEffect(() => {
    fetch("/api/convert-roadmap")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setItems(data.items || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Group by category preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, RoadmapItem[]>();
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return map;
  }, [items]);

  // Auto-detect date range from data
  const autoRange = useMemo(() => {
    const dates: Date[] = [];
    for (const item of items) {
      const bar = getBarDates(item);
      const s = parseDate(bar.start);
      const e = parseDate(bar.end);
      const l = parseDate(item.expectedLaunchDate);
      const g = parseDate(item.gaLaunchDate);
      if (s) dates.push(s);
      if (e) dates.push(e);
      if (l) dates.push(l);
      if (g) dates.push(g);
    }
    if (dates.length === 0) {
      const now = new Date();
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth() + 4, 0),
      };
    }
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const pad = zoom === "days" ? 7 : 30;
    min.setDate(min.getDate() - pad);
    max.setDate(max.getDate() + pad);
    return { start: min, end: max };
  }, [items, zoom]);

  // User override or auto
  const timelineStart = parseDate(rangeStart) || autoRange.start;
  const timelineEnd = parseDate(rangeEnd) || autoRange.end;

  const totalDays = Math.max(daysBetween(timelineStart, timelineEnd), 1);
  const rowHeight = 40;
  const categoryHeaderHeight = 32;
  const labelWidth = 320;

  // Fill available width, with a minimum dayWidth so it doesn't get too cramped
  const availableWidth = Math.max(containerWidth - labelWidth - 20, 200);
  const minDayWidth = zoom === "days" ? 28 : 4;
  const dayWidth = Math.max(availableWidth / totalDays, minDayWidth);
  const timelineWidth = totalDays * dayWidth;

  // Grid lines
  const gridLines = useMemo(() => {
    const lines: Array<{ x: number; label: string; isMajor: boolean }> = [];
    const cursor = new Date(timelineStart);
    if (zoom === "days") {
      while (cursor <= timelineEnd) {
        const x = daysBetween(timelineStart, cursor) * dayWidth;
        const isFirst = cursor.getDate() === 1;
        const isMonday = cursor.getDay() === 1;
        if (isFirst) lines.push({ x, label: formatMonthYear(cursor), isMajor: true });
        else if (isMonday) lines.push({ x, label: formatDate(cursor), isMajor: false });
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
  }, [timelineStart, timelineEnd, zoom, dayWidth]);

  const todayX = daysBetween(timelineStart, new Date()) * dayWidth;
  const showToday = todayX >= 0 && todayX <= timelineWidth;

  if (loading) return <div className="text-center py-12 text-gray-500">Loading Convert roadmap...</div>;
  if (error) return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
      <h3 className="font-medium mb-1">Error loading roadmap</h3>
      <p className="text-sm">{error}</p>
    </div>
  );

  const scheduledCount = items.filter((i) => {
    const bar = getBarDates(i);
    return bar.start || bar.end;
  }).length;
  const unscheduledCount = items.length - scheduledCount;

  return (
    <div ref={containerRef}>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Range:</span>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
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
        <span className="text-xs text-gray-400 ml-auto">
          {scheduledCount} scheduled, {unscheduledCount} unscheduled
        </span>
      </div>

      {/* Gantt */}
      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: labelWidth + timelineWidth + 20 }}>
            {/* Header */}
            <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              <div
                className="shrink-0 px-3 py-2 text-xs font-medium text-gray-500 border-r border-gray-200 sticky left-0 z-20 bg-gray-50"
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

            {/* Grouped rows */}
            {[...grouped.entries()].map(([category, categoryItems]) => (
              <div key={category}>
                {/* Category header */}
                <div
                  className="flex border-b border-gray-200"
                  style={{ height: categoryHeaderHeight }}
                >
                  <div
                    className="shrink-0 px-3 flex items-center gap-2 border-r border-gray-100 sticky left-0 z-20"
                    style={{ width: labelWidth, backgroundColor: categoryColors[category] ? `${categoryColors[category]}10` : "#6b728010" }}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: categoryColors[category] || "#6b7280" }}
                    />
                    <span className="text-xs font-semibold text-gray-800">{category}</span>
                    <span className="text-[10px] text-gray-400">({categoryItems.length})</span>
                  </div>
                  <div className="relative flex-1" style={{ width: timelineWidth }}>
                    {gridLines.map((line, i) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0"
                        style={{ left: line.x, width: 1, backgroundColor: line.isMajor ? "#e5e7eb" : "#f3f4f6" }}
                      />
                    ))}
                  </div>
                </div>

                {/* Items */}
                {categoryItems.map((item) => {
                  const bar = getBarDates(item);
                  const barStart = parseDate(bar.start);
                  const barEnd = parseDate(bar.end);
                  const launchDate = isExperiment(item) ? parseDate(item.expectedLaunchDate) : null;
                  const gaDate = parseDate(item.gaLaunchDate);
                  const hasAnyDate = barStart || barEnd || launchDate || gaDate;
                  const color = categoryColors[item.category] || "#6b7280";

                  let barLeft = 0;
                  let barWidth = 0;
                  if (barStart && barEnd) {
                    barLeft = daysBetween(timelineStart, barStart) * dayWidth;
                    barWidth = Math.max(daysBetween(barStart, barEnd) * dayWidth, 8);
                  } else if (barStart) {
                    barLeft = daysBetween(timelineStart, barStart) * dayWidth;
                    barWidth = zoom === "days" ? 28 : 20;
                  }

                  let launchX: number | null = null;
                  if (launchDate) launchX = daysBetween(timelineStart, launchDate) * dayWidth;

                  let gaX: number | null = null;
                  if (gaDate) gaX = daysBetween(timelineStart, gaDate) * dayWidth;

                  return (
                    <div
                      key={item.summary}
                      className="flex border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      style={{ height: rowHeight }}
                    >
                      <div
                        className="shrink-0 px-3 flex items-center gap-2 border-r border-gray-100 overflow-hidden sticky left-0 z-20 bg-white"
                        style={{ width: labelWidth }}
                      >
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-gray-800 hover:underline truncate"
                            title={`${item.summary}${item.key ? ` (${item.key})` : ""}`}
                          >
                            {item.key && (
                              <span className="text-blue-600 mr-1.5">{item.key}</span>
                            )}
                            {item.summary}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500 truncate italic" title={item.summary}>
                            {item.summary}
                          </span>
                        )}
                        {item.status && (
                          <span
                            className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: `${statusColors[item.status] || "#9ca3af"}20`,
                              color: statusColors[item.status] || "#6b7280",
                            }}
                          >
                            {item.status}
                          </span>
                        )}
                        {!hasAnyDate && (
                          <span className="shrink-0 text-[10px] text-gray-300 italic">unscheduled</span>
                        )}
                      </div>

                      <div className="relative flex-1" style={{ width: timelineWidth }}>
                        {gridLines.map((line, i) => (
                          <div
                            key={i}
                            className="absolute top-0 bottom-0"
                            style={{ left: line.x, width: 1, backgroundColor: line.isMajor ? "#e5e7eb" : "#f3f4f6" }}
                          />
                        ))}

                        {showToday && (
                          <div
                            className="absolute top-0 bottom-0 z-10"
                            style={{ left: todayX, width: 2, backgroundColor: "#ef4444" }}
                          />
                        )}

                        {/* Bar: full range */}
                        {barStart && barEnd && barWidth > 0 && (
                          <div
                            className="absolute top-2 rounded"
                            style={{
                              left: barLeft,
                              width: barWidth,
                              height: rowHeight - 16,
                              backgroundColor: color,
                              opacity: 0.75,
                            }}
                            title={`${isExperiment(item) ? "Experiment" : "Project"}: ${formatShortDate(bar.start)} - ${formatShortDate(bar.end)}`}
                          />
                        )}

                        {/* Start only (no end date) */}
                        {barStart && !barEnd && (
                          <div
                            className="absolute top-2 rounded-l"
                            style={{
                              left: barLeft,
                              width: barWidth,
                              height: rowHeight - 16,
                              backgroundColor: color,
                              opacity: 0.4,
                              backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.4) 3px, rgba(255,255,255,0.4) 6px)",
                            }}
                            title={`Start: ${formatShortDate(bar.start)} (no end date)`}
                          />
                        )}

                        {/* Expected launch marker */}
                        {launchX !== null && (
                          <div
                            className="absolute z-20 flex items-center justify-center"
                            style={{ left: launchX - 8, top: (rowHeight - 20) / 2, width: 20, height: 20 }}
                            title={`Expected launch: ${formatShortDate(item.expectedLaunchDate)}`}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <path d="M8 1L10 6H14L11 9L12 14L8 11L4 14L5 9L2 6H6L8 1Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1" />
                            </svg>
                          </div>
                        )}

                        {/* GA marker */}
                        {gaX !== null && (
                          <div
                            className="absolute z-20 flex items-center justify-center"
                            style={{ left: gaX - 8, top: (rowHeight - 20) / 2, width: 20, height: 20 }}
                            title={`GA: ${formatShortDate(item.gaLaunchDate)}`}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <circle cx="8" cy="8" r="6" fill="#22c55e" stroke="#16a34a" strokeWidth="1" />
                              <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-t border-gray-200 bg-gray-50 text-[10px] text-gray-500">
          {Object.entries(categoryColors).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1">
              <div className="w-6 h-2.5 rounded" style={{ backgroundColor: color, opacity: 0.75 }} />
              <span>{cat}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L10 6H14L11 9L12 14L8 11L4 14L5 9L2 6H6L8 1Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1" />
            </svg>
            <span>Expected launch</span>
          </div>
          <div className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="6" cy="6" r="5" fill="#22c55e" stroke="#16a34a" strokeWidth="1" />
              <path d="M3.5 6l1.5 1.5 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>GA</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-0.5 h-3 bg-red-500" />
            <span>Today</span>
          </div>
        </div>
      </div>
    </div>
  );
}
