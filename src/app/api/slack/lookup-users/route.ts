import { NextRequest, NextResponse } from "next/server";
import { callSlackMcp } from "@/lib/slack-api";

export interface SlackCandidate {
  slackId: string;
  displayName: string;
  title: string | null;
  avatar: string | null;
}

// Look up Slack users by name, returning all candidates for each
export async function GET(request: NextRequest) {
  const names = request.nextUrl.searchParams.get("names");
  const emails = request.nextUrl.searchParams.get("emails");
  if (!names) {
    return NextResponse.json({ candidates: {} });
  }

  const nameList = names.split(",").map((n) => n.trim()).filter(Boolean);
  const emailList = emails ? emails.split(",").map((e) => e.trim()) : [];
  const candidates: Record<string, SlackCandidate[]> = {};

  await Promise.all(
    nameList.map(async (name, i) => {
      try {
        const email = emailList[i] || "";

        // If we have an email, try exact email match first
        if (email) {
          const raw = await callSlackMcp("slack_search_users", {
            query: email,
            limit: 1,
          });
          const parsed = parseUserBlocks(raw);
          if (parsed.length === 1) {
            candidates[name] = parsed;
            return;
          }
        }

        // Search by name and return all candidates
        const raw = await callSlackMcp("slack_search_users", {
          query: name,
          limit: 10,
        });
        candidates[name] = parseUserBlocks(raw);
      } catch {
        candidates[name] = [];
      }
    })
  );

  return NextResponse.json({ candidates });
}

function parseUserBlocks(raw: string): SlackCandidate[] {
  let markdown: string;
  try {
    const parsed = JSON.parse(raw);
    markdown = parsed.results || raw;
  } catch {
    markdown = raw;
  }

  const results: SlackCandidate[] = [];
  const userBlocks = markdown.split(/(?=Name:\s)/);

  for (const block of userBlocks) {
    const idMatch = block.match(/User ID:\s*(U[A-Z0-9]+)/);
    const nameMatch = block.match(/Name:\s*([^\n]+)/);
    const titleMatch = block.match(/Title:\s*([^\n]+)/);
    const avatarMatch = block.match(/Profile Pic:\s*\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (!idMatch || !nameMatch) continue;

    results.push({
      slackId: idMatch[1],
      displayName: nameMatch[1].trim(),
      title: titleMatch ? titleMatch[1].trim() : null,
      avatar: avatarMatch ? avatarMatch[1] : null,
    });
  }

  return results;
}
