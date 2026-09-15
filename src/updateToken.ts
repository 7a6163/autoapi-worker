import { sendTelegramMessage } from "./telegram.ts";
import { getAccessToken, persistTokens } from "./auth.ts";
import type { WorkerEnv } from "./types";

export async function updateToken(env: WorkerEnv): Promise<void> {
  try {
    const currentToken = await env.E5_CONFIG.get("MS_TOKEN");
    if (!currentToken) {
      throw new Error("No refresh token found in KV storage");
    }

    const newToken = await getAccessToken(
      currentToken,
      env.CLIENT_ID,
      env.CLIENT_SECRET,
    );

    await persistTokens(env, newToken);

    console.log("Token updated successfully");
    await sendTelegramMessage(env, "✅ AutoApi 成功更新 token");
  } catch (error) {
    console.error("Token update failed:", error);
    await sendTelegramMessage(env, "❌ AutoApi 無法更新 token");
    throw error;
  }
}
