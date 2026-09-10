# Deployment and environment variables

Three hosted things: **two Vercel projects** (frontend and backend) and **one Supabase
project**. They deploy independently.

---

## Vercel project 1 — frontend

- Root directory: `frontend/`
- Framework: Next.js **16.2.1** (App Router). Build `npm run build`, output `.next`.
- Config: `frontend/vercel.json` — deploys from `main` only; `master` is explicitly
  disabled (`"master": false`), because `master` is the legacy Streamlit app and
  exists for rollback reference only.
- Carries the **Vercel Cron** entry that drives the job queue: `/api/jobs/drain`,
  `* * * * *`.

This project contains the entire UI plus the one server route, `/api/jobs/drain`,
which holds the service-role key.

## Vercel project 2 — backend

- Root directory: `backend/`
- Runtime: `@vercel/python`, all routes to `main.py` (`backend/vercel.json`).
- Dependencies: `backend/requirements.txt` — FastAPI, uvicorn, httpx, pydantic,
  python-dotenv, `pyjwt[crypto]` (the `[crypto]` extra is required for the
  asymmetric-JWT verification path).
- A `Dockerfile` also exists for container hosting, if the platform ever changes.

Local development is `uvicorn main:app --reload --port 8000`. Backend dependencies live
in a pyenv 3.12.4 environment on the original developer's machine; if `pytest` resolves
to a Python without them, use `~/.pyenv/versions/3.12.4/bin/pytest`.

## Supabase

Project ref `promptmaster-engine`, Postgres **major version 17**. Schema is applied
from `supabase/migrations/` — see [`data-model.md`](data-model.md) for the rules.

`supabase/config.toml` is the **local development** config, not the hosted settings.
It does not describe the production project. Notable local values, for reference when
reproducing behaviour: `jwt_expiry = 3600`, refresh-token rotation on with a 10-second
reuse interval, `minimum_password_length = 6`, email confirmations **off**, signup on,
anonymous sign-ins off, all external OAuth providers off, MFA off, and
`[experimental.pgdelta] enabled = true`.

Two things in that file to be aware of: `[db.seed]` points at `./seed.sql`, **which
does not exist in the repository**; and `[db.network_restrictions]` is disabled with
`allowed_cidrs = ["0.0.0.0/0"]`.

---

## Environment variables

### Frontend Vercel project

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public, RLS-constrained. |
| `NEXT_PUBLIC_API_URL` | Yes in production | The backend Vercel URL. Defaults to `http://localhost:8000` — **if it is unset in production the app silently calls localhost and every generation fails in the browser.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Secret. Bypasses RLS.** Used only by `/api/jobs/drain`. Never expose it to the client; never prefix it `NEXT_PUBLIC_`. |
| `CRON_SECRET` | Yes | The bearer token Vercel Cron presents to `/api/jobs/drain`. Compared in constant time; an unset value cannot match, so the cron simply stops working. |
| `WORKER_SHARED_SECRET` | Yes | The credential the drain presents to FastAPI. **Must be byte-identical to the backend's.** |

### Backend Vercel project

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | The only provider credential. Server-side only. |
| `ALLOWED_ORIGINS` | Yes | Comma-separated. **No hardcoded default — CORS fails closed if unset.** Must include the frontend's production origin, and any preview origin you want to work. |
| `SUPABASE_URL` | Yes | Used to build the JWKS URL for asymmetric token verification. |
| `SUPABASE_JWT_SECRET` | If the project signs HS256 | Legacy symmetric signing. Harmless to set alongside `SUPABASE_URL`. |
| `WORKER_SHARED_SECRET` | Yes | **Must match the frontend's.** |
| `AUTH_ENFORCED` | No | Defaults to `true`. Set `false` only during a deploy-ordering emergency; it lets unauthenticated requests through, logging `UNAUTHENTICATED_REQUEST`. |

### Local development

Frontend `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.
Backend `backend/.env`: `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS`.

`supabase/.gitignore` excludes `.env.keys`, `.env.local` and `.env.*.local`. No secret
should ever be committed; there is none in the repository today.

### The two that must match

`WORKER_SHARED_SECRET` is set in **both** Vercel projects and they must be identical.
A mismatch is a nasty failure mode because it is invisible from the UI: saving works,
navigation works, and only long-form drafting fails, with a 401 the user sees as a
generic generation error. Rotating it is a two-sided operation — see
[`runbook.md`](runbook.md).

---

## Deploy order

The frontend calls the backend, so a change to their shared contract goes out
**backend first**. The Pydantic schemas in `backend/promptmaster/schemas.py` and their
mirror in `frontend/src/types/index.ts` are two hand-maintained copies of one
contract; there is no codegen, and nothing fails the build if they drift.

A migration that a deploy depends on goes out **before** that deploy. A migration is
additive by convention here, so this is normally uneventful, but the ordering matters
for anything that adds a NOT NULL column or a new CHECK value.

## Branches

- `main` — production. Both Vercel projects deploy from it.
- `master` — the legacy Streamlit app. **Never deploy from it.** Rollback reference
  only, and `frontend/vercel.json` disables it explicitly.
