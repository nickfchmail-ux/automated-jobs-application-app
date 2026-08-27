---
name: supabase-efficiency
description: "The verified list of Supabase resource-burn patterns in the JobSeek codebase (as examined 2026-08-27) and how to fix each one. Covers: unfiltered Realtime channels, select('*') over-fetching + in-memory pagination in API routes, missing indexes on filter columns, N+1 query loops, no client-side query caching, storage bucket churn, singleton-vs-per-call clients, and the sibling backend's write patterns. Load this whenever working on ANY Supabase query, Realtime subscription, API route, server action, or data-fetching change — it tells you what is already known to burn resources so you don't repeat it and can verify it's fixed. Use when: supabase efficiency, why is supabase slow, exhausted, query cost, select *, pagination, missing index, realtime channel filter, postgres_changes filter, N+1, caching, react-query, storage list, connection pool, reduce supabase load."
---

# Supabase Efficiency — Verified Codebase Findings (2026-08-27)

> These findings were verified by reading the code on 2026-08-27. Line numbers may
> shift as the code changes — match on the pattern + file path, then re-verify.
> The fix for each is stated here so any specialist can implement without
> re-deriving the analysis. **This is the "known burners" list — when you touch
> one of these files, check the burner is fixed, not preserved.**

## 🔴 1. Unfiltered Realtime `jobs` channel (HIGHEST burner)

**Where:** `hooks/useRealtimeRun.ts` — the connection effect:

```ts
channel = sb
  .channel("jobs-live")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "jobs" },
    (payload) => {
      const row = payload.new as Partial<LiveJobRow>;
      if (!row?.id) return;
      if (
        runIdRef.current &&
        row.pipeline_run_id &&
        row.pipeline_run_id !== runIdRef.current
      ) {
        return; // ← filtered CLIENT-SIDE, after delivery
      }
      dispatch(runJobUpserted(row as LiveJobRow));
    },
  );
```

**Problem:** the subscription streams EVERY `jobs` change the user's RLS can see
(all their jobs, all events) to the browser, and the "only my active run" filter
runs in JS **after** the row was delivered. Every insert/update/delete across all
the user's jobs (and the account-wide evaluator writes) is delivered over the
Realtime websocket and processed in Redux. That is massive message volume → Realtime
rate limits → dropped/missed updates → exhausted.

**Fix (server-side filter + RLS):**

- Push the run filter into the subscription using the `filter` option:
  ```ts
  .on("postgres_changes",
    { event: "INSERT", schema: "public", table: "jobs",
      filter: `pipeline_run_id=eq.${runId}` }, ...)
  ```
  Only subscribe to the events you need (`INSERT` for the stream; you may also need
  `UPDATE` for resume_status/fit changes — pick minimally).
- The connection effect is keyed on `enabled` but the filter depends on `runId`.
  Restructure so the channel filter tracks `runId` (re-subscribe when the run
  changes, or subscribe per-run and clean up). Do NOT open a new channel per render.
- Realtime already applies RLS to postgres_changes — verify the RLS policy on
  `jobs` allows SELECT only for `user_id = auth.uid()` (it should). Never subscribe
  to rows the user can't read.
- Keep `event: "INSERT"` (and only add `UPDATE` if resume_status/fit truly need it).
  `event: "*"` triples the delivery for no benefit.

## 🔴 2. `select("*")` + in-memory pagination in API routes

**Where:** `app/api/jobs/fit/route.ts`, `app/api/jobs/not-fit/route.ts`,
`app/api/jobs/not-interested/route.ts`, `app/api/jobs/_shared.ts`
(`paginateAndFilter`), and the same pattern in `app/api/jobs/resume/route.ts`,
`app/api/resume/[jobId]/versions/route.ts`, cover-letter versions routes.

```ts
const { data: jobs, error } = await supabase
  .from("jobs")
  .select("*")
  .eq("fit", true)
  .eq("user_id", userId)
  .or("interested_in.is.null,interested_in.eq.true");
return paginateAndFilter(jobs ?? [], req); // ← paginates in JS after pulling ALL rows
```

**Problem:** the DB returns **every** matching row (full `*` including
`raw_description`, `skills`, `requirements`, `responsibilities`, `benefits`,
`about_company`, `cover_letter`…) and the app paginates/filters in memory. On a
large account this is a huge data transfer + CPU on every list load, with no
index-driven pagination.

**Fix:**

- Push `limit`, `offset`, `order`, and column projection into the query:
  ```ts
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,company,location,salary,url,board,status,fit,fit_score,posted_date,created_at,interested_in,applied,resume_status,resume_url,resume_pdf_url",
    )
    .eq("user_id", userId)
    .eq("fit", true)
    .or("interested_in.is.null,interested_in.eq.true")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1); // real DB pagination
  ```
- Drop columns you don't render in the list (raw_description, skills, etc.) — fetch
  those on the detail page only.
- Replace `paginateAndFilter` in `_shared.ts` with a DB-backed pager, or remove it.

## 🔴 3. Missing indexes on list/filter columns

**Where:** `supabase/migrations/*.sql` — existing indexes are:
`evaluation_runs_pipeline_run_id_idx`, `evaluation_runs_user_id_idx`,
`evaluation_runs_keyword_idx`, `jobs_pipeline_run_id_status_idx`,
`idx_jobs_cover_letter_status`, `idx_usage_user_type`, `idx_usage_free_dedup`,
`idx_entitlements_plan`, `idx_scraper_api_keys_active`, `idx_scraper_api_keys_exhausted`.

**Problem:** the hot list queries filter on `user_id`, `fit`, `interested_in`,
`applied`, `resume_status` — but there is **no composite index** covering
`(user_id, fit, interested_in)` or `(user_id, applied)`. Postgres will seq-scan the
user's jobs on every fit/not-fit/not-interested load. Same for `evaluation_runs`
per-run lookups and `generated_resumes` by `job_id`.

**Fix (new timestamped migrations — NEVER edit an applied migration):**

- `create index if not exists idx_jobs_user_fit_interested on public.jobs (user_id, fit, interested_in);`
- `create index if not exists idx_jobs_user_applied on public.jobs (user_id, applied);`
- `create index if not exists idx_jobs_pipeline_run on public.jobs (pipeline_run_id);` (if not covered)
- `create index if not exists idx_generated_resumes_job on public.generated_resumes (job_id);`
- `create index if not exists idx_document_versions_job on public.document_versions (job_id);`
- Verify with `explain analyze` that the hot queries hit them. Check the backend's
  schema too (jobs table is created by the sibling backend — coordinate the index
  migration with the backend team, or add it in OUR migrations if we own the table).

## 🟠 4. N+1 / redundant query loops

**Where:** `app/actions/evaluate.ts` (per-run/per-keyword queries), the evaluator
functions (`azure/ai-evaluator`), and any loop that awaits a Supabase query inside
a `for`. Also `app/api/jobs/[jobId]/cover-letter/versions/route.ts` does a jobs
query + document_versions query per request.

**Problem:** each iteration = a round trip + connection slot + query cost.

**Fix:**

- Batch: fetch all needed rows in ONE query (`.in("id", ids)`), then group in JS.
- Use a single query with a join/filter where possible (avoid cross-table loops).
- In the evaluator, batch usage/status writes (insert many rows in one call).

## 🟠 5. No client-side caching of Supabase reads

**Where:** `lib/data-services.tsx` (`getJobsMatch` — `select("*")` all jobs),
`app/actions/*` fetchers, server components that load lists on every render.

**Problem:** every mount / navigation re-hits Supabase for the same data. React
Query (`@tanstack/react-query` is already a dependency) is not used for Supabase
reads → wasted queries + connections.

**Fix:**

- Wrap Supabase reads in React Query with a sensible `staleTime` (e.g. 30–60s) and
  `gcTime`. Invalidate on mutation (`revalidatePath` already handles server data;
  add React Query invalidation for client-cached data).
- `getJobsMatch` → select only needed columns + paginate; cache it.
- Prefer socket.io `stats` (already implemented) for live counters instead of
  polling Supabase.

## 🟠 6. Storage bucket churn

**Where:** `app/actions/resume.ts` — `storage.from(BUCKET).list("")` on every call,
re-upload of the resume on save, delete+recreate when extension changes; the
download routes (`app/api/resume/[jobId]/route.ts` etc.) stream blobs through the
server instead of a signed/public URL.

**Problem:** listing a bucket + uploading on every save + server-side blob streaming
= storage API calls + egress per op. Signed URLs should be the norm.

**Fix:**

- Cache the "existing file" lookup (skip `list()` if you already know the filename —
  it's deterministic `${userId}-resume.${ext}`); only `list()` when you need to
  discover the ext.
- Skip the upload entirely if the file is unchanged (compare hash/size).
- For reads, `createSignedUrl` (short-lived) and stream THAT to the browser, or use
  a public URL if the bucket policy allows. Avoid proxying the blob through Node on
  every request.

## 🟢 7. Client/session churn (verify, usually OK)

**Where:** `lib/supabase.ts` (server singleton — OK), `lib/supabase-browser.ts`
(`getSupabaseBrowser()` singleton, `persistSession: false` — OK). But confirm:

- `setSupabaseSession(token)` is NOT called on every render (it should be called
  once when the token refreshes).
- No `"use client"` component imports the server client (`@/lib/supabase`).
- The auth token fetch (`app/actions/realtime.ts`) isn't hammered on reconnects
  (guard with retry caps, which `useRealtimeRun` already does).

## Sibling backend (`backend-scraping-api`) — read-only findings to verify

- `src/wsPush.ts` — does building `stats` hit Supabase per push, or read from Redis?
  If per-push Supabase queries → recommend caching the funnel in Redis.
- `src/worker.ts` / `azure/functions/src/**` — are jobs inserts batched? Are
  `pipeline_runs` / `run_boards` / `usage_records` writes batched? Do they hold
  connections open across long scrapes? Any polling loops?
- `azure/functions/src/usage.ts` — usage_records insert per consumed unit; ensure
  batched and that the partial-unique-index dedup is correct.
- **Output:** recommendations for that team. NEVER edit backend files.

## Verifying a fix (evidence, not vibes)

- Query plan: run the query with `explain analyze` (in the SQL editor) → confirm
  `Index Scan` not `Seq Scan`, and row count ≈ page size not full table.
- Realtime: confirm the channel uses `filter:` and only `INSERT`/needed events;
  confirm no duplicate channels in the Network tab (one websocket, one `jobs-live`).
- Calls per mount: use the Supabase dashboard (Project → Database → Report / API
  logs) before/after to show the drop, or count `.from(` calls in a page load.
- Connection count: Supabase dashboard "Pooler"/"Connections" before/after.
- UX: the live dashboard still streams, lists paginate smoothly, no blank states.
