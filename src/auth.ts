import { sendTelegramMessage } from "./telegram.ts";
import type { WorkerEnv } from "./types";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

const TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const REDIRECT_URI =
  "https://login.microsoftonline.com/common/oauth2/nativeclient";
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 1000;
export const ACCESS_TOKEN_TTL = 3600;

export async function getAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
  });

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;

      if (
        typeof data.access_token !== "string" ||
        typeof data.refresh_token !== "string"
      ) {
        throw new Error(
          "Invalid token response: missing access_token or refresh_token",
        );
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
    }

    if (retry === MAX_RETRIES - 1) {
      throw new Error(
        `Failed to obtain token after ${MAX_RETRIES} attempts (status: ${response.status})`,
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new Error("Unreachable: retry loop exited without return or throw");
}

/**
 * Microsoft invalidates the old refresh token the moment it issues a new one,
 * so a failed MS_TOKEN write leaves KV holding a dead token and every job
 * failing until someone re-authorises by hand. KV has no transactions, so the
 * best we can do is shout.
 */
export async function persistTokens(
  env: WorkerEnv,
  tokens: TokenResponse,
): Promise<void> {
  try {
    await env.E5_CONFIG.put("MS_TOKEN", tokens.refresh_token);
  } catch (error) {
    console.error("Failed to persist refresh token:", error);
    await sendTelegramMessage(
      env,
      "🚨 AutoApi 無法寫回 refresh token，請立即重新授權",
    );
    throw error;
  }

  await env.E5_CONFIG.put("ACCESS_TOKEN", tokens.access_token, {
    expirationTtl: ACCESS_TOKEN_TTL,
  });
}

export async function ensureAccessToken(env: WorkerEnv): Promise<string> {
  const cached = await env.E5_CONFIG.get("ACCESS_TOKEN");
  if (cached) {
    return cached;
  }

  const refreshToken = await env.E5_CONFIG.get("MS_TOKEN");
  if (!refreshToken) {
    throw new Error("No refresh token found in KV storage");
  }

  const tokens = await getAccessToken(
    refreshToken,
    env.CLIENT_ID,
    env.CLIENT_SECRET,
  );

  await persistTokens(env, tokens);

  return tokens.access_token;
}
