# Tests

Two suites, both fast, both offline. Counts below were produced by running them on
this branch.

| Suite | Command | Result | Time |
|---|---|---|---|
| Backend | `cd backend && pytest -q` | **281 passed** (30 test files) | ~2.7 s |
| Frontend | `cd frontend && npx vitest run` | **400 passed in 28 files** | — |
| Frontend build | `cd frontend && npm run build` | passes | — |

`npm run build` **must pass before pushing**. There is no CI to catch it — see
[`known-limitations.md`](known-limitations.md).

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

- **No end-to-end harness.** No Playwright, no Cypress. Every walkthrough — including
  the Book and Research workflow demonstrations — was captured manually.
- **No SQL test harness.** The trigger and RLS invariants in
  [`data-model.md`](data-model.md) are asserted by grepping migration text. That
  proves the SQL *says* the right thing; it does not prove a trigger *fires*. Nothing
  exercises the ten `SECURITY DEFINER` job functions against a real Postgres — the
  drain tests run against an in-memory fake.
- **No CI.** There is no `.github/` directory and no workflow of any kind. Both suites
  and the build are run by hand.
- **No load or concurrency testing** beyond the single-process drain test.

See [`known-limitations.md`](known-limitations.md).
