import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "hono/utils/buffer";
import { updateToken } from "./updateToken.ts";
import { runReadAPIs } from "./apiRead.ts";
import { runWriteAPIs } from "./apiWrite.ts";
import type { WorkerEnv, ScheduledEvent } from "./types";

type Bindings = WorkerEnv;

const app = new Hono<{ Bindings: Bindings }>();

// Workers are public on *.workers.dev; fail closed when ADMIN_TOKEN is unset.
const requireAdmin = bearerAuth({
  verifyToken: async (token, c) => {
    const expected = (c.env as Bindings).ADMIN_TOKEN;
    return !!expected && (await timingSafeEqual(token, expected));
  },
});

app.get("/", (c) => {
  return c.text("AutoApi E5 Worker is running with Hono!");
});

app.post("/update-token", requireAdmin, async (c) => {
  try {
    await updateToken(c.env);
    return c.json({ success: true, message: "Token updated successfully" });
  } catch {
    return c.json({ success: false, error: "Token update failed" }, 500);
  }
});

app.post("/run-read", requireAdmin, async (c) => {
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

app.post("/run-write", requireAdmin, async (c) => {
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
  if (_err instanceof HTTPException) {
    return _err.getResponse();
  }
  console.error("Unhandled error:", _err);
  return c.json({ error: "Internal server error" }, 500);
});

/** Keys must stay identical to `triggers.crons` in wrangler.jsonc — see worker.test.ts. */
export const CRON_TASKS: Record<string, (env: WorkerEnv) => Promise<void>> = {
  "10 10 * * 1,4,6": updateToken,
  "12 */6 * * 1-5": runReadAPIs,
  "12 23 * * *": runWriteAPIs,
};

async function scheduled(event: ScheduledEvent, env: WorkerEnv): Promise<void> {
  const task = CRON_TASKS[event.cron];
  if (!task) {
    throw new Error(`No task registered for cron "${event.cron}"`);
  }

  // Each task sends its own Telegram failure alert and rethrows, so Cloudflare
  // records the invocation as failed; alerting here too would double-notify.
  await task(env);
}

export default {
  fetch: app.fetch,
  scheduled,
};
