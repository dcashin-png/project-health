import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type { AcvFilters, AcvFilterOptions, AcvRow, AcvDataResult } from "./types";

const execFileAsync = promisify(execFile);

const ATS_URL = "https://analytics.tinyspeck.com/py-api/v1/data-query/run";
const TABLE = "metrics.slack_acv__sales_data";

interface AtsColumn {
  name: string;
  type: string;
}

interface AtsQueryResult {
  ok?: boolean;
  results?: {
    columns: AtsColumn[];
    rows: unknown[][];
  };
  error?: string;
}

async function atsQuery(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const body = JSON.stringify({
    connectionName: "dw",
    query: sql,
    jobId: randomUUID(),
  });

  const { stdout } = await execFileAsync(
    "slack-uberproxy-curl",
    [
      "-s",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-d", body,
      ATS_URL,
    ],
    { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
  );

  const parsed: AtsQueryResult = JSON.parse(stdout);
  if (parsed.results?.columns) {
    return parsed.results;
  }
  throw new Error(parsed.error || `ATS query failed: ${JSON.stringify(parsed).slice(0, 500)}`);
}

async function getLatestDs(): Promise<string> {
  const result = await atsQuery(
    `SELECT MAX(ds) as latest_ds FROM ${TABLE} WHERE ds >= cast(date_add('day', -14, current_date) as varchar)`
  );
  if (result.rows.length === 0 || !result.rows[0][0]) {
    throw new Error("No recent data found in ATS");
  }
  return String(result.rows[0][0]);
}

// Escape a string for use in SQL IN clause — only allows values from a known allowlist
function escapeValue(val: string): string {
  return val.replace(/'/g, "''");
}

function buildInClause(values: string[], allowlist: string[]): string | null {
  const safe = values.filter((v) => allowlist.includes(v));
  if (safe.length === 0) return null;
  return `(${safe.map((v) => `'${escapeValue(v)}'`).join(",")})`;
}

export async function getAcvFilterOptions(): Promise<AcvFilterOptions> {
  const latestDs = await getLatestDs();
  const sql = `
    SELECT 'attribution' as dim, dim_acv_attribution as val FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY dim_acv_attribution
    UNION ALL
    SELECT 'segment', dim_derived_segment_macro_name FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY dim_derived_segment_macro_name
    UNION ALL
    SELECT 'businessLine', dim_l1_business_line FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY dim_l1_business_line
    UNION ALL
    SELECT 'productLine', dim_l2_product_line FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY dim_l2_product_line
    UNION ALL
    SELECT 'region', dim_derived_region FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY dim_derived_region
    UNION ALL
    SELECT 'quarter', fiscal_close_year_quarter_name FROM ${TABLE} WHERE ds = '${latestDs}' GROUP BY fiscal_close_year_quarter_name
  `;

  const result = await atsQuery(sql);
  const options: AcvFilterOptions = {
    attributions: [],
    segments: [],
    businessLines: [],
    productLines: [],
    regions: [],
    quarters: [],
    snapshotDateRange: { min: "", max: "" },
    latestDs,
  };

  for (const row of result.rows) {
    const dim = String(row[0]);
    const val = String(row[1] ?? "");
    if (!val) continue;
    switch (dim) {
      case "attribution": options.attributions.push(val); break;
      case "segment": options.segments.push(val); break;
      case "businessLine": options.businessLines.push(val); break;
      case "productLine": options.productLines.push(val); break;
      case "region": options.regions.push(val); break;
      case "quarter": options.quarters.push(val); break;
    }
  }

  // Get snapshot date range
  const rangeResult = await atsQuery(
    `SELECT MIN(snapshot_date), MAX(snapshot_date) FROM ${TABLE} WHERE ds = '${latestDs}'`
  );
  if (rangeResult.rows.length > 0) {
    options.snapshotDateRange.min = String(rangeResult.rows[0][0] ?? "");
    options.snapshotDateRange.max = String(rangeResult.rows[0][1] ?? "");
  }

  // Sort quarters in reverse order for better UX
  options.quarters.sort().reverse();

  return options;
}

export async function getAcvData(
  filters: AcvFilters,
  filterOptions: AcvFilterOptions
): Promise<AcvDataResult> {
  const latestDs = filterOptions.latestDs;
  const conditions: string[] = [`ds = '${latestDs}'`];

  if (filters.attributions?.length) {
    const clause = buildInClause(filters.attributions, filterOptions.attributions);
    if (clause) conditions.push(`dim_acv_attribution IN ${clause}`);
  }
  if (filters.segments?.length) {
    const clause = buildInClause(filters.segments, filterOptions.segments);
    if (clause) conditions.push(`dim_derived_segment_macro_name IN ${clause}`);
  }
  if (filters.businessLines?.length) {
    const clause = buildInClause(filters.businessLines, filterOptions.businessLines);
    if (clause) conditions.push(`dim_l1_business_line IN ${clause}`);
  }
  if (filters.productLines?.length) {
    const clause = buildInClause(filters.productLines, filterOptions.productLines);
    if (clause) conditions.push(`dim_l2_product_line IN ${clause}`);
  }
  if (filters.regions?.length) {
    const clause = buildInClause(filters.regions, filterOptions.regions);
    if (clause) conditions.push(`dim_derived_region IN ${clause}`);
  }
  if (filters.quarters?.length) {
    const clause = buildInClause(filters.quarters, filterOptions.quarters);
    if (clause) conditions.push(`fiscal_close_year_quarter_name IN ${clause}`);
  }
  if (filters.snapshotDateStart) {
    conditions.push(`snapshot_date >= '${escapeValue(filters.snapshotDateStart)}'`);
  }
  if (filters.snapshotDateEnd) {
    conditions.push(`snapshot_date <= '${escapeValue(filters.snapshotDateEnd)}'`);
  }

  const sql = `
    SELECT
      snapshot_date,
      dim_acv_attribution,
      dim_derived_segment_macro_name,
      dim_l1_business_line,
      dim_l2_product_line,
      dim_derived_region,
      fiscal_close_year_quarter_name,
      SUM(slack_acv_by_month_end_snapshot) as acv
    FROM ${TABLE}
    WHERE ${conditions.join(" AND ")}
    GROUP BY
      snapshot_date,
      dim_acv_attribution,
      dim_derived_segment_macro_name,
      dim_l1_business_line,
      dim_l2_product_line,
      dim_derived_region,
      fiscal_close_year_quarter_name
    ORDER BY snapshot_date
  `;

  const result = await atsQuery(sql);
  const colIdx = Object.fromEntries(
    result.columns.map((c: string | { name: string }, i: number) => [typeof c === "string" ? c : c.name, i])
  );

  const rows: AcvRow[] = result.rows.map((row) => ({
    snapshotDate: String(row[colIdx["snapshot_date"]] ?? ""),
    attribution: String(row[colIdx["dim_acv_attribution"]] ?? ""),
    segment: String(row[colIdx["dim_derived_segment_macro_name"]] ?? ""),
    businessLine: String(row[colIdx["dim_l1_business_line"]] ?? ""),
    productLine: String(row[colIdx["dim_l2_product_line"]] ?? ""),
    region: String(row[colIdx["dim_derived_region"]] ?? ""),
    quarter: String(row[colIdx["fiscal_close_year_quarter_name"]] ?? ""),
    acv: Number(row[colIdx["acv"]] ?? 0),
  }));

  const totalAcv = rows.reduce((sum, r) => sum + r.acv, 0);

  return { rows, totalAcv, latestDs };
}
