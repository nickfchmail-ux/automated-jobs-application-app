---
name: supabase-data-access
description: "JobSeek Supabase data access patterns: server client vs browser client, RLS scoping, storage bucket (resume) naming and upload flow, server actions conventions, migrations location, getUserId()/getToken() usage, revalidatePath. Use when: Supabase queries, RLS, storage upload/download, server actions, migrations, schema changes, user_id scoping."
---

# JobSeek Supabase Data Access

## Two Clients — Never Confuse Them

| Client                  | File                      | Use                                                                                                                                            |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Server / service client | `lib/supabase.ts`         | Server actions, server components, admin ops (uses `SUPABASE_SERVICE_KEY` if configured)                                                       |
| Browser client          | `lib/supabase-browser.ts` | ONLY Realtime subscriptions + client storage downloads. Anon key, `persistSession: false`. RLS filters after `setSupabaseSession(accessToken)` |

**Never** import `@/lib/supabase` (server client) into a `"use client"` component.

## RLS & Scoping

- Every query scoped by `user_id` — get it from `getUserId()` (`lib/auth.ts`), return early `{ ok: false, error: "Not authenticated." }` if null.
- Example (from `app/actions/jobs.ts`):
  ```ts
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };
  await supabase
    .from("jobs")
    .update({ applied })
    .eq("id", jobId)
    .eq("user_id", userId);
  ```

## Storage Bucket: `resume`

- Bucket name: `resume`.
- File naming: `${userId}-resume.${ext}` — `ext` in `pdf | doc | docx`.
- Upload flow (`app/actions/resume.ts`):
  1. Validate type (`application/pdf`, `application/msword`, `application/vnd...wordprocessingml.document`).
  2. List `""` with `search: ${userId}-resume`; delete an existing file if extension changed.
  3. `upload(newName, buffer, { contentType: file.type, upsert: true })`.
- Read flow (`getResumeInfo`): list bucket, find `${userId}-resume*`, `createSignedUrl(name, 60 * 60)`.

## Server Action Conventions

- File: `app/actions/<domain>.ts` with `"use server"` at top.
- Return discriminated unions: `{ ok: true, ... } | { ok: false, error: string }`.
- Proxy external calls via `fetchWithAuth` or `fetch` with `cache: "no-store"` and an `AbortController` timeout (~30s).
- After mutations, `revalidatePath(...)` for affected routes (e.g., `/jobs/${jobId}`, `/fit`, `/not-interested`).
- Function keys (`AZURE_SCRAPE_KEY`, `AZURE_EVALUATOR_KEY`) live only here / env — never in the client.

## Migrations

- Location: `supabase/migrations/` (timestamped filenames).
- Also referenced: `azure/ai-evaluator/migrations/` for evaluator-owned tables (e.g., `evaluation_runs`).
- Keep RLS enabled; test policies against an anon/authenticated role.

## ⚠️ Efficiency — Known Supabase Burners (load `supabase-efficiency` too)

> The Principal Architect maintains a **verified list of resource-burn patterns**
> in this repo at `.github/skills/supabase-efficiency/SKILL.md`. Load it whenever
> you touch ANY query, action, API route, migration, or storage flow. The big ones
> to never reintroduce:

- **`select("*")` on list pages** → always project columns + paginate in the DB
  (`.range()`, `.limit()`, `.order()`), never fetch-all-then-filter in JS
  (`app/api/jobs/_shared.ts` currently does this — replace it).
- **Missing composite indexes** on hot filter columns (`user_id, fit, interested_in`,
  `user_id, applied`, `pipeline_run_id`) → add in NEW timestamped migrations, never
  edit an applied one (checksum mismatch on `supabase db push`).
- **Unfiltered Realtime channels** → push filters into the subscription (see
  `realtime-architecture`), don't filter after delivery.
- **N+1 loops** → batch with `.in()`.
- **Storage churn** → skip re-upload when unchanged; avoid repeated bucket `list()`.
- **New client per call** → never; the module-level singletons in `lib/supabase.ts`
  and `lib/supabase-browser.ts` are correct — keep them.

Always verify a fix with evidence (EXPLAIN shows an Index Scan, calls-per-mount drop
in the Supabase dashboard, channel has a `filter:`).
