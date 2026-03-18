import fs from "fs/promises";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".slack-tokens.json");
const MCP_URL = "https://mcp.slack.com/mcp";
const CLIENT_ID = "188160004832.9210129962818";

let cachedToken: string | null = null;

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  [key: string]: unknown;
}

async function readTokenFile(): Promise<TokenData> {
  const raw = await fs.readFile(TOKEN_FILE, "utf-8");
  return JSON.parse(raw);
}

async function refreshToken(data: TokenData): Promise<string> {
  if (!data.refresh_token) {
    throw new Error("Slack token expired and no refresh token. Run: node scripts/slack-auth.mjs");
  }
  const res = await fetch("https://slack.com/api/oauth.v2.user.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
  });
  const tokens = await res.json();
  if (!tokens.ok) {
    throw new Error(`Slack token refresh failed: ${tokens.error}. Run: node scripts/slack-auth.mjs`);
  }
  const updated: TokenData = {
    ...data,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || data.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    saved_at: new Date().toISOString(),
  };
  await fs.writeFile(TOKEN_FILE, JSON.stringify(updated, null, 2));
  cachedToken = updated.access_token;
  return cachedToken;
}

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  try {
    const data = await readTokenFile();
    if (data.expires_at && Date.now() > data.expires_at - 60_000) {
      return await refreshToken(data);
    }
    cachedToken = data.access_token;
    return cachedToken;
  } catch (err) {
    if (err instanceof Error && err.message.includes("refresh")) throw err;
    throw new Error("No Slack token found. Run: node scripts/slack-auth.mjs");
  }
}

// Call a tool on the Slack MCP server via JSON-RPC over HTTP
export async function callSlackMcp(toolName: string, args: Record<string, unknown>): Promise<string> {
  const token = await getToken();

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now(),
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (res.status === 401) {
      cachedToken = null;
      try {
        const tokenData = await readTokenFile();
        const newToken = await refreshToken(tokenData);
        const retry = await fetch(MCP_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${newToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: args },
            id: Date.now(),
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!retry.ok) throw new Error("Still unauthorized after refresh");
        const retryData = await retry.json();
        const retryContent = retryData.result?.content || [];
        const retryText = retryContent.find((c: { type: string; text?: string }) => c.type === "text");
        return retryText?.text || "";
      } catch {
        throw new Error("Slack token expired. Run: node scripts/slack-auth.mjs");
      }
    }
    throw new Error(`Slack MCP returned ${res.status}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Slack MCP error: ${JSON.stringify(data.error)}`);
  }

  // Extract text content from MCP response — may be JSON-encoded
  const content = data.result?.content || [];
  const textPart = content.find((c: { type: string; text?: string }) => c.type === "text");
  return textPart?.text || "";
}

export async function isSlackConnected(): Promise<boolean> {
  try {
    await getToken();
    return true;
  } catch {
    return false;
  }
}

// Find channel ID by searching the MCP search_channels response
export function parseChannelId(searchText: string, targetName: string): string | null {
  // The response is JSON with a "results" field containing markdown
  let markdown: string;
  try {
    const parsed = JSON.parse(searchText);
    markdown = parsed.results || searchText;
  } catch {
    markdown = searchText;
  }

  // Extract all channel name + archive ID pairs
  const blocks = markdown.split(/### Result \d+ of \d+/);
  for (const block of blocks) {
    const nameMatch = block.match(/Name: #([^\n]+)/);
    const idMatch = block.match(/archives\/([A-Z0-9]+)/);
    if (nameMatch && idMatch && nameMatch[1].trim() === targetName) {
      return idMatch[1];
    }
  }

  // Fall back to first result
  const firstId = markdown.match(/archives\/([A-Z0-9]+)/);
  return firstId?.[1] || null;
}

// Parse all channels from a search response
export function parseChannelResults(searchText: string): Array<{ id: string; name: string }> {
  let markdown: string;
  try {
    const parsed = JSON.parse(searchText);
    markdown = parsed.results || searchText;
  } catch {
    markdown = searchText;
  }

  const channels: Array<{ id: string; name: string }> = [];
  const blocks = markdown.split(/### Result \d+ of \d+/);
  for (const block of blocks) {
    const nameMatch = block.match(/Name: #([^\n]+)/);
    const idMatch = block.match(/archives\/([A-Z0-9]+)/);
    if (nameMatch && idMatch) {
      channels.push({ id: idMatch[1], name: nameMatch[1].trim() });
    }
  }
  return channels;
}

// Parsed message with metadata for thread detection
interface ParsedMessage {
  text: string;
  ts: string | null;
  threadReplies: number;
}

// Parse messages from the MCP read_channel response, extracting thread metadata
function parseMessages(readText: string): ParsedMessage[] {
  let markdown: string;
  try {
    const parsed = JSON.parse(readText);
    markdown = parsed.messages || readText;
  } catch {
    markdown = readText;
  }

  const blocks = markdown.split(/=== Message from .+? ===/);
  const messages: ParsedMessage[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Extract message TS
    const tsMatch = trimmed.match(/Message TS:\s*([0-9.]+)/);
    const ts = tsMatch ? tsMatch[1] : null;

    // Extract thread reply count: "Thread: 9 replies"
    const threadMatch = trimmed.match(/Thread:\s*(\d+)\s*repl/);
    const threadReplies = threadMatch ? parseInt(threadMatch[1], 10) : 0;

    // Extract message text (skip metadata lines)
    const lines = trimmed.split("\n").filter(
      (l) =>
        l.trim() &&
        !l.startsWith("Message TS:") &&
        !l.startsWith("Reactions:") &&
        !l.startsWith("Thread:") &&
        !l.startsWith("Channel:")
    );

    const text = lines.join(" ").trim();
    if (text) messages.push({ text, ts, threadReplies });
  }

  return messages;
}

// Parse thread reply messages from slack_read_thread response
function parseThreadMessages(readText: string): string[] {
  let markdown: string;
  try {
    const parsed = JSON.parse(readText);
    markdown = parsed.messages || readText;
  } catch {
    markdown = readText;
  }

  const blocks = markdown.split(/=== (?:Message|Reply) from .+? ===/);
  const messages: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n").filter(
      (l) =>
        l.trim() &&
        !l.startsWith("Message TS:") &&
        !l.startsWith("Reactions:") &&
        !l.startsWith("Thread:") &&
        !l.startsWith("Channel:") &&
        !l.startsWith("Reply TS:")
    );

    const text = lines.join(" ").trim();
    if (text) messages.push(text);
  }

  return messages;
}

// Read recent messages from a Slack channel via MCP, including threads with 3+ replies
async function readSlackChannel(channelName: string): Promise<string[]> {
  const name = channelName.replace(/^#/, "");

  try {
    const searchText = await callSlackMcp("slack_search_channels", { query: name, limit: 5 });
    const channelId = parseChannelId(searchText, name);
    if (!channelId) return [];

    const msgText = await callSlackMcp("slack_read_channel", {
      channel_id: channelId,
      limit: 30,
    });

    const parsed = parseMessages(msgText);
    const allMessages = parsed.map((m) => m.text);

    // Read threads with 3+ replies (cap at 3 threads to limit API calls)
    const threadsToRead = parsed
      .filter((m) => m.threadReplies >= 3 && m.ts)
      .slice(0, 3);

    if (threadsToRead.length > 0) {
      const threadResults = await Promise.all(
        threadsToRead.map(async (m) => {
          try {
            const threadText = await callSlackMcp("slack_read_thread", {
              channel_id: channelId,
              message_ts: m.ts,
              limit: 20,
            });
            return parseThreadMessages(threadText);
          } catch {
            return [];
          }
        })
      );

      for (const threadMsgs of threadResults) {
        allMessages.push(...threadMsgs);
      }
    }

    return allMessages;
  } catch {
    return [];
  }
}

// Batch read: deduplicate channels, read each once, cap concurrency
export async function batchReadSlackChannels(
  channelNames: string[]
): Promise<Map<string, string[]>> {
  const unique = [...new Set(channelNames.filter(Boolean))];
  const results = new Map<string, string[]>();

  if (unique.length === 0) return results;

  const concurrency = 10;
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (name) => ({
        name,
        messages: await readSlackChannel(name),
      }))
    );
    for (const { name, messages } of batchResults) {
      results.set(name, messages);
    }
  }

  return results;
}
