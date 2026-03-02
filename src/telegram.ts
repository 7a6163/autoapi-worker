import type { WorkerEnv } from "./types";

export async function sendTelegramMessage(
  env: WorkerEnv,
  message: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.CHAT_ID) {
    console.log("Telegram config not found, skipping notification");
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: message,
        }),
      },
    );

    if (!response.ok) {
      console.error("Failed to send Telegram message, status:", response.status);
    }
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
}
