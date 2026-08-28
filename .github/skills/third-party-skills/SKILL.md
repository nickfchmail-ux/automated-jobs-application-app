---
name: third-party-skills
description: "How to discover, install, update, and use THIRD-PARTY skills (installable via the `npx skills` CLI) from the open agent skills ecosystem (skills.sh) — e.g. supabase, microsoft/azure-skills, vercel-labs, render, and more. These are the OFFICIAL, maintained best-practice skills for a technology, and should be PREFERRED over writing our own when they exist. Use when: skills CLI, npx skills, find skills, install skill, skills.sh, third-party skill, supabase skill, azure skill, render skill, best practices, marketplace, which skill to use, add a skill."
---

# Third-Party Skills (the `npx skills` ecosystem)

The open agent skills ecosystem (https://skills.sh) provides **official,
maintained, best-practice skills** for many technologies — Supabase, Azure,
Vercel, Render, Stripe, Cloudflare, etc. These are installed with the **Skills
CLI** and are updated over time by the vendors.

> **Rule of thumb: if an official third-party skill exists for a technology,
> use it instead of (or on top of) our own hand-written skill.** Our `.github/skills/*`
> files encode THIS project's conventions; the third-party skills encode the
> vendor's best practices. Both are loaded as needed.

## The Skills CLI

```bash
npx skills find <query> [--owner <owner>]   # search the marketplace
npx skills add <owner/repo@skill> [-g] [-y] # install a skill (-g = global/user-level)
npx skills update                            # update all installed skills
npx skills list [-g]                        # list installed skills (+ their source)
```

- Browse catalog: https://skills.sh/
- Install for everyone: `-g` (user-level, recommended for shared skills)
- Skip confirmations: `-y`

## Discovery Checklist (use BEFORE writing our own skill)

1. **Check what's already installed** first: `npx skills list -g`. Many are
   already present globally (Azure, Vercel, Stripe, Cloudflare, web-design-guidelines…).
2. **Search the marketplace** for the technology: `npx skills find <tech>`.
3. **Verify quality** before recommending/installing:
   - Prefer 1K+ installs; be cautious under 100.
   - Prefer official sources (`supabase`, `microsoft`, `vercel-labs`, `render`…).
   - Check GitHub stars of the source repo.
4. If a good official skill exists → **install + use it**. If none exists → then
   we write our own under `.github/skills/<name>/`.

## Known Relevant Skills for THIS Project

### Supabase (✅ INSTALLED 2026-08-23)

Installed globally via:

```bash
npx skills add supabase/agent-skills@supabase-postgres-best-practices -g -y   # 364K installs
npx skills add supabase/agent-skills@supabase -g -y                            # 233K installs
```

- `supabase-postgres-best-practices` — Postgres/SQL/RLS best practices (supabase, 364K). Display name: **"Postgres Best Practices"**
- `supabase` — general Supabase platform usage (supabase, 233K). Display name: **"Supabase"**
- Not installed (optional): `supabase/server@supabase-server` (5K), `supabase/supabase@vitest` (2.3K)

### Microsoft Azure (already installed — from `microsoft/azure-skills`)

Installed globally: `azure-prepare`, `azure-deploy`, `azure-validate`,
`azure-diagnostics`, `azure-ai`, `azure-aigateway`, `azure-storage`,
`azure-resource-lookup`, `azure-compliance`, `azure-kusto`, `azure-messaging`,
`azure-rbac`, `azure-compute`, `azure-cost`, `azure-reliability`, `azure-quotas`,
`azure-enterprise-infra-planner`, `azure-upgrade`, `azure-kubernetes`,
`appinsights-instrumentation`, `microsoft-foundry`, `python-appservice-deploy`,
`entra-agent-id`, `entra-app-registration`, `airunway-aks-setup`, … (Source: `microsoft/azure-skills`)

### Vercel / Next.js / React (already installed)

`vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`
(source: `vercel-labs/agent-skills`), `next-dev-loop` (source: `vercel/next.js`),
plus `nexus-ui` (victorcodess).

### Design / Frontend (✅ frontend-design INSTALLED 2026-08-23)

- **`frontend-design`** (Anthropic, `anthropics/skills@frontend-design`, 808K installs) —
  distinctive, intentional visual design; typography; non-templated aesthetic direction.
  Installed globally:
  ```bash
  npx skills add anthropics/skills@frontend-design -g -y
  ```
  > Note: the user originally asked for `anthropics/claude-code-skill-frontend-design`,
  > but that repo doesn't exist — the correct package is `anthropics/skills@frontend-design`.
- **`web-design-guidelines`** (Vercel, `vercel-labs/agent-skills/web-design-guidelines`) —
  already installed (from `vercel-labs/agent-skills`).
- **Motion/animation**: if a feature needs framer-motion, search first
  (`npx skills find motion`); if no skill, use the library directly + `frontend-design`
  for direction.

### Render

- The **Express API** the frontend talks to is deployed on **Render**
  (`ai-job-server-r2dk.onrender.com`) — but that's the OTHER team's backend; we don't
  deploy it.
- If we ever deploy OUR app to Render, search `npx skills find render` for an
  official skill first. As of 2026-08-23 there is no widely-adopted "render deploy"
  skill — so if needed, use the generic deploy guidance or our own skill.

### Others installed that may be relevant

- Stripe (`stripe-best-practices`, `stripe-docs`, `stripe-projects`, `stripe-directory`, `upgrade-stripe`)
- Cloudflare (`cloudflare`, `wrangler`, `workers-best-practices`, `durable-objects`, `cloudflare-one`, `sandbox-*`, …)
- `find-skills` — helper skill that walks through discovery/install interactively

## How Agents Should Use This

1. When a task is in a technology domain (Supabase, Azure, Vercel, Render, Stripe,
   Cloudflare…), **check for an installed third-party skill** first and load it.
2. If the right skill isn't installed, **ask the team leader** to install it via
   the CLI (or install it yourself if you have `execute` and it's clearly needed).
3. Prefer vendor best practices from the official skill, layered with our project
   conventions from `.github/skills/jobseek-project-conventions`.
4. Keep skills updated: run `npx skills update` periodically.

## Rules

- Never install a skill without verifying source + install count (see checklist).
- Never remove/rename an installed third-party skill — manage installs via `npx skills`.
- If a vendor skill and our project conventions conflict, **project conventions win**
  for this repo, but flag the conflict to the team leader.
