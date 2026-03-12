import { NextRequest, NextResponse } from "next/server";
import { callSlackMcp, parseChannelResults } from "@/lib/slack-api";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  if (!query) {
    return NextResponse.json({ channels: [] });
  }

  try {
    const searchText = await callSlackMcp("slack_search_channels", {
      query,
      limit: 10,
    });
    const channels = parseChannelResults(searchText);
    return NextResponse.json({ channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
