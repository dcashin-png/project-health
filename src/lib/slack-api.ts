import fs from "fs/promises";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".slack-tokens.json");
const MCP_URL = "https://mcp.slack.com/mcp";

let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw);
    cachedToken = data.access_token;
    return cachedToken!;
  } catch {
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
      throw new Error("Slack token expired. Run: node scripts/slack-auth.mjs");
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

// Parse messages from the MCP read_channel response
function parseMessages(readText: string): string[] {
  let markdown: string;
  try {
    const parsed = JSON.parse(readText);
    markdown = parsed.messages || readText;
  } catch {
    markdown = readText;
  }

  // Messages are separated by "=== Message from ... ==="
  const blocks = markdown.split(/=== Message from .+? ===/);
  const messages: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Skip metadata lines (Message TS, Reactions, Thread replies)
    const lines = trimmed.split("\n").filter(
      (l) =>
        l.trim() &&
        !l.startsWith("Message TS:") &&
        !l.startsWith("Reactions:") &&
        !l.startsWith("Thread replies:") &&
        !l.startsWith("Channel:")
    );

    const text = lines.join(" ").trim();
    if (text) messages.push(text);
  }

  return messages;
}

// Read recent messages from a Slack channel via MCP
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

    return parseMessages(msgText);
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
