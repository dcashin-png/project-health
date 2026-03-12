#!/usr/bin/env node
/**
 * OAuth PKCE flow for Houston MCP.
 * Run: node scripts/houston-auth.mjs
 */

import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CALLBACK_PORT = 3120;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth/callback`;
const TOKEN_FILE = path.join(process.cwd(), ".houston-tokens.json");
const REGISTRATION_URL = "https://toolbelt.tinyspeck.com/oauth/register";
const AUTH_URL = "https://toolbelt.tinyspeck.com/oauth/authorize";
const TOKEN_URL = "https://toolbelt.tinyspeck.com/oauth/token";
const SCOPES = "mcp.read";

// Step 1: Dynamic client registration
async function registerClient() {
  const res = await fetch(REGISTRATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "project-health-dashboard",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${text}`);
  }
  return res.json();
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function main() {
  console.log("Registering client with toolbelt...");
  const clientInfo = await registerClient();
  const clientId = clientInfo.client_id;
  console.log(`Client registered: ${clientId}`);

  const { verifier, challenge } = generatePKCE();

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

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
      res.writeHead(400);
      res.end("Missing code");
      return;
    }

    try {
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
          grant_type: "authorization_code",
        }),
      });

      const tokens = await tokenRes.json();

      if (tokens.error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
        server.close();
        process.exit(1);
      }

      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        client_id: clientId,
        saved_at: new Date().toISOString(),
      };

      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
      console.log(`\nTokens saved to ${TOKEN_FILE}`);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h1>Houston Authorized!</h1><p>You can close this window.</p>`);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
    }

    server.close();
    process.exit(0);
  });

  server.listen(CALLBACK_PORT, () => {
    console.log(`Listening on http://localhost:${CALLBACK_PORT}/oauth/callback`);
    console.log(`\nOpening browser for Houston authorization...`);
    try {
      execSync(`open "${authUrl.toString()}"`);
    } catch {
      console.log("Could not open browser. Visit the URL above.");
    }
  });
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
