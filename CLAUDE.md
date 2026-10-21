# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Cloudflare Worker that keeps a Microsoft 365 E5 developer subscription active by calling Microsoft Graph on a cron schedule (port of the Python/Docker "AutoApi" project).

## Commands

```bash
npm run dev         # wrangler dev (local; secrets via .dev.vars)
npm run deploy      # wrangler deploy
npm run tail        # live logs
npm run typecheck   # wrangler types && tsc --noEmit
npm test            # node --test "src/**/*.test.ts"
node --test --test-name-pattern="CRON_TASKS" src/worker.test.ts   # single test
```

Tests use Node's built-in runner with native TypeScript stripping (no vitest/jest, no build step). That is why relative imports carry the `.ts` extension — keep it on value imports, or Node can't resolve them. Type-only imports (`import type ... from "./types"`) are erased and may omit it.

## Architecture

- `src/index.ts` — Hono app (`POST /update-token`, `/run-read`, `/run-write` behind `requireAdmin` bearer auth, fail-closed when `ADMIN_TOKEN` is unset; public `GET /status`) plus the `scheduled` handler. `CRON_TASKS` maps cron strings to jobs; **its keys must match `triggers.crons` in `wrangler.jsonc` exactly** — a test parses wrangler.jsonc and enforces this. Change both together.
- Three jobs, each `(env: WorkerEnv) => Promise<void>`: `updateToken`, `runReadAPIs` (random subset of Graph GET endpoints), `runWriteAPIs` (uploads an in-memory xlsx to OneDrive `AutoApi/App1/`, runs 2 of 3 random ops — Excel edit, create/delete Team, create/delete Task). Every created resource (workbook, team, task list) is removed in a `finally` via `deleteQuietly`. Team creation is async (202): the id comes from the `Content-Location` header, not a name lookup.
- Jobs report success/failure via Telegram (`telegram.ts`, no-op if `TELEGRAM_BOT_TOKEN`/`CHAT_ID` unset) and **must rethrow** so Cloudflare marks the invocation failed. `scheduled` deliberately sends no alert of its own (that double-notified), so a new job must send its own.
- `auth.ts` — token state lives in KV namespace `E5_CONFIG`: `MS_TOKEN` (refresh token, no TTL) and `ACCESS_TOKEN` (cached for `expires_in` minus `ACCESS_TOKEN_EXPIRY_MARGIN`, not cached if that is under KV's 60s minimum). `ensureAccessToken` uses the cache, otherwise refreshes. Microsoft invalidates the old refresh token on rotation, so `persistTokens` writes `MS_TOKEN` first and alerts loudly if it fails — preserve that ordering.
- Retry policy lives in `isRetryableStatus` (`utils.ts`), used by the token refresh, read and write paths. 429 is always retried; 5xx and network errors only for idempotent calls; a POST is never replayed after a 5xx or network error, because it may already have created the resource.
- Excel generation uses SheetJS (`xlsx`, aliased to `@e965/xlsx`).
- Telegram messages are in Traditional Chinese; keep that style.

## Testing pattern

`src/worker.test.ts` fakes `env` with an in-memory `Map` KV (`fakeEnv`, supports `failPutOn` to simulate KV write failure) and stubs `globalThis.fetch` per test (restored in `afterEach`). Write-op tests use `fakeGraph` and `forceTaskAndTeam` (mocks `Math.random` to pick the Task and Team ops, and makes `setTimeout` fire immediately). No network or wrangler needed.

## Config

Secrets: `CLIENT_ID`, `CLIENT_SECRET`, `ADMIN_TOKEN` (required), `TELEGRAM_BOT_TOKEN`, `CHAT_ID` (optional) via `wrangler secret put`. The KV namespace id in `wrangler.jsonc` is a placeholder; the initial refresh token is seeded with `wrangler kv key put ... "MS_TOKEN" ... --remote`. Workers have a 30s execution limit, so jobs cannot sleep/delay long.
