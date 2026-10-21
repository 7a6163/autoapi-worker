import type { WorkerEnv } from "./types";

export async function sendTelegramMessage(
  env: WorkerEnv,
  message: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.CHAT_ID) {
    console.log("Telegram config not found, skipping notification");
    return;
  }

  // Forum topic in a supergroup; ignore a malformed value rather than lose the alert.
  const topicId = env.TOPIC_ID ? Number(env.TOPIC_ID) : undefined;
  if (topicId !== undefined && !Number.isInteger(topicId)) {
    console.error(`Ignoring invalid TOPIC_ID "${env.TOPIC_ID}"`);
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
          ...(Number.isInteger(topicId) ? { message_thread_id: topicId } : {}),
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
