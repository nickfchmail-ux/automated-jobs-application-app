---
name: quality-assurance
description: "JobSeek quality gate: exact commands to lint, type-check, and build; what to verify before shipping; accessibility and performance standards; how to report findings with file:line references. Use when: verifying changes, running lint/type-check/build, QA review, checking accessibility, performance, reporting issues."
---

# JobSeek Quality Assurance

## Verification Commands

Run in the repo root (`d:\Workstation\automated-jobs\next-react`):

```bash
npm run lint        # ESLint (eslint-config-next)
npx tsc --noEmit    # TypeScript strict check
npm run build       # Next.js production build
```

If the Azure evaluator changed, also verify it:

```bash
cd azure/ai-evaluator && npm run build   # tsc for the Functions app
```

## Standard Sequence

1. `npx tsc --noEmit` — fastest signal for type regressions.
2. `npm run lint` — catches React hooks rules, unused vars, `'use client'`/`'use server'` misuse.
3. `npm run build` — final gate (also catches route/SSG errors, invalid imports).

## What to Check Before Shipping

### Type & runtime

- Server actions return discriminated unions (`{ ok: true, ... } | { ok: false, error }`) — keep them.
- `params` in App Router is a `Promise<{ id }>` — `await params`.
- No server-only imports in client components (no `@/lib/supabase` server client in `"use client"` files).

### Security / data

- No secrets in browser-exposed code (`SUPABASE_SERVICE_KEY`, `AZURE_*_KEY`).
- Queries scoped by `user_id` from `getUserId()`.

### Accessibility (Web Interface Guidelines)

- Form inputs have visible `<label>`s (see `ScrapePanel` labels).
- Buttons are real `<button>`s or MUI components with `aria-label`.
- Focus states visible: `focus:ring-2`, `focus-visible:ring-2` on links/cards.
- Contrast: don't use `text-zinc-400` for essential text; use `dark:` variants everywhere.
- Keyboard nav: Drawer closes on `onClose`; stretched-link cards are `focus-visible`.

### Performance

- Watch for large client bundles; prefer server components where no interactivity is needed.
- Don't add top-level awaits to the dashboard shell (`app/(main)/page.tsx`) — keep `Suspense` streaming.
- Avoid re-render storms from broad Redux selectors (see `redux-state-patterns`).

## Reporting Findings

Return a structured report:

```
**Pass/Fail**
- [x] TypeScript (npx tsc --noEmit)
- [x] ESLint (npm run lint)
- [ ] Build (npm run build) — FAILED

**Findings**
- [blocker] path/file.tsx:123 — description
- [warning] path/file.tsx:45 — description
- [nit] ...
```

Only fix trivial issues yourself and say so; otherwise hand findings to the owning specialist.
