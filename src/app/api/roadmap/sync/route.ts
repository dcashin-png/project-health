import { NextRequest, NextResponse } from "next/server";
import { createIssue, updateIssueFields } from "@/lib/jira-api";

interface SyncRow {
  rowIndex: number;
  jiraKey: string | null;
  action: "create" | "update";
  fields: Record<string, unknown>;
  summary: string;
}

interface SyncResult {
  rowIndex: number;
  jiraKey: string;
  action: "created" | "updated";
  summary: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      rows,
      projectKey,
      issueType,
    }: {
      rows: SyncRow[];
      projectKey: string;
      issueType: string;
    } = await request.json();

    if (!rows || !projectKey) {
      return NextResponse.json({ error: "rows and projectKey are required" }, { status: 400 });
    }

    const results: SyncResult[] = [];

    // Process sequentially to avoid overwhelming Jira
    for (const row of rows) {
      try {
        if (row.action === "create") {
          const fields: Record<string, unknown> = {
            project: { key: projectKey },
            issuetype: { name: issueType || "Epic" },
            ...row.fields,
          };

          // Ensure Epic Name is set if creating an Epic
          if (
            (issueType === "Epic" || !issueType) &&
            !fields.customfield_10019 &&
            fields.summary
          ) {
            fields.customfield_10019 = fields.summary;
          }

          const result = await createIssue(fields);
          results.push({
            rowIndex: row.rowIndex,
            jiraKey: result.key,
            action: "created",
            summary: row.summary,
          });
        } else if (row.action === "update" && row.jiraKey) {
          // Don't include project/issuetype in updates
          const fields = { ...row.fields };
          await updateIssueFields(row.jiraKey, fields);
          results.push({
            rowIndex: row.rowIndex,
            jiraKey: row.jiraKey,
            action: "updated",
            summary: row.summary,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed";
        results.push({
          rowIndex: row.rowIndex,
          jiraKey: row.jiraKey || "",
          action: row.action === "create" ? "created" : "updated",
          summary: row.summary,
          error: message,
        });
      }
    }

    const succeeded = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => r.error).length;

    return NextResponse.json({
      results,
      summary: { succeeded, failed, total: results.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
