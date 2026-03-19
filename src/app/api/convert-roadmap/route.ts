import { NextResponse } from "next/server";
import { searchAllIssues } from "@/lib/jira-api";

interface RoadmapItem {
  key: string | null;
  summary: string;
  url: string | null;
  status: string | null;
  productCategory: string | null;
  experimentStartDate: string | null;
  experimentEndDate: string | null;
  expectedLaunchDate: string | null;
  gaLaunchDate: string | null;
  startDate: string | null;
  category: string;
}

// Hardcoded roadmap: category -> [{ name, jiraKey }]
const ROADMAP: Array<{ category: string; name: string; jiraKey: string | null }> = [
  // Path to Paid (Free Audience)
  { category: "Path to Paid", name: "Intelligent Trials: Plan Choice", jiraKey: "MNY-12770" },
  { category: "Path to Paid", name: "Intelligent Trials: No-commitment Fallback", jiraKey: "MNY-12774" },
  { category: "Path to Paid", name: "German Pricing Page Localization", jiraKey: "CUSTACQ-15046" },
  { category: "Path to Paid", name: "Gifted Business+ Trial, Free Teams", jiraKey: null },
  { category: "Path to Paid", name: "STP Bus+ with Pro Escape Hatch", jiraKey: "MNY-12928" },
  { category: "Path to Paid", name: "Pricing page: annual/discount/find your plan tool", jiraKey: "CUSTACQ-13894" },
  { category: "Path to Paid", name: "Plans page (free teams): 90d message", jiraKey: "CUSTACQ-15723" },
  // Upgrades (Pro Audience)
  { category: "Upgrades", name: "Contextualized upsell modal", jiraKey: null },
  { category: "Upgrades", name: "Entry point optimization: CTA copy changes", jiraKey: "MNY-12788" },
  { category: "Upgrades", name: "V1 Segmented Offers", jiraKey: "UPGRD-9092" },
  { category: "Upgrades", name: "SAML SSO Paywall In-client", jiraKey: null },
  { category: "Upgrades", name: "RTP reminder notification", jiraKey: null },
  // Purchase Experience
  { category: "Purchase Experience", name: "Apple Pay US & Canada", jiraKey: "PXP-3564" },
  { category: "Purchase Experience", name: "Checkout Content Optimizations", jiraKey: null },
  { category: "Purchase Experience", name: "Modernizing tax infrastructure & clean-up", jiraKey: "PXP-1425" },
  { category: "Purchase Experience", name: "Consolidate all global tax calculations", jiraKey: "PXP-3360" },
  // Tiger Team / Infrastructure
  { category: "Tiger Team / Infrastructure", name: "Offering system: Milestone 1 Billing and discounts", jiraKey: "UPGRD-8592" },
  { category: "Tiger Team / Infrastructure", name: "Offering system: Milestone 2 Promotions and discounts", jiraKey: "UPGRD-9020" },
];

const FIELDS = [
  "summary",
  "status",
  "customfield_18803", // Experiment Start Date
  "customfield_14505", // Experiment End Date
  "customfield_10611", // Expected Launch START Date
  "customfield_18503", // GA Launch Date
  "customfield_18801", // Product Category
  "customfield_12313", // Start Date
];

export async function GET() {
  try {
    const jiraKeys = ROADMAP.map((r) => r.jiraKey).filter(Boolean) as string[];

    const issues = jiraKeys.length > 0
      ? await searchAllIssues(`key in (${jiraKeys.join(",")})`, FIELDS)
      : [];

    const issueMap = new Map(issues.map((issue) => [issue.key, issue]));

    const items: RoadmapItem[] = ROADMAP.map((entry) => {
      const issue = entry.jiraKey ? issueMap.get(entry.jiraKey) : null;
      if (issue) {
        const f = issue.fields as Record<string, unknown>;
        const productCategoryField = f.customfield_18801 as { value?: string } | null;
        return {
          key: issue.key,
          summary: entry.name,
          url: `https://jira.tinyspeck.com/browse/${issue.key}`,
          status: issue.fields.status.name,
          productCategory: productCategoryField?.value || null,
          experimentStartDate: (f.customfield_18803 as string) || null,
          experimentEndDate: (f.customfield_14505 as string) || null,
          expectedLaunchDate: (f.customfield_10611 as string) || null,
          gaLaunchDate: (f.customfield_18503 as string) || null,
          startDate: (f.customfield_12313 as string) || null,
          category: entry.category,
        };
      }
      return {
        key: entry.jiraKey,
        summary: entry.name,
        url: entry.jiraKey ? `https://jira.tinyspeck.com/browse/${entry.jiraKey}` : null,
        status: null,
        productCategory: null,
        experimentStartDate: null,
        experimentEndDate: null,
        expectedLaunchDate: null,
        gaLaunchDate: null,
        startDate: null,
        category: entry.category,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch roadmap data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
