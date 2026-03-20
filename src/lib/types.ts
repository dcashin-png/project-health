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

export interface CleanupExperiment {
  key: string;
  summary: string;
  url: string;
  status: string;
  experimentStatus: string;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  assignee: string | null;
  experimentDri: Array<{ name: string; displayName: string; email: string | null }>;
  productManager: { name: string; displayName: string; email: string | null } | null;
  growthSquad: string | null;
  productCategory: string | null;
  estimatedAcv: number | null;
}

export interface DigestExperiment {
  key: string;
  summary: string;
  url: string;
  status: string;
  experimentStatus: string;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  gaLaunchDate: string | null;
  expectedLaunchStartDate: string | null;
  estimatedAcv: number | null;
  actualAcv: number | null;
  experimentDri: Array<{ name: string; displayName: string; email: string | null }>;
  productCategory: string | null;
  growthSquad: string | null;
}

export interface AcvFilters {
  attributions?: string[];
  segments?: string[];
  businessLines?: string[];
  productLines?: string[];
  regions?: string[];
  quarters?: string[];
  snapshotDateStart?: string;
  snapshotDateEnd?: string;
}

export interface AcvFilterOptions {
  attributions: string[];
  segments: string[];
  businessLines: string[];
  productLines: string[];
  regions: string[];
  quarters: string[];
  snapshotDateRange: { min: string; max: string };
  latestDs: string;
}

export interface AcvRow {
  snapshotDate: string;
  attribution: string;
  segment: string;
  businessLine: string;
  productLine: string;
  region: string;
  quarter: string;
  acv: number;
}

export interface AcvDataResult {
  rows: AcvRow[];
  totalAcv: number;
  latestDs: string;
}
