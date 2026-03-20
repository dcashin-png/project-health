import { NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";
import type { CleanupExperiment } from "@/lib/types";

const STALE_JQL = `project IN (NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET)
  AND issuetype in (Epic, Experiment)
  AND ("Start Date" >= 2024-02-01 OR "Experiment Start Date" >= 2024-02-01)
  AND ("Start Date" < 2027-02-01 OR "Experiment Start Date" < 2027-02-01 OR "Experiment End Date" < 2027-01-01 OR "Expected Launch START Date" < 2027-02-01)
  AND (
    ("Experiment Start Date" <= startOfDay() AND "Experiment Status" in ("Planning", "Development"))
    OR ("Experiment End Date" <= startOfDay() AND status != Done)
  ) ORDER BY "Experiment Start Date" ASC`;

const MISSING_ACV_JQL = `project IN (NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET)
  AND issuetype in (Epic, Experiment)
  AND "Experiment Status" not in ("Cancelled")
  AND "Estimated ACV" is EMPTY
  AND "Experiment Start Date" is not EMPTY
  ORDER BY "Experiment Start Date" ASC`;

const FIELDS = [
  "summary",
  "status",
  "assignee",
  "customfield_19103", // Experiment Status
  "customfield_18803", // Experiment Start Date
  "customfield_14505", // Experiment End Date
  "customfield_18500", // Experiment DRI
  "customfield_10606", // Product Manager
  "customfield_18401", // Growth Squad
  "customfield_18801", // Product Category
  "customfield_19001", // Estimated ACV
];

function mapIssue(issue: ReturnType<typeof Object>): CleanupExperiment {
  const f = issue.fields as Record<string, unknown>;
  const driField = f.customfield_18500 as
    | Array<{ name?: string; displayName?: string; emailAddress?: string }>
    | null;
  const pmField = f.customfield_10606 as
    | { name?: string; displayName?: string; emailAddress?: string }
    | null;
  const squadField = f.customfield_18401 as { value?: string } | null;
  const productCategoryField = f.customfield_18801 as { value?: string } | null;

  return {
    key: issue.key as string,
    summary: (issue.fields as { summary: string }).summary,
    url: `https://jira.tinyspeck.com/browse/${issue.key}`,
    status: (issue.fields as { status: { name: string } }).status.name,
    experimentStatus: (f.customfield_19103 as { value?: string })?.value || "Unknown",
    experimentStartDate: (f.customfield_18803 as string) || null,
    experimentEndDate: (f.customfield_14505 as string) || null,
    assignee: (issue.fields as { assignee?: { displayName?: string } | null }).assignee?.displayName || null,
    experimentDri: (driField || []).map((d) => ({
      name: d.name || "",
      displayName: d.displayName || d.name || "",
      email: d.emailAddress || null,
    })),
    productManager: pmField
      ? { name: pmField.name || "", displayName: pmField.displayName || pmField.name || "", email: pmField.emailAddress || null }
      : null,
    growthSquad: squadField?.value || null,
    productCategory: productCategoryField?.value || null,
    estimatedAcv: (f.customfield_19001 as number) ?? null,
  };
}

export async function GET() {
  try {
    const [staleIssues, missingAcvIssues] = await Promise.all([
      searchAllIssues(STALE_JQL, FIELDS),
      searchAllIssues(MISSING_ACV_JQL, FIELDS),
    ]);

    const experiments = staleIssues.map(mapIssue);
    const missingAcv = missingAcvIssues.map(mapIssue);

    return NextResponse.json({ experiments, missingAcv });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch experiments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
