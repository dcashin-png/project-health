import { NextRequest, NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";

const PROJECTS = "NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET, GRO";

const FIELDS = [
  "summary",
  "status",
  "customfield_19103", // Experiment Status
  "customfield_18803", // Experiment Start Date
  "customfield_14505", // Experiment End Date
  "customfield_18500", // Experiment DRI
  "customfield_18801", // Product Category
  "customfield_18401", // Growth Squad
];

function getMonthRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const fmt = (dt: Date) => dt.toISOString().split("T")[0];
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start: fmt(d), end: fmt(end), label };
}

export async function GET(request: NextRequest) {
  try {
    const monthOffset = parseInt(request.nextUrl.searchParams.get("month") || "0", 10);
    const { start: monthStart, end: monthEnd, label: monthLabel } = getMonthRange(monthOffset);

    // Fetch experiments active during the target month
    const JQL = `project IN (${PROJECTS})
      AND issuetype in (Epic, Experiment)
      AND "Experiment Start Date" is not EMPTY
      AND "Experiment Status" not in ("Cancelled", "GA Complete")
      AND (
        ("Experiment Start Date" <= "${monthEnd}" AND ("Experiment End Date" >= "${monthStart}" OR "Experiment End Date" is EMPTY))
        OR ("Experiment Start Date" >= "${monthStart}" AND "Experiment Start Date" <= "${monthEnd}")
      )
      ORDER BY "Experiment Start Date" ASC`;

    const issues = await searchAllIssues(JQL, FIELDS);

    const experiments = issues.map((issue) => {
      const f = issue.fields as Record<string, unknown>;
      const driField = f.customfield_18500 as
        | Array<{ displayName?: string }>
        | null;
      const squadField = f.customfield_18401 as { value?: string } | null;
      const categoryField = f.customfield_18801 as { value?: string } | null;

      return {
        key: issue.key,
        summary: issue.fields.summary,
        url: `https://jira.tinyspeck.com/browse/${issue.key}`,
        experimentStatus:
          (f.customfield_19103 as { value?: string })?.value || "Unknown",
        experimentStartDate: (f.customfield_18803 as string) || null,
        experimentEndDate: (f.customfield_14505 as string) || null,
        growthSquad: squadField?.value || null,
        productCategory: categoryField?.value || null,
        dri: driField?.[0]?.displayName || null,
      };
    });

    return NextResponse.json({
      experiments,
      month: { start: monthStart, end: monthEnd, label: monthLabel, offset: monthOffset },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch collisions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
