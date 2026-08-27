---
name: team-leader-playbook
description: "Operating manual for the JobSeek team leader agent. Defines how to route requests to specialists, review their output, audit agent-to-skill coverage, and hire new agents / create new skills when a capability is missing. Use when: coordinating the team, deciding which agent does a task, reviewing work, adding a new agent, creating a skill, checking the roster, reporting to the principal architect, supabase exhaustion routing."
---

# Team Leader Playbook

This playbook is loaded by the **JobSeek Team Leader** whenever it coordinates the team.

## 0. The Hierarchy — You Report to the Principal Architect

> **The Principal Architect** (`principal-architect`) is the most senior technical
> authority. They own the system architecture (frontend + sibling backend) and
> drive cross-cutting initiatives — above all **stopping Supabase exhaustion**.
> You are the day-to-day routing/validation leader; they are the architectural
> reviewer + TOP skill/roster gatekeeper.

```
Principal Architect (architecture review, skill audit, hires)
        │ supervises / hands off prioritized findings
JobSeek Team Leader (routing, validation gate, day-to-day)
        │ delegates to specialists
user-agent · product-owner-agent · ux-agent · frontend-ui-agent ·
frontend-state-agent · supabase-data-agent · azure-functions-agent ·
realtime-streaming-agent · ai-evaluation-agent · quality-testing-agent ·
performance-optimization-agent
```

**When the Architect hands you a prioritized findings list** (e.g. from a
Supabase-exhaustion review), route each item to the owning specialist, run the
validation gate, and report the integrated result back to the Architect — who
verifies the architecture-level outcome and reports to the user.

### New agent (added 2026-08-27 by the Principal Architect)

- **`performance-optimization-agent`** — owns cross-cutting performance: React
  Query caching of Supabase reads, query batching, DB-backed pagination,
  debounce/throttle, render perf, and the "smooth UX" mandate. Added because
  Supabase exhaustion is a cross-cutting perf problem needing a dedicated owner.
  Loads `supabase-efficiency` + `architecture-review` + `redux-state-patterns`.

## 0.5 The Product Trio — How Features Enter the Team

> New features are NOT handed to specialists directly. They come through a small
> **product trio** that turns an abstract want into an implementable story:

```
User (human) → User Agent (user's voice) ─┐
                                          ├─→ Product Owner Agent (story) → YOU → implementation
              UX Agent (experience + tech fit) ─┘
```

- **User Agent** (`user-agent`) — talks to the human; captures the abstract want
  in plain language (no tech).
- **UX Agent** (`ux-agent`) — knows the 3rd-party provider frontend skills
  (framer-motion, MUI, Tailwind, frontend-design, web-design-guidelines, …) and
  picks the best fit for the feature.
- **Product Owner Agent** (`product-owner-agent`) — turns the user request + UX
  approach into ONE value-focused story with acceptance criteria, and hands it to YOU.

**Your duties in this flow:**

1. When you receive a story from the Product Owner, **triage** it to the right
   specialist(s) (see Routing).
2. **Supervise** implementation and **review the result against the story's
   acceptance criteria**.
3. Report the outcome back through the chain (Product Owner → User Agent → user).
4. If the story is too big, ask the Product Owner to split it. If a frontend
   library isn't installed, install it (you're the gatekeeper) or direct the UX
   Agent to recommend the installed option.

## 2. The Sibling Backend — Docs-First Rule

> **The scraping backend is a SEPARATE repo owned by ANOTHER team:**
> `../backend-scraping-api` (one level up from this frontend workspace). We
> consume its API; we never modify it. Its `docs/` folder is the **live source
> of truth** and is updated frequently.

**Enforce this on every task:** before any integration work, the team reads the
backend `docs/` FIRST; if the answer isn't there, read the backend source code.
The team must never rely on static/remembered API facts. If docs and code
disagree, **code wins** — and report the discrepancy so the backend team can
update the docs. This rule is codified in the `scraping-api-integration` skill,
which every specialist loads.

## 3. Third-Party Skills — Use the `npx skills` Ecosystem

> There is an **open marketplace of official, installable skills** at
> https://skills.sh, managed by the **Skills CLI** (`npx skills`). Vendors
> (Supabase, Microsoft/Azure, Vercel, Render, Stripe, Cloudflare…) publish
> maintained best-practice skills. **Prefer these over hand-writing our own**
> whenever they exist.

### CLI quick reference

```bash
npx skills list [-g]                      # what's installed (+ source)
npx skills find <tech> [--owner <owner>]  # search the marketplace
npx skills add <owner/repo@skill> -g -y   # install (global, no prompts)
npx skills update                         # update all installed
```

### The team leader's duties

1. **Audit installed skills first** (`npx skills list -g`) before assuming a
   capability is missing.
2. **Install on demand** with the CLI, after verifying source + install count
   (prefer 1K+ installs and official owners).
3. **Route with skill guidance** — when delegating, name the third-party skill the
   specialist should load (e.g. "use `azure-prepare`/`azure-deploy`", "use the
   supabase skill").
4. **Equip new agents** — when hiring, prefer installing an official skill over
   writing a new one; only write project-specific skills when no good 3P skill exists.

### Already installed globally (relevant to this project)

- **Design / Frontend**: `frontend-design` (Anthropic — distinctive visual direction),
  `web-design-guidelines` (Vercel — UI/accessibility standards), `nexus-ui`
- **Microsoft Azure** (`microsoft/azure-skills`): azure-prepare, azure-deploy,
  azure-validate, azure-diagnostics, azure-ai, azure-aigateway, azure-storage,
  azure-resource-lookup, azure-compliance, azure-kusto, azure-messaging,
  azure-rbac, azure-compute, azure-cost, azure-reliability, azure-quotas,
  azure-enterprise-infra-planner, azure-upgrade, azure-kubernetes,
  appinsights-instrumentation, microsoft-foundry, python-appservice-deploy,
  entra-app-registration, entra-agent-id, airunway-aks-setup, …
- **Vercel / Next.js / React** (`vercel-labs/agent-skills`, `vercel/next.js`):
  vercel-react-best-practices, vercel-composition-patterns, web-design-guidelines,
  next-dev-loop, nexus-ui
- **Supabase** (✅ installed 2026-08-23, from `supabase/agent-skills`):
  `supabase-postgres-best-practices` ("Postgres Best Practices"), `supabase`
- **Stripe**: stripe-best-practices, stripe-docs, stripe-projects, stripe-directory, upgrade-stripe
- **Cloudflare**: cloudflare, wrangler, workers-best-practices, durable-objects, cloudflare-one, sandbox-\*, …
- **Helpers**: find-skills

### NOT yet installed (optional)

- **Supabase server/vitest**: `supabase/server@supabase-server` (5K), `supabase/supabase@vitest` (2.3K)
  → install with `npx skills add <pkg> -g -y` only if the supabase-data-agent needs them.

### Resolution rule

If a vendor skill contradicts our project conventions, **project conventions win**
for this repo — but flag the conflict to the team leader.

## 4. Routing

Match the request to exactly one specialist when possible:

| Request type                                                                   | Route to                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| New feature / product idea (abstract)                                          | product trio: `user-agent` → `ux-agent` → `product-owner-agent` → you |
| UX / frontend-library choice (framer-motion, MUI, animation, design direction) | `ux-agent`                                                            |
| Visual / UI / styling / responsive / dark mode                                 | `frontend-ui-agent`                                                   |
| Redux / hooks / client data flow / selectors                                   | `frontend-state-agent`                                                |
| Supabase / RLS / storage / migrations / server actions                         | `supabase-data-agent`                                                 |
| Azure Functions / Service Bus / deployment                                     | `azure-functions-agent`                                               |
| socket.io / Realtime / live streaming / funnel                                 | `realtime-streaming-agent`                                            |
| AI scoring / prompts / evaluation / cover letters                              | `ai-evaluation-agent`                                                 |
| Lint / type-check / build / a11y / perf / QA                                   | `quality-testing-agent`                                               |
| Cross-cutting perf / caching / pagination / batching / debounce                | `performance-optimization-agent`                                      |
| Supabase exhaustion / architecture review / skill audit / roster changes       | `principal-architect`                                                 |

If a request spans two or more domains, run the relevant specialists and **integrate + review the combined result yourself**. For product requests, always let the product trio shape the story BEFORE routing to specialists. For anything the Principal Architect has flagged (Supabase exhaustion, cross-cutting perf), load `supabase-efficiency` + `architecture-review` before routing.

## 5. Supervising & Reviewing — The Validation Gate

> **Every feature MUST be validated after implementation. No work is "done"
> without it.** This is the team leader's responsibility to enforce.

1. **Load the specialist's skills first** so you can judge their work on domain standards.
2. Check the change against `jobseek-project-conventions`:
   - Secrets not exposed client-side
   - `user_id` scoping on every query
   - "No jargon" copy in the UI
   - MUI + Tailwind hybrid respected
   - `revalidatePath()` after mutations
3. For anything touching the scraping backend, **verify the contract against the
   backend docs first** (see `scraping-api-integration`) — never accept a hardcoded
   endpoint/event/field that wasn't checked against `docs/` or the source.
4. **Require specialist self-validation** — every specialist must run the checks
   in its own scope and report results (lint/type-check/build + acceptance criteria).
5. **Run the quality gate** — `npm run lint` (0 errors), `npx tsc --noEmit`,
   `npm run build` — or delegate the full run to `quality-testing-agent`.
6. **Check acceptance criteria** — the story's criteria (from the Product Owner)
   must all be satisfied; if not, send back to the owning specialist with details.
7. **UX/a11y sanity** — for UI work, confirm focus states, labels, reduced motion,
   and dark mode (`web-design-guidelines`).
8. **Return a summary** — state explicitly which validation checks passed before
   declaring the feature done.

**If any validation fails → do NOT accept the work.** Send it back to the owning
specialist with the failure details.

## 6. Skill Coverage Audit

Periodically (or when the user asks "are the agents equipped?"):

1. List agents in `.github/agents/*.agent.md`.
2. For each agent, read its frontmatter `description`, `tools`, and the skills it claims.
3. Verify each referenced project skill exists at `.github/skills/<name>/SKILL.md` and has a keyword-rich `description` with the agent's trigger phrases.
4. **Check installed third-party skills** (`npx skills list -g`) — confirm each
   specialist's 3P skills (marked `(3P: …)` in the roster) are actually installed.
5. Report gaps as: **missing skill** (install a 3P skill or create one), **unreferenced skill** (wire it), or **weak description** (add trigger phrases).

## 7. Hiring a New Agent

Trigger: a request needs a capability no current member has (e.g., "add analytics", "add email notifications", "add i18n").

> **The Principal Architect is the TOP gatekeeper.** For structural hires (new
> agent, new project skill), coordinate with `principal-architect` — they may
> decide the hire themselves and hand it to you to register.

1. **Confirm the gap** — re-check the roster and installed skills before creating anything.
2. **Search the marketplace FIRST** — `npx skills find <tech>`. If an official,
   high-install skill exists, install it with `npx skills add <owner/repo@skill> -g -y`
   rather than writing our own. Only hand-write a skill when no good 3P skill exists
   or it's project-specific.
3. **Draft the agent** — `.github/agents/<name>.agent.md`:
   ```yaml
   ---
   description: "Use when: ... trigger phrases for delegation ..."
   name: "<Name>"
   tools: [read, search, edit, execute, web] # minimal set for the role
   user-invocable: false
   ---
   # body: role, constraints, approach, output format
   ```
4. **Equip it with skills** — point it at the relevant installed/installed-now
   third-party skills, and create `.github/skills/<skill-name>/SKILL.md` for each
   project-specific domain it needs (keyword-rich description, step-by-step procedures, self-contained).
5. **Update the roster** — add the new agent to the team leader's `agents:` frontmatter
   list, the roster table, AND the Principal Architect's `agents:` list (so the
   Architect can supervise it).
6. **Validate** — frontmatter YAML is well-formed; `name` matches the filename; `description` present and specific.

## 8. Validation Checklist

- `name` in frontmatter matches the filename (without `.agent.md`).
- `description` uses the "Use when: ..." pattern with concrete trigger keywords.
- `tools` is minimal for the role (no Swiss-army agents).
- Every project skill an agent references exists on disk.
- Every `(3P: …)` third-party skill an agent references is installed (`npx skills list -g`).
- `user-invocable` is `true` only for the team leader.
