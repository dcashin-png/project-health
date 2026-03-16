import { NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";
import type { CleanupExperiment } from "@/lib/types";

const JQL = `project IN (NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET)
  AND issuetype in (Epic, Experiment)
  AND ("Start Date" >= 2024-02-01 OR "Experiment Start Date" >= 2024-02-01)
  AND ("Start Date" < 2027-02-01 OR "Experiment Start Date" < 2027-02-01 OR "Experiment End Date" < 2027-01-01 OR "Expected Launch START Date" < 2027-02-01)
  AND "Experiment Status" NOT IN ("Cancelled")
  AND resolution NOT IN ("Won't Do")
  AND (
    ("Experiment Start Date" <= startOfDay() AND "Experiment Status" in ("Planning", "Development"))
    OR ("Experiment End Date" <= startOfDay() AND status != Done)
  ) ORDER BY "Experiment Start Date" ASC`;

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
];

export async function GET() {
  try {
    const issues = await searchAllIssues(JQL, FIELDS);

    const experiments: CleanupExperiment[] = issues.map((issue) => {
      const f = issue.fields as Record<string, unknown>;
      const driField = f.customfield_18500 as
        | Array<{ name?: string; displayName?: string }>
        | null;
      const pmField = f.customfield_10606 as
        | { name?: string; displayName?: string }
        | null;
      const squadField = f.customfield_18401 as { value?: string } | null;
      const productCategoryField = f.customfield_18801 as { value?: string } | null;

      return {
        key: issue.key,
        summary: issue.fields.summary,
        url: `https://jira.tinyspeck.com/browse/${issue.key}`,
        status: issue.fields.status.name,
        experimentStatus: (f.customfield_19103 as { value?: string })?.value || "Unknown",
        experimentStartDate: (f.customfield_18803 as string) || null,
        experimentEndDate: (f.customfield_14505 as string) || null,
        assignee: issue.fields.assignee?.displayName || null,
        experimentDri: (driField || []).map((d) => ({
          name: d.name || "",
          displayName: d.displayName || d.name || "",
        })),
        productManager: pmField
          ? { name: pmField.name || "", displayName: pmField.displayName || pmField.name || "" }
          : null,
        growthSquad: squadField?.value || null,
        productCategory: productCategoryField?.value || null,
      };
    });

    return NextResponse.json({ experiments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch experiments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
