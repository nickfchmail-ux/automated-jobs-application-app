---
name: jobseek-project-conventions
description: 'Facts and conventions for the JobSeek automated-jobs Next.js app. ALWAYS load this when working in this repo: tech stack (Next 16 App Router, React 19, MUI v7 + Tailwind v4 hybrid, Redux Toolkit, Supabase, Azure Functions, socket.io), folder layout, env vars, data model, and the "no jargon in the UI" principle. Use when: navigating the codebase, deciding where a change belongs, checking conventions, understanding routes/actions/slices.'
---

# JobSeek Project Conventions

The project is an **AI-powered job application engine**: users search job boards, jobs are scraped by an Azure Function, AI-evaluated against the user's resume by a separate Azure Functions microservice, and everything streams live via socket.io + Supabase Realtime.

## ⚠️ Sibling Backend Repo (another team owns it)

> **The scraping backend is a SEPARATE repo:** `../backend-scraping-api` (one level
> up from this frontend workspace — i.e. `d:\Workstation\automated-jobs\backend-scraping-api`).
> It is owned by another team. We consume its API; we never modify it.
> Its `docs/` folder is the **live source of truth** and is updated frequently.
> **Always read the backend `docs/` FIRST, and if you have doubts read the backend
> source code — never rely on static/remembered info.** See the
> `scraping-api-integration` skill for the full source map + rules.

## ⚠️ Third-Party Skills (installable via `npx skills`)

> For vendor best practices, prefer the **official installable skills** from the
> `npx skills` marketplace (skills.sh) — Supabase, Microsoft Azure, Vercel, Render,
> Stripe, Cloudflare, etc. Many are already installed globally (Azure suite, Vercel
> React, web-design-guidelines, Stripe, Cloudflare). Check `npx skills list -g`,
> install with `npx skills add <owner/repo@skill> -g -y`, and load them alongside
> our project skills. See the `third-party-skills` skill for the full reference.

## Tech Stack

- **Next.js 16** (App Router, React 19, server components + server actions)
- **Supabase** — Postgres DB, Realtime (postgres_changes), Storage (resume bucket)
- **Azure Functions** — scraper (`jobsautomation-fn`) + AI evaluator (`jobsautomation-evaluator` in `azure/ai-evaluator`)
- **Azure Service Bus** — scraper uses the backend's bus; the evaluator has its OWN bus + `evaluation-requests` queue (one queue, one worker)
- **socket.io-client** — live funnel + evaluation pushes (unified `stats` event)
- **Redux Toolkit** — client state (`state/global/store.ts`, slices)
- **MUI v7** (@mui/material + @mui/icons-material) + **Tailwind CSS v4** — hybrid styling
- **@tanstack/react-query**, **docx** (client DOCX cover letters), **jose/jsonwebtoken** (auth)

## Folder Layout

```
app/
  (main)/                 # Authenticated routes (dashboard, fit, not-fit, not-interested, profile, jobs/[id])
  actions/                # Server actions: auth, evaluate, jobs, realtime, resume, scrape
  api/jobs/               # Route handlers (fit, not-fit, not-interested, resume)
  login/ signup/          # Unauthenticated routes
azure/ai-evaluator/       # Separate Azure Functions microservice (evaluate → queue → evaluateWorker → evaluateStatus)
components/               # Shared client components (JobCard, Navbar, ScrapePanel, ...)
hooks/useRealtimeRun.ts   # Live dashboard wiring (socket.io + Realtime)
lib/                      # supabase clients, auth, fetchWithAuth, funnel, dateUtils, data-services
state/global/             # Redux store + slices (jobSlice, runSlice)
supabase/migrations/      # SQL migrations
types/                    # api.ts, job.ts
```

## Env Vars (`.env.local`)

| Variable                                   | Visibility | Use                              |
| ------------------------------------------ | ---------- | -------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`    | public     | Supabase + Realtime + Storage    |
| `NEXT_PUBLIC_API_SERVER`                   | public     | Express API server (auth, stats) |
| `NEXT_PUBLIC_WS_URL`                       | public     | socket.io WebSocket URL          |
| `NEXT_PUBLIC_AZURE_FN_URL`                 | public     | Azure Functions scrape base URL  |
| `NEXT_PUBLIC_EVALUATOR_URL`                | public     | Azure evaluator base URL         |
| `SUPABASE_SERVICE_KEY`                     | secret     | server-only, bypasses RLS        |
| `AZURE_SCRAPE_KEY` / `AZURE_EVALUATOR_KEY` | secret     | server-only function keys        |

**Rule:** secrets (service role key, function keys) NEVER appear in browser-exposed code — only inside server actions / API routes.

## Data Model & Conventions

- **`jobs`** table: `id, user_id, title, company, location, salary, url, board, status, fit, fit_score, fit_reasons, cover_letter, skills, requirements, responsibilities, benefits, employment_type, experience_level, about_company, raw_description, expected_salary, search_key, posted_date, scraped_date, created_at, applied, applied_on, interested_in, resume_status, resume_url, resume_pdf_url, pipeline_run_id`
- **`pipeline_runs`**, **`evaluation_runs`** — run + per-keyword batch tracking
- **Storage bucket `resume`** — file naming `${userId}-resume.${ext}` (pdf/doc/docx)
- All queries scoped by `user_id` obtained from `getUserId()` (RLS enforces this)
- **Fit scoring thresholds:** ≥75 "Great fit", 50–74 "Possible", <50 "Low"
- **Supported boards:** jobsdb, ctgoodjobs, offertoday, linkedin

## The "No Jargon" Principle

Backend states, status codes, queues, brokers, and technical jargon are **translated to plain human copy** before reaching the UI. E.g. a 429 becomes "You've hit today's search limit. It resets at midnight." Never expose raw socket/Azure/Supabase error messages to users.

## Key Patterns

- **Dashboard page shell** has zero top-level awaits (except the fast auth check); data sections stream in behind `<Suspense>`.
- **`useRealtimeRun(enabled)`** hook: a "connection" effect (opens socket + Realtime channel once, kept alive) and a "hydrate" effect (seeds run status + counts when a run is queued).
- **Server actions** use `getUserId()`/`getToken()` from `lib/auth.ts`, call `fetchWithAuth` or fetch functions with `cache: "no-store"`, and `revalidatePath()` after mutations.
- **Supabase browser client** (`lib/supabase-browser.ts`) is used ONLY for Realtime subscriptions and client storage downloads; RLS filters via `setSupabaseSession(token)`.

## Quality Commands

```bash
npm run lint    # ESLint
npx tsc --noEmit  # TypeScript check
npm run build   # Next.js build
npm run dev     # dev server
```

## ⚠️ Validation Is MANDATORY After Every Implementation

> **No feature is "done" until it is validated.** Every agent on the team must
> validate their own work after implementing, and the Team Leader enforces the
> validation gate before accepting any feature.

The standard validation sequence:

1. `npm run lint` — 0 errors required (warnings acceptable but note them).
2. `npx tsc --noEmit` — clean.
3. `npm run build` — succeeds; new/changed routes appear.
4. Acceptance criteria from the story — all must pass (check off each one).
5. Backend contract (if applicable) — verified against the sibling backend `docs/`.
6. UX/a11y (for UI) — focus states, labels, `aria-pressed`/`aria-current`,
   reduced motion, dark mode, mobile.
7. Regression — shared components checked on all pages that use them.

If you can't run a check (e.g. no live backend/LLM), say so explicitly and state
what remains to verify. NEVER claim validation you didn't perform.

## UI Hybrid Pattern

- **MUI** for icons, Chip, Badge, Drawer, IconButton (and anything needing a11y widget behavior).
- **Tailwind** for layout, spacing, colors — zinc palette: shells `bg-zinc-50 dark:bg-zinc-950`, cards `rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900`, text `text-zinc-900 dark:text-zinc-50` / muted `text-zinc-400`.
- Per-board source colors in `JobCard` / job detail `detectSource()`.
- Dark mode is standard: every style has a `dark:` variant.
