"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

interface FunnelMetric {
  section: string;
  metric: string;
  qtd: number | string | null;
  vsPacing: number | string | null;
  yoy: number | string | null;
}

interface FunnelData {
  asOf: string;
  metrics: FunnelMetric[];
}

// Map spreadsheet sections to funnel pillars, with key metrics to highlight
const PILLAR_METRIC_MAP: Record<string, { sections: string[]; highlights: string[] }> = {
  "Acquire Demand": {
    sections: ["Funnel"],
    highlights: ["Unique Daily Visitors", "Created Work Teams"],
  },
  "Activate": {
    sections: ["Funnel"],
    highlights: ["CWT+1 (in 14d)", "Activated/Returned Work (in 14d)"],
  },
  "Convert": {
    sections: ["NPT", "New ACV Inputs"],
    highlights: ["Total New Paid Teams", "New ACV"],
  },
  "Retain": {
    sections: ["Exp. ACV Inputs", "Attrition Inputs"],
    highlights: ["Expansion ACV", "Attrition", "NNAOV"],
  },
};

function formatMetricValue(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "\u2014";
  if (typeof val === "string") return val;
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatYoy(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "";
  if (typeof val === "string") {
    if (val.includes("%")) return val;
    const n = parseFloat(val);
    if (!isNaN(n)) return `${n > 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
    return val;
  }
  const pct = Math.abs(val) <= 10 ? val * 100 : val;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function yoyColorClass(val: number | string | null): string {
  if (val === null || val === undefined || val === "" || val === "-") return "opacity-50";
  const str = String(val).replace("%", "");
  const n = parseFloat(str);
  if (isNaN(n)) return "opacity-50";
  if (n > 0) return "text-green-300";
  if (n < 0) return "text-red-300";
  return "opacity-70";
}

interface BacklogItem {
  key: string;
  summary: string;
  url: string;
  status: string;
  issueType: string;
  priority: string;
  experimentStatus: string | null;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  assignee: string | null;
  dri: string | null;
  growthSquad: string;
  productCategory: string | null;
  estimatedAcv: number | null;
  actualAcv: number | null;
}

type PillarData = Record<string, Record<string, BacklogItem[]>>;

const PILLAR_ORDER = ["Acquire Demand", "Activate", "Convert", "Retain", "Other"];

const PILLAR_THEME: Record<string, { color: string; bg: string; border: string; light: string; ring: string }> = {
  "Acquire Demand": { color: "bg-blue-600", bg: "bg-blue-50", border: "border-blue-200", light: "bg-blue-100", ring: "ring-blue-400" },
  "Activate": { color: "bg-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", light: "bg-emerald-100", ring: "ring-emerald-400" },
  "Convert": { color: "bg-amber-600", bg: "bg-amber-50", border: "border-amber-200", light: "bg-amber-100", ring: "ring-amber-400" },
  "Retain": { color: "bg-purple-600", bg: "bg-purple-50", border: "border-purple-200", light: "bg-purple-100", ring: "ring-purple-400" },
  "Other": { color: "bg-gray-600", bg: "bg-gray-50", border: "border-gray-200", light: "bg-gray-100", ring: "ring-gray-400" },
};

const STATUS_COLORS: Record<string, string> = {
  "In Progress": "bg-blue-100 text-blue-800",
  "In Development": "bg-blue-100 text-blue-800",
  "To Do": "bg-gray-100 text-gray-800",
  "Open": "bg-gray-100 text-gray-800",
  "Backlog": "bg-gray-100 text-gray-600",
  "In Review": "bg-yellow-100 text-yellow-800",
  "Blocked": "bg-red-100 text-red-800",
};

const EXP_STATUS_COLORS: Record<string, string> = {
  "Planning": "bg-gray-100 text-gray-700",
  "Development": "bg-blue-100 text-blue-700",
  "Ramping": "bg-indigo-100 text-indigo-700",
  "Running": "bg-green-100 text-green-700",
  "Analysis": "bg-amber-100 text-amber-700",
  "Paused": "bg-red-100 text-red-700",
  "Paused/Issues": "bg-red-100 text-red-700",
};

function statusBadge(status: string, colorMap: Record<string, string>) {
  const colors = colorMap[status] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {status}
    </span>
  );
}

function formatDate(d: string | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatAcv(val: number | null): string {
  if (val === null) return "\u2014";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
}

interface PillarMetrics {
  total: number;
  squads: number;
  running: number;
  planning: number;
  estimatedAcv: number;
}

function computeMetrics(squads: Record<string, BacklogItem[]>): PillarMetrics {
  const allItems = Object.values(squads).flat();
  return {
    total: allItems.length,
    squads: Object.keys(squads).length,
    running: allItems.filter((i) => i.experimentStatus === "Running" || i.experimentStatus === "Ramping").length,
    planning: allItems.filter((i) => i.experimentStatus === "Planning" || i.experimentStatus === "Development").length,
    estimatedAcv: allItems.reduce((sum, i) => sum + (i.estimatedAcv || 0), 0),
  };
}

// Funnel stage widths taper from wide to narrow
const FUNNEL_WIDTHS = [100, 85, 70, 55, 45];

function getPillarHighlights(pillarName: string, funnelMetrics: FunnelMetric[]): FunnelMetric[] {
  const mapping = PILLAR_METRIC_MAP[pillarName];
  if (!mapping) return [];
  return mapping.highlights
    .map((name) => funnelMetrics.find((m) => m.metric === name))
    .filter((m): m is FunnelMetric => !!m);
}

function FunnelPanel({
  pillars,
  selected,
  onSelect,
  funnelMetrics,
  funnelAsOf,
  simMode,
  promotedMap,
  onDrop,
}: {
  pillars: PillarData;
  selected: string | null;
  onSelect: (name: string | null) => void;
  funnelMetrics: FunnelMetric[];
  funnelAsOf: string | null;
  simMode: boolean;
  promotedMap: PromotedMap;
  onDrop: (pillar: string, itemKey: string) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const ordered = PILLAR_ORDER.filter((p) => pillars[p] && Object.keys(pillars[p]).length > 0);

  // Build a lookup of all items by key for ACV calculation
  const itemsByKey = useMemo(() => {
    const map = new Map<string, BacklogItem>();
    for (const squads of Object.values(pillars)) {
      for (const items of Object.values(squads)) {
        for (const item of items) map.set(item.key, item);
      }
    }
    return map;
  }, [pillars]);

  const handleDragOver = (e: React.DragEvent, pillar: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(pillar);
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = (e: React.DragEvent, pillar: string) => {
    e.preventDefault();
    setDragOver(null);
    const itemKey = e.dataTransfer.getData("text/plain");
    if (itemKey) onDrop(pillar, itemKey);
  };

  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      {ordered.map((name, idx) => {
        const theme = PILLAR_THEME[name] || PILLAR_THEME.Other;
        const metrics = computeMetrics(pillars[name]);
        const widthPct = FUNNEL_WIDTHS[idx] || 45;
        const isSelected = selected === name;
        const highlights = getPillarHighlights(name, funnelMetrics);
        const isDragTarget = dragOver === name;

        // Sim mode: compute promoted ACV for this pillar
        const promotedKeys = promotedMap[name] || new Set();
        const promotedAcv = Array.from(promotedKeys).reduce((sum, key) => {
          const item = itemsByKey.get(key);
          return sum + (item?.estimatedAcv || 0);
        }, 0);
        const currentRunningAcv = Object.values(pillars[name] || {})
          .flat()
          .filter((i) => RUNNING_STATUSES.has(i.experimentStatus || ""))
          .reduce((sum, i) => sum + (i.estimatedAcv || 0), 0);

        const stageProps = simMode
          ? {
              onDragOver: (e: React.DragEvent) => handleDragOver(e, name),
              onDragLeave: handleDragLeave,
              onDrop: (e: React.DragEvent) => handleDrop(e, name),
            }
          : {};

        return (
          <div
            key={name}
            {...stageProps}
            onClick={() => !simMode && onSelect(isSelected ? null : name)}
            className={`relative transition-all duration-200 rounded-lg text-white text-left overflow-hidden
              ${theme.color}
              ${!simMode && isSelected ? `ring-2 ${theme.ring} ring-offset-2 scale-[1.02]` : ""}
              ${!simMode ? "cursor-pointer hover:scale-[1.01] hover:brightness-110" : ""}
              ${simMode && isDragTarget ? "ring-2 ring-indigo-400 ring-offset-2 scale-[1.03] brightness-110" : ""}
              ${simMode && !isDragTarget ? "opacity-90" : ""}`}
            style={{ width: `${widthPct}%` }}
          >
            {/* Drop zone overlay */}
            {simMode && isDragTarget && (
              <div className="absolute inset-0 bg-white/20 flex items-center justify-center z-10 pointer-events-none">
                <span className="text-white font-semibold text-sm bg-black/30 px-3 py-1 rounded-full">
                  Drop here
                </span>
              </div>
            )}

            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-sm">{name}</span>
                <span className="text-xs opacity-80">{metrics.squads} squad{metrics.squads !== 1 ? "s" : ""}</span>
              </div>

              {/* Backlog stats */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-1">
                <div>
                  <span className="opacity-70">Items</span>
                  <span className="ml-1 font-bold text-base">{metrics.total}</span>
                </div>
                <div>
                  <span className="opacity-70">Running</span>
                  <span className="ml-1 font-bold text-base">{metrics.running}</span>
                </div>
                <div>
                  <span className="opacity-70">Pipeline</span>
                  <span className="ml-1 font-bold text-base">{metrics.planning}</span>
                </div>
                {metrics.estimatedAcv > 0 && (
                  <div>
                    <span className="opacity-70">Est ACV</span>
                    <span className="ml-1 font-bold">{formatAcv(metrics.estimatedAcv)}</span>
                  </div>
                )}
              </div>

              {/* Sim mode: promoted impact for this stage */}
              {simMode && promotedKeys.size > 0 && (
                <div className="border-t border-white/20 pt-1.5 mt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="opacity-80">
                      +{promotedKeys.size} promoted
                    </span>
                    <span className="font-bold">+{formatAcv(promotedAcv)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-0.5">
                    <span className="opacity-80">Projected Running ACV</span>
                    <span className="font-bold">{formatAcv(currentRunningAcv + promotedAcv)}</span>
                  </div>
                </div>
              )}

              {/* Funnel scorecard metrics (non-sim mode) */}
              {!simMode && highlights.length > 0 && (
                <div className="border-t border-white/20 pt-1.5 mt-1">
                  <div className="grid gap-1">
                    {highlights.map((m) => (
                      <div key={m.metric} className="flex items-center justify-between text-xs">
                        <span className="opacity-80 truncate mr-2">{m.metric}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-bold">{formatMetricValue(m.qtd)}</span>
                          {m.yoy != null && m.yoy !== "" && m.yoy !== "-" && (
                            <span className={`text-[10px] ${yoyColorClass(m.yoy)}`}>
                              {formatYoy(m.yoy)} YoY
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Sim mode: total impact summary */}
      {simMode && (() => {
        const totalPromoted = Object.values(promotedMap).reduce((sum, s) => sum + s.size, 0);
        const totalPromotedAcv = Object.values(promotedMap).reduce((sum, s) => {
          return sum + Array.from(s).reduce((a, key) => a + (itemsByKey.get(key)?.estimatedAcv || 0), 0);
        }, 0);
        const totalRunningAcv = Object.values(pillars).reduce((sum, squads) => {
          return sum + Object.values(squads).flat()
            .filter((i) => RUNNING_STATUSES.has(i.experimentStatus || ""))
            .reduce((a, i) => a + (i.estimatedAcv || 0), 0);
        }, 0);

        if (totalPromoted === 0) return null;

        return (
          <div className="mt-3 w-full rounded-lg bg-gray-900 text-white p-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="text-gray-400 uppercase text-[10px]">Running</div>
                <div className="font-bold text-sm">{formatAcv(totalRunningAcv)}</div>
              </div>
              <div>
                <div className="text-indigo-400 uppercase text-[10px]">+Promoted</div>
                <div className="font-bold text-sm text-indigo-300">+{formatAcv(totalPromotedAcv)}</div>
              </div>
              <div>
                <div className="text-gray-400 uppercase text-[10px]">Projected</div>
                <div className="font-bold text-sm">{formatAcv(totalRunningAcv + totalPromotedAcv)}</div>
              </div>
            </div>
          </div>
        );
      })()}

      {!simMode && funnelAsOf ? (
        <p className="text-[10px] text-gray-400 mt-2 text-center">Scorecard as of {funnelAsOf}</p>
      ) : !simMode ? (
        <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium mb-0.5">Scorecard metrics not loaded</p>
          <p className="text-amber-700">
            Run <code className="bg-amber-100 px-1 rounded">node scripts/fetch-funnel.mjs</code> then
            Cmd+A, Cmd+C the JSON in the browser, press Enter in terminal.
          </p>
        </div>
      ) : null}
    </div>
  );
}

type DetailFilter = "all" | "running" | "pipeline" | "analysis";

const RUNNING_STATUSES = new Set(["Running", "Ramping"]);
const PIPELINE_STATUSES = new Set(["Planning", "Development"]);
const ANALYSIS_STATUSES = new Set(["Analysis"]);

function filterItems(items: BacklogItem[], filter: DetailFilter): BacklogItem[] {
  if (filter === "all") return items;
  if (filter === "running") return items.filter((i) => RUNNING_STATUSES.has(i.experimentStatus || ""));
  if (filter === "pipeline") return items.filter((i) => PIPELINE_STATUSES.has(i.experimentStatus || ""));
  if (filter === "analysis") return items.filter((i) => ANALYSIS_STATUSES.has(i.experimentStatus || ""));
  return items;
}

function DetailPanel({
  pillars,
  selected,
}: {
  pillars: PillarData;
  selected: string | null;
}) {
  const [expandedSquads, setExpandedSquads] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<DetailFilter>("all");

  // When selected pillar changes, auto-expand all its squads and reset filter
  useEffect(() => {
    if (selected && pillars[selected]) {
      setExpandedSquads(new Set(Object.keys(pillars[selected]).map((s) => `${selected}::${s}`)));
      setActiveFilter("all");
    }
  }, [selected, pillars]);

  const toggleSquad = (key: string) => {
    setExpandedSquads((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm py-16">
        <div className="text-center">
          <div className="text-4xl mb-3">&#8592;</div>
          <p>Click a funnel stage to view squad details</p>
        </div>
      </div>
    );
  }

  const squads = pillars[selected];
  if (!squads) return null;
  const theme = PILLAR_THEME[selected] || PILLAR_THEME.Other;

  // Compute counts for filter tabs
  const allItems = Object.values(squads).flat();
  const filterCounts: Record<DetailFilter, number> = {
    all: allItems.length,
    running: allItems.filter((i) => RUNNING_STATUSES.has(i.experimentStatus || "")).length,
    pipeline: allItems.filter((i) => PIPELINE_STATUSES.has(i.experimentStatus || "")).length,
    analysis: allItems.filter((i) => ANALYSIS_STATUSES.has(i.experimentStatus || "")).length,
  };

  const filterTabs: { key: DetailFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "running", label: "Running" },
    { key: "pipeline", label: "Pipeline" },
    { key: "analysis", label: "Analysis" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{selected}</h3>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 pb-0">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition-colors ${
              activeFilter === tab.key
                ? "bg-white text-gray-900 border-gray-200"
                : "bg-transparent text-gray-500 border-transparent hover:text-gray-700"
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
              activeFilter === tab.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
            }`}>
              {filterCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      <div className={`rounded-lg border ${theme.border} overflow-hidden divide-y ${theme.border}`}>
        {Object.entries(squads).map(([squadName, rawItems]) => {
          const items = filterItems(rawItems, activeFilter);
          if (items.length === 0) return null;
          const squadKey = `${selected}::${squadName}`;
          const isExpanded = expandedSquads.has(squadKey);

          return (
            <div key={squadKey}>
              <button
                onClick={() => toggleSquad(squadKey)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${theme.bg} hover:bg-white/50`}
              >
                <span className="font-medium text-sm text-gray-800">{squadName}</span>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{items.length} item{items.length !== 1 ? "s" : ""}</span>
                  <span>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 w-[90px]">Key</th>
                        <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Summary</th>
                        <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 w-[100px]">Status</th>
                        <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 w-[100px]">Exp Status</th>
                        <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 w-[120px]">DRI</th>
                        <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500 w-[70px]">Start</th>
                        <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500 w-[70px]">End</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 w-[75px]">Est ACV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.key} className="border-b last:border-b-0 border-gray-50 hover:bg-gray-50">
                          <td className="py-1.5 pr-3">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-mono text-xs"
                            >
                              {item.key}
                            </a>
                          </td>
                          <td className="py-1.5 pr-3 text-gray-900 truncate max-w-[250px]" title={item.summary}>
                            {item.summary}
                          </td>
                          <td className="py-1.5 pr-3">{statusBadge(item.status, STATUS_COLORS)}</td>
                          <td className="py-1.5 pr-3">
                            {item.experimentStatus
                              ? statusBadge(item.experimentStatus, EXP_STATUS_COLORS)
                              : <span className="text-gray-400 text-xs">&mdash;</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-gray-700 truncate max-w-[120px]" title={item.dri || item.assignee || ""}>
                            {item.dri || item.assignee || <span className="text-gray-400">&mdash;</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-xs text-gray-600 font-mono">
                            {formatDate(item.experimentStartDate)}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-xs text-gray-600 font-mono">
                            {formatDate(item.experimentEndDate)}
                          </td>
                          <td className="py-1.5 text-right text-xs text-gray-700 font-mono">
                            {formatAcv(item.estimatedAcv)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Simulation (drag-and-drop) ---

// Promoted items tracked per pillar
type PromotedMap = Record<string, Set<string>>; // pillar -> set of item keys

function SimulationPanel({
  pillars,
  promotedMap,
  onDrop,
  onRemove,
  onReset,
}: {
  pillars: PillarData;
  promotedMap: PromotedMap;
  onDrop: (pillar: string, itemKey: string) => void;
  onRemove: (itemKey: string) => void;
  onReset: () => void;
}) {
  // All pipeline items across all pillars
  const pipelineItems = useMemo(() => {
    const items: (BacklogItem & { pillar: string })[] = [];
    for (const [pillar, squads] of Object.entries(pillars)) {
      for (const squadItems of Object.values(squads)) {
        for (const item of squadItems) {
          if (PIPELINE_STATUSES.has(item.experimentStatus || "")) {
            items.push({ ...item, pillar });
          }
        }
      }
    }
    return items;
  }, [pillars]);

  // Set of all promoted keys (across all pillars)
  const allPromotedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of Object.values(promotedMap)) {
      for (const k of s) keys.add(k);
    }
    return keys;
  }, [promotedMap]);

  // Items not yet promoted
  const availableItems = useMemo(
    () => pipelineItems.filter((i) => !allPromotedKeys.has(i.key)),
    [pipelineItems, allPromotedKeys],
  );

  // Group available by pillar
  const groupedAvailable = useMemo(() => {
    const groups: Record<string, (BacklogItem & { pillar: string })[]> = {};
    for (const item of availableItems) {
      if (!groups[item.pillar]) groups[item.pillar] = [];
      groups[item.pillar].push(item);
    }
    return groups;
  }, [availableItems]);

  const handleDragStart = (e: React.DragEvent, itemKey: string) => {
    e.dataTransfer.setData("text/plain", itemKey);
    e.dataTransfer.effectAllowed = "move";
  };

  const hasPromotions = allPromotedKeys.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Pipeline Items</h3>
          <p className="text-xs text-gray-500">Drag items onto a funnel stage to simulate promotion</p>
        </div>
        {hasPromotions && (
          <button
            onClick={onReset}
            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 border border-gray-200 rounded-md"
          >
            Reset All
          </button>
        )}
      </div>

      {/* Available pipeline items */}
      <div className="space-y-2">
        {PILLAR_ORDER.filter((p) => groupedAvailable[p]?.length > 0).map((pillar) => {
          const items = groupedAvailable[pillar];
          const theme = PILLAR_THEME[pillar] || PILLAR_THEME.Other;

          return (
            <div key={pillar} className={`rounded-lg border ${theme.border} overflow-hidden`}>
              <div className={`px-3 py-2 ${theme.bg} flex items-center justify-between`}>
                <span className="text-sm font-medium text-gray-800">{pillar}</span>
                <span className="text-xs text-gray-500">{items.length} available</span>
              </div>
              <div className="divide-y divide-gray-50 bg-white">
                {items.map((item) => (
                  <div
                    key={item.key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.key)}
                    className="flex items-center gap-3 px-3 py-2 cursor-grab active:cursor-grabbing hover:bg-indigo-50 transition-colors"
                  >
                    <div className="text-gray-300 flex-shrink-0 text-sm select-none" title="Drag to a funnel stage">&#9776;</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-xs flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.key}
                        </a>
                        <span className="text-sm text-gray-900 truncate">{item.summary}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span>{item.growthSquad}</span>
                        {item.dri && <span>{item.dri}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 w-[70px]">
                      <span className={`text-sm font-mono ${item.estimatedAcv ? "text-gray-900" : "text-gray-400"}`}>
                        {item.estimatedAcv ? formatAcv(item.estimatedAcv) : "\u2014"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {availableItems.length === 0 && !hasPromotions && (
          <div className="text-center py-8 text-gray-400 text-sm">No pipeline items to simulate</div>
        )}
        {availableItems.length === 0 && hasPromotions && (
          <div className="text-center py-6 text-gray-400 text-sm">All pipeline items have been promoted</div>
        )}
      </div>

      {/* Promoted items list — for removing */}
      {hasPromotions && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <h4 className="text-xs font-semibold text-indigo-800 uppercase tracking-wide mb-2">
            Promoted ({allPromotedKeys.size} item{allPromotedKeys.size !== 1 ? "s" : ""})
          </h4>
          <div className="space-y-1">
            {pipelineItems.filter((i) => allPromotedKeys.has(i.key)).map((item) => {
              // Find which pillar it was promoted to
              const targetPillar = Object.entries(promotedMap).find(([, s]) => s.has(item.key))?.[0] || "";
              return (
                <div key={item.key} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1.5 border border-indigo-100">
                  <span className="font-mono text-blue-600">{item.key}</span>
                  <span className="text-gray-700 truncate flex-1">{item.summary}</span>
                  <span className="text-indigo-600 flex-shrink-0">&rarr; {targetPillar}</span>
                  <span className="font-mono text-gray-900 flex-shrink-0">{item.estimatedAcv ? formatAcv(item.estimatedAcv) : "\u2014"}</span>
                  <button
                    onClick={() => onRemove(item.key)}
                    className="text-gray-400 hover:text-red-600 flex-shrink-0 ml-1"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400">
        Estimated ACV from JIRA. Drag items to funnel stages to see per-stage and total impact.
      </p>
    </div>
  );
}

export function GrowthFunnel() {
  const [pillars, setPillars] = useState<PillarData | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [funnelMetrics, setFunnelMetrics] = useState<FunnelMetric[]>([]);
  const [funnelAsOf, setFunnelAsOf] = useState<string | null>(null);
  const [simMode, setSimMode] = useState(false);
  const [promotedMap, setPromotedMap] = useState<PromotedMap>({});

  const handleSimDrop = useCallback((pillar: string, itemKey: string) => {
    setPromotedMap((prev) => {
      // Remove from any other pillar first
      const next: PromotedMap = {};
      for (const [p, s] of Object.entries(prev)) {
        const copy = new Set(s);
        copy.delete(itemKey);
        if (copy.size > 0) next[p] = copy;
      }
      // Add to target pillar
      if (!next[pillar]) next[pillar] = new Set();
      next[pillar].add(itemKey);
      return next;
    });
  }, []);

  const handleSimRemove = useCallback((itemKey: string) => {
    setPromotedMap((prev) => {
      const next: PromotedMap = {};
      for (const [p, s] of Object.entries(prev)) {
        const copy = new Set(s);
        copy.delete(itemKey);
        if (copy.size > 0) next[p] = copy;
      }
      return next;
    });
  }, []);

  const handleSimReset = useCallback(() => setPromotedMap({}), []);

  useEffect(() => {
    // Fetch backlog data (required)
    const backlogPromise = fetch("/api/growth-backlog")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setPillars(d.pillars);
        setTotalCount(d.totalCount);
      });

    // Fetch funnel scorecard data (optional — may not exist)
    const funnelPromise = fetch("/api/funnel")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error && d.metrics) {
          setFunnelMetrics(d.metrics);
          setFunnelAsOf(d.asOf || null);
        }
      })
      .catch(() => {}); // Silently ignore if not available

    Promise.all([backlogPromise, funnelPromise])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Compute overall summary metrics
  const summary = useMemo(() => {
    if (!pillars) return null;
    const allItems = Object.values(pillars).flatMap((squads) => Object.values(squads).flat());
    return {
      total: allItems.length,
      running: allItems.filter((i) => i.experimentStatus === "Running" || i.experimentStatus === "Ramping").length,
      pipeline: allItems.filter((i) => i.experimentStatus === "Planning" || i.experimentStatus === "Development").length,
      totalAcv: allItems.reduce((sum, i) => sum + (i.estimatedAcv || 0), 0),
    };
  }, [pillars]);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading growth backlog...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
        <h3 className="font-medium mb-1">Error loading growth backlog</h3>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!pillars || totalCount === 0) {
    return <div className="text-center py-12 text-gray-500">No growth backlog items found.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Growth Funnel</h2>
        <div className="flex items-center gap-4">
          {summary && (
            <div className="flex items-center gap-5 text-xs text-gray-500">
              <span><strong className="text-gray-900">{summary.total}</strong> items</span>
              <span><strong className="text-green-700">{summary.running}</strong> running</span>
              <span><strong className="text-blue-700">{summary.pipeline}</strong> in pipeline</span>
              {summary.totalAcv > 0 && (
                <span><strong className="text-gray-900">{formatAcv(summary.totalAcv)}</strong> est ACV</span>
              )}
            </div>
          )}
          {funnelMetrics.length > 0 && (
            <button
              onClick={() => { setSimMode(!simMode); if (!simMode) { setSelected(null); } else { setPromotedMap({}); } }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                simMode
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {simMode ? "Exit Simulation" : "Simulate"}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-6 min-h-[500px]">
        {/* Left: Funnel */}
        <div className="w-[400px] flex-shrink-0 self-start sticky top-4">
          <FunnelPanel
            pillars={pillars}
            selected={selected}
            onSelect={setSelected}
            funnelMetrics={funnelMetrics}
            funnelAsOf={funnelAsOf}
            simMode={simMode}
            promotedMap={promotedMap}
            onDrop={handleSimDrop}
          />
        </div>

        {/* Right: Detail or Simulation */}
        <div className="flex-1 min-w-0">
          {simMode ? (
            <SimulationPanel
              pillars={pillars}
              promotedMap={promotedMap}
              onDrop={handleSimDrop}
              onRemove={handleSimRemove}
              onReset={handleSimReset}
            />
          ) : (
            <DetailPanel pillars={pillars} selected={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
