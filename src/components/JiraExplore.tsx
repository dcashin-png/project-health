"use client";

import { useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

// --- Types ---

interface Experiment {
  key: string;
  summary: string;
  url: string;
  status: string;
  experimentStatus: string;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  expectedLaunchStartDate: string | null;
  estimatedAcv: number | null;
  actualAcv: number | null;
  dri: string | null;
  productCategory: string | null;
  growthSquad: string | null;
  created: string;
}

interface QueryOption {
  key: string;
  label: string;
  description: string;
  chartType: "bar" | "pie" | "stacked-bar" | "table-only";
  groupBy: (exp: Experiment) => string;
  metric?: (exps: Experiment[]) => number;
  metricLabel?: string;
  hasDateFilter: boolean;
  hasCustomJql: boolean;
}

// --- Query Definitions ---

const QUERIES: QueryOption[] = [
  {
    key: "experiments-by-status",
    label: "Experiments by Status",
    description: "Breakdown of experiments by their current experiment status",
    chartType: "bar",
    groupBy: (e) => e.experimentStatus,
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "experiments-by-squad",
    label: "Experiments by Squad",
    description: "Number of experiments per growth squad",
    chartType: "bar",
    groupBy: (e) => e.growthSquad || "Unassigned",
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "acv-by-squad",
    label: "ACV by Squad",
    description: "Total estimated ACV broken down by growth squad",
    chartType: "bar",
    groupBy: (e) => e.growthSquad || "Unassigned",
    metric: (exps) => exps.reduce((sum, e) => sum + (e.estimatedAcv || 0), 0),
    metricLabel: "Estimated ACV",
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "acv-by-category",
    label: "ACV by Category",
    description: "Total estimated ACV broken down by product category",
    chartType: "pie",
    groupBy: (e) => e.productCategory || "Uncategorized",
    metric: (exps) => exps.reduce((sum, e) => sum + (e.estimatedAcv || 0), 0),
    metricLabel: "Estimated ACV",
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "monthly-velocity",
    label: "Monthly Velocity",
    description: "Number of experiments launched per month",
    chartType: "bar",
    groupBy: (e) => {
      if (!e.experimentStartDate) return "No Date";
      return e.experimentStartDate.substring(0, 7);
    },
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "ga-tracker",
    label: "GA Tracker",
    description: "Experiments that have GA'd with actual ACV",
    chartType: "bar",
    groupBy: (e) => {
      if (!e.expectedLaunchStartDate) return "No Date";
      return e.expectedLaunchStartDate.substring(0, 7);
    },
    metric: (exps) => exps.reduce((sum, e) => sum + (e.actualAcv || 0), 0),
    metricLabel: "Actual ACV",
    hasDateFilter: true,
    hasCustomJql: false,
  },
  {
    key: "active-experiments",
    label: "Active Experiments",
    description: "All currently active experiments (Running, Development, Planning)",
    chartType: "table-only",
    groupBy: (e) => e.experimentStatus,
    hasDateFilter: false,
    hasCustomJql: false,
  },
  {
    key: "custom-jql",
    label: "Custom JQL",
    description: "Write your own JQL query",
    chartType: "bar",
    groupBy: (e) => e.experimentStatus,
    hasDateFilter: false,
    hasCustomJql: true,
  },
];

// --- Helpers ---

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1",
  "#84CC16", "#D946EF",
];

function formatAcv(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(2)}`;
}

// --- Panel Component ---

interface PanelState {
  selectedQuery: string;
  since: string;
  until: string;
  customJql: string;
  experiments: Experiment[];
  loading: boolean;
  error: string | null;
  jqlUsed: string | null;
  hasQueried: boolean;
}

function ExplorePanel({ compact }: { compact: boolean }) {
  const [state, setState] = useState<PanelState>({
    selectedQuery: "experiments-by-status",
    since: "2025-01-01",
    until: "",
    customJql: "",
    experiments: [],
    loading: false,
    error: null,
    jqlUsed: null,
    hasQueried: false,
  });

  const query = QUERIES.find((q) => q.key === state.selectedQuery)!;

  const update = (patch: Partial<PanelState>) => setState((prev) => ({ ...prev, ...patch }));

  const runQuery = useCallback(async () => {
    update({ loading: true, error: null, hasQueried: true });

    const params: Record<string, string> = {};
    if (query.hasDateFilter) {
      params.since = state.since;
      if (state.until) params.until = state.until;
    }
    if (query.hasCustomJql) params.jql = state.customJql;

    try {
      const res = await fetch(
        `/api/jira-explore?query=${encodeURIComponent(state.selectedQuery)}&params=${encodeURIComponent(JSON.stringify(params))}`
      );
      const data = await res.json();
      if (data.error) {
        update({ error: data.error, loading: false });
        return;
      }
      update({ experiments: data.experiments || [], jqlUsed: data.jql || null, loading: false });
    } catch (e) {
      update({ error: e instanceof Error ? e.message : "Failed to fetch", loading: false });
    }
  }, [state.selectedQuery, state.since, state.customJql, query]);

  // Build chart data
  const chartData = (() => {
    if (state.experiments.length === 0) return [];
    const groups: Record<string, Experiment[]> = {};
    for (const exp of state.experiments) {
      const key = query.groupBy(exp);
      if (!groups[key]) groups[key] = [];
      groups[key].push(exp);
    }
    return Object.entries(groups)
      .map(([name, exps]) => ({
        name,
        count: exps.length,
        value: query.metric ? query.metric(exps) : exps.length,
      }))
      .sort((a, b) => {
        if (a.name.match(/^\d{4}-\d{2}/) && b.name.match(/^\d{4}-\d{2}/)) {
          return a.name.localeCompare(b.name);
        }
        return b.value - a.value;
      });
  })();

  const totalValue = chartData.reduce((s, d) => s + d.value, 0);
  const totalAcv = state.experiments.reduce((s, e) => s + (e.estimatedAcv || 0), 0);
  const totalActualAcv = state.experiments.reduce((s, e) => s + (e.actualAcv || 0), 0);
  const uniqueSquads = new Set(state.experiments.map((e) => e.growthSquad).filter(Boolean)).size;

  const chartHeight = compact ? 280 : 400;

  return (
    <div className="space-y-4">
      {/* Query selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className={compact ? "space-y-3" : "grid grid-cols-1 md:grid-cols-5 gap-4"}>
          <div className={compact ? "" : "md:col-span-2"}>
            <label className="block text-xs font-medium text-gray-700 mb-1">Query</label>
            <select
              value={state.selectedQuery}
              onChange={(e) => update({ selectedQuery: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {QUERIES.map((q) => (
                <option key={q.key} value={q.key}>{q.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{query.description}</p>
          </div>

          {query.hasDateFilter && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
                <input
                  type="date"
                  value={state.since}
                  onChange={(e) => update({ since: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
                <input
                  type="date"
                  value={state.until}
                  onChange={(e) => update({ until: e.target.value })}
                  placeholder="No end date"
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div className={compact ? "" : "flex items-end"}>
            <button
              onClick={runQuery}
              disabled={state.loading}
              className="w-full px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.loading ? "Querying..." : "Run"}
            </button>
          </div>
        </div>

        {query.hasCustomJql && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">JQL</label>
            <textarea
              value={state.customJql}
              onChange={(e) => update({ customJql: e.target.value })}
              rows={3}
              placeholder='project IN (NEWXP, PXP) AND issuetype = Experiment AND "Experiment Status" = "Running"'
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* Error */}
      {state.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm">
          {state.error}
        </div>
      )}

      {/* Results */}
      {state.hasQueried && !state.loading && !state.error && state.experiments.length > 0 && (
        <>
          {/* Summary cards */}
          <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-4"} gap-3`}>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{state.experiments.length}</div>
              <div className="text-xs text-gray-500">Experiments</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{uniqueSquads}</div>
              <div className="text-xs text-gray-500">Squads</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{formatAcv(totalAcv)}</div>
              <div className="text-xs text-gray-500">Est. ACV</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{formatAcv(totalActualAcv)}</div>
              <div className="text-xs text-gray-500">Actual ACV</div>
            </div>
          </div>

          {/* Chart */}
          {query.chartType !== "table-only" && chartData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">
                {query.label}
                {query.metricLabel && ` — ${query.metricLabel}: ${formatAcv(totalValue)}`}
                {!query.metricLabel && ` — ${totalValue} total`}
              </h3>

              {query.chartType === "pie" ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={compact ? 90 : 150}
                      label={({ name, value }) =>
                        `${name}: ${query.metric ? formatAcv(value) : value}`
                      }
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        query.metric ? formatAcv(Number(value)) : value
                      }
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={chartData} margin={{ bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: compact ? 9 : 11 }}
                      angle={-35}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={query.metric ? (v: number) => formatAcv(v) : undefined}
                    />
                    <Tooltip
                      formatter={(value) =>
                        query.metric ? formatAcv(Number(value)) : value
                      }
                    />
                    <Bar
                      dataKey="value"
                      name={query.metricLabel || "Count"}
                      fill="#3B82F6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Data table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900">
                Results ({state.experiments.length})
              </h3>
              {state.jqlUsed && (
                <button
                  onClick={() => navigator.clipboard.writeText(state.jqlUsed!)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                  title={state.jqlUsed}
                >
                  Copy JQL
                </button>
              )}
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Summary</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Squad</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Start</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">End</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Est. ACV</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actual ACV</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">DRI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {state.experiments.map((exp) => (
                    <tr key={exp.key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <a
                          href={exp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {exp.key}
                        </a>
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate">{exp.summary}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          exp.experimentStatus === "Running" ? "bg-blue-100 text-blue-700"
                            : exp.experimentStatus === "GA Complete" ? "bg-emerald-100 text-emerald-700"
                            : exp.experimentStatus === "Cancelled" || exp.experimentStatus === "Paused/Issues" ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {exp.experimentStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{exp.growthSquad || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatShortDate(exp.experimentStartDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatShortDate(exp.experimentEndDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-gray-900">
                        {exp.estimatedAcv ? formatAcv(exp.estimatedAcv) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-gray-900">
                        {exp.actualAcv ? formatAcv(exp.actualAcv) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{exp.dri || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {state.hasQueried && !state.loading && !state.error && state.experiments.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No results. Try adjusting the date range or query.</p>
        </div>
      )}

      {/* Initial state */}
      {!state.hasQueried && !state.loading && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Select a query and click Run</p>
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function JiraExplore() {
  const [compareMode, setCompareMode] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">
          {compareMode ? "Side-by-Side Comparison" : "Explore Jira Data"}
        </h2>
        <button
          onClick={() => setCompareMode(!compareMode)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            compareMode
              ? "bg-gray-900 text-white"
              : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          }`}
        >
          {compareMode ? "Single View" : "Compare Side-by-Side"}
        </button>
      </div>

      {compareMode ? (
        <div className="grid grid-cols-2 gap-4">
          <ExplorePanel compact />
          <ExplorePanel compact />
        </div>
      ) : (
        <ExplorePanel compact={false} />
      )}
    </div>
  );
}
