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
  lastUpdated: string;
}

export interface DashboardData {
  projects: ProjectHealth[];
  lastRefreshed: string;
}
