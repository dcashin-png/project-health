import { NextRequest, NextResponse } from "next/server";
import { getAvailableServers } from "@/lib/mcp-client";
import { searchIssues, searchAllIssues } from "@/lib/jira-api";
import type { Project, ProjectHealth, Phase, HealthStatus } from "@/lib/types";
import type { JiraIssue } from "@/lib/jira-api";

// Each epic from the filter = a "project" on the dashboard
async function fetchEpicsFromFilter(filter: string): Promise<
  Array<{ epic: JiraIssue; project: Project }>
> {
  const jql = /^\d+$/.test(filter)
    ? `filter = ${filter}`
    : `filter = "${filter}"`;

  const result = await searchIssues(
    jql,
    ["summary", "status", "assignee", "priority", "project", "labels", "customfield_19103"],
    200
  );

  return result.issues.map((epic) => {
    const experimentStatus = (epic.fields as Record<string, unknown>).customfield_19103 as
      | { value: string } | null | undefined;

    return {
      epic,
      project: {
        key: epic.key,
        name: epic.fields.summary,
        lead: epic.fields.assignee?.displayName || epic.fields.assignee?.name,
        jiraProject: epic.fields.project?.name,
        url: `https://jira.tinyspeck.com/browse/${epic.key}`,
        status: experimentStatus?.value || epic.fields.status.name,
      },
    };
  });
}

// Fetch ALL child issues for ALL epics in one batched query, grouped by epic key
async function fetchAllChildIssues(
  epicKeys: string[]
): Promise<Map<string, JiraIssue[]>> {
  const childrenByEpic = new Map<string, JiraIssue[]>();
  for (const key of epicKeys) {
    childrenByEpic.set(key, []);
  }

  if (epicKeys.length === 0) return childrenByEpic;

  // Query in batches of 50 epic keys (JQL IN clause limit), run batches in parallel
  const batchSize = 50;
  const batches: string[][] = [];
  for (let i = 0; i < epicKeys.length; i += batchSize) {
    batches.push(epicKeys.slice(i, i + batchSize));
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const inClause = batch.join(", ");
      const jql = `"Epic Link" in (${inClause}) ORDER BY priority DESC`;
      try {
        return await searchAllIssues(
          jql,
          ["status", "priority", "issuetype", "created", "updated", "summary", "assignee", "customfield_10017"],
        );
      } catch {
        return [];
      }
    })
  );

  for (const issues of batchResults) {
    for (const issue of issues) {
      const epicLink = (issue.fields as Record<string, unknown>).customfield_10017 as string | null;
      if (epicLink && childrenByEpic.has(epicLink)) {
        childrenByEpic.get(epicLink)!.push(issue);
      }
    }
  }

  return childrenByEpic;
}

function detectPhase(epic: JiraIssue, children: JiraIssue[]): Phase {
  const epicStatus = epic.fields.status?.statusCategory?.key || categorizeStatus(epic.fields.status.name);
  if (epicStatus === "done") return "launched";

  if (children.length === 0) {
    if (epicStatus === "new") return "planning";
    return "unknown";
  }

  const statuses = children.map(
    (i) => i.fields.status.statusCategory?.key || categorizeStatus(i.fields.status.name)
  );

  const todo = statuses.filter((s) => s === "new").length;
  const inProgress = statuses.filter((s) => s === "indeterminate").length;
  const done = statuses.filter((s) => s === "done").length;
  const total = statuses.length;

  if (done === total) return "review";
  if (todo / total > 0.7) return "planning";
  if (inProgress > 0 || done / total > 0.2) return "in-progress";

  return "planning";
}

function categorizeStatus(statusName: string): string {
  const lower = statusName.toLowerCase();
  if (["to do", "open", "backlog", "new", "created", "triage"].some((s) => lower.includes(s)))
    return "new";
  if (["in progress", "in review", "in development", "active", "started"].some((s) => lower.includes(s)))
    return "indeterminate";
  if (["done", "closed", "resolved", "complete", "launched"].some((s) => lower.includes(s)))
    return "done";
  return "indeterminate";
}

function assessHealth(
  epic: JiraIssue,
  children: JiraIssue[]
): { health: HealthStatus; risks: string[]; issuesList: string[]; needsLeadership: boolean } {
  const risks: string[] = [];
  const issuesList: string[] = [];

  if (epic.fields.priority.name === "Blocker") {
    risks.push("Epic itself is marked Blocker priority");
  }

  if (children.length === 0) {
    issuesList.push("No child issues — epic may not be broken down yet");
  }

  const blockers = children.filter((i) => i.fields.priority.name === "Blocker");
  if (blockers.length > 0) {
    risks.push(
      `${blockers.length} blocker(s): ${blockers.map((b) => b.fields.summary).slice(0, 3).join("; ")}`
    );
  }

  const criticals = children.filter((i) => i.fields.priority.name === "Critical");
  if (criticals.length > 0) {
    issuesList.push(`${criticals.length} critical issue(s)`);
  }

  const bugs = children.filter((i) => i.fields.issuetype.name === "Bug");
  if (bugs.length > 3) {
    issuesList.push(`${bugs.length} open bugs`);
  }

  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const stale = children.filter(
    (i) =>
      i.fields.updated < twoWeeksAgo &&
      (i.fields.status.statusCategory?.key || categorizeStatus(i.fields.status.name)) !== "done"
  );
  if (stale.length > 3) {
    risks.push(`${stale.length} child issues not updated in 14+ days`);
  }

  const unassigned = children.filter(
    (i) =>
      !i.fields.assignee &&
      (i.fields.status.statusCategory?.key || categorizeStatus(i.fields.status.name)) === "indeterminate"
  );
  if (unassigned.length > 0) {
    issuesList.push(`${unassigned.length} in-progress issue(s) unassigned`);
  }

  let health: HealthStatus = "healthy";
  const needsLeadership = blockers.length >= 2 || (blockers.length >= 1 && stale.length > 3);

  if (needsLeadership) {
    health = "needs-help";
  } else if (blockers.length >= 1 || risks.length > 0 || criticals.length >= 3) {
    health = "at-risk";
  } else if (children.length === 0) {
    health = "unknown";
  }

  return { health, risks, issuesList, needsLeadership };
}

function buildSummary(children: JiraIssue[]): string {
  if (children.length === 0) return "No child issues";

  const done = children.filter(
    (i) => (i.fields.status.statusCategory?.key || categorizeStatus(i.fields.status.name)) === "done"
  ).length;
  return `${done}/${children.length} child issues done`;
}

export async function GET(request: NextRequest) {
  try {
    const servers = await getAvailableServers();
    const filter = request.nextUrl.searchParams.get("filter");

    if (!filter) {
      return NextResponse.json({
        projects: [],
        lastRefreshed: new Date().toISOString(),
        connectedServers: servers,
        filter: null,
        message: "Select a JIRA filter to load epics.",
      });
    }

    // 1. Fetch all epics from the filter (single query)
    const epics = await fetchEpicsFromFilter(filter);
    const epicKeys = epics.map((e) => e.epic.key);

    // 2. Fetch ALL child issues in batched queries (instead of N+1)
    const childrenByEpic = await fetchAllChildIssues(epicKeys);

    // 3. Analyze health for each epic using pre-fetched children
    const healthData: ProjectHealth[] = epics.map(({ epic, project }) => {
      const children = childrenByEpic.get(epic.key) || [];
      const phase = detectPhase(epic, children);
      const { health, risks, issuesList, needsLeadership } = assessHealth(epic, children);
      const summary = buildSummary(children);

      return {
        project,
        phase,
        health,
        risks,
        decisions: [],
        issues: issuesList,
        needsLeadership,
        summary,
        lastUpdated: new Date().toISOString(),
      };
    });

    const order: Record<HealthStatus, number> = {
      "needs-help": 0,
      "at-risk": 1,
      healthy: 2,
      unknown: 3,
    };
    healthData.sort((a, b) => order[a.health] - order[b.health]);

    return NextResponse.json({
      projects: healthData,
      lastRefreshed: new Date().toISOString(),
      connectedServers: servers,
      filter,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze project health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
