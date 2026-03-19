import fs from "fs/promises";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".houston-tokens.json");
const MCP_URL = "https://houston.tinyspeck.com/api/mcp";
const TOKEN_URL = "https://toolbelt.tinyspeck.com/oauth/token";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function refreshToken(): Promise<string> {
  const raw = await fs.readFile(TOKEN_FILE, "utf-8");
  const data = JSON.parse(raw);

  if (!data.refresh_token || !data.client_id) {
    throw new Error("No refresh token. Run: node scripts/houston-auth.mjs");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      client_id: data.client_id,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}). Run: node scripts/houston-auth.mjs`);
  }

  const tokens = await res.json() as Record<string, unknown>;
  const newData = {
    access_token: tokens.access_token as string,
    refresh_token: (tokens.refresh_token as string) || data.refresh_token,
    token_type: tokens.token_type as string,
    expires_at: Date.now() + ((tokens.expires_in as number) || 3600) * 1000,
    client_id: data.client_id,
    saved_at: new Date().toISOString(),
  };

  await fs.writeFile(TOKEN_FILE, JSON.stringify(newData, null, 2));
  cachedToken = newData.access_token;
  tokenExpiresAt = newData.expires_at;
  return cachedToken;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;

  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw);
    const expiresAt = data.expires_at as number || 0;

    // If token is expired or about to expire, refresh
    if (Date.now() > expiresAt - 60000) {
      return await refreshToken();
    }

    cachedToken = data.access_token;
    tokenExpiresAt = expiresAt;
    return cachedToken!;
  } catch {
    throw new Error("No Houston token found. Run: node scripts/houston-auth.mjs");
  }
}

// Parse SSE or JSON response from Houston MCP
function parseSSEResponse(raw: string): string {
  // Parse SSE: look for "data: {...}" lines
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) {
      const json = JSON.parse(line.slice(6));
      const content = json.result?.content || [];
      const textPart = content.find((c: { type: string; text?: string }) => c.type === "text");
      return textPart?.text || "";
    }
  }

  // Fallback: try parsing as direct JSON
  try {
    const json = JSON.parse(raw);
    const content = json.result?.content || [];
    const textPart = content.find((c: { type: string; text?: string }) => c.type === "text");
    return textPart?.text || "";
  } catch {
    return "";
  }
}

function buildMcpRequest(toolName: string, args: Record<string, unknown>) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    } as Record<string, string>,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now(),
    }),
  };
}

// Houston MCP returns SSE format
export async function callHoustonMcp(toolName: string, args: Record<string, unknown>): Promise<string> {
  const token = await getToken();

  const req = buildMcpRequest(toolName, args);
  req.headers.Authorization = `Bearer ${token}`;

  const res = await fetch(MCP_URL, { ...req, signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    if (res.status === 401) {
      // Try refreshing the token once
      cachedToken = null;
      tokenExpiresAt = 0;
      const newToken = await refreshToken();
      const retryReq = buildMcpRequest(toolName, args);
      retryReq.headers.Authorization = `Bearer ${newToken}`;
      const retryRes = await fetch(MCP_URL, { ...retryReq, signal: AbortSignal.timeout(15000) });
      if (!retryRes.ok) {
        throw new Error("Houston token expired. Run: node scripts/houston-auth.mjs");
      }
      return parseSSEResponse(await retryRes.text());
    }
    throw new Error(`Houston MCP returned ${res.status}`);
  }

  return parseSSEResponse(await res.text());
}

export async function isHoustonConnected(): Promise<boolean> {
  try {
    await getToken();
    return true;
  } catch {
    return false;
  }
}

// --- Types for Houston experiment data ---

export interface HoustonExperiment {
  id: number;
  name: string;
  type: string;
  status: "draft" | "scheduled" | "active" | "paused" | "finished" | "archived";
  toggleType: string;
  owner: string;
  summary: string;
  jiraKey: string | null;
  groups: string[];
  rolloutPercent: number | null;
  tags: string[];
  dateCreated: string;
  dateUpdated: string;
  channelName: string | null;
}

export interface ExperimentHealth {
  experimentId: number;
  srmIssue: boolean;
  exposureCount: number;
  hasMetrics: boolean;
}

export interface MetricResult {
  metricName: string;
  effectSize: number | null;
  pValue: number | null;
  isSignificant: boolean;
  direction: "positive" | "negative" | "neutral";
  confidenceInterval?: { lower: number; upper: number };
}

export interface ExperimentSummary {
  experiment: HoustonExperiment;
  health?: ExperimentHealth;
  primaryMetrics: MetricResult[];
}

// --- Parse helpers ---

function parseExperimentStatus(exp: Record<string, unknown>): HoustonExperiment["status"] {
  const schedule = exp.schedule as Array<{ state?: string }> | undefined;
  if (!schedule || schedule.length === 0) return "draft";
  const lastState = schedule[schedule.length - 1]?.state;
  if (lastState === "finished") return "finished";
  if (lastState === "running") return "active";
  if (lastState === "paused") return "paused";
  return "scheduled";
}

function parseRolloutPercent(exp: Record<string, unknown>): number | null {
  const schedule = exp.schedule as Array<{
    state?: string;
    group_basis_points?: number[];
    launch_basis_points?: number;
  }> | undefined;
  if (!schedule || schedule.length === 0) return null;
  const last = schedule[schedule.length - 1];
  if (last.launch_basis_points) return last.launch_basis_points / 100;
  if (last.group_basis_points) {
    const total = last.group_basis_points.reduce((a, b) => a + b, 0);
    return total / 100;
  }
  return null;
}

function parseJiraKey(jiraField: unknown): string | null {
  if (!jiraField || typeof jiraField !== "string") return null;
  const match = (jiraField as string).match(/browse\/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

function parseExperiment(raw: Record<string, unknown>): HoustonExperiment {
  const meta = raw.ts_metadata as Record<string, unknown> | undefined;
  const groups = raw.groups as { names?: string[] } | undefined;

  return {
    id: raw.id as number,
    name: raw.name as string,
    type: raw.type as string,
    status: parseExperimentStatus(raw),
    toggleType: (meta?.toggle_type as string) || "unknown",
    owner: (meta?.owner as string) || "unknown",
    summary: (meta?.summary as string) || "",
    jiraKey: parseJiraKey(meta?.jira),
    groups: groups?.names || [],
    rolloutPercent: parseRolloutPercent(raw),
    tags: (meta?.tags as string[]) || [],
    dateCreated: new Date((raw.date_create as number) * 1000).toISOString(),
    dateUpdated: new Date((raw.date_update as number) * 1000).toISOString(),
    channelName: (meta?.channel_name as string) || null,
  };
}

// --- Public API ---

// Search Houston for experiments matching JIRA project prefixes,
// then filter to experiments linked to specific JIRA keys via ts_metadata.jira.
// This is fast (~1s for 8 prefixes) vs fetching all 9500+ experiments.
export async function batchFindExperiments(
  jiraKeys: string[]
): Promise<Map<string, HoustonExperiment[]>> {
  const results = new Map<string, HoustonExperiment[]>();
  if (jiraKeys.length === 0) return results;

  const keySet = new Set(jiraKeys);
  const prefixes = [...new Set(jiraKeys.map((k) => k.split("-")[0]))];
  const seen = new Set<number>();

  // Search by each JIRA project prefix in parallel
  const prefixResults = await Promise.all(
    prefixes.map(async (prefix) => {
      try {
        const text = await callHoustonMcp("search_experiments", {
          query: prefix,
          limit: 1000,
        });
        const data = JSON.parse(text);
        return (data.experiments || []) as Record<string, unknown>[];
      } catch {
        return [];
      }
    })
  );

  for (const experiments of prefixResults) {
    for (const raw of experiments) {
      const id = raw.id as number;
      if (seen.has(id)) continue;
      seen.add(id);

      const meta = raw.ts_metadata as Record<string, unknown> | undefined;
      const jiraUrl = meta?.jira as string | undefined;
      if (!jiraUrl) continue;

      const jiraKey = parseJiraKey(jiraUrl);
      if (!jiraKey || !keySet.has(jiraKey)) continue;

      const experiment = parseExperiment(raw);
      if (!results.has(jiraKey)) results.set(jiraKey, []);
      results.get(jiraKey)!.push(experiment);
    }
  }

  return results;
}

// Parse Houston markdown responses (they return markdown tables, not JSON)

function parseExposuresMarkdown(text: string): { totalExposures: number; srmIssue: boolean } {
  // Extract total from "| **Total** | **373** |" pattern
  const totalMatch = text.match(/\*\*Total\*\*\s*\|\s*\*\*([0-9,]+)\*\*/);
  const totalExposures = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 0;

  // Extract SRM from "p-value = 0.0083" pattern
  const srmMatch = text.match(/p-value\s*=\s*([0-9.]+)/);
  const srmPValue = srmMatch ? parseFloat(srmMatch[1]) : 1;
  const srmIssue = srmPValue < 0.01;

  return { totalExposures, srmIssue };
}

function parseMetricMetadataMarkdown(text: string): boolean {
  // Check if any metric groups exist: "Found N metric group(s)"
  const match = text.match(/Found (\d+) metric group/);
  return match ? parseInt(match[1], 10) > 0 : false;
}

function parseResultsMarkdown(text: string): MetricResult[] {
  // Parse markdown table rows like:
  // | first_login_users | treatment | 23.34% | 0.5254 | No | 111.68% |
  const results: MetricResult[] = [];
  const seen = new Set<string>();

  for (const line of text.split("\n")) {
    // Skip header and separator rows
    if (!line.startsWith("|") || line.includes("---") || line.includes("Metric")) continue;

    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 5) continue;

    const metricName = cells[0];
    // Deduplicate by metric name (results often have multiple rows per metric for different windows)
    if (seen.has(metricName)) continue;
    seen.add(metricName);

    const relChangeStr = cells[2]?.replace("%", "") || "0";
    const effectSize = parseFloat(relChangeStr) / 100;
    const pValue = parseFloat(cells[3] || "1");
    const isSignificant = cells[4]?.toLowerCase() === "yes";

    let direction: MetricResult["direction"] = "neutral";
    if (effectSize > 0) direction = "positive";
    else if (effectSize < 0) direction = "negative";

    results.push({ metricName, effectSize, pValue, isSignificant, direction });
  }

  return results.slice(0, 5);
}

// Get experiment health (SRM, exposures, metrics existence)
export async function getExperimentHealth(experimentId: number): Promise<ExperimentHealth | null> {
  try {
    const [expText, metaText] = await Promise.all([
      callHoustonMcp("get_experiment_exposures", { experimentId }),
      callHoustonMcp("get_experiment_metric_metadata", { experimentId }),
    ]);

    const { totalExposures, srmIssue } = parseExposuresMarkdown(expText);
    const hasMetrics = parseMetricMetadataMarkdown(metaText);

    return { experimentId, srmIssue, exposureCount: totalExposures, hasMetrics };
  } catch {
    return null;
  }
}

// Get metric results for an experiment
export async function getExperimentResults(experimentId: number): Promise<MetricResult[]> {
  try {
    const text = await callHoustonMcp("get_experiment_results", { experimentId });
    return parseResultsMarkdown(text);
  } catch {
    return [];
  }
}

// Full summary for an experiment: details + health + results
export async function getExperimentSummary(experiment: HoustonExperiment): Promise<ExperimentSummary> {
  const isRunning = experiment.status === "active" || experiment.status === "finished";

  const [health, primaryMetrics] = await Promise.all([
    isRunning ? getExperimentHealth(experiment.id) : Promise.resolve(null),
    isRunning ? getExperimentResults(experiment.id) : Promise.resolve([]),
  ]);

  return { experiment, health: health || undefined, primaryMetrics };
}

// Full pipeline: for a list of JIRA keys, get all linked experiments with health + metrics
export async function getHoustonDataForEpics(
  jiraKeys: string[]
): Promise<Map<string, ExperimentSummary[]>> {
  const experimentsByKey = await batchFindExperiments(jiraKeys);
  const result = new Map<string, ExperimentSummary[]>();

  // Collect all experiments that need enrichment (active/finished ones)
  const allExperiments: Array<{ key: string; exp: HoustonExperiment }> = [];
  for (const [key, exps] of experimentsByKey) {
    for (const exp of exps) {
      allExperiments.push({ key, exp });
    }
  }

  // Enrich in parallel batches (higher concurrency since each experiment needs 2-3 calls)
  const concurrency = 10;
  const summaries: Array<{ key: string; summary: ExperimentSummary }> = [];

  for (let i = 0; i < allExperiments.length; i += concurrency) {
    const batch = allExperiments.slice(i, i + concurrency);
    const batchSummaries = await Promise.all(
      batch.map(async ({ key, exp }) => ({
        key,
        summary: await getExperimentSummary(exp),
      }))
    );
    summaries.push(...batchSummaries);
  }

  for (const { key, summary } of summaries) {
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push(summary);
  }

  return result;
}
