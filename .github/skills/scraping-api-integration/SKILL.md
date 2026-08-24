---
name: scraping-api-integration
description: "How to work with the INDEPENDENT scraping API owned by another team (sibling repo ../backend-scraping-api). CRITICAL RULE: always read its live docs FIRST (docs/*.md) and track the SOURCE CODE for answers — never trust stale/static info, because the API changes. Use when: scraping API, backend-scraping-api, /api/scrape, stats events, run_boards, pipeline_runs, Express server, WebSocket contract, board stages, Redis funnel, source of truth, docs folder, API doubts."
---

# Scraping API Integration (sibling repo — other team owns it)

> **The scraping backend lives in a SEPARATE repo owned by ANOTHER team:**
> `d:\Workstation\automated-jobs\backend-scraping-api` (one level up from this
> frontend workspace). It is NOT part of `next-react`. We consume it, we do not
> own it. **Never modify its files.**

## ⚠️ Cardinal Rule — Track the Live Source, Not Static Info

The backend team updates their API **frequently**. Docs and code change without
notice. Therefore:

1. **ALWAYS read the docs folder FIRST** before writing any integration code:
   - `docs/API.md` — authoritative REST/WebSocket/Supabase reference
   - `docs/FRONTEND_API.md` — every API surface a frontend can use
   - `docs/FRONTEND_INTEGRATION_GUIDE.md` — implementation task list
   - `docs/FRONTEND_WEBSOCKET_GUIDE.md` — socket.io contract (event names + payloads)
   - `docs/FRONTEND_GUIDE.md` / `docs/UX_SPEC_REALTIME_DASHBOARD.md` — UI/UX spec
   - `docs/SCRAPING_AGENT_TEAM.md` — backend's own agent-team architecture
2. **If you have doubts, read the SOURCE CODE for the answer** — it is the ground
   truth. Do NOT rely on your memory of an old contract or a past session.
3. **Check the docs' "Last updated" / version header.** If the doc contradicts
   code, the **code wins** — flag the discrepancy to the team leader.

> **Example (real, 2026-08-23):** the WebSocket contract changed to a SINGLE
> `stats` event (`summary + run + boards + status` in one payload). The old
> `stats:summary` / `stats:run` / `stats:boards` events are **gone**. If you see
> those names in frontend code, verify against `docs/FRONTEND_WEBSOCKET_GUIDE.md`
> and `src/wsPush.ts` before assuming they still work.

## Where Things Live (source map)

```
d:\Workstation\automated-jobs\backend-scraping-api\
├── docs/                          # ← ALWAYS START HERE (live API docs)
│   ├── API.md                     # authoritative REST/WS/Supabase reference
│   ├── FRONTEND_API.md            # every surface a frontend can use
│   ├── FRONTEND_INTEGRATION_GUIDE.md
│   ├── FRONTEND_WEBSOCKET_GUIDE.md # socket.io contract
│   ├── FRONTEND_GUIDE.md
│   ├── UX_SPEC_REALTIME_DASHBOARD.md
│   └── SCRAPING_AGENT_TEAM.md     # backend's internal agent-team design
├── src/                           # Express API + legacy worker (TypeScript)
│   ├── server.ts                  # app wiring, /health, POST /webhook/state
│   ├── wsPush.ts                  # ⚠️ WebSocket event contract (source of truth)
│   ├── routes/auth.ts             # /auth/register, /auth/login, /auth/refresh
│   ├── routes/jobs.ts             # legacy /scrape, /jobs/:jobId
│   ├── routes/stats.ts            # /stats/summary, /stats/runs, /stats/runs/:id
│   ├── middleware/auth.ts         # requireAuth (Bearer JWT)
│   ├── queue/upstash.ts           # Redis user-keyed funnel counters
│   ├── queue/redis.ts, queue/index.ts
│   └── scrapers/, pipeline/, lib/ # board parsers, pipeline internals
├── azure/functions/src/           # ⚠️ serverless scrape pipeline (production path)
│   ├── functions/
│   │   ├── scrape.ts              # POST /api/scrape (creates pipeline_run, enqueues)
│   │   ├── scraperWorker.ts       # Service Bus queue trigger → fetch/parse
│   │   ├── jobProcessor.ts        # detail fetch + enrich + store
│   │   ├── jobProcessCallback.ts
│   │   ├── runStatus.ts           # GET /api/runs/:runId
│   │   ├── generateResume.ts, resumeBuildWorker.ts
│   ├── boardRegistry.ts           # per-board patterns (jobsdb/ctgoodjobs/indeed/linkedin/offertoday)
│   ├── boardParsers.ts            # HTML/JSON → ScrapedJob[]
│   ├── publicApiScrapers.ts
│   ├── normalize.ts               # → one frontend-friendly shape
│   ├── runBoardState.ts           # per-board stages (pending→fetching→extracting→done/blocked/failed)
│   ├── redisState.ts              # funnel counters
│   ├── scraperApi.ts, serviceBus.ts, supabase.ts
│   └── types.ts
├── supabase/migrations/           # SQL migrations (jobs, pipeline_runs, run_boards, ...)
└── cloudflare/                    # job-board proxy workers (anti-bot)
```

## Key Facts (verify against source — these can change)

- **Base URLs:** Express `https://ai-job-server.onrender.com` · Azure Functions
  `https://jobsautomation-fn.azurewebsites.net` · Supabase
  `https://uqrgivzeklqehuqqqqyv.supabase.co` · WebSocket `wss://ai-job-server.onrender.com`
- **Auth:** `Authorization: Bearer <access_token>` (Supabase JWT). Azure function
  calls use `x-functions-key`. Refresh proactively; on 401 refresh then retry.
- **Trigger a scrape:** `POST /api/scrape` (Azure fn, `x-functions-key`) with
  `{ keyword, pages?, boards?, user_id, country_code? }` → `202 { runId, pollUrl }`.
  Allowed boards per docs: `jobsdb, ctgoodjobs, offertoday, linkedin` (indeed also
  exists in backend code — confirm in `boardRegistry.ts`).
- **Live state:** `GET /stats/summary`, `/stats/runs`, `/stats/runs/:runId`
  (Express, Bearer). Funnel = `{ scraped, duplicate, unique, processing }`.
- **Realtime:** Supabase `postgres_changes` on `jobs`, `pipeline_runs`,
  `run_boards` (+ `evaluation_runs`, `generated_resumes` from our own evaluator).
- **Board stages:** `pending → fetching → extracting → done | blocked | failed`
  (see `run_boards.stage`; map to human copy like "Searching…", "✓ Done").

## Rules for the Team

- **Before ANY task touching scraping/API/WebSocket/run state**: open
  `docs/` first. If the answer isn't there, read the backend **source**.
- **Never** paste or hardcode values you haven't verified this session.
- **Never** modify files under `backend-scraping-api`. If a contract change is
  needed, report it to the team leader (they coordinate with the backend team).
- If docs and code disagree, code wins — and tell the team leader so they can
  flag the docs update.
