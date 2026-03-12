export interface Project {
  key: string;
  name: string;
  lead?: string;
  jiraProject?: string;
  url?: string;
  status?: string;
  slackChannel?: string | null;
  experimentStartDate?: string | null;
  experimentEndDate?: string | null;
  launchStartDate?: string | null;
  growthSquad?: string | null;
  productTeams?: string[];
}

export interface QualitativeHealth {
  summary: string;
  signals: string[];
  channelMissing: boolean;
}

export type Phase = "planning" | "in-progress" | "review" | "launched" | "unknown";
export type HealthStatus = "healthy" | "at-risk" | "needs-help" | "unknown";

export interface HoustonExperimentInfo {
  id: number;
  name: string;
  status: "draft" | "scheduled" | "active" | "paused" | "finished" | "archived";
  toggleType: string;
  owner: string;
  summary: string;
  groups: string[];
  rolloutPercent: number | null;
  tags: string[];
  // Health
  srmIssue?: boolean;
  exposureCount?: number;
  hasMetrics?: boolean;
  // Results
  metrics?: Array<{
    metricName: string;
    effectSize: number | null;
    pValue: number | null;
    isSignificant: boolean;
    direction: "positive" | "negative" | "neutral";
  }>;
}

export interface ProjectHealth {
  project: Project;
  phase: Phase;
  health: HealthStatus;
  risks: string[];
  decisions: string[];
  issues: string[];
  needsLeadership: boolean;
  summary: string;
  qualitativeHealth?: QualitativeHealth;
  experiments?: HoustonExperimentInfo[];
  lastUpdated: string;
}

export interface DashboardData {
  projects: ProjectHealth[];
  lastRefreshed: string;
}
