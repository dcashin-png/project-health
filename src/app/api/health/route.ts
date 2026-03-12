import { NextRequest, NextResponse } from "next/server";
import { getAvailableServers } from "@/lib/mcp-client";
import { searchIssues, searchAllIssues } from "@/lib/jira-api";
import { isSlackConnected, batchReadSlackChannels as slackBatchRead } from "@/lib/slack-api";
import type { Project, ProjectHealth, Phase, HealthStatus, QualitativeHealth } from "@/lib/types";
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
    ["summary", "status", "assignee", "priority", "project", "labels", "customfield_19103", "customfield_10607"],
    200
  );

  return result.issues.map((epic) => {
    const fields = epic.fields as Record<string, unknown>;
    const experimentStatus = fields.customfield_19103 as { value: string } | null | undefined;
    const channel = (fields.customfield_10607 as string | null)?.trim() || null;

    return {
      epic,
      project: {
        key: epic.key,
        name: epic.fields.summary,
        lead: epic.fields.assignee?.displayName || epic.fields.assignee?.name,
        jiraProject: epic.fields.project?.name,
        url: `https://jira.tinyspeck.com/browse/${epic.key}`,
        status: experimentStatus?.value || epic.fields.status.name,
        slackChannel: channel,
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


function analyzeSlackMessages(messages: string[]): QualitativeHealth {
  if (messages.length === 0) {
    return {
      summary: "No recent activity in channel",
      signals: [],
      channelMissing: false,
    };
  }

  const signals: string[] = [];

  // Risk / blocker signals
  const riskKeywords = ["blocked", "blocker", "blocking", "stuck"];
  const riskMessages = messages.filter((m) =>
    riskKeywords.some((kw) => m.toLowerCase().includes(kw))
  );
  if (riskMessages.length > 0) {
    signals.push(`Blocker/blocked mentioned ${riskMessages.length}x`);
  }

  // Delay / slip signals
  const delayKeywords = ["slip", "delay", "pushed", "postpone", "behind schedule", "won't make"];
  const delayMessages = messages.filter((m) =>
    delayKeywords.some((kw) => m.toLowerCase().includes(kw))
  );
  if (delayMessages.length > 0) {
    signals.push(`Timeline concerns mentioned ${delayMessages.length}x`);
  }

  // Escalation signals
  const escalationKeywords = ["escalat", "help needed", "need help", "urgent", "critical"];
  const escalationMessages = messages.filter((m) =>
    escalationKeywords.some((kw) => m.toLowerCase().includes(kw))
  );
  if (escalationMessages.length > 0) {
    signals.push(`Escalation/help signals ${escalationMessages.length}x`);
  }

  // Positive signals
  const positiveKeywords = ["shipped", "launched", "completed", "merged", "looks good", "on track"];
  const positiveMessages = messages.filter((m) =>
    positiveKeywords.some((kw) => m.toLowerCase().includes(kw))
  );
  if (positiveMessages.length > 0) {
    signals.push(`Positive progress signals ${positiveMessages.length}x`);
  }

  // Decision signals
  const decisionKeywords = ["decided", "decision", "agreed", "consensus", "going with", "let's go with"];
  const decisionMessages = messages.filter((m) =>
    decisionKeywords.some((kw) => m.toLowerCase().includes(kw))
  );
  if (decisionMessages.length > 0) {
    signals.push(`Decisions made ${decisionMessages.length}x`);
  }

  // Build summary
  const totalNegative = riskMessages.length + delayMessages.length + escalationMessages.length;
  const totalPositive = positiveMessages.length;
  let summary: string;

  if (totalNegative > 3) {
    summary = "Multiple risk signals detected in recent channel activity";
  } else if (totalNegative > 0 && totalPositive === 0) {
    summary = "Some concerns raised in channel, no positive signals";
  } else if (totalPositive > totalNegative) {
    summary = "Positive momentum in channel activity";
  } else if (messages.length < 5) {
    summary = "Low channel activity recently";
  } else {
    summary = "Normal channel activity";
  }

  return { summary, signals, channelMissing: false };
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
  children: JiraIssue[],
  qualitative?: QualitativeHealth
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

  // Factor in Slack qualitative signals
  const slackNegativeSignals = qualitative?.signals.filter(
    (s) => s.includes("Blocker") || s.includes("Timeline") || s.includes("Escalation")
  ).length || 0;

  let health: HealthStatus = "healthy";
  const needsLeadership = blockers.length >= 2 || (blockers.length >= 1 && stale.length > 3) || slackNegativeSignals >= 3;

  if (needsLeadership) {
    health = "needs-help";
  } else if (blockers.length >= 1 || risks.length > 0 || criticals.length >= 3 || slackNegativeSignals >= 2) {
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

    // 2. Fetch ALL child issues in batched queries
    const childrenByEpic = await fetchAllChildIssues(epicKeys);

    // 3. If Slack token is available, batch-read all unique channels
    let slackConnected = false;
    let channelMessages = new Map<string, string[]>();

    try {
      slackConnected = await isSlackConnected();
    } catch {
      slackConnected = false;
    }

    if (slackConnected) {
      const channelNames = epics
        .map((e) => e.project.slackChannel)
        .filter((ch): ch is string => !!ch);
      channelMessages = await slackBatchRead(channelNames);
    }

    // 4. Analyze health for each epic
    const healthData: ProjectHealth[] = epics.map(({ epic, project }) => {
      const children = childrenByEpic.get(epic.key) || [];
      const phase = detectPhase(epic, children);

      // Build qualitative health from Slack
      let qualitativeHealth: QualitativeHealth;
      if (!project.slackChannel) {
        qualitativeHealth = {
          summary: "No Slack channel specified on epic",
          signals: [],
          channelMissing: true,
        };
      } else if (!slackConnected) {
        qualitativeHealth = {
          summary: "Slack not connected",
          signals: [],
          channelMissing: false,
        };
      } else {
        const messages = channelMessages.get(project.slackChannel) || [];
        qualitativeHealth = analyzeSlackMessages(messages);
      }

      const { health, risks, issuesList, needsLeadership } = assessHealth(
        epic, children, qualitativeHealth
      );
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
        qualitativeHealth,
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
      slackConnected,
      filter,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze project health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
