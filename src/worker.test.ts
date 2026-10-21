import { test, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureAccessToken, persistTokens } from "./auth.ts";
import { runWriteAPIs } from "./apiWrite.ts";
import { runReadAPIs } from "./apiRead.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { updateToken } from "./updateToken.ts";
import worker, { CRON_TASKS } from "./index.ts";
import { shuffledCopy, pickRandom, isRetryableStatus } from "./utils.ts";
import type { WorkerEnv } from "./types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeEnv(
  seed: Record<string, string> = {},
  opts: { failPutOn?: string; telegram?: boolean } = {},
): {
  env: WorkerEnv;
  kv: Map<string, string>;
  ttls: Map<string, number | undefined>;
} {
  const kv = new Map(Object.entries(seed));
  const ttls = new Map<string, number | undefined>();
  const env = {
    CLIENT_ID: "cid",
    CLIENT_SECRET: "secret",
    ...(opts.telegram ? { TELEGRAM_BOT_TOKEN: "bot", CHAT_ID: "42" } : {}),
    E5_CONFIG: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
        if (k === opts.failPutOn) throw new Error("KV write failed");
        kv.set(k, v);
        ttls.set(k, o?.expirationTtl);
      },
    },
  } as unknown as WorkerEnv;
  return { env, kv, ttls };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("ensureAccessToken uses the cached access token without hitting Microsoft", async () => {
  const { env } = fakeEnv({ ACCESS_TOKEN: "cached", MS_TOKEN: "rt" });
  globalThis.fetch = (() => assert.fail("should not refresh")) as typeof fetch;

  assert.equal(await ensureAccessToken(env), "cached");
});

test("ensureAccessToken persists the rotated refresh token", async () => {
  // Microsoft returns a new refresh token every time; dropping it bricks the account.
  const { env, kv, ttls } = fakeEnv({ MS_TOKEN: "old-rt" });
  globalThis.fetch = (async () =>
    json({ access_token: "new-at", refresh_token: "new-rt" })) as typeof fetch;

  assert.equal(await ensureAccessToken(env), "new-at");
  assert.equal(kv.get("MS_TOKEN"), "new-rt");
  assert.equal(kv.get("ACCESS_TOKEN"), "new-at");
  assert.equal(ttls.get("ACCESS_TOKEN"), 3300); // fallback 3600 minus margin
  assert.equal(ttls.get("MS_TOKEN"), undefined);
});

test("ensureAccessToken throws when KV has no refresh token", async () => {
  const { env } = fakeEnv();
  globalThis.fetch = (() => assert.fail("should not refresh")) as typeof fetch;

  await assert.rejects(ensureAccessToken(env), /No refresh token/);
});

test("runWriteAPIs deletes the uploaded workbook even when an operation fails", async () => {
  // OneDrive is capped at 10 GB, so a failing op must not leak the .xlsx.
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const deleted: string[] = [];
  let uploaded = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PUT" && url.includes("/AutoApi/App1/")) {
      uploaded = url;
      return json({ id: "file-id" });
    }
    if (method === "DELETE" && url.includes("/AutoApi/App1/")) {
      deleted.push(url);
      return new Response(null, { status: 204 });
    }
    return new Response("nope", { status: 500 }); // every op fails
  }) as typeof fetch;

  await assert.rejects(runWriteAPIs(env));

  assert.match(uploaded, /\/AutoApi\/App1\/QAQ\d+\.xlsx:\/content$/);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0], uploaded.replace(":/content", ""));
});

// Graph fake for write ops: every call is recorded; calls matching `fail` return 500.
function fakeGraph(fail: RegExp, failStatus = 500): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = `${init?.method ?? "GET"} ${String(input)}`;
    calls.push(call);
    if (fail.test(call)) return new Response("nope", { status: failStatus });
    if (call.startsWith("DELETE")) return new Response(null, { status: 204 });
    if (call.endsWith("/v1.0/teams")) {
      return new Response(null, {
        status: 202,
        headers: { "Content-Location": "/teams('team-1')" },
      });
    }
    if (call.includes("/channels")) return json({ id: "ch-1" });
    if (call.endsWith("/todo/lists")) return json({ id: "list-1" });
    if (call.endsWith("/tasks")) return json({ id: "task-1" });
    return json({ id: "file-id" });
  }) as typeof fetch;
  return calls;
}

// Math.random() = 0.99 makes pickRandom choose ops [3 (task), 2 (team)]; setTimeout fires at once.
function forceTaskAndTeam(t: TestContext): void {
  t.mock.method(Math, "random", () => 0.99);
  t.mock.method(globalThis, "setTimeout", (fn: () => void) => {
    fn();
    return 0;
  });
}

test("runWriteAPIs deletes the team by its Content-Location id when channel creation fails", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/^POST .*\/channels$/);

  await assert.rejects(runWriteAPIs(env));

  assert.ok(
    calls.includes("DELETE https://graph.microsoft.com/v1.0/groups/team-1"),
  );
  assert.ok(!calls.some((c) => c.includes("joinedTeams")));
});

test("runWriteAPIs deletes the task list when task creation fails", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/^POST .*\/tasks$/);

  await assert.rejects(runWriteAPIs(env));

  assert.ok(
    calls.includes(
      "DELETE https://graph.microsoft.com/v1.0/me/todo/lists/list-1",
    ),
  );
});

test("runWriteAPIs runs task and team ops end to end and cleans up everything", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/^$/);

  await runWriteAPIs(env);

  const deletes = calls.filter((c) => c.startsWith("DELETE"));
  assert.equal(deletes.length, 5); // task, list, channel, team, workbook
});

test("trigger endpoints reject callers without the admin token", async () => {
  const { env } = fakeEnv({ MS_TOKEN: "rt" });
  globalThis.fetch = (() =>
    assert.fail("should not reach Microsoft")) as typeof fetch;
  const post = (path: string, token?: string) =>
    worker.fetch(
      new Request(`https://w.example${path}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      env,
    );

  // Unset ADMIN_TOKEN must fail closed, not open.
  assert.equal((await post("/run-write", "anything")).status, 401);

  env.ADMIN_TOKEN = "s3cret";
  for (const path of ["/update-token", "/run-read", "/run-write"]) {
    assert.equal((await post(path)).status, 401);
    assert.equal((await post(path, "wrong")).status, 401);
  }
});

test("trigger endpoints run the job with the right admin token", async () => {
  const { env, kv } = fakeEnv({ MS_TOKEN: "old-rt" });
  env.ADMIN_TOKEN = "s3cret";
  globalThis.fetch = (async () =>
    json({ access_token: "new-at", refresh_token: "new-rt" })) as typeof fetch;

  const res = await worker.fetch(
    new Request("https://w.example/update-token", {
      method: "POST",
      headers: { Authorization: "Bearer s3cret" },
    }),
    env,
  );

  assert.equal(res.status, 200);
  assert.equal(kv.get("MS_TOKEN"), "new-rt");
});

test("isRetryableStatus retries throttling always and 5xx only for idempotent calls", () => {
  assert.equal(isRetryableStatus(429, false), true);
  assert.equal(isRetryableStatus(503, true), true);
  assert.equal(isRetryableStatus(503, false), false);
  assert.equal(isRetryableStatus(400, true), false);
  assert.equal(isRetryableStatus(404, true), false);
});

test("runWriteAPIs never replays a POST that 5xx'd, but does retry DELETE", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/^(POST .*\/todo\/lists|DELETE .*\.xlsx)$/, 503);

  await assert.rejects(runWriteAPIs(env));

  assert.equal(calls.filter((c) => c.endsWith("/todo/lists")).length, 1);
  assert.equal(calls.filter((c) => /^DELETE .*\.xlsx$/.test(c)).length, 2);
});

test("runWriteAPIs retries a throttled POST", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/^POST .*\/todo\/lists$/, 429);

  await assert.rejects(runWriteAPIs(env));

  assert.equal(calls.filter((c) => c.endsWith("/todo/lists")).length, 2);
});

test("runReadAPIs does not retry a 4xx", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv({ ACCESS_TOKEN: "at", MS_TOKEN: "rt" });
  const calls = fakeGraph(/./, 403);

  await assert.rejects(runReadAPIs(env), /All API calls failed/);

  assert.equal(calls.length, 12); // 6 fixed + 6 extra, one attempt each
});

test("getAccessToken gives up immediately on invalid_grant", async () => {
  const { env } = fakeEnv({ MS_TOKEN: "dead-rt" });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
    });
  }) as typeof fetch;

  await assert.rejects(ensureAccessToken(env), /status: 400/);
  assert.equal(calls, 1);
});

test("persistTokens caches the access token until shortly before expires_in", async () => {
  const { env, kv, ttls } = fakeEnv();

  await persistTokens(env, {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 1800,
  });
  assert.equal(ttls.get("ACCESS_TOKEN"), 1500);

  kv.delete("ACCESS_TOKEN");
  await persistTokens(env, {
    access_token: "at2",
    refresh_token: "rt2",
    expires_in: 200,
  });
  assert.equal(kv.get("ACCESS_TOKEN"), undefined); // too short to cache
  assert.equal(kv.get("MS_TOKEN"), "rt2");
});

test("a failing scheduled job sends exactly one Telegram alert", async (t) => {
  forceTaskAndTeam(t);
  const { env } = fakeEnv(
    { ACCESS_TOKEN: "at", MS_TOKEN: "rt" },
    { telegram: true },
  );
  const alerts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("api.telegram.org")) {
      alerts.push(JSON.parse(String(init?.body)).text);
      return json({ ok: true });
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  await assert.rejects(worker.scheduled({ cron: "12 23 * * *" }, env));

  assert.deepEqual(alerts, ["❌ AutoApi 執行寫入型 API 失敗"]);
});

test("sendTelegramMessage posts into the forum topic only when TOPIC_ID is a valid integer", async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return json({ ok: true });
  }) as typeof fetch;
  const { env } = fakeEnv({}, { telegram: true });

  await sendTelegramMessage(env, "no topic");
  env.TOPIC_ID = "7";
  await sendTelegramMessage(env, "topic");
  env.TOPIC_ID = "general";
  await sendTelegramMessage(env, "bad topic");

  assert.equal("message_thread_id" in bodies[0], false);
  assert.equal(bodies[1].message_thread_id, 7);
  assert.equal("message_thread_id" in bodies[2], false); // still delivered, to the main chat
});

test("pickRandom returns distinct elements and never over-picks", () => {
  const source = [1, 2, 3, 4, 5] as const;
  for (let i = 0; i < 100; i++) {
    const picked = pickRandom(source, 3);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
    assert.ok(picked.every((n) => source.includes(n)));
  }
  assert.equal(pickRandom(source, 99).length, source.length);
});

test("shuffledCopy keeps the same elements and leaves the input alone", () => {
  const source = [1, 2, 3, 4, 5];
  const shuffled = shuffledCopy(source);

  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.deepEqual([...shuffled].sort(), [...source].sort());
});

test("persistTokens raises a loud alert when the refresh token cannot be stored", async () => {
  // KV has no transactions: a dropped MS_TOKEN write needs manual re-authorisation.
  const { env } = fakeEnv({}, { failPutOn: "MS_TOKEN", telegram: true });
  const alerts: string[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    alerts.push(JSON.parse(String(init?.body)).text);
    return json({ ok: true });
  }) as typeof fetch;

  await assert.rejects(
    persistTokens(env, { access_token: "at", refresh_token: "rt" }),
    /KV write failed/,
  );
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /refresh token/);
});

test("updateToken rotates both keys in KV", async () => {
  const { env, kv, ttls } = fakeEnv({ MS_TOKEN: "old-rt" });
  globalThis.fetch = (async () =>
    json({ access_token: "new-at", refresh_token: "new-rt" })) as typeof fetch;

  await updateToken(env);

  assert.equal(kv.get("MS_TOKEN"), "new-rt");
  assert.equal(kv.get("ACCESS_TOKEN"), "new-at");
  assert.equal(ttls.get("ACCESS_TOKEN"), 3300); // fallback 3600 minus margin
});

test("CRON_TASKS matches the schedules declared in wrangler.jsonc", () => {
  // ponytail: naive JSONC strip, fine for a file we own; use a parser if it grows.
  const raw = readFileSync(`${import.meta.dirname}/../wrangler.jsonc`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const crons: string[] = JSON.parse(raw).triggers.crons;

  assert.deepEqual(Object.keys(CRON_TASKS).sort(), [...crons].sort());
});

test("scheduled rejects on an unknown cron instead of silently doing nothing", async () => {
  const { env } = fakeEnv();

  await assert.rejects(
    worker.scheduled({ cron: "0 0 * * *" }, env),
    /No task registered/,
  );
});

test("scheduled surfaces task failures to Cloudflare", async () => {
  const { env } = fakeEnv();
  const original = CRON_TASKS["12 23 * * *"];
  CRON_TASKS["12 23 * * *"] = async () => {
    throw new Error("boom");
  };

  try {
    await assert.rejects(
      worker.scheduled({ cron: "12 23 * * *" }, env),
      /boom/,
    );
  } finally {
    CRON_TASKS["12 23 * * *"] = original;
  }
});
