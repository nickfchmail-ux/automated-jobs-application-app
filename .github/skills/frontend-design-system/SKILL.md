---
name: frontend-design-system
description: "JobSeek frontend design system: MUI v7 + Tailwind v4 hybrid patterns, zinc color tokens, card/nav/form conventions, per-board source colors, fit/score badge thresholds, dark mode. Use when: styling components, building new UI, changing layout, colors, spacing, responsive, dark mode, MUI vs Tailwind choice, design consistency."
---

# JobSeek Frontend Design System

## Hybrid Styling Model

Two systems coexist; pick by what you're styling:

- **MUI** (`@mui/material`, `@mui/icons-material`) — use for **widgets** that need accessibility behavior: `IconButton`, `Drawer`, `Chip`, `Badge`, `Select`. Style via `sx` or `PaperProps.sx`. Also MUI icons (`MenuIcon`, `SentimentSatisfiedAltIcon`, etc.).
- **Tailwind v4** — use for **layout, spacing, and color**. Utility classes only (no `@apply` unless needed).

Never introduce raw `<button>`/`<input>` styling that reinvents MUI when a widget exists — but the app leans heavily on Tailwind for forms (see `ScrapePanel`). Consistency matters more than dogma.

## Color Tokens (zinc palette + accents)

| Purpose             | Classes                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shell          | `bg-zinc-50 dark:bg-zinc-950`                                                                                                                                          |
| Card                | `rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm`                                                                          |
| Card hover          | `hover:shadow-md transition-shadow`                                                                                                                                    |
| Header row / navbar | `bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800`                                                                                              |
| Primary text        | `text-zinc-900 dark:text-zinc-50`                                                                                                                                      |
| Muted text          | `text-zinc-400 dark:text-zinc-500` (also `text-zinc-500 dark:text-zinc-400`)                                                                                           |
| Inputs              | `rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm` + `focus:ring-2 focus:ring-blue-500 focus:border-transparent` |
| Primary button      | `rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-5 py-2.5`                                                                                |

## Per-Board Source Colors

`detectSource(url)` appears in `components/JobCard.tsx` and `app/(main)/jobs/[id]/layout.tsx`. Keep the palette consistent:

| Board      | color / bg / border                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| JobsDB     | `text-purple-700 dark:text-purple-300` / `bg-purple-50 dark:bg-purple-950` / `border-purple-200 dark:border-purple-800` |
| Indeed     | `text-sky-700 dark:text-sky-300` / `bg-sky-50 dark:bg-sky-950` / `border-sky-200 dark:border-sky-800`                   |
| CTgoodjobs | `text-orange-700 dark:text-orange-300` / `bg-orange-50 dark:bg-orange-950` / `border-orange-200 dark:border-orange-800` |
| LinkedIn   | `text-orange-700 dark:text-orange-300` / `bg-orange-50 dark:bg-orange-950` / `border-orange-200 dark:border-orange-800` |
| OfferToday | `text-teal-700 dark:text-teal-300` / `bg-teal-50 dark:bg-teal-950` / `border-teal-200 dark:border-teal-800`             |
| Glassdoor  | `text-green-700 dark:text-green-300` / `bg-green-50 dark:bg-green-950` / `border-green-200 dark:border-green-800`       |
| fallback   | `text-zinc-700 dark:text-zinc-300` / `bg-zinc-50 dark:bg-zinc-800` / `border-zinc-200 dark:border-zinc-700`             |

## Score / Fit Badges

- **Score badge** (`ScoreBadge`): `>= 65` emerald, `>= 45` amber, else red (Tailwind version in JobCard; MUI Chip `success/warning/error` in job detail layout).
- **Fit thresholds** (app-wide): `>= 75` "Great fit", `50–74` "Possible", `< 50` "Low".

## Common Card Anatomy (JobCard)

1. Stretched `<Link href={/jobs/${job.id}} className="absolute inset-0 ...">` for the whole card.
2. Header: source chip + search key row, then title/company/location.
3. Body: skills chips, short description, score badge.
4. Hover: `hover:shadow-md`.

## Responsive + Dark Mode Rules

- Every color must have a `dark:` variant.
- Use `flex-col sm:flex-row` for responsive form rows; `hidden md:flex` for desktop nav; mobile uses a MUI `Drawer` (see `Navbar`).
- Preserve existing breakpoint behavior when touching `Navbar`, `ScrapePanel`, `InfiniteJobList`.

## Loading / Skeleton Patterns

- Stream sections behind `<Suspense>` with `animate-pulse` skeleton blocks matching card shapes (see `app/(main)/page.tsx`).
- `PageSpinner.tsx` for full-page loading.
