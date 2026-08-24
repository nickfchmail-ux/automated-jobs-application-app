---
name: redux-state-patterns
description: "JobSeek Redux Toolkit state patterns: store layout, runSlice/jobSlice shape, key actions and selectors, useRealtimeRun hook wiring, dispatch/useSelector usage, avoiding re-render pitfalls. Use when: working with Redux state, slices, selectors, dispatch, hooks, useRealtimeRun, jobStream, run state, client data flow."
---

# JobSeek Redux State Patterns

## Store Layout

`state/global/store.ts` — single `configureStore`:

```ts
export const store = configureStore({
  reducer: { jobs: jobReducer, run: runReducer },
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

Wired once in `components/ProviderManager.tsx` (client) inside `app/(main)/layout.tsx`.

## runSlice — the live run state

Key state fields (see `state/global/slice/runSlice.ts`):

- `phase` — `idle | queued | starting | processing | scraping | completed | failed`
- `runId`, `keyword`, `boards`
- `jobStream` — array of live job rows
- `counts` — `FunnelCounts` (`{ total, fit, unfit, ... }`)

Key actions (import from `@/state/global/slice/runSlice`):
`runQueued`, `runStarting`, `runSucceeded`, `runFailed`, `runStatusUpdated`, `runCountsUpdated`, `runJobUpserted`, `runJobStreamReplaced`, `runBoardUpdated`, `runBoardsUpdated`, `runConnection`, `evaluationRunUpserted`, `evaluationRunsUpdated`, `evaluationStatusUpdated`, `runError`.

## jobSlice

Holds static job listings for list pages. Use selectors to derive filtered views (fit/not-fit/etc).

## Selector & Hook Conventions

- Read state with `useSelector((s: RootState) => s.run.xxx)` — destructure only what you need.
- Dispatch actions from `useDispatch()` (typed as `AppDispatch` if strict).
- **Avoid** selecting large arrays when a scalar suffices — selects returning new object/array literals cause re-renders. Prefer returning primitives or memoized values.
- Keep async orchestration in `hooks/useRealtimeRun.ts` or server actions, not inline in components.

## useRealtimeRun(enabled)

The live dashboard hook (in `hooks/useRealtimeRun.ts`):

- **Connection effect** (keyed on `enabled`): opens socket.io + Supabase Realtime channel ONCE, keeps alive, cleans up on unmount (`disposed` guard).
- **Hydrate effect** (keyed on `runId`): seeds run status + per-board counts and loads the job stream when a run is queued.
- Derives completion from terminal states (`done | failed | blocked` per board, or all streamed jobs in `completed | failed | duplicate`).

If you change state shape, update every selector/consumer and re-verify `ScrapePanel`, `LiveRunCard`, `RealtimeJobStream`, `EvaluationProgress`, `Navbar` (badges), `RunHistory`.

## Rules

- Never put async network calls directly in a reducer.
- Keep slice action names stable — they are imported across many components.
- `RootState`/`AppDispatch` types must stay in sync when adding reducers.
