# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

PromptMaster Engine is a professional AI workflow platform that structures interactions with LLMs using modes, evaluation, and iterative refinement. It is NOT a chatbot — it's a 5-phase guided workflow for analysts, auditors, lawyers, and strategists who need aligned, evaluated AI outputs.

The system is based on a book ("How to Become a PromptMaster" by Sean Moran) and has a provisional patent covering the structured interaction + evaluation loop. Backend modules reference book chapters/sections in docstrings (e.g. "Ch1 S13-S14") — keep those citations when editing.

## Commands

**Frontend** (`cd frontend`):
```
npm run dev              # next dev on :3000
npm run build            # MUST pass before pushing
npm run lint             # eslint
```

**Backend** (`cd backend`):
```
uvicorn main:app --reload --port 8000     # dev server
pytest                                     # full suite (128 tests, ~1s, no network)
pytest tests/test_long_form_router.py      # single file
pytest -k test_detect                      # single test by name
```
Tests never call OpenRouter — `tests/conftest.py` supplies an `AsyncMock` client plus `basic_inputs` / `good_evaluation` / `basic_iteration` fixtures. Adding an endpoint means adding a router test that asserts on prompt content, not on LLM output.

Backend deps live in a pyenv 3.12.4 environment on this machine; if `pytest` resolves to a Python without them, use `~/.pyenv/versions/3.12.4/bin/pytest`.

## Architecture

**Monorepo, two independently deployed units:**
- `frontend/` — Next.js 16 (App Router) on Vercel
- `backend/` — FastAPI on Vercel (`@vercel/python`, `vercel.json` routes everything to `main.py`); `Dockerfile` exists for container hosting

**The load-bearing invariant:** the backend is a *stateless but authenticated* LLM proxy. It **owns no user data** — no Supabase data client, no persistence, no session store; every request carries the state it needs (inputs, iteration history, chat history). All persistence happens in the frontend via the Supabase JS SDK under RLS. **Do not add a Supabase data client or session store to the backend.**

It does verify identity. `backend/auth.py` checks the Supabase JWT and attaches a `user_id`; `main.py` applies `require_user` at router-include time so a new router cannot ship unprotected by omission. This superseded the original "no auth check" rule on 2026-09-02: every `/api/*` route had been public and billable against the OpenRouter key, and FR-17/FR-18 require an authenticated API and per-user cost controls. `/api/health` and `/api/modes` stay public; `/api/models` is protected because it calls OpenRouter.

**Where state actually lives:**
- **`/projects`** — Supabase is authoritative. `project-store.ts` holds a cache plus a `revision` for optimistic concurrency; scalar edits are debounced field patches (never whole snapshots — that is a lost-update generator), appends are immediate, and a conflict is surfaced rather than resolved. `use-project-flush` forces pending edits out on tab hide and unload.
- **`/session`** — the legacy flow. Zustand persisted to `sessionStorage` (dies on tab close), autosaved to `sessions.data` as one JSONB blob.

### Backend layout

`routers/` are thin HTTP shells; `promptmaster/` holds the engine logic and all prompt text. Put prompt strings in `promptmaster/`, never in a router.

| Router | Endpoints |
|---|---|
| `meta.py` | `GET /api/modes`, `GET /api/models` |
| `engine.py` | `build-prompt`, `run-iteration`, `flow-trigger`, `flow-inspect`, `build-realignment`, `run-self-audit`, `hard-reset-lessons`, `format-summary`, `export-session` |
| `conversation.py` | `chat-message`, `apply-to-answer`, `save-as-new-version` |
| `continuation.py` | `continue-document` |
| `long_form.py` | `detect-long-form`, `generate-outline`, `generate-section`, `finalize-long-form` |
| `setup.py` | `generate-setup` |
| `audit.py` | `audit-findings`, `apply-audit` |

`routers/_pipeline.py` — `build_iteration_with_full_pipeline()` is **the** "produce a new Iteration" path, used by every iteration-creating endpoint. It fans out eval + suggestions + summary in parallel via `asyncio`, stamps the FR-10 provenance fields (`created_at`, `model_used`, `instruction`), and enforces `finish_reason == "length"` → `completeness = incomplete`, overriding whatever the evaluator LLM said. Pass `active_iteration=None` for a first iteration: there is nothing to summarise a change against, so the summary call is skipped. Never re-implement the fan-out — until 2026-09-02 `engine.py` had its own inlined copy twice, which made every new `Iteration` field a three-site change.

`promptmaster/` modules: `prompt_builder` (assembly), `modes` (persona scaffolding), `evaluator`, `guidance` (suggestions), `realigner`, `flow_triggers` (one-click techniques), `conversation`, `continuity` (snapshot compression for continuation — generated lazily, only on user action), `long_form`, `setup_suggester`, `audit_findings`, `session_context` (formats history into prompts), `summaries`, `schemas` (Pydantic; frontend `src/types/index.ts` mirrors it), `llm_client`.

`llm_client.OpenRouterClient` is created once per app lifespan (`deps.py`) and injected via `get_client()`. `generate_json()` requests JSON mode, strips fences, and on a parse failure makes a **second repair call** before giving up — assume JSON responses are validated, not raw.

### Frontend layout

- `src/app/session/page.tsx` — phase router: renders one of five phase components off `store.phase`, wrapped in `ErrorBoundary`
- `src/app/session/session-shell.tsx` — sidebar + top nav + content well
- `src/components/phases/` — `input`, `review`, `output`, `realign`, `summary`
- `src/components/` also: `chat/`, `long-form/`, `evaluation/`, `input/`, `output/`, `persona/`, `sidebar/`, `tutorial/`, `shared/`, `ui/`
- The live 5-phase UI is `layout/top-nav.tsx` (`PHASE_TABS`) and `layout/sidebar.tsx` (`PHASE_LABELS`) — there is no phase-indicator component
- `src/lib/api/client.ts` — the `api` object; every backend call goes through `apiFetch`, which unwraps FastAPI's `detail` into an `Error`. Frontend never talks to an LLM directly.
- `src/lib/supabase/` — one module per table: `sessions`, `templates`, `usage`, `custom-modes`, `conversation` (`conversation_messages`), `presets` (`user_presets`)
- `src/lib/constants.ts` — `MODE_DISPLAY`, `PROMPT_STACKS`, `CONSTRAINT_PRESETS`, `FORMAT_PRESETS`, `AUDIENCE_OPTIONS`, `DEFAULT_MODEL`

`frontend/AGENTS.md`: this is Next.js 16 — APIs differ from training data. Read `node_modules/next/dist/docs/` before writing framework-level code. Notably `proxy.ts` replaces `middleware.ts`, and auth/session routes are `force-dynamic`.

## Two flows, mid-migration

The app currently has **two** ways to do work. This is deliberate and temporary.

### `/projects` — the Phase 2 workflow system (where new work goes)

A project pins a **workflow template version** (`projects.workflow_template_id`) and moves through its stages. Templates are rows in `workflow_templates`, immutable once published — revising one publishes a new version, so a book halfway through drafting is unaffected.

- `src/lib/workflow/` — the engine. `engine.ts` is pure functions (evaluate a stage's exit criteria, project state from events, list transitions); `templates/*.v1.ts` are the authoring source for `book`, `research` and `single_output`.
- **Templates are generated into a seed migration**, never hand-written as JSON: `npm run --silent gen:templates > ../supabase/migrations/<ts>_seed_workflow_templates.sql`. `seed-drift.test.ts` fails if the TypeScript and the migration disagree. The `--silent` matters — without it npm's banner lands in the SQL.
- `src/components/workflow/` — stage rail, header, exit-criteria checklist, transition bar, workspace. `workflow-workspace.tsx` dispatches on `stage.renderer`.
- `src/components/workflow/renderers/` — `prose`, `list`, `review` (and `outline`, `long_form`). **Five renderers cover 26 stages across both workflows; no renderer branches on which workflow it is**, and a test asserts that.
- Generation is `POST /api/generate-stage-artifact`, one LLM call. It does *not* use `build_iteration_with_full_pipeline` — that scores output against `inputs.objective`, which judges a list of audience segments against the wrong thing, and costs four calls where one will do.

**Stage state is projected from the `workflow_events` log in exactly one place** (`projectState` in `engine.ts`). Events are the record; `projects.stage` is a denormalised cursor for the list view.

**Exit criteria are declarative predicates evaluated by pure functions** — never an LLM call. A gate that fails because a model timed out is a gate users learn to resent. Unknown rule types degrade to a manual checklist item rather than throwing.

### `/session` — the legacy 5-phase flow (still live, being retired)

Input → Review → Output → Realign → Summary, driven by `session-store.ts` and `components/phases/`. It retires once `single_output` renders through the workspace; until then it is the only place some generation happens. **Do not add features here.**

## Evaluation System

A separate LLM call scores three dimensions plus two optional fields (`EvaluationResult` in `schemas.py`):
- **Alignment** — matches the objective? (High/Medium/Low)
- **Clarity** — well-structured? (High/Medium/Low)
- **Drift** — wandered off-topic? (**inverted polarity**: Low is good)
- **Completeness** — structural completeness; also force-set to `incomplete` when the model hit its token limit
- **Interpretation** — plain-language "why this works" bullets

`EvaluationResult.needs_realignment` is the single authority: `alignment == "Low" or drift == "High"`. Use the property; don't re-derive the condition.

## Supabase Schema

**Phase 2 (current):** `projects`, `artifacts`, `artifact_versions`, `evaluations`, `workflow_templates`, `workflow_events`, `project_stage_events`, `recommendations`, `decisions`, `project_tasks`, `jobs`.

Four rules the schema enforces, so they cannot be undone by a later code change:
- **`project_stage_events.actor` is `user | system` — there is no `'model'`.** A model reaches stage state only via `proposal_id` pointing at an accepted recommendation. Auditable from the DDL alone, which matters because this is contract evidence.
- **Children carry a composite FK on `(project_id, user_id)`**, so an artifact cannot be parented into another user's project even from a service-role client.
- **`artifact_versions` is append-only**, with a trigger permitting only `user_rating` to change. Restore appends a new version rather than mutating; that is why version history and prompt assembly can trust it.
- **`revision` is bumped by trigger, never by the client.** A client that could set it would echo its stale value back and defeat the concurrency guard.

**Legacy (still live):** `sessions` (a whole `Session` in a `data` JSONB blob; the per-row columns are only for listing), `templates`, `usage_tracking` (emits `iteration`/`realignment`/`session_finalize` only), `custom_modes`, `conversation_messages`, `user_presets`.

Migrations are the source of truth: always checked in, always idempotent, `drop policy if exists` before `create policy` (Postgres has no `create policy if not exists`). **A migration must apply against an empty database** — validate with `supabase db diff --linked --schema public` before pushing. Two migrations here have already broken that rule and had to be fixed.

## Environment Variables

Frontend `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).
Backend `.env`: `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS` (comma-separated; no hardcoded default — CORS fails closed if unset).

## Branches

- `main` — production (Next.js + FastAPI); Vercel deploys from here
- `master` — legacy Streamlit app, rollback only. Never deploy from it.

## Conventions

- **Never mention client/stakeholder names** in commits, code, or public-facing content
- Material Symbols Outlined icons (not Lucide, not emojis); Inter font
- Design system "Foundry Slate" / "Architectural Monolith": tonal surface separation, **no 1px borders for sections**, 2.75rem display headings, 720px content well, ambient shadows. Spec in `design-system/` (not committed).
- CSS custom properties (`var(--pm-primary)`, `var(--surface-container-low)`), Tailwind v4 (`@plugin`, not `@import`, for plugins)
- All components carry `'use client'`
- Larger features get a design spec + plan pair in `docs/superpowers/specs/` and `docs/superpowers/plans/` — read the relevant one before extending long-form, conversation, continuity, custom modes, or smart setup
