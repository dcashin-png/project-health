import { NextRequest, NextResponse } from "next/server";
import { searchIssues } from "@/lib/jira-api";

export async function GET(request: NextRequest) {
  const filter = request.nextUrl.searchParams.get("filter");

  if (!filter) {
    return NextResponse.json(
      { error: "Missing 'filter' query parameter" },
      { status: 400 }
    );
  }

  try {
    const jql = /^\d+$/.test(filter.trim())
      ? `filter = ${filter.trim()}`
      : `filter = "${filter.trim()}"`;

    const result = await searchIssues(jql, ["project"], 100);

    const projectMap = new Map<string, string>();
    for (const issue of result.issues) {
      const proj = issue.fields?.project;
      if (proj?.key) {
        projectMap.set(proj.key, proj.name || proj.key);
      }
    }

    const projects = Array.from(projectMap.entries()).map(([key, name]) => ({
      key,
      name,
    }));

    return NextResponse.json({
      valid: true,
      filter: filter.trim(),
      jql,
      totalIssues: result.total,
      projects,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Filter validation failed";

    if (
      message.includes("does not exist") ||
      message.includes("not found") ||
      message.includes("parse")
    ) {
      return NextResponse.json({
        valid: false,
        filter: filter.trim(),
        error: `No filter found matching "${filter.trim()}". Enter a valid filter name or numeric ID.`,
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
