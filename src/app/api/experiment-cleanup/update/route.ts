import { NextRequest, NextResponse } from "next/server";
import { updateIssueFields } from "@/lib/jira-api";

// Allowed Experiment Status values (customfield_19103)
const EXPERIMENT_STATUSES = [
  "Planning",
  "Development",
  "Running",
  "Analysis",
  "Paused / Issues",
  "Concluded Control",
  "GA Complete",
  "Cancelled",
];

export async function POST(request: NextRequest) {
  try {
    const { issueKey, experimentStatus, experimentStartDate, experimentEndDate } =
      await request.json();

    if (!issueKey) {
      return NextResponse.json({ error: "issueKey is required" }, { status: 400 });
    }

    const fields: Record<string, unknown> = {};

    if (experimentStatus !== undefined) {
      if (!EXPERIMENT_STATUSES.includes(experimentStatus)) {
        return NextResponse.json(
          { error: `Invalid experiment status. Must be one of: ${EXPERIMENT_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      fields.customfield_19103 = { value: experimentStatus };
    }

    if (experimentStartDate !== undefined) {
      fields.customfield_18803 = experimentStartDate || null;
    }

    if (experimentEndDate !== undefined) {
      fields.customfield_14505 = experimentEndDate || null;
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await updateIssueFields(issueKey, fields);

    return NextResponse.json({ ok: true, issueKey, updated: Object.keys(fields) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
