import { Hono } from "hono";
import { updateToken } from "./updateToken";
import { runReadAPIs } from "./apiRead";
import { runWriteAPIs } from "./apiWrite";
import { sendTelegramMessage } from "./telegram";
import type { WorkerEnv, ScheduledEvent, ExecutionContext } from "./types";

type Bindings = WorkerEnv;

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
  return c.text("AutoApi E5 Worker is running with Hono!");
});

app.post("/update-token", async (c) => {
  try {
    await updateToken(c.env);
    return c.json({ success: true, message: "Token updated successfully" });
  } catch {
    return c.json({ success: false, error: "Token update failed" }, 500);
  }
});

app.post("/run-read", async (c) => {
  try {
    await runReadAPIs(c.env);
    return c.json({
      success: true,
      message: "Read APIs executed successfully",
    });
  } catch {
    return c.json({ success: false, error: "Read API execution failed" }, 500);
  }
});

app.post("/run-write", async (c) => {
  try {
    await runWriteAPIs(c.env);
    return c.json({
      success: true,
      message: "Write APIs executed successfully",
    });
  } catch {
    return c.json(
      { success: false, error: "Write API execution failed" },
      500,
    );
  }
});

app.get("/status", async (c) => {
  try {
    const hasRefreshToken = !!(await c.env.E5_CONFIG.get("MS_TOKEN"));
    const hasAccessToken = !!(await c.env.E5_CONFIG.get("ACCESS_TOKEN"));

    return c.json({
      status: "healthy",
      tokens: { hasRefreshToken, hasAccessToken },
      endpoints: {
        updateToken: "/update-token",
        runRead: "/run-read",
        runWrite: "/run-write",
      },
    });
  } catch {
    return c.json({ status: "error", error: "Status check failed" }, 500);
  }
});

app.notFound((c) => {
  return c.json({ error: "Endpoint not found" }, 404);
});

app.onError((_err, c) => {
  console.error("Unhandled error:", _err);
  return c.json({ error: "Internal server error" }, 500);
});

function scheduled(
  event: ScheduledEvent,
  env: WorkerEnv,
  ctx: ExecutionContext,
): void {
  const task = async () => {
    const cron = event.cron;
    try {
      if (cron === "10 10 * * 1,4,6") {
        console.log("Starting token update...");
        await updateToken(env);
      } else if (cron === "12 */6 * * 1-5") {
        console.log("Starting read API calls...");
        await runReadAPIs(env);
      } else if (cron === "12 23 * * *") {
        console.log("Starting write API calls...");
        await runWriteAPIs(env);
      }
    } catch (error) {
      console.error("Scheduled task failed:", error);
      await sendTelegramMessage(env, "❌ AutoApi Worker 執行失敗");
    }
  };

  ctx.waitUntil(task());
}

export default {
  fetch: app.fetch,
  scheduled,
};
