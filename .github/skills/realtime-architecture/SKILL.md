---
name: realtime-architecture
description: "JobSeek realtime architecture: socket.io funnel (stats:summary/stats:run), Supabase Realtime postgres_changes, the useRealtimeRun hook (connection effect vs hydrate effect), friendly error copy, live-run components. Use when: socket.io, websocket, Supabase Realtime, postgres_changes, funnel, live stream, live run, channels, subscriptions, EvaluationProgress, LiveRunCard, RealtimeJobStream."
---

# JobSeek Realtime Architecture

## The Two Live Channels

1. **socket.io** (Express server at `NEXT_PUBLIC_WS_URL`) — pushes funnel counters:
   - `stats:summary` → `FunnelCounts` (total/fit/unfit) drives navbar badges + stats.
   - `stats:run` → per-run/per-board stage updates.
2. **Supabase Realtime** (`postgres_changes`) — streams actual **job rows** (row-level upserts) and **evaluation_runs** progress. RLS scopes rows to the user once `setSupabaseSession(token)` is called.

## `useRealtimeRun(enabled)` — The Hook

Two effects (keep this separation — it is the core design):

- **Connection effect** (keyed `enabled`): `getRealtimeSession()` → token + wsUrl → `setSupabaseSession(token)` → open socket.io + subscribe to the Realtime channel. Opens ONCE and keeps alive. Uses a `disposed` guard + refs (`socketRef`) for cleanup — never open duplicate channels on re-render.
- **Hydrate effect** (keyed `runId`): when a run is queued, seed run status + per-board counts (REST fallback `statsRunDetailAction`) and load the job stream.

Completion logic: treat the run as done when every board reaches a terminal stage (`done | failed | blocked`) OR all streamed jobs are terminal (`completed | failed | duplicate`). Dispatch `runSucceeded()`.

## Session Token Flow

`app/actions/realtime.ts` → `getRealtimeSession()` returns `{ token, wsUrl }`. Set it on the browser Supabase client before subscribing (RLS depends on it).

## Friendly Copy (No Jargon)

Never surface raw socket/Azure/Supabase error text. Map to human copy:

- `invalid token | missing token` → "Your session expired. Please sign in again."
- `verification failed` → "We couldn't reach the live service. Please try again."
- 429 → "You've hit today's search limit. It resets at midnight."

## Live-Run Components

- `LiveRunCard` — funnel summary during a run.
- `RealtimeJobStream` — streaming job rows as they arrive.
- `EvaluationProgress` — per-keyword batch progress from `evaluation_runs` (drives the "web developer — 12 of 20 jobs…" copy).
- `Navbar` badges read `s.run.counts.fit/unfit`.

## Rules

- Keep `getSupabaseBrowser()` usage client-only.
- Always unsubscribe/close on unmount (avoid leaking channels).
- When changing the funnel shape, update `FunnelCounts` in `types/api.ts` and the slice together.
