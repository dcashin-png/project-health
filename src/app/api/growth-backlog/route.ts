import { NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";

const BACKLOG_JQL = `project IN (NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET)
  AND issuetype in (Epic, Experiment)
  AND "Growth Squad" is not EMPTY
  AND status != Done
  ORDER BY status ASC, priority DESC, updated DESC`;

const FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "issuetype",
  "customfield_19103", // Experiment Status
  "customfield_18803", // Experiment Start Date
  "customfield_14505", // Experiment End Date
  "customfield_18500", // Experiment DRI
  "customfield_18401", // Growth Squad
  "customfield_18801", // Product Category
  "customfield_19001", // Estimated ACV
  "customfield_19000", // Actual ACV
];

// Sub-pillar -> squad mapping
const SUB_PILLARS: Record<string, string[]> = {
  "Acquire Demand": ["Acquire demand"],
  "Activate": ["Acquire demand", "Creator"],
  "Convert": ["Path to Paid", "Upgrades & add-ons", "Capture demand"],
  "Retain": ["Seat expansion", "Joiner"],
};

export interface BacklogItem {
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

function mapIssue(issue: ReturnType<typeof Object>): BacklogItem {
  const f = issue.fields as Record<string, unknown>;
  const driField = f.customfield_18500 as
    | Array<{ displayName?: string; name?: string }>
    | null;
  const squadField = f.customfield_18401 as { value?: string } | null;
  const productCategoryField = f.customfield_18801 as { value?: string } | null;
  const statusField = f.status as { name: string };
  const priorityField = f.priority as { name: string } | null;
  const issueTypeField = f.issuetype as { name: string };

  return {
    key: issue.key as string,
    summary: (f.summary as string) || "",
    url: `https://jira.tinyspeck.com/browse/${issue.key}`,
    status: statusField?.name || "Unknown",
    issueType: issueTypeField?.name || "Unknown",
    priority: priorityField?.name || "Medium",
    experimentStatus: (f.customfield_19103 as { value?: string })?.value || null,
    experimentStartDate: (f.customfield_18803 as string) || null,
    experimentEndDate: (f.customfield_14505 as string) || null,
    assignee: (f.assignee as { displayName?: string } | null)?.displayName || null,
    dri: driField?.[0]?.displayName || driField?.[0]?.name || null,
    growthSquad: squadField?.value || "Unknown",
    productCategory: productCategoryField?.value || null,
    estimatedAcv: (f.customfield_19001 as number) ?? null,
    actualAcv: (f.customfield_19000 as number) ?? null,
  };
}

export async function GET() {
  try {
    const issues = await searchAllIssues(BACKLOG_JQL, FIELDS);
    const items = issues.map(mapIssue);

    // Group by sub-pillar -> squad -> items
    const result: Record<string, Record<string, BacklogItem[]>> = {};

    for (const [pillar, squads] of Object.entries(SUB_PILLARS)) {
      result[pillar] = {};
      for (const squad of squads) {
        const squadItems = items.filter((i) => i.growthSquad === squad);
        if (squadItems.length > 0) {
          result[pillar][squad] = squadItems;
        }
      }
    }

    // Collect any squads not mapped to a sub-pillar
    const allMappedSquads = new Set(Object.values(SUB_PILLARS).flat());
    const unmapped: Record<string, BacklogItem[]> = {};
    for (const item of items) {
      if (!allMappedSquads.has(item.growthSquad)) {
        if (!unmapped[item.growthSquad]) unmapped[item.growthSquad] = [];
        unmapped[item.growthSquad].push(item);
      }
    }
    if (Object.keys(unmapped).length > 0) {
      result["Other"] = unmapped;
    }

    return NextResponse.json({ pillars: result, totalCount: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch growth backlog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
