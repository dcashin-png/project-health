import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const JIRA_BASE = "https://jira.tinyspeck.com";

async function jiraFetch<T>(path: string): Promise<T> {
  const { stdout } = await execFileAsync(
    "slack-uberproxy-curl",
    ["-s", `${JIRA_BASE}${path}`],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

export interface JiraProject {
  key: string;
  name: string;
  lead?: { displayName?: string; name?: string };
}

export interface JiraIssue {
  key: string;
  fields: {
    project: { key: string; name: string };
    status: { name: string; statusCategory?: { key: string; name: string } };
    priority: { name: string };
    issuetype: { name: string };
    assignee?: { displayName?: string; name?: string } | null;
    created: string;
    updated: string;
    summary: string;
    labels?: string[];
  };
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

export interface JiraFilter {
  id: string;
  name: string;
  jql: string;
  owner?: { displayName?: string; name?: string };
  favourite?: boolean;
}

export async function searchIssues(
  jql: string,
  fields: string[] = [],
  maxResults = 50
): Promise<JiraSearchResult> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(maxResults),
  });
  if (fields.length > 0) {
    params.set("fields", fields.join(","));
  }
  return jiraFetch<JiraSearchResult>(`/rest/api/2/search?${params}`);
}

// Fetch all results with large page size, paginating only if needed
export async function searchAllIssues(
  jql: string,
  fields: string[] = [],
  pageSize = 1000
): Promise<JiraIssue[]> {
  const first = await searchIssues(jql, fields, pageSize);
  if (first.issues.length >= first.total) {
    return first.issues;
  }

  // Need more pages — fetch remaining in parallel
  const allIssues = [...first.issues];
  const remaining: Promise<JiraSearchResult>[] = [];
  for (let startAt = first.issues.length; startAt < first.total; startAt += pageSize) {
    const params = new URLSearchParams({
      jql,
      maxResults: String(pageSize),
      startAt: String(startAt),
    });
    if (fields.length > 0) {
      params.set("fields", fields.join(","));
    }
    remaining.push(jiraFetch<JiraSearchResult>(`/rest/api/2/search?${params}`));
  }

  const pages = await Promise.all(remaining);
  for (const page of pages) {
    allIssues.push(...page.issues);
  }
  return allIssues;
}

export async function listProjects(maxResults = 100): Promise<JiraProject[]> {
  return jiraFetch<JiraProject[]>(
    `/rest/api/2/project?maxResults=${maxResults}`
  );
}

export async function getFilter(filterId: string): Promise<JiraFilter> {
  return jiraFetch<JiraFilter>(`/rest/api/2/filter/${filterId}`);
}

export async function getFavouriteFilters(): Promise<JiraFilter[]> {
  return jiraFetch<JiraFilter[]>(`/rest/api/2/filter/favourite`);
}
