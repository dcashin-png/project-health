import { NextRequest, NextResponse } from "next/server";
import { callSlackMcp } from "@/lib/slack-api";

export async function POST(request: NextRequest) {
  try {
    const { channelId, message, thread_ts } = await request.json();

    if (!channelId || !message) {
      return NextResponse.json(
        { error: "channelId and message are required" },
        { status: 400 }
      );
    }

    if (message.length > 5000) {
      return NextResponse.json(
        { error: "Message exceeds 5000 character limit" },
        { status: 400 }
      );
    }

    const args: Record<string, unknown> = {
      channel_id: channelId,
      message,
    };
    if (thread_ts) {
      args.thread_ts = thread_ts;
    }

    const result = await callSlackMcp("slack_send_message", args);

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
