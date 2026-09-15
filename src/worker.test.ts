import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureAccessToken, persistTokens } from "./auth.ts";
import { runWriteAPIs } from "./apiWrite.ts";
import { updateToken } from "./updateToken.ts";
import worker, { CRON_TASKS } from "./index.ts";
import { shuffledCopy, pickRandom } from "./utils.ts";
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
  assert.equal(ttls.get("ACCESS_TOKEN"), 3600);
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
  assert.equal(ttls.get("ACCESS_TOKEN"), 3600);
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
    worker.scheduled({ cron: "0 0 * * *", scheduledTime: 0 }, env),
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
      worker.scheduled({ cron: "12 23 * * *", scheduledTime: 0 }, env),
      /boom/,
    );
  } finally {
    CRON_TASKS["12 23 * * *"] = original;
  }
});
