# Handoff — "Dup always 0" on same-keyword re-search

**Date:** 2026-08-23
**From:** JobSeek frontend team (`next-react`)
**To:** Jobs Automation scraping backend team (`backend-scraping-api`)

---

## 1. Symptom (what the user sees)

Searching the **same keyword** again (e.g. `gov`) on JobSeek returns **0 duplicates** on every board:

```
Board       New   Found   Dup   Reading   Done   Status
JobsDB      30    30      0     –         –      Done ✓
CTgoodjobs  19    19      0     –         –      Done ✓
OfferToday  10    10      0     –         –      Done ✓
LinkedIn    10    10      0     –         –      Done ✓
```

Expected: jobs already scraped for this user should be detected and shown under **Dup**.

---

## 2. What the frontend team already fixed (our repo — no action needed from you)

The backend WebSocket now emits a **single `stats` event** (summary + run + boards + status bundled). The frontend was still listening to the removed `stats:summary` / `stats:run` / `stats:boards` events, so live per-board data (including the **Dup** column) never arrived.

- **Fixed in `next-react/hooks/useRealtimeRun.ts`** — now consumes the unified `stats` event.
- Validated: `tsc` clean, `npm run lint` 0 errors, `npm run build` passes.

---

## 3. Root causes in the BACKEND repo (need your fix)

### 3a. Per-board `duplicate` counter is never written to Redis (the main cause of "Dup = 0")

- **File:** `azure/functions/src/functions/scraperWorker.ts` — around **line 324**
- **Issue:** the dedup path calls `incrementCounters(userId, runId, { duplicate: skipped })` **without the `board` argument**.
- **Effect:** `redisState.ts` only writes the per-board Redis key (`{board}:duplicate`) when a `board` argument is provided. Without it, the run-level aggregate and user summary get the number, but **no per-board Redis key is ever created**.
- **Result:** the per-board "Dup" column (served by `wsPush.ts` → `boardsFrom()` and the `/stats/runs/:runId` REST endpoint, both reading the Redis `boards` hash) is **structurally always 0**.

**Fix:** pass the board through, e.g.

```ts
await incrementCounters(body.userId, runId, { duplicate: skipped }, board);
```

### 3b. Persisted dedup key is date-bound (cross-day re-runs insert duplicates)

- **Files:**
  - `azure/functions/src/functions/scraperWorker.ts` — pre-insert upsert (~line 422)
  - `azure/functions/src/functions/jobProcessor.ts` — upsert (~line 216)
  - `supabase/schema.sql:47` — `UNIQUE NULLS NOT DISTINCT (url, scraped_date, user_id)`
- **Issue:** the dedup/unique key is `(url, scraped_date, user_id)`, and `scraped_date` is set to **today** at run time (`scraperWorker.ts` ~line 259).
- **Effect:** re-searching the **same keyword on a different calendar day** treats the same URL as a different row → new inserts. Same-day relies entirely on a byte-exact URL match (see 3c).
- **Suggested fix:** make the persisted key date-independent for dedup purposes, e.g. `(url, user_id)` with a separate "last seen date" column, or canonicalize + keep `scraped_date` but detect cross-day duplicates in the in-memory check.

### 3c. In-memory dedup is a fragile byte-exact URL match

- **File:** `azure/functions/src/functions/scraperWorker.ts` — `loadExisting()` (~lines 271–305) + the filter (~lines 312–318)
- **Issue:** dedup compares the **raw parsed URL** (pre-normalization) via `Set.has(j.url)`. `normalize.ts` only cleans HTML entities — it does **not** strip tracking params, reorder query params, or strip trailing slashes.
- **Effect:** any URL variance between runs (session/tracking param, `?a=1&b=2` vs `?b=2&a=1`, trailing `/`) silently fails the match, so jobs slip through as "unique".
- **Suggested fix:** canonicalize URLs (strip known tracking params, lowercase host, normalize query order/trailing slash) before inserting into the dedup sets **and** before persisting, so stored URLs are stable across runs.

---

## 4. Quick reference (exact locations)

| Item                                                    | Location                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| In-memory dedup load (URL + title+company, user-scoped) | `azure/functions/src/functions/scraperWorker.ts:271-305`          |
| Dedup filter + `duplicate` count                        | `azure/functions/src/functions/scraperWorker.ts:312-318`          |
| **`duplicate` Redis increment — MISSING `board` arg**   | `azure/functions/src/functions/scraperWorker.ts:324`              |
| Per-board Redis key only written when `board` passed    | `azure/functions/src/redisState.ts:120-128`                       |
| Aggregate counter (run + summary)                       | `azure/functions/src/redisState.ts:112-119`                       |
| `run_boards.duplicate` write via `markBoardDone`        | `azure/functions/src/functions/scraperWorker.ts:325-327`          |
| `scraped_date` set to today                             | `azure/functions/src/functions/scraperWorker.ts:259`              |
| Pre-insert upsert key `(url, scraped_date, user_id)`    | `azure/functions/src/functions/scraperWorker.ts:422-428`          |
| Processor upsert key                                    | `azure/functions/src/functions/jobProcessor.ts:216`               |
| Unique constraint                                       | `supabase/schema.sql:47`                                          |
| WS per-board `duplicate` from Redis boards hash         | `backend-scraping-api/src/wsPush.ts:217-243`                      |
| Unified `stats` event emitted                           | `backend-scraping-api/src/wsPush.ts` (`buildStats` / `pushStats`) |

---

## 5. Summary of requested actions

1. **Pass the `board` argument** to `incrementCounters(...)` in `scraperWorker.ts:324` so per-board `duplicate` is written to Redis → the frontend "Dup" column will finally show real numbers.
2. **Make dedup survive across days** — don't let `scraped_date` (today) be the sole differentiator; detect duplicates regardless of the day the job was first stored.
3. **Canonicalize URLs** before the dedup `Set.has()` match and before persistence, so identical jobs produce identical URLs across runs.

If you want the frontend team to verify after your change, just let us know — we'll re-run the same-keyword search and confirm the **Dup** column reflects the previously stored jobs.
