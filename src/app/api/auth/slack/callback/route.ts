import { NextRequest, NextResponse } from "next/server";
import {
  getServerConfig,
  disconnectServer,
} from "@/lib/mcp-client";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { HttpServerConfig } from "@/lib/mcp-client";
import { createOAuthProviderForAuth } from "@/lib/slack-oauth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "Missing authorization code" },
      { status: 400 }
    );
  }

  const config = getServerConfig("slack") as HttpServerConfig;
  if (!config?.oauth) {
    return NextResponse.json(
      { error: "Slack server not configured for OAuth" },
      { status: 400 }
    );
  }

  // Clear any cached connection
  await disconnectServer("slack");

  const provider = createOAuthProviderForAuth("slack", config, () => {});

  try {
    const result = await auth(provider, {
      serverUrl: config.url,
      authorizationCode: code,
    });

    if (result === "AUTHORIZED") {
      // Redirect back to the dashboard
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth callback failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
