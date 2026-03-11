import { NextResponse } from "next/server";
import {
  getAvailableServers,
  getServerConfig,
  disconnectServer,
} from "@/lib/mcp-client";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { HttpServerConfig } from "@/lib/mcp-client";
import { createOAuthProviderForAuth } from "@/lib/slack-oauth";

export async function GET() {
  const servers = await getAvailableServers();
  if (!servers.includes("slack")) {
    return NextResponse.json(
      { error: "Slack MCP server not configured" },
      { status: 404 }
    );
  }

  const config = getServerConfig("slack") as HttpServerConfig;
  if (!config?.oauth) {
    return NextResponse.json(
      { error: "Slack server does not use OAuth" },
      { status: 400 }
    );
  }

  // Clear any existing connection so we can re-auth
  await disconnectServer("slack");

  let authorizationUrl: string | undefined;

  const provider = createOAuthProviderForAuth("slack", config, (url) => {
    authorizationUrl = url.toString();
  });

  try {
    const result = await auth(provider, { serverUrl: config.url });

    if (result === "AUTHORIZED") {
      return NextResponse.json({ status: "already_authorized" });
    }

    if (result === "REDIRECT" && authorizationUrl) {
      return NextResponse.redirect(authorizationUrl);
    }

    return NextResponse.json(
      { error: "OAuth flow failed to produce a redirect URL" },
      { status: 500 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth initiation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
