# AI powered Jobs Application Engine

<p align="center">
  <a href="https://www.youtube.com/watch?v=NvKCRjTVL2Q">
    <img src="https://img.youtube.com/vi/NvKCRjTVL2Q/maxresdefault.jpg" alt="ai powered job application engine" width="640"/>
    <br>
    <strong>Watch the full demo (click to play)</strong>
  </a>
</p>

A Next.js app that scrapes job listings, **AI-evaluates each job against your resume in a separate Azure microservice**, and streams everything live with a realtime dashboard.

## Features

- **Live job search** — type a keyword, tap "Find me jobs", and watch the search run in real time (no refresh)
- **Separate AI evaluator microservice** — Azure Functions app that scores each job (one LLM call per job) against your resume, with no queues and no function-to-function calls
- **AI scoring** — each job is scored 0–100 for fit against your resume, with reasons + cover letter
- **Per-keyword batch progress** — watch "'web developer' — 12 of 20 jobs…" update live as evaluation runs
- **Tailored resumes for good fits** — fit jobs get a tailored resume HTML + cover letter; non-fits get neither
- **Good Fit / Not Fit / Not Interested** — jobs are automatically categorised
- **Cover letter generation** — copy or download as a formatted DOCX
- **Realtime dashboard** — WebSocket funnel updates + Supabase Realtime row streaming
- **Resume management** — upload your resume (PDF/DOC/DOCX) from your profile

## Tech Stack

- [Next.js 16](https://nextjs.org/) — App Router, server components
- [Supabase](https://supabase.com/) — database, Realtime subscriptions & file storage
- [Azure Functions](https://learn.microsoft.com/azure/azure-functions/) — scraping (existing) + AI evaluation (separate microservice in `azure/ai-evaluator`)
- [Azure Service Bus](https://learn.microsoft.com/azure/service-bus/) — scrape queue (backend); the evaluator is queue-free
- [socket.io-client](https://socket.io/) — live pipeline funnel pushes
- [Redux Toolkit](https://redux-toolkit.js.org/) — client state (live run + job stream)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [docx](https://docx.js.org/) — client-side DOCX generation

## Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Set environment variables** — create a `.env.local` file:

   ```env
   # Public — safe in the browser bundle
   NEXT_PUBLIC_SUPABASE_URL=https://uqrgivzeklqehuqqqqyv.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   NEXT_PUBLIC_API_SERVER=https://ai-job-server-r2dk.onrender.com
   NEXT_PUBLIC_WS_URL=wss://ai-job-server-r2dk.onrender.com
   NEXT_PUBLIC_AZURE_FN_URL=https://jobsautomation-fn.azurewebsites.net
   NEXT_PUBLIC_EVALUATOR_URL=https://jobsautomation-evaluator.azurewebsites.net

   # Secret — server-side ONLY (server actions / proxy routes)
   SUPABASE_SERVICE_KEY=your_service_role_key
   AZURE_SCRAPE_KEY=your_scrape_function_key
   AZURE_EVALUATOR_KEY=your_evaluator_function_key
   ```

3. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable                        | Visibility | Description                                           |
| ------------------------------- | ---------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | public     | Supabase project URL                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public     | Supabase anon key (Realtime + user-scoped Storage)    |
| `NEXT_PUBLIC_API_SERVER`        | public     | Express API server (auth, `/stats/*`)                 |
| `NEXT_PUBLIC_WS_URL`            | public     | Socket.io WebSocket URL                               |
| `NEXT_PUBLIC_AZURE_FN_URL`      | public     | Azure Functions scrape base URL (server proxy)        |
| `NEXT_PUBLIC_EVALUATOR_URL`     | public     | Azure Functions AI evaluator base URL (server proxy)  |
| `SUPABASE_SERVICE_KEY`          | secret     | Supabase service role key (server-side, bypasses RLS) |
| `AZURE_SCRAPE_KEY`              | secret     | Azure Function scrape key (server-side only)          |
| `AZURE_EVALUATOR_KEY`           | secret     | Azure Function evaluator key (server-side only)       |

> ⚠️ **Never** put `SUPABASE_SERVICE_KEY`, `DEEP_SEEK_API`, or Azure function keys in
> browser-exposed code. They are used only inside server actions / API routes.

## How it works

```
1. User logs in      → POST /auth/login → { access_token, refresh_token }
2. Start a search    → POST /api/scrape (Azure Function) → { runId }
3. Watch it live     → socket.io (stats:summary / stats:run) drives the funnel
4. Jobs stream in    → Supabase Realtime pushes row-level updates
5. Match them        → POST /api/evaluate (separate Azure Function) enqueues
                       one message → the evaluator's queue worker runs one
                       LLM call per job (fit + cover letter), plus one more
                       per fit job for the resume
6. Watch the batches → socket `stats` event + Supabase Realtime on
                       `evaluation_runs` → per-keyword progress
7. Get fit jobs      → fit score ≥ 75 = "Great fit", 50–74 = "Possible", <50 = "Low"
```

All states are translated to plain human copy — no brokers, status codes, or
technical jargon ever reach the UI.

## AI Evaluator microservice

The evaluation logic lives in its own deployable unit so a slow/over-budget LLM never
blocks scraping and it scales independently:

```
azure/ai-evaluator/
├── src/
│   ├── functions/      # evaluate (HTTP → enqueue), evaluateWorker (SB queue → orchestrator), evaluateStatus (HTTP)
│   ├── lib/            # runEvaluator (orchestrator), ai, prompts, resume, resumeDocuments, socket, serviceBus, status, supabase
│   └── shared/types.ts
├── migrations/         # Supabase SQL (evaluation_runs table + evaluation_status column)
├── host.json / local.settings.json / package.json / tsconfig.json
└── README.md           # local dev + deploy notes
```

`POST /api/evaluate` enqueues ONE message to the evaluator's OWN Service Bus
queue (`evaluation-requests`) and returns 202; the `evaluateWorker` queue
trigger runs the whole evaluation in-process. Jobs are grouped by `search_key`
(keyword); each batch becomes one `evaluation_runs` row. Each job is scored
with its own LLM call; fit jobs additionally get a tailored resume + cover
letter. Evaluation state streams live to the socket (`stats` event) and via
Supabase Realtime.
