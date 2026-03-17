import { NextRequest, NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";

const PROJECTS = "NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET, GRO";

const FIELDS = [
  "summary",
  "status",
  "created",
  "updated",
  "customfield_19103", // Experiment Status
  "customfield_18803", // Experiment Start Date
  "customfield_14505", // Experiment End Date
  "customfield_18503", // GA Launch Date
  "customfield_10611", // Expected Launch START Date
  "customfield_19001", // Estimated ACV
  "customfield_19000", // Actual ACV
  "customfield_18500", // Experiment DRI
  "customfield_18801", // Product Category
  "customfield_18401", // Growth Squad
];

interface QueryTemplate {
  jql: (params: Record<string, string>) => string;
}

function dateRange(p: Record<string, string>, field: string): string {
  const since = p.since || "2025-01-01";
  const until = p.until;
  if (until) {
    return `"${field}" >= "${since}" AND "${field}" <= "${until}"`;
  }
  return `"${field}" >= "${since}"`;
}

const QUERIES: Record<string, QueryTemplate> = {
  "experiments-by-status": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Experiment Start Date")}
        ORDER BY "Experiment Start Date" ASC`,
  },
  "experiments-by-squad": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Experiment Start Date")}
        ORDER BY "Growth Squad" ASC`,
  },
  "acv-by-squad": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Experiment Start Date")}
        AND "Estimated ACV" > 0
        ORDER BY "Growth Squad" ASC`,
  },
  "acv-by-category": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Experiment Start Date")}
        AND "Estimated ACV" > 0
        ORDER BY "Product Category" ASC`,
  },
  "monthly-velocity": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Experiment Start Date")}
        ORDER BY "Experiment Start Date" ASC`,
  },
  "ga-tracker": {
    jql: (p) =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND ${dateRange(p, "Expected Launch START Date")}
        AND (status = Done OR "Experiment Status" = "GA Complete")
        ORDER BY "Expected Launch START Date" ASC`,
  },
  "active-experiments": {
    jql: () =>
      `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment)
        AND "Experiment Status" IN ("Running", "Development", "Planning")
        AND "Experiment Start Date" IS NOT EMPTY
        ORDER BY "Experiment Start Date" DESC`,
  },
  "custom-jql": {
    jql: (p) => p.jql || `project IN (${PROJECTS}) AND issuetype IN (Epic, Experiment) ORDER BY created DESC`,
  },
};

export async function GET(request: NextRequest) {
  try {
    const queryType = request.nextUrl.searchParams.get("query") || "experiments-by-status";
    const paramsJson = request.nextUrl.searchParams.get("params") || "{}";
    const params = JSON.parse(paramsJson) as Record<string, string>;

    const template = QUERIES[queryType];
    if (!template) {
      return NextResponse.json({ error: `Unknown query: ${queryType}` }, { status: 400 });
    }

    const jql = template.jql(params);
    const issues = await searchAllIssues(jql, FIELDS);

    const experiments = issues.map((issue) => {
      const f = issue.fields as Record<string, unknown>;
      const driField = f.customfield_18500 as Array<{ displayName?: string }> | null;
      const squadField = f.customfield_18401 as { value?: string } | null;
      const categoryField = f.customfield_18801 as { value?: string } | null;

      return {
        key: issue.key,
        summary: issue.fields.summary,
        url: `https://jira.tinyspeck.com/browse/${issue.key}`,
        status: issue.fields.status.name,
        experimentStatus: (f.customfield_19103 as { value?: string })?.value || "Unknown",
        experimentStartDate: (f.customfield_18803 as string) || null,
        experimentEndDate: (f.customfield_14505 as string) || null,
        expectedLaunchStartDate: (f.customfield_10611 as string) || null,
        estimatedAcv: (f.customfield_19001 as number) ?? null,
        actualAcv: (f.customfield_19000 as number) ?? null,
        dri: driField?.[0]?.displayName || null,
        productCategory: categoryField?.value || null,
        growthSquad: squadField?.value || null,
        created: issue.fields.created,
      };
    });

    return NextResponse.json({ experiments, jql, total: experiments.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
