export interface RaidItem {
  id: string;
  category: "risk" | "assumption" | "issue" | "dependency";
  title: string;
  detail: string;
  status: "open" | "mitigated" | "closed";
  owner?: string;
  source?: string; // which channel surfaced this
}

export interface TimelineEvent {
  date: string; // YYYY-MM-DD
  title: string;
  detail: string;
  type: "milestone" | "blocker" | "decision" | "progress" | "upcoming";
  source?: string;
}

export interface ChannelSummary {
  channelId: string;
  channelName: string;
  messageCount: number;
  topTopics: string[];
  recentActivity: string;
}

export interface StripeTaxSnapshot {
  date: string; // YYYY-MM-DD
  capturedAt: string; // ISO timestamp
  overallStatus: "on-track" | "at-risk" | "blocked";
  statusSummary: string;
  raid: RaidItem[];
  timeline: TimelineEvent[];
  channels: ChannelSummary[];
  workstreams: Workstream[];
}

export interface Workstream {
  name: string;
  owner: string;
  status: "on-track" | "at-risk" | "blocked" | "complete";
  summary: string;
  nextSteps: string[];
}

export const STRIPE_TAX_CHANNELS = [
  { id: "C05HTJDAZ4K", name: "devel-stripe-hack-sdk" },
  { id: "C0A7EQXH2MR", name: "devel-stripe-tax" },
  { id: "C0AB0D6GJHL", name: "proj-invalid-us-billing-address-remediation" },
  { id: "C08LC942B2N", name: "proj-stripe-tax" },
  { id: "C099740D716", name: "slack-heroku-stripe-tax" },
] as const;
