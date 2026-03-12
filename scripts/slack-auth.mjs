#!/usr/bin/env node
/**
 * One-time OAuth PKCE flow to get a Slack MCP access token.
 * Run: node scripts/slack-auth.mjs
 *
 * Opens browser for Slack authorization, listens for callback,
 * exchanges code for tokens, saves to .slack-tokens.json
 */

import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = "188160004832.9210129962818";
const CALLBACK_PORT = 3118;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth/callback`;
const TOKEN_FILE = path.join(process.cwd(), ".slack-tokens.json");

const SCOPES = [
  "search:read.public",
  "channels:history",
  "groups:history",
  "users:read",
].join(" ");

// Generate PKCE challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const { verifier, challenge } = generatePKCE();

// Build authorization URL
const authUrl = new URL("https://slack.com/oauth/v2_user/authorize");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
  if (!url.pathname.startsWith("/oauth/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>Missing authorization code</h1>");
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.user.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.ok) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
      server.close();
      process.exit(1);
    }

    // Save tokens
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_at: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
      team: tokens.team,
      authed_user: tokens.authed_user,
      saved_at: new Date().toISOString(),
    };

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
    console.log(`\nTokens saved to ${TOKEN_FILE}`);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h1>Authorized!</h1><p>You can close this window. Tokens saved.</p>`);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
  }

  server.close();
  process.exit(0);
});

server.listen(CALLBACK_PORT, () => {
  console.log(`Listening on http://localhost:${CALLBACK_PORT}/callback`);
  console.log(`\nOpening browser for Slack authorization...`);
  console.log(`URL: ${authUrl.toString()}\n`);

  // Open browser
  try {
    execSync(`open "${authUrl.toString()}"`);
  } catch {
    console.log("Could not open browser automatically. Please visit the URL above.");
  }
});
