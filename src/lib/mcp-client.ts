import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface StdioServerConfig {
  type?: "stdio";
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpServerConfig {
  type: "http";
  name: string;
  url: string;
  headers?: Record<string, string>;
  oauth?: {
    clientId: string;
    callbackPort: number;
  };
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

const serverConfigs: Record<string, McpServerConfig> = {};

let configsLoaded = false;

async function loadConfigs() {
  if (configsLoaded) return;
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const configPath = path.join(process.cwd(), "mcp-servers.json");
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    for (const [name, config] of Object.entries(parsed.servers || {})) {
      serverConfigs[name] = config as McpServerConfig;
    }
    configsLoaded = true;
  } catch {
    console.warn("No mcp-servers.json found or failed to parse it");
    configsLoaded = true;
  }
}

// File-based OAuth token storage
const TOKEN_DIR = ".oauth-tokens";

async function getTokenPath(serverName: string): Promise<string> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), TOKEN_DIR);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${serverName}.json`);
}

async function loadTokens(serverName: string): Promise<OAuthTokens | undefined> {
  try {
    const fs = await import("fs/promises");
    const tokenPath = await getTokenPath(serverName);
    const raw = await fs.readFile(tokenPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function saveTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
  const fs = await import("fs/promises");
  const tokenPath = await getTokenPath(serverName);
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
}

async function loadClientInfo(serverName: string): Promise<OAuthClientInformationMixed | undefined> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const dir = path.join(process.cwd(), TOKEN_DIR);
    const infoPath = path.join(dir, `${serverName}-client.json`);
    const raw = await fs.readFile(infoPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function saveClientInfo(serverName: string, info: OAuthClientInformationMixed): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), TOKEN_DIR);
  await fs.mkdir(dir, { recursive: true });
  const infoPath = path.join(dir, `${serverName}-client.json`);
  await fs.writeFile(infoPath, JSON.stringify(info, null, 2));
}

async function loadCodeVerifier(serverName: string): Promise<string> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), TOKEN_DIR);
  const verifierPath = path.join(dir, `${serverName}-verifier.txt`);
  return fs.readFile(verifierPath, "utf-8");
}

async function saveCodeVerifier(serverName: string, verifier: string): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), TOKEN_DIR);
  await fs.mkdir(dir, { recursive: true });
  const verifierPath = path.join(dir, `${serverName}-verifier.txt`);
  await fs.writeFile(verifierPath, verifier);
}

function createOAuthProvider(
  serverName: string,
  config: HttpServerConfig
): OAuthClientProvider {
  const oauth = config.oauth!;
  const callbackUrl = `http://localhost:${oauth.callbackPort}/callback`;

  return {
    get redirectUrl() {
      return new URL(callbackUrl);
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "project-health",
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },

    clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
      return loadClientInfo(serverName);
    },

    saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
      return saveClientInfo(serverName, info);
    },

    tokens(): Promise<OAuthTokens | undefined> {
      return loadTokens(serverName);
    },

    saveTokens(tokens: OAuthTokens): Promise<void> {
      return saveTokens(serverName, tokens);
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      // Store the auth URL so the /api/auth/[server] route can redirect to it
      console.log(`[OAuth] Authorization required for ${serverName}: ${authorizationUrl.toString()}`);
      // In a server context, we can't redirect the browser. The auth initiation
      // route will handle this separately.
    },

    saveCodeVerifier(verifier: string): Promise<void> {
      return saveCodeVerifier(serverName, verifier);
    },

    codeVerifier(): Promise<string> {
      return loadCodeVerifier(serverName);
    },
  };
}

// Cache active clients
const clients: Record<string, Client> = {};
// Cache OAuth providers for auth flow
const oauthProviders: Record<string, OAuthClientProvider> = {};
// Cache transports for finishAuth
const transports: Record<string, StreamableHTTPClientTransport> = {};

export function getOAuthProvider(serverName: string): OAuthClientProvider | undefined {
  return oauthProviders[serverName];
}

export function getTransport(serverName: string): StreamableHTTPClientTransport | undefined {
  return transports[serverName];
}

export function getServerConfig(serverName: string): McpServerConfig | undefined {
  return serverConfigs[serverName];
}

export async function getMcpClient(serverName: string): Promise<Client> {
  await loadConfigs();

  if (clients[serverName]) {
    return clients[serverName];
  }

  const config = serverConfigs[serverName];
  if (!config) {
    throw new Error(
      `No MCP server config found for "${serverName}". Add it to mcp-servers.json`
    );
  }

  let transport;
  if (config.type === "http") {
    if (config.oauth) {
      const authProvider = createOAuthProvider(serverName, config);
      oauthProviders[serverName] = authProvider;
      transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        { authProvider }
      );
      transports[serverName] = transport;
    } else {
      transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers || {} } }
      );
    }
  } else {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
    });
  }

  const client = new Client({
    name: "project-health",
    version: "0.1.0",
  });

  await client.connect(transport);
  clients[serverName] = client;
  return client;
}

export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {}
) {
  const client = await getMcpClient(serverName);
  const result = await client.callTool({ name: toolName, arguments: args });
  return result;
}

export async function getAvailableServers(): Promise<string[]> {
  await loadConfigs();
  return Object.keys(serverConfigs);
}

export async function isServerConnected(serverName: string): Promise<boolean> {
  try {
    await getMcpClient(serverName);
    return true;
  } catch {
    return false;
  }
}

// Disconnect a cached client (e.g., to reconnect after OAuth)
export async function disconnectServer(serverName: string): Promise<void> {
  const client = clients[serverName];
  if (client) {
    try {
      await client.close();
    } catch { /* ignore */ }
    delete clients[serverName];
  }
  delete transports[serverName];
}
