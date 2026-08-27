---
name: architecture-review
description: "Operating manual for the JobSeek PRINCIPAL ARCHITECT. Defines how to thoroughly examine the frontend (next-react) AND the sibling scraping backend (backend-scraping-api), find every Supabase resource-burn (RUs, connection pool, Realtime message volume, storage ops, N+1, over-fetching, missing indexes, missing cache/pagination), classify findings by impact, produce a prioritized findings report, and drive refactoring through the Team Leader. Use when: architecture review, system design review, examine the app, find bottlenecks, why is supabase exhausted, performance audit, query optimization, connection pool, missing index, N+1, over-fetching, pagination, caching, realtime overload, storage churn, refactor plan, findings report."
---

# Architecture Review — Operating Manual for the Principal Architect

## 0. Mission Frame

The user's #1 pain: **Supabase is exhausted and the app is not smooth.** Your job
is to examine the frontend AND the backend, find every way the app burns Supabase
resources, and drive refactoring. Always connect a finding to the USER experience:
"the dashboard was loading every row and resubscribing on each render — that's why
Supabase ran out."

## 1. The Supabase Resource Budget (what "exhaustion" means)

Supabase has hard per-project limits. These are what get "exhausted":

| Resource                                | What burns it                                                                                     | User-visible symptom                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Connection pool** (per-tenant limits) | Too many concurrent clients / no pooling / leaking clients / new client per request               | "Too many clients", timeouts, 5xx                          |
| **Query cost / DB load**                | Missing indexes → seq scans on big tables; `select("*")` over-fetching; N+1 loops; unneeded joins | Slow pages, high CPU                                       |
| **Realtime message volume**             | Unfiltered `postgres_changes` on busy tables, subscribing to ALL rows/events, duplicate channels  | Rate limits on Realtime, missed messages, connection drops |
| **Storage ops**                         | Re-uploading unchanged files, signed-URL churn, listing buckets repeatedly                        | Slow resume/cover-letter ops                               |
| **Auth / API requests**                 | Re-fetching sessions/tokens, no caching, polling instead of streaming                             | 429s, "rate limit"                                         |

**Rule of thumb for this codebase:** prefer socket.io `stats` for funnel counters;
use Supabase Realtime ONLY for the actual job/document rows of the ACTIVE run; use
REST/server actions for everything else; paginate; index; never `select("*")` more
than you need.

## 2. What to Examine — Frontend (`next-react`)

Walk this checklist. For each area, grep + read + record `file:line` evidence.

### 2.1 Supabase clients

- `lib/supabase.ts` (server/service client) — created ONCE at module load? One
  singleton, or a new client per call? (New client per call burns connections.)
- `lib/supabase-browser.ts` — `getSupabaseBrowser()` singleton? `persistSession`?
  Is the browser client used for anything OTHER than Realtime + storage downloads
  (it should be)? Any server-client import in a `"use client"` component?
- Where is `setSupabaseSession()` called? Is it called repeatedly on re-renders
  (re-auth churn)?

### 2.2 Server actions (`app/actions/*`)

For each action, note:

- **Query shape**: `select("*")` vs a column list; is the result paginated?
- **Index use**: the WHERE columns (`user_id`, `fit`, `interested_in`,
  `pipeline_run_id`, `status`…) — is there an index covering them? (Check
  `supabase/migrations/*.sql`.)
- **N+1**: is a query inside a loop (e.g. per-job, per-keyword, per-board)?
- **Redundant calls**: the same query run twice, or re-querying data already in
  the client/Redux.
- **Missing `revalidatePath`** → stale UI → user re-fetches manually.

### 2.3 API routes (`app/api/**`)

- Same as actions. These run server-side, so also check: do they proxy through
  the service client with full row pulls, then filter in JS (e.g.
  `app/api/jobs/_shared.ts` paginating in memory after `select("*")`)? That's a
  classic exhaustor — the DB should paginate, not the app.

### 2.4 Realtime / streaming

- `hooks/useRealtimeRun.ts`: the channel filter. Is the `jobs` subscription
  filtered to the active run (`pipeline_run_id`) or does it receive EVERY row of
  EVERY user? (Realtime supports RLS + filters — see `supabase-efficiency`.)
- Duplicate subscriptions: does the connection effect re-subscribe on each render?
  Is cleanup (`channel.unsubscribe()`, `socket.disconnect()`) correct?
- Is `postgres_changes` used for things the socket already covers (funnel stats)?
  Double delivery = double burn.
- Are `evaluation_runs` / `generated_resumes` / `pipeline_runs` channels filtered?

### 2.5 Data fetching / caching (frontend)

- Server components: are list pages loading ALL rows then filtering client-side?
- Is there any React Query (`@tanstack/react-query`) caching of Supabase reads, or
  is every mount a fresh DB hit?
- `lib/data-services.tsx` `getJobsMatch()` — `select("*")` all jobs for the user?
- Any polling loops that hit Supabase instead of socket.io/REST?

### 2.6 Storage (resume / generated-resumes / cover-letters)

- `app/actions/resume.ts`: re-upload on every save? Does it `list()` the bucket on
  every call (storage listing cost)? Signed URLs generated repeatedly?
- Are download routes hitting storage via service client instead of public/signed URLs?

## 3. What to Examine — Sibling Backend (`backend-scraping-api`) — READ ONLY

The user asked you to examine the backend too. You have READ access. Never modify.

- `docs/API.md`, `docs/FRONTEND_WEBSOCKET_GUIDE.md`, `docs/FRONTEND_API.md` —
  the contract and the backend's own Supabase usage.
- `src/wsPush.ts` — how stats are built; does it query Supabase on every push
  (Redis vs DB)? `src/server.ts`, `src/worker.ts`, `src/queue/*`, `src/db.ts`.
- Backend Azure Functions (`azure/functions/src/**`) — `usage.ts` (usage_records
  writes), `scraperWorker`, `jobProcessor`, `supabase.ts` client patterns.
- Backend's Supabase writes (jobs inserts, pipeline_runs, run_boards, usage_records)
  — are they batched? Do they hold transactions/connections open? Any polling that
  hammers the DB?

**Output:** a findings + recommendation list for the backend team (their schema,
their write patterns, their own queries). Frontend-side fixes are yours to implement;
backend fixes go to that team as recommendations.

## 4. Classify Findings by Impact

| Severity    | Class                                             | Example                                                                                      | Fix owner                                            |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 🔴 CRITICAL | Connection-pool / full-scan / unfiltered Realtime | new client per call; `select("*")` + in-memory pagination; `jobs` channel without run filter | supabase-data-agent / realtime-streaming-agent       |
| 🟠 HIGH     | Over-fetch / N+1 / missing index                  | `select("*")` on list pages; query inside a loop; no index on filter columns                 | supabase-data-agent / frontend-state-agent           |
| 🟡 MEDIUM   | No caching / redundant calls / storage churn      | re-querying on every mount; re-upload unchanged resume; repeated bucket lists                | performance-optimization-agent / supabase-data-agent |
| 🟢 LOW      | Minor                                             | unused client, minor copy                                                                    | any owner                                            |

## 5. Produce the Findings Report

Write it to session memory (`/memories/session/supabase-exhaustion-findings.md`)
so it survives the conversation and the team can work from it:

```markdown
# Supabase Exhaustion Findings (YYYY-MM-DD)

## 🔴 Critical

- [ ] `file:line` — what burns — why (evidence) — fix

## 🟠 High

...

## 🟡 Medium

...

## 🟢 Low

...

## Backend recommendations (backend-scraping-api, READ-ONLY)

- ...

## Priority order

1. ...
```

## 6. Drive Refactoring Through the Team Leader

- Hand the prioritized list to `jobseek-team-leader` → it routes to specialists and
  enforces the validation gate.
- Common routing for exhaustion fixes:
  - Schema / indexes / RLS / actions → `supabase-data-agent`
  - Client data flow / caching / pagination in components → `frontend-state-agent`
  - Realtime channel filters / subscription lifecycle → `realtime-streaming-agent`
  - Cross-cutting caching / batching → `performance-optimization-agent`
  - Verification → `quality-testing-agent`
- **Review the integrated result at architecture level:** did the fix ACTUALLY
  reduce load? Verify with evidence: query now hits an index (EXPLAIN), channel has
  a filter, page is paginated, calls per mount reduced. If not, send it back.

## 7. UX Must Stay Smooth

Every refactor must preserve the user experience:

- No blank loading states — keep Suspense boundaries.
- The live dashboard must still stream live (socket stats + filtered Realtime rows).
- No jargon in the UI; friendly copy for limits/errors.
- Pagination must keep working scroll (infinite scroll or "load more", not page reloads).

## 8. Definition of Done

A refactor round is done when:

1. The 🔴 items are fixed or have a dated follow-up.
2. Every fix is validated (lint/type-check/build by the Team Leader's gate).
3. Evidence shows reduced Supabase load (fewer calls, indexed queries, filtered channel).
4. UX verified smooth (no jank, live dashboard still live).
5. Findings + remaining work reported to the user in plain language.
