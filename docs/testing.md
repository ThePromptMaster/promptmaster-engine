# Tests

Two unit suites, both fast and offline, plus a browser E2E suite that runs the
real stack with a scripted model. Counts below were produced by running them on
this branch.

| Suite | Command | Result | Time |
|---|---|---|---|
| Backend | `cd backend && pytest -q` | **292 passed** | ~2.5 s |
| Frontend | `cd frontend && npx vitest run` | **530 passed in 32 files** | — |
| Frontend build | `cd frontend && npm run build` | passes | — |
| Browser E2E | `cd frontend && npm run test:e2e` | see [E2E](#browser-e2e--playwright) | ~1 min incl. build |

*(Counts as of `phase2/wave1` including Lane A. They were 281 / 400-in-28 immediately
before that merge; quote them from a run, not from here.)*

`npm run build` **must pass before pushing**. CI (`.github/workflows/ci.yml`) runs
all of the above on every pull request; Vercel auto-deploy is not connected, so CI is
the only gate before a CLI deploy.

---

## Browser E2E — Playwright

`frontend/e2e/`, config in `frontend/playwright.config.ts`. It runs:

- a **real local Supabase** (`npx supabase start` — every migration applied to an
  empty database),
- the **real FastAPI app** with `PM_LLM_MODE=mock`, on port 8100,
- a **production build** of the frontend (`NEXT_DIST_DIR=.next-e2e`), on port 3100.

Only the model is replaced. `backend/promptmaster/mock_llm.py::ScriptedClient`
overrides the one network method of `OpenRouterClient`, so JSON cleaning and the
repair pass still run, and picks each reply by matching the real prompt constants.
`deps.llm_mode()` refuses mock mode when `VERCEL_ENV=production`.

**Fault injection.** Put a marker anywhere that reaches a prompt (an objective, a
section title): `[[mock:402]]` out of credits, `[[mock:429]]` rate limited,
`[[mock:500]]` provider error, `[[mock:length]]` truncated output,
`[[mock:slow=N]]` sleep N seconds. This is how recovery paths are driven from the UI.

Each run creates a fresh confirmed user in the local database (`e2e/global-setup.ts`,
which refuses any non-local Supabase URL) and signs in through the real login form.

**Every test records video and screenshots** into `frontend/test-results/`; CI uploads
them as the `playwright-evidence` artifact. They are the evidence attached to pull
requests.

```
npx supabase start                  # from the repo root, once
cd frontend && npm run test:e2e     # builds, starts both servers, runs
npm run test:e2e:report             # open the HTML report
```

`E2E_UVICORN` overrides the uvicorn binary (default `../backend/.venv/bin/uvicorn`).

---

## Backend — pytest

`backend/pytest.ini`: `testpaths = tests`, `asyncio_mode = auto`.

```
cd backend
pytest                                  # everything
pytest tests/test_long_form_router.py   # one file
pytest -k test_detect                   # one test by name
```

If `pytest` resolves to a Python without the dependencies, use
`~/.pyenv/versions/3.12.4/bin/pytest`.

**Tests never call OpenRouter.** `tests/conftest.py` supplies an `AsyncMock` client
plus `basic_inputs`, `good_evaluation` and `basic_iteration` fixtures. The suite needs
no network and no API key.

### What the backend suite is actually for

Because the client is a mock, asserting on model output would be asserting on the
fixture. So the tests assert on **what is sent**, not what comes back:

- **Prompt content** — `test_stage_prompts.py`, `test_long_form_prompts.py`,
  `test_conversation_prompts.py`, `test_research_stage_prompts.py`,
  `test_rating_signal_in_prompts.py`. These are the real regression net: they catch a
  refactor that silently drops the objective, the constraints, or the user's rating
  signal out of an assembled prompt.
- **Pipeline invariants** — `test_evaluator_completeness.py` covers the
  `finish_reason == "length"` → `completeness = incomplete` override;
  `test_engine_summary_wiring.py` the fan-out.
- **The auth property** — `test_auth.py` asserts that every router is included with
  `require_user`, so a new endpoint cannot ship unprotected by omission.
  `test_auth_worker.py` covers the `WORKER_SHARED_SECRET` credential.
- **Error classification** — `test_error_responses.py`, `test_error_taxonomy.py`.
- **Schema shape** — `test_schemas.py`.

**Adding an endpoint means adding a router test that asserts on prompt content.**
That is the convention; a test that only checks the status code adds nothing here.

## Frontend — vitest

```
cd frontend
npm test              # vitest run
npm run test:watch
npx vitest run src/stores/project-store.test.ts
```

Config: `vitest.config.mts` + `vitest.setup.ts`, with `@testing-library/react` and
`jest-dom`. Supabase modules are mocked with `vi.mock`; fake timers are used wherever
a debounce or poll is involved.

### The load-bearing frontend tests

Most of the suite is ordinary component and unit coverage. These four carry
architectural guarantees and should not be deleted casually:

| Test | Guarantees |
|---|---|
| `lib/workflow/seed-drift.test.ts` | The TypeScript templates and the generated seed migration agree. Without it, `gen:templates` output can silently diverge from what the database holds. |
| `components/workflow/renderers/renderers.test.tsx` | No renderer branches on which workflow it is — the property that makes a fourth workflow cheap. Also that an unbuilt renderer is *named* rather than falling through to prose. |
| `lib/jobs/drain.test.ts` | FR-05 end to end against an in-memory store: ten-section drafting, resume from a checkpoint, and that only one drain holds a project at a time. |
| `stores/project-store.test.ts` + `lib/supabase/projects.test.ts` | FR-21: the 800 ms debounce, field-patch accumulation, the revision guard, and both conflict resolutions. Indexed in [`saving-and-concurrency.md`](saving-and-concurrency.md). |

`lib/workflow/event-type-drift.test.ts` similarly pins the `workflow_events.type`
values against the CHECK constraint in the migration.

## What is not tested

Stated plainly, because these are the gaps that matter for acceptance:

- **E2E coverage is new and still thin.** The harness exists (above) and CI runs it;
  scenarios are being added feature by feature. Anything not listed in
  `frontend/e2e/` is still verified by hand.
- **No SQL test harness.** No pgTAP, no `supabase test db` wiring. Most trigger and
  RLS invariants in [`data-model.md`](data-model.md) are asserted by grepping
  migration text — which guards against the DDL being weakened, but does not prove a
  trigger *fires*. Nothing exercises the ten `SECURITY DEFINER` job functions against
  a real Postgres; the drain tests run against an in-memory fake.

  **One real SQL test exists**, `supabase/tests/fr02_proposal.sql`, covering the FR-02
  proposal boundary. Run it by hand against a database the migrations have been applied
  to:

  ```
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/fr02_proposal.sql
  ```

  It creates a throwaway user and project, asserts, and rolls back. It was last run on
  2026-09-09 against a fresh PostgreSQL with every migration replayed from empty — 10
  assertions, all passing, plus a negative control confirming the trigger rather than
  the foreign key is what enforces the rule. **CI now runs every file in
  `supabase/tests/`** against the migrated local database.
- **No load or concurrency testing** beyond the single-process drain test.

See [`known-limitations.md`](known-limitations.md).
