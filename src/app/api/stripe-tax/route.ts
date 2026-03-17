import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { callSlackMcp } from "@/lib/slack-api";
import {
  STRIPE_TAX_CHANNELS,
  type StripeTaxSnapshot,
  type RaidItem,
  type TimelineEvent,
  type ChannelSummary,
  type Workstream,
} from "@/lib/stripe-tax-types";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "stripe-tax-snapshots");

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readChannelMessages(
  channelId: string,
  limit = 100
): Promise<string> {
  try {
    return await callSlackMcp("slack_read_channel", {
      channel_id: channelId,
      limit,
    });
  } catch {
    return "";
  }
}

function countMessages(raw: string): number {
  // Each message block starts with a username followed by a colon or has timestamps in brackets
  const matches = raw.match(/\[\d{4}-\d{2}-\d{2}/g);
  return matches?.length || 0;
}

function extractRecentActivity(raw: string): string {
  // Get the date of the most recent message
  const dateMatch = raw.match(/\[(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : "unknown";
}

// Analyze channel messages to extract RAID items, timeline events, etc.
function analyzeMessages(
  channelName: string,
  raw: string
): {
  raidItems: RaidItem[];
  timelineEvents: TimelineEvent[];
  topics: string[];
} {
  const raidItems: RaidItem[] = [];
  const timelineEvents: TimelineEvent[] = [];
  const topics: string[] = [];

  const lines = raw.split("\n");
  let idCounter = 0;
  const makeId = () => `${channelName}-${++idCounter}`;

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Extract risks
    if (
      lower.includes("risk") ||
      lower.includes("blocker") ||
      lower.includes("blocked") ||
      lower.includes("at risk")
    ) {
      // Skip join messages and bot noise
      if (lower.includes("has joined") || lower.includes("huddle started"))
        continue;
      const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
      const text = line
        .replace(/\[.*?\]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text.length > 20) {
        raidItems.push({
          id: makeId(),
          category: "risk",
          title: text.slice(0, 120),
          detail: text,
          status: "open",
          source: channelName,
        });
        if (dateMatch) {
          timelineEvents.push({
            date: dateMatch[1],
            title: `Risk identified: ${text.slice(0, 80)}`,
            detail: text,
            type: "blocker",
            source: channelName,
          });
        }
      }
    }

    // Extract dependencies
    if (
      lower.includes("dependency") ||
      lower.includes("depends on") ||
      lower.includes("waiting on") ||
      lower.includes("need to") ||
      lower.includes("unblock")
    ) {
      if (lower.includes("has joined") || lower.includes("huddle started"))
        continue;
      const text = line
        .replace(/\[.*?\]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text.length > 20) {
        raidItems.push({
          id: makeId(),
          category: "dependency",
          title: text.slice(0, 120),
          detail: text,
          status: "open",
          source: channelName,
        });
      }
    }

    // Extract issues
    if (
      lower.includes("issue") ||
      lower.includes("broke") ||
      lower.includes("incident") ||
      lower.includes("mismatch") ||
      lower.includes("breaking change")
    ) {
      if (lower.includes("has joined") || lower.includes("huddle started"))
        continue;
      const text = line
        .replace(/\[.*?\]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text.length > 20) {
        raidItems.push({
          id: makeId(),
          category: "issue",
          title: text.slice(0, 120),
          detail: text,
          status: "open",
          source: channelName,
        });
      }
    }

    // Extract milestones / progress
    if (
      lower.includes("completed") ||
      lower.includes("merged") ||
      lower.includes("shipped") ||
      lower.includes("rolled out") ||
      lower.includes("successfully") ||
      lower.includes(":tada:") ||
      lower.includes("eow update")
    ) {
      if (lower.includes("has joined") || lower.includes("huddle started"))
        continue;
      const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
      const text = line
        .replace(/\[.*?\]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text.length > 20 && dateMatch) {
        timelineEvents.push({
          date: dateMatch[1],
          title: text.slice(0, 100),
          detail: text,
          type: lower.includes("eow update") ? "milestone" : "progress",
          source: channelName,
        });
      }
    }

    // Extract upcoming items
    if (
      lower.includes("up next") ||
      lower.includes("aiming to") ||
      lower.includes("target") ||
      lower.includes("plan to") ||
      lower.includes("due to be sent")
    ) {
      if (lower.includes("has joined") || lower.includes("huddle started"))
        continue;
      const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
      const text = line
        .replace(/\[.*?\]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text.length > 20 && dateMatch) {
        timelineEvents.push({
          date: dateMatch[1],
          title: text.slice(0, 100),
          detail: text,
          type: "upcoming",
          source: channelName,
        });
      }
    }
  }

  // Deduce topics from channel content
  const topicKeywords = [
    "SDK update",
    "API upgrade",
    "tax exemption",
    "invalid address",
    "email campaign",
    "billing address",
    "StripeObject",
    "address validation",
    "tax calculation",
    "POC",
    "telecom",
    "dark mode",
    "FE changes",
    "credit memo",
    "tax id",
    "Basil",
    "Clover",
  ];
  for (const kw of topicKeywords) {
    if (raw.toLowerCase().includes(kw.toLowerCase())) {
      topics.push(kw);
    }
  }

  return { raidItems, timelineEvents, topics };
}

function deriveWorkstreams(
  allRaid: RaidItem[],
  allTimeline: TimelineEvent[],
  allRaw: Map<string, string>
): Workstream[] {
  const workstreams: Workstream[] = [];

  // SDK/API Update workstream
  const sdkRaw = allRaw.get("devel-stripe-hack-sdk") || "";
  const sdkHasRecent =
    sdkRaw.includes("2026-03") || sdkRaw.includes("2026-02");
  workstreams.push({
    name: "Stripe SDK & API Upgrade",
    owner: "Priscilla Lok",
    status: sdkRaw.includes("very risky") ? "at-risk" : "on-track",
    summary:
      "Upgrading Stripe SDK from v475 through v942, v1091, v1268 to v1618, and API version to Basil/Clover. StripeObject changes completed. Currently at v1268 (Acacia).",
    nextSteps: [
      "Complete SDK update to v1618 (must happen simultaneously with API upgrade to Basil)",
      "Update API version to Clover",
      sdkHasRecent
        ? "Recent activity detected in channel"
        : "No recent activity",
    ],
  });

  // Invalid Address Remediation
  const addrRaw =
    allRaw.get("proj-invalid-us-billing-address-remediation") || "";
  const emailsSent =
    addrRaw.includes("live run") || addrRaw.includes("proceed with");
  workstreams.push({
    name: "Invalid Address Remediation",
    owner: "David Valentin",
    status: emailsSent ? "on-track" : "at-risk",
    summary:
      "~2,879 teams with invalid US billing addresses. Email campaign to notify customers. Dry run completed successfully (2,843 would receive email, 5 already fixed, 31 not eligible).",
    nextSteps: [
      "1st email send: March 17",
      "2nd email send: March 30",
      "3rd email send: April 13",
      "April 20: Evaluate email campaign efficacy",
    ],
  });

  // Tax Exemption
  const taxRaw = allRaw.get("proj-stripe-tax") || "";
  workstreams.push({
    name: "Tax Exemption Migration",
    owner: "David Valentin / Priscilla Lok",
    status: taxRaw.includes("mismatch") ? "at-risk" : "on-track",
    summary:
      "Migrating tax exemption process from SureTax to Stripe Tax. Gaps identified: Stripe only supports state-level exemption (not city-level). Transaction Type Code / Tax Exemption Code fields need mapping.",
    nextSteps: [
      "Get SureTax export of all tax-exempt customers from Jerald Blakeney",
      "Resolve city-level vs state-level exemption gap with Stripe",
      "Design backfill process for exemption data",
    ],
  });

  // Tax Calculation POC
  workstreams.push({
    name: "Tax Calculation POC",
    owner: "Ed Kang",
    status: "on-track",
    summary:
      "Proof of concept comparing Invoice Preview vs Tax Calculation API approaches. Evaluating pricing tiers and latency impact on checkout.",
    nextSteps: [
      "Complete POC comparing Tax API vs automatic invoice calculation",
      "Evaluate latency impact (Invoice.create ~600ms + InvoiceItem.create ~500ms)",
      "Determine Product Tax Code mapping from SureTax TransTypeCode",
    ],
  });

  // FE Changes
  workstreams.push({
    name: "Frontend (Address & Tax ID Elements)",
    owner: "Courtney Anderson-Clark",
    status: "at-risk",
    summary:
      "Integrating Stripe Address and Tax ID elements into checkout. FE tech spec drafted. Currently on hold while team works on currency project.",
    nextSteps: [
      "Resume FE work after currency project",
      "Implement loading UI for synchronous validation",
      "FE changes will NOT be part of Dark mode phase",
    ],
  });

  // Telecom tax blocker
  const herokuRaw = allRaw.get("slack-heroku-stripe-tax") || "";
  const telecomResolved =
    herokuRaw.includes("telecom") && herokuRaw.includes("resolved");
  workstreams.push({
    name: "Telecommunications Tax",
    owner: "Danny Cashin (coordinating)",
    status: telecomResolved ? "on-track" : "blocked",
    summary:
      "Stripe does not support telecommunications tax at the federal level. This is critical for huddles and upcoming features. Not currently on Stripe roadmap. Vertex and Avalara (used by other Salesforce BUs) do support this.",
    nextSteps: [
      "Stripe to check with Product on telecom tax plans",
      "Tax team to confirm telecom tax requirement",
      "Evaluate fallback options (Vertex, Avalara, hybrid approach)",
    ],
  });

  return workstreams;
}

function deriveOverallStatus(
  workstreams: Workstream[]
): "on-track" | "at-risk" | "blocked" {
  if (workstreams.some((w) => w.status === "blocked")) return "blocked";
  if (workstreams.filter((w) => w.status === "at-risk").length >= 2)
    return "at-risk";
  return "at-risk"; // conservative given known risks
}

export async function GET() {
  try {
    // Read all channels in parallel
    const channelResults = await Promise.all(
      STRIPE_TAX_CHANNELS.map(async (ch) => ({
        ...ch,
        raw: await readChannelMessages(ch.id, 100),
      }))
    );

    const allRaid: RaidItem[] = [];
    const allTimeline: TimelineEvent[] = [];
    const channels: ChannelSummary[] = [];
    const rawMap = new Map<string, string>();

    for (const ch of channelResults) {
      rawMap.set(ch.name, ch.raw);
      const { raidItems, timelineEvents, topics } = analyzeMessages(
        ch.name,
        ch.raw
      );
      allRaid.push(...raidItems);
      allTimeline.push(...timelineEvents);
      channels.push({
        channelId: ch.id,
        channelName: ch.name,
        messageCount: countMessages(ch.raw),
        topTopics: topics.slice(0, 5),
        recentActivity: extractRecentActivity(ch.raw),
      });
    }

    // Deduplicate RAID items by similarity (simple: same first 60 chars)
    const seen = new Set<string>();
    const dedupedRaid = allRaid.filter((item) => {
      const key = item.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort timeline by date descending
    allTimeline.sort((a, b) => b.date.localeCompare(a.date));

    const workstreams = deriveWorkstreams(dedupedRaid, allTimeline, rawMap);
    const overallStatus = deriveOverallStatus(workstreams);

    const snapshot: StripeTaxSnapshot = {
      date: todayStr(),
      capturedAt: new Date().toISOString(),
      overallStatus,
      statusSummary: `Stripe Tax migration is ${overallStatus}. ${workstreams.filter((w) => w.status === "blocked").length} workstream(s) blocked, ${workstreams.filter((w) => w.status === "at-risk").length} at risk. Key blocker: Stripe lacks telecom tax support.`,
      raid: dedupedRaid,
      timeline: allTimeline,
      channels,
      workstreams,
    };

    // Save daily snapshot (only once per day)
    await saveSnapshotIfNeeded(snapshot);

    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function saveSnapshotIfNeeded(snapshot: StripeTaxSnapshot) {
  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
    const filePath = path.join(SNAPSHOT_DIR, `${snapshot.date}.json`);
    try {
      await fs.access(filePath);
      // File exists, don't overwrite today's snapshot
    } catch {
      // File doesn't exist, save it
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
    }
  } catch {
    // Non-fatal: snapshot save failure shouldn't break the API
  }
}
