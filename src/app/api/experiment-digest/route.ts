import { NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";
import type { DigestExperiment } from "@/lib/types";

function getDateRanges() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset);

  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  return {
    lastWeekStart: fmt(lastMonday),
    lastWeekEnd: fmt(lastSunday),
    thisWeekStart: fmt(thisMonday),
    thisWeekEnd: fmt(thisSunday),
    monthStart: fmt(monthStart),
    monthEnd: fmt(monthEnd),
    nextMonthStart: fmt(nextMonthStart),
    nextMonthEnd: fmt(nextMonthEnd),
  };
}

const PROJECTS = "NEWXP, PXP, MNY, STEP, UPGRD, I18N, CUSTACQ, PNP, RET, GRO";

const FIELDS = [
  "summary",
  "status",
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

export async function GET() {
  try {
    const dates = getDateRanges();

    const JQL = `project IN (${PROJECTS})
      AND issuetype in (Epic, Experiment)
      AND (
        ("Experiment Start Date" >= "${dates.monthStart}" AND "Experiment Start Date" <= "${dates.nextMonthEnd}")
        OR ("Experiment End Date" >= "${dates.lastWeekStart}" AND "Experiment End Date" <= "${dates.thisWeekEnd}")
        OR ("Expected Launch START Date" >= "${dates.monthStart}" AND "Expected Launch START Date" <= "${dates.nextMonthEnd}" AND (status = Done OR "Experiment Status" = "GA Complete"))
      )
      ORDER BY "Experiment Start Date" ASC`;

    const issues = await searchAllIssues(JQL, FIELDS);

    const experiments: DigestExperiment[] = issues.map((issue) => {
      const f = issue.fields as Record<string, unknown>;
      const driField = f.customfield_18500 as
        | Array<{ name?: string; displayName?: string; emailAddress?: string }>
        | null;
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
        gaLaunchDate: (f.customfield_18503 as string) || null,
        expectedLaunchStartDate: (f.customfield_10611 as string) || null,
        estimatedAcv: (f.customfield_19001 as number) ?? null,
        actualAcv: (f.customfield_19000 as number) ?? null,
        experimentDri: (driField || []).map((d) => ({
          name: d.name || "",
          displayName: d.displayName || d.name || "",
          email: d.emailAddress || null,
        })),
        productCategory: categoryField?.value || null,
        growthSquad: squadField?.value || null,
      };
    });

    return NextResponse.json({ experiments, dates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch experiments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
