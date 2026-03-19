"use client";

import { useState, useCallback } from "react";

// --- Types ---

interface HoustonExperiment {
  id: number;
  name: string;
  type: string;
  status: string;
  owner: string;
  summary: string;
  jiraUrl: string | null;
  jiraKey: string | null;
  rolloutPercent: number | null;
  tags: string[];
  dateCreated: string;
  dateUpdated: string;
  channelName: string | null;
  groups: string[];
}

interface ExperimentDetail {
  experiment: HoustonExperiment;
  health: { srmPValue: string; exposures: string; hasMetrics: boolean } | null;
  metrics: MetricRow[];
  guardrails: GuardrailRow[];
}

interface MetricRow {
  name: string;
  group: string;
  relChange: string;
  pValue: string;
  significant: string;
  power: string;
}

interface GuardrailRow {
  name: string;
  relChange: string;
  pValue: string;
  regression: boolean;
}

type QueryType = "active" | "search" | "recent-rollouts" | "by-owner" | "by-status" | "summary";

interface QueryOption {
  key: QueryType;
  label: string;
  description: string;
}

const QUERIES: QueryOption[] = [
  { key: "active", label: "Active Experiments", description: "All currently running experiments" },
  { key: "search", label: "Search", description: "Search experiments by name, description, or tags" },
  { key: "recent-rollouts", label: "Recent Rollouts", description: "Experiments launched in the last N hours" },
  { key: "by-owner", label: "By Owner", description: "Find experiments by username" },
  { key: "by-status", label: "By Status", description: "Filter experiments by status" },
  { key: "summary", label: "Summary", description: "High-level stats across all experiments" },
];

const STATUS_OPTIONS = ["active", "draft", "scheduled", "paused", "finished", "archived", "all"] as const;

// --- Helpers ---

function parseExperiment(raw: Record<string, unknown>): HoustonExperiment {
  const meta = raw.ts_metadata as Record<string, unknown> | undefined;
  const groups = raw.groups as { names?: string[] } | undefined;
  const schedule = raw.schedule as Array<{ state?: string; group_basis_points?: number[]; launch_basis_points?: number }> | undefined;

  let status = "draft";
  if (schedule && schedule.length > 0) {
    const last = schedule[schedule.length - 1]?.state;
    if (last === "finished") status = "finished";
    else if (last === "running") status = "active";
    else if (last === "paused") status = "paused";
    else status = "scheduled";
  }

  let rolloutPercent: number | null = null;
  if (schedule && schedule.length > 0) {
    const last = schedule[schedule.length - 1];
    if (last.launch_basis_points) rolloutPercent = last.launch_basis_points / 100;
    else if (last.group_basis_points) {
      rolloutPercent = last.group_basis_points.reduce((a, b) => a + b, 0) / 100;
    }
  }

  const jiraUrl = (meta?.jira as string) || null;
  let jiraKey: string | null = null;
  if (jiraUrl) {
    const m = jiraUrl.match(/browse\/([A-Z]+-\d+)/);
    jiraKey = m ? m[1] : null;
  }

  return {
    id: raw.id as number,
    name: raw.name as string,
    type: raw.type as string,
    status,
    owner: (meta?.owner as string) || "unknown",
    summary: (meta?.summary as string) || "",
    jiraUrl,
    jiraKey,
    rolloutPercent,
    tags: (meta?.tags as string[]) || [],
    groups: groups?.names || [],
    dateCreated: raw.date_create ? new Date((raw.date_create as number) * 1000).toISOString() : "",
    dateUpdated: raw.date_update ? new Date((raw.date_update as number) * 1000).toISOString() : "",
    channelName: (meta?.channel_name as string) || null,
  };
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(2)}`;
}

function parseMarkdownTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || line.includes("---")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700",
  finished: "bg-emerald-100 text-emerald-700",
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-yellow-100 text-yellow-700",
  paused: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

// --- API helper ---

async function callHouston(tool: string, args: Record<string, unknown> = {}): Promise<{ data?: unknown; text?: string; error?: string }> {
  const res = await fetch(
    `/api/houston?tool=${encodeURIComponent(tool)}&args=${encodeURIComponent(JSON.stringify(args))}`
  );
  return res.json();
}

// --- Detail Panel ---

function ExperimentDetailPanel({ experimentId, onClose }: { experimentId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    (async () => {
      try {
        const [detailRes, healthRes, resultsRes, guardrailRes] = await Promise.all([
          callHouston("get_experiment_details", { experimentId }),
          callHouston("get_experiment_health", { experimentId }),
          callHouston("get_experiment_results", { experimentId }),
          callHouston("get_guardrail_metrics", { experimentId }),
        ]);

        if (detailRes.error) {
          setError(detailRes.error);
          setLoading(false);
          return;
        }

        // Parse experiment
        const rawExp = (detailRes.data as Record<string, unknown>)?.experiment || detailRes.data;
        const experiment = parseExperiment(rawExp as Record<string, unknown>);

        // Parse health from markdown
        const healthText = healthRes.text || "";
        const srmMatch = healthText.match(/p-value\s*=\s*([0-9.]+)/);
        const totalMatch = healthText.match(/\*\*Total\*\*\s*\|\s*\*\*([0-9,]+)\*\*/);
        const health = healthText ? {
          srmPValue: srmMatch ? srmMatch[1] : "N/A",
          exposures: totalMatch ? totalMatch[1] : "0",
          hasMetrics: false,
        } : null;

        // Parse metric results from markdown
        const resultsText = resultsRes.text || "";
        const resultRows = parseMarkdownTable(resultsText);
        const metrics: MetricRow[] = [];
        for (let i = 1; i < resultRows.length; i++) {
          const r = resultRows[i];
          if (r.length >= 5) {
            metrics.push({
              name: r[0],
              group: r[1] || "",
              relChange: r[2] || "",
              pValue: r[3] || "",
              significant: r[4] || "",
              power: r[5] || "",
            });
          }
        }
        if (health) health.hasMetrics = metrics.length > 0;

        // Parse guardrails from markdown
        const guardrailText = guardrailRes.text || "";
        const guardrailRows = parseMarkdownTable(guardrailText);
        const guardrails: GuardrailRow[] = [];
        for (let i = 1; i < guardrailRows.length; i++) {
          const r = guardrailRows[i];
          if (r.length >= 3) {
            guardrails.push({
              name: r[0],
              relChange: r[1] || "",
              pValue: r[2] || "",
              regression: (r[3] || "").toLowerCase().includes("yes") || (r[3] || "").toLowerCase().includes("regression"),
            });
          }
        }

        setDetail({ experiment, health, metrics, guardrails });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load details");
      } finally {
        setLoading(false);
      }
    })();
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-16 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Experiment #{experimentId}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          {loading && <div className="text-center py-8 text-gray-500">Loading experiment details...</div>}
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm">{error}</div>}

          {detail && (
            <>
              {/* Header */}
              <div>
                <h4 className="text-base font-semibold text-gray-900">{detail.experiment.name}</h4>
                <p className="text-sm text-gray-600 mt-1">{detail.experiment.summary}</p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[detail.experiment.status] || "bg-gray-100 text-gray-600"}`}>
                    {detail.experiment.status}
                  </span>
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                    {detail.experiment.type}
                  </span>
                  {detail.experiment.rolloutPercent !== null && (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                      {detail.experiment.rolloutPercent}% rollout
                    </span>
                  )}
                  {detail.experiment.jiraKey && (
                    <a
                      href={detail.experiment.jiraUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:underline"
                    >
                      {detail.experiment.jiraKey}
                    </a>
                  )}
                </div>
              </div>

              {/* Health */}
              {detail.health && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-700 uppercase mb-2">Health</h5>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <div className="text-lg font-bold text-gray-900">{detail.health.exposures}</div>
                      <div className="text-xs text-gray-500">Exposures</div>
                    </div>
                    <div className={`rounded p-2 text-center ${parseFloat(detail.health.srmPValue) < 0.01 ? "bg-red-50" : "bg-gray-50"}`}>
                      <div className="text-lg font-bold text-gray-900">{detail.health.srmPValue}</div>
                      <div className="text-xs text-gray-500">SRM p-value</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <div className="text-lg font-bold text-gray-900">{detail.health.hasMetrics ? "Yes" : "No"}</div>
                      <div className="text-xs text-gray-500">Has Metrics</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Metric Results */}
              {detail.metrics.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-700 uppercase mb-2">Metric Results</h5>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Metric</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Group</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rel Change</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">p-value</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sig?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detail.metrics.map((m, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-medium text-gray-900">{m.name}</td>
                            <td className="px-3 py-1.5 text-gray-600">{m.group}</td>
                            <td className="px-3 py-1.5 text-right text-gray-900">{m.relChange}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{m.pValue}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                                m.significant.toLowerCase() === "yes" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                              }`}>
                                {m.significant}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Guardrails */}
              {detail.guardrails.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-700 uppercase mb-2">Guardrail Metrics</h5>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Metric</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rel Change</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">p-value</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Regression?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detail.guardrails.map((g, i) => (
                          <tr key={i} className={g.regression ? "bg-red-50" : "hover:bg-gray-50"}>
                            <td className="px-3 py-1.5 font-medium text-gray-900">{g.name}</td>
                            <td className="px-3 py-1.5 text-right text-gray-900">{g.relChange}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{g.pValue}</td>
                            <td className="px-3 py-1.5 text-center">
                              {g.regression && (
                                <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                  Regression
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="text-xs text-gray-400 space-y-1">
                <div>Owner: {detail.experiment.owner} | Groups: {detail.experiment.groups.join(", ") || "—"}</div>
                <div>Created: {formatDate(detail.experiment.dateCreated)} | Updated: {formatDate(detail.experiment.dateUpdated)}</div>
                {detail.experiment.channelName && <div>Channel: #{detail.experiment.channelName}</div>}
                {detail.experiment.tags.length > 0 && <div>Tags: {detail.experiment.tags.join(", ")}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export function HoustonDashboard() {
  const [queryType, setQueryType] = useState<QueryType>("active");
  const [searchText, setSearchText] = useState("");
  const [ownerText, setOwnerText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [hoursBack, setHoursBack] = useState(24);
  const [experiments, setExperiments] = useState<HoustonExperiment[]>([]);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const query = QUERIES.find((q) => q.key === queryType)!;

  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasQueried(true);
    setSummaryText(null);

    try {
      let result: { data?: unknown; text?: string; error?: string };

      switch (queryType) {
        case "active":
          result = await callHouston("get_active_rollouts", { limit: 200 });
          break;
        case "search":
          if (!searchText.trim()) {
            setError("Enter a search term");
            setLoading(false);
            return;
          }
          result = await callHouston("search_experiments", { query: searchText, limit: 200 });
          break;
        case "recent-rollouts":
          result = await callHouston("get_recent_rollouts", { hours: hoursBack, limit: 200 });
          break;
        case "by-owner":
          if (!ownerText.trim()) {
            setError("Enter a username");
            setLoading(false);
            return;
          }
          result = await callHouston("find_experiments_by_user", { username: ownerText });
          break;
        case "by-status":
          result = await callHouston("get_experiments_by_status", { status: statusFilter, limit: 200 });
          break;
        case "summary":
          result = await callHouston("get_experiments_summary", {});
          if (result.text) {
            setSummaryText(result.text);
          } else if (result.data) {
            setSummaryText(JSON.stringify(result.data, null, 2));
          }
          setExperiments([]);
          setLoading(false);
          return;
        default:
          result = { error: "Unknown query type" };
      }

      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }

      // Parse experiments from response
      const data = result.data as Record<string, unknown> | undefined;
      const rawExps = (data?.experiments || []) as Record<string, unknown>[];
      const parsed = rawExps.map(parseExperiment);
      setExperiments(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [queryType, searchText, ownerText, statusFilter, hoursBack]);

  // Stats
  const statusCounts: Record<string, number> = {};
  for (const exp of experiments) {
    statusCounts[exp.status] = (statusCounts[exp.status] || 0) + 1;
  }
  const ownerCounts = new Set(experiments.map((e) => e.owner)).size;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-700">Houston Experiments</h2>

      {/* Query selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Query</label>
            <select
              value={queryType}
              onChange={(e) => setQueryType(e.target.value as QueryType)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {QUERIES.map((q) => (
                <option key={q.key} value={q.key}>{q.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{query.description}</p>
          </div>

          {queryType === "search" && (
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Experiment name, tag, or keyword..."
                onKeyDown={(e) => e.key === "Enter" && runQuery()}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {queryType === "by-owner" && (
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={ownerText}
                onChange={(e) => setOwnerText(e.target.value)}
                placeholder="e.g. jsmith"
                onKeyDown={(e) => e.key === "Enter" && runQuery()}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {queryType === "by-status" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          )}

          {queryType === "recent-rollouts" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Hours Back</label>
              <input
                type="number"
                value={hoursBack}
                onChange={(e) => setHoursBack(Math.min(168, Math.max(1, parseInt(e.target.value) || 24)))}
                min={1}
                max={168}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="flex items-end">
            <button
              onClick={runQuery}
              disabled={loading}
              className="w-full px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Run"}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Summary view */}
      {summaryText && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Experiment Summary</h3>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded p-3">
            {summaryText}
          </pre>
        </div>
      )}

      {/* Results */}
      {hasQueried && !loading && !error && experiments.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{experiments.length}</div>
              <div className="text-xs text-gray-500">Experiments</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{ownerCounts}</div>
              <div className="text-xs text-gray-500">Owners</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-blue-600">{statusCounts["active"] || 0}</div>
              <div className="text-xs text-gray-500">Active</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-emerald-600">{statusCounts["finished"] || 0}</div>
              <div className="text-xs text-gray-500">Finished</div>
            </div>
          </div>

          {/* Experiment table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-900">Results ({experiments.length})</h3>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rollout</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">JIRA</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {experiments.map((exp) => (
                    <tr
                      key={exp.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedId(exp.id)}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-blue-600 font-medium">{exp.id}</td>
                      <td className="px-3 py-2 max-w-xs">
                        <div className="truncate font-medium text-gray-900">{exp.name}</div>
                        {exp.summary && <div className="truncate text-xs text-gray-400">{exp.summary}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[exp.status] || "bg-gray-100 text-gray-600"}`}>
                          {exp.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{exp.type}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{exp.owner}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {exp.rolloutPercent !== null ? `${exp.rolloutPercent}%` : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {exp.jiraKey ? (
                          <a
                            href={exp.jiraUrl || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {exp.jiraKey}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(exp.dateUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {hasQueried && !loading && !error && experiments.length === 0 && !summaryText && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No experiments found. Try a different query.</p>
        </div>
      )}

      {/* Initial state */}
      {!hasQueried && !loading && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Select a query and click Run</p>
        </div>
      )}

      {/* Detail modal */}
      {selectedId !== null && (
        <ExperimentDetailPanel experimentId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
