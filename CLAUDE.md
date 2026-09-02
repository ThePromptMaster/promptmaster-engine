# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Zustand store (`frontend/src/stores/session-store.ts`, ~450 lines) is the single source of truth for a live session, persisted to **sessionStorage** (survives refresh, clears on tab close) with `error`/`loading` stripped via `partialize`.
- Supabase persists the session across tabs in `sessions.data` (a JSONB blob holding the whole `Session`, `long_form` included). There is no `sessions.long_form` column — the only per-row columns are the denormalized `objective`/`mode`/`audience`/`iterations` (an int count)/`finalized` used for listing.
- The store is passed wholesale into API calls; the backend reconstructs context from `iteration_history` and `chat_history` on each request.

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

## The 5-Phase Workflow

1. **Input** — mode card grid (8 modes incl. `custom`), objective, audience, constraint/format presets, session facts, prompt stack
2. **Review** — inspect assembled system prompt, edit user prompt, execute. Long-form detection runs here, before `run-iteration`.
3. **Output & Evaluation** — output, scores, suggestions, flow triggers, chat panel; refine / realign / finalize
4. **Realignment** — corrective prompt, re-execute
5. **Summary** — export (txt/json), iteration comparison, Cold Critic self-audit, carry lessons forward

## Evaluation System

A separate LLM call scores three dimensions plus two optional fields (`EvaluationResult` in `schemas.py`):
- **Alignment** — matches the objective? (High/Medium/Low)
- **Clarity** — well-structured? (High/Medium/Low)
- **Drift** — wandered off-topic? (**inverted polarity**: Low is good)
- **Completeness** — structural completeness; also force-set to `incomplete` when the model hit its token limit
- **Interpretation** — plain-language "why this works" bullets

`EvaluationResult.needs_realignment` is the single authority: `alignment == "Low" or drift == "High"`. Use the property; don't re-derive the condition.

## Supabase Schema

Six tables, all RLS-scoped to `auth.uid() = user_id`:
`sessions` (objective, mode, audience, iterations as an int count, finalized, `data` JSONB), `templates`, `usage_tracking` (action: iteration/realignment/session_finalize — `self_audit` and `hard_reset` are *not* emitted by any code path), `custom_modes`, `conversation_messages`, `user_presets`.

Migrations live in `supabase/migrations/` (applied manually against the project — no local Supabase CLI setup in the repo). New tables follow the `custom_modes` pattern: `(user_id, created_at desc)` index, four owner policies, `touch_updated_at` trigger.

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
