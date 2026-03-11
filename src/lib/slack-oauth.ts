import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { HttpServerConfig } from "./mcp-client";
import * as fs from "fs/promises";
import * as path from "path";

const TOKEN_DIR = ".oauth-tokens";

async function tokenDir(): Promise<string> {
  const dir = path.join(process.cwd(), TOKEN_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function saveJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Creates an OAuthClientProvider for use with the `auth()` helper function.
 * The `onRedirect` callback captures the authorization URL instead of opening a browser.
 */
export function createOAuthProviderForAuth(
  serverName: string,
  config: HttpServerConfig,
  onRedirect: (url: URL) => void
): OAuthClientProvider {
  const oauth = config.oauth!;
  // The OAuth callback comes back to our Next.js app, not a separate port
  const callbackUrl = `http://localhost:3000/api/auth/slack/callback`;

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

    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
      const dir = await tokenDir();
      return loadJson(path.join(dir, `${serverName}-client.json`));
    },

    async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
      const dir = await tokenDir();
      await saveJson(path.join(dir, `${serverName}-client.json`), info);
    },

    async tokens(): Promise<OAuthTokens | undefined> {
      const dir = await tokenDir();
      return loadJson(path.join(dir, `${serverName}.json`));
    },

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      const dir = await tokenDir();
      await saveJson(path.join(dir, `${serverName}.json`), tokens);
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      onRedirect(authorizationUrl);
    },

    async saveCodeVerifier(verifier: string): Promise<void> {
      const dir = await tokenDir();
      await fs.writeFile(path.join(dir, `${serverName}-verifier.txt`), verifier);
    },

    async codeVerifier(): Promise<string> {
      const dir = await tokenDir();
      return fs.readFile(path.join(dir, `${serverName}-verifier.txt`), "utf-8");
    },
  };
}
