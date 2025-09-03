import { Hono } from "hono";
import { updateToken } from "./updateToken";
import { runReadAPIs } from "./apiRead";
import { runWriteAPIs } from "./apiWrite";
import type { WorkerEnv, ScheduledEvent, ExecutionContext } from "./types";

type Bindings = WorkerEnv;

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get("/", (c) => {
  return c.text("AutoApi E5 Worker is running with Hono! 🚀");
});

// Manual trigger endpoints
app.post("/update-token", async (c) => {
  try {
    await updateToken(c.env);
    return c.json({ success: true, message: "Token updated successfully" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

app.post("/run-read", async (c) => {
  try {
    await runReadAPIs(c.env);
    return c.json({
      success: true,
      message: "Read APIs executed successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

app.post("/run-write", async (c) => {
  try {
    await runWriteAPIs(c.env);
    return c.json({
      success: true,
      message: "Write APIs executed successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// Status endpoint with detailed information
app.get("/status", async (c) => {
  try {
    const hasRefreshToken = !!(await c.env.E5_CONFIG.get("MS_TOKEN"));
    const hasAccessToken = !!(await c.env.E5_CONFIG.get("ACCESS_TOKEN"));

    return c.json({
      status: "healthy",
      tokens: {
        hasRefreshToken,
        hasAccessToken,
      },
      endpoints: {
        updateToken: "/update-token",
        runRead: "/run-read",
        runWrite: "/run-write",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ status: "error", error: errorMessage }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Endpoint not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Scheduled event handler (remains outside Hono for cron jobs)
async function scheduled(
  event: ScheduledEvent,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const cron = event.cron;

  try {
    // Determine which task to run based on cron schedule
    if (cron === "10 10 * * 1,4,6") {
      // Update Token: Mon, Thu, Sat at 10:10 UTC
      console.log("Starting token update...");
      await updateToken(env);
    } else if (cron === "12 */6 * * 1-5") {
      // Read APIs: Every 6 hours on weekdays
      console.log("Starting read API calls...");
      await runReadAPIs(env);
    } else if (cron === "12 23 * * *") {
      // Write APIs: Daily at 23:12 UTC
      console.log("Starting write API calls...");
      await runWriteAPIs(env);
    }
  } catch (error) {
    console.error("Scheduled task failed:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(
      env,
      `❌ AutoApi Worker 執行失敗: ${errorMessage}`,
    );
  }
}

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
      console.error("Failed to send Telegram message:", await response.text());
    }
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
}

// Export the default object for Cloudflare Workers
export default {
  fetch: app.fetch,
  scheduled,
};
