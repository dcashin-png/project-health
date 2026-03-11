import { NextResponse } from "next/server";
import { getAvailableServers, isServerConnected } from "@/lib/mcp-client";

export async function GET() {
  const configured = await getAvailableServers();
  const expected = ["jira", "slack", "houston"];

  // Test which servers are actually connectable
  const connected: string[] = [];
  for (const server of configured) {
    if (await isServerConnected(server)) {
      connected.push(server);
    }
  }

  return NextResponse.json({
    status: "ok",
    configuredServers: configured,
    connectedServers: connected,
    expectedServers: expected,
    missing: expected.filter((s) => !configured.includes(s)),
    needsAuth: configured.filter((s) => !connected.includes(s)),
  });
}
