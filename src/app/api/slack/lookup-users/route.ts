import { NextRequest, NextResponse } from "next/server";
import { callSlackMcp } from "@/lib/slack-api";

// Look up Slack users by name, returning userId + displayName
export async function GET(request: NextRequest) {
  const names = request.nextUrl.searchParams.get("names");
  if (!names) {
    return NextResponse.json({ users: {} });
  }

  const nameList = names.split(",").map((n) => n.trim()).filter(Boolean);
  const results: Record<string, { slackId: string; displayName: string } | null> = {};

  await Promise.all(
    nameList.map(async (name) => {
      try {
        const raw = await callSlackMcp("slack_search_users", {
          query: name,
          limit: 1,
        });

        // Response is JSON: { results: "markdown...", pagination_info: "..." }
        let markdown: string;
        try {
          const parsed = JSON.parse(raw);
          markdown = parsed.results || raw;
        } catch {
          markdown = raw;
        }

        // Parse: "Name: Bradley Bortner\nUser ID: U05BKC6GUPM"
        const idMatch = markdown.match(/User ID:\s*(U[A-Z0-9]+)/);
        const nameMatch = markdown.match(/Name:\s*([^\n]+)/);
        if (idMatch) {
          results[name] = {
            slackId: idMatch[1],
            displayName: nameMatch ? nameMatch[1].trim() : name,
          };
        } else {
          results[name] = null;
        }
      } catch {
        results[name] = null;
      }
    })
  );

  return NextResponse.json({ users: results });
}
