import { NextRequest, NextResponse } from "next/server";
import { searchAllIssues, getFilter } from "@/lib/jira-api";
import type { DigestExperiment } from "@/lib/types";

// Salesforce FY quarters: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
function getFiscalQuarter(date: Date): { quarter: string; start: Date; end: Date } {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  // Month -> quarter mapping (0=Jan..11=Dec)
  // Q4: Nov(10), Dec(11), Jan(0)
  // Q1: Feb(1), Mar(2), Apr(3)
  // Q2: May(4), Jun(5), Jul(6)
  // Q3: Aug(7), Sep(8), Oct(9)
  if (month >= 1 && month <= 3) {
    const fy = year + 1; // FY starts in Feb, so Feb 2026 = FY27
    return { quarter: `FY${fy % 100} Q1`, start: new Date(year, 1, 1), end: new Date(year, 3, 30) };
  } else if (month >= 4 && month <= 6) {
    const fy = year + 1;
    return { quarter: `FY${fy % 100} Q2`, start: new Date(year, 4, 1), end: new Date(year, 6, 31) };
  } else if (month >= 7 && month <= 9) {
    const fy = year + 1;
    return { quarter: `FY${fy % 100} Q3`, start: new Date(year, 7, 1), end: new Date(year, 9, 31) };
  } else {
    // month 10, 11, or 0 (Nov, Dec, Jan)
    const fy = month === 0 ? year : year + 1;
    const startYear = month === 0 ? year - 1 : year;
    return { quarter: `FY${(fy + 1) % 100} Q4`, start: new Date(startYear, 10, 1), end: new Date(startYear + 1, 0, 31) };
  }
}

function getDateRanges() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset);

  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const fq = getFiscalQuarter(now);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  return {
    thisWeekStart: fmt(thisMonday),
    thisWeekEnd: fmt(thisSunday),
    monthStart: fmt(monthStart),
    monthEnd: fmt(monthEnd),
    quarterStart: fmt(fq.start),
    quarterEnd: fmt(fq.end),
    quarterLabel: fq.quarter,
    monthLabel: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    weekLabel: `${thisMonday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${thisSunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  };
}

const FIELDS = [
  "summary",
  "status",
  "assignee",
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

export async function GET(request: NextRequest) {
  try {
    const filterParam = request.nextUrl.searchParams.get("filter");
    if (!filterParam) {
      return NextResponse.json({ error: "filter parameter is required" }, { status: 400 });
    }

    const dates = getDateRanges();

    // Get the filter's JQL and scope it to relevant dates
    const filter = await getFilter(filterParam);
    const baseJql = filter.jql;

    // Fetch issues with relevant dates in current month, week, or fiscal quarter (for QTD)
    const jql = `(${baseJql}) AND (
      "Expected Launch START Date" >= "${dates.monthStart}" AND "Expected Launch START Date" <= "${dates.monthEnd}"
      OR "Experiment Start Date" >= "${dates.monthStart}" AND "Experiment Start Date" <= "${dates.monthEnd}"
      OR "Experiment End Date" >= "${dates.monthStart}" AND "Experiment End Date" <= "${dates.monthEnd}"
      OR "GA Launch Date" >= "${dates.quarterStart}" AND "GA Launch Date" <= "${dates.quarterEnd}"
    ) ORDER BY "Experiment Start Date" ASC`;

    const issues = await searchAllIssues(jql, FIELDS);

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
    const message = error instanceof Error ? error.message : "Failed to fetch WBR data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
