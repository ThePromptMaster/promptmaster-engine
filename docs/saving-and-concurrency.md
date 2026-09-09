# Saving and concurrency

> **FR-21 — Save Integrity.** "The agreed autosave or save behavior is documented and
> testable. Conflicting stale saves are prevented or clearly warned against."

This document is the *documented* half. The *testable* half is 15 tests in
`frontend/src/stores/project-store.test.ts` and 9 in
`frontend/src/lib/supabase/projects.test.ts`, indexed at the end.

There is no Save button. Everything is written automatically, and this describes
exactly when.

---

## Two write paths, and they behave differently

| | Debounced path | Immediate path |
|---|---|---|
| What | Scalar edits to the `projects` row — title, objective, audience, constraints, model, format | Appends: new versions, restores, evaluations, ratings, stage summaries |
| Entry point | `patchProject(patch)` | `appendVersion`, `appendStageVersion`, `restoreVersion`, `recordStageEvaluation`, `setStageSummary`, `rateVersion`, `ensureStageArtifact` |
| Order | Local state first, network 800 ms later | **Network first**, local state only on success |
| Guarded by `revision` | Yes | No |

The ordering difference is deliberate. A debounced text edit must feel instant, so the
UI updates first and reconciles later. An append must not leave the UI showing a
version that does not exist, so it writes first and only then touches local state — if
the write fails, nothing appears to have happened, which is the honest outcome.

## The debounced path in detail

`frontend/src/stores/project-store.ts`.

```
DEBOUNCE_MS = 800
```

1. `patchProject({ title: 'x' })` applies the change to local state immediately and
   sets `saveState: 'saving'`.
2. It merges the change into a module-level `pendingPatch` and re-arms an 800 ms timer.
   Further edits inside that window merge into the same patch and push the timer out.
3. On fire, `flush()` snapshots `pendingPatch`, clears it, and calls
   `updateProject(id, patch, project.revision)`.

**It accumulates field patches, never whole snapshots.** The code says why:

```
// Accumulate field patches rather than whole snapshots — sending the whole
// object on a debounce is a lost-update generator when two fields are
// edited in different tabs.
```

A whole-snapshot write says "the project is exactly this", which silently reverts every
field the writer did not know about. A field patch says only "title is now x", so two
tabs editing *different* fields both succeed and neither loses.

`saveState` is `'idle' | 'saving' | 'saved' | 'conflict' | 'error'` and is what the
header indicator reads.

**On a non-conflict error** the patch is merged *back* into `pendingPatch` — as
`{ ...patch, ...pendingPatch }`, so anything typed since the failed attempt still wins
— and `saveState` becomes `'error'`. It is retried on the next edit or flush. There is
no timer-based retry and no backoff; a user who stops typing after a failed save has
their edit sitting in memory until they type again or the page flushes.

## The `revision` guard

`projects.revision` is a `bigint` bumped by a database trigger on every update
(see [`data-model.md`](data-model.md)). The client never sets it — a client that could
would echo its stale value back and defeat the whole mechanism, and a test asserts
`revision` never appears in an update payload.

`updateProject` in `frontend/src/lib/supabase/projects.ts`:

```ts
.update(patch).eq('id', id).eq('revision', knownRevision).select(FULL_COLUMNS).maybeSingle()
```

The guard is a **WHERE clause on the UPDATE**. If the revision has moved, the update
matches zero rows and writes nothing. The client then re-reads the row to tell the two
cases apart and throws:

```ts
throw new ProjectConflictError(current ? 'stale' : 'deleted', current);
```

`ProjectConflictError` (`frontend/src/types/project.ts`) carries `reason` and the
current server state. It is thrown in exactly one place and caught in exactly one
place. On success the store adopts the returned row — including its new `revision` —
so the next write is not stale.

**The guard covers `updateProject` only.** `softDeleteProject`, `restoreProject` and
`hardDeleteProject` issue unguarded updates, and the append path sends no revision at
all.

## What the user sees on a conflict

`saveState` becomes `'conflict'`, the header shows **"Changed elsewhere"**, and a
banner appears in the workspace:

> This project was changed in another tab.  \[Reload theirs] \[Keep my changes]

| Choice | What actually happens |
|---|---|
| **Reload theirs** | Clears the pending patch and re-reads the project. **The local edit is discarded outright** — there is no copy shown and no undo. |
| **Keep my changes** | Re-applies the local patch on top of the server row and flushes against the *server's* revision. A deliberate overwrite, chosen by the user. |

"Keep my changes" is field-scoped: only the keys the user actually edited are re-sent,
so the other writer's edits to *other* fields survive. Their edit to the *same* field
is overwritten. The banner does not name the conflicting fields or show a diff, so the
user is choosing without seeing what they would overwrite.

If a third write lands between the two attempts, it re-enters the conflict state
rather than looping.

## Flush on leaving the page

`frontend/src/lib/persistence/use-project-flush.ts`, mounted by the project page:

- `visibilitychange` → flush **only** when `document.visibilityState === 'hidden'`
- `pagehide` → flush unconditionally
- effect cleanup → flush again, covering a client-side route change or unmount

`beforeunload` is deliberately not used. Note honestly that `flush()` is `async` and
its promise is discarded: on a real unload there is no guarantee the request
completes. `sendBeacon` is not used. This is best-effort, and the 800 ms window is the
exposure — the realistic worst case is losing under a second of typing when a tab is
killed at exactly the wrong moment.

---

## Two tabs open

This is the case FR-21 is really about, so it is worth being precise rather than
reassuring.

**There is no realtime subscription and no polling on `projects`.** The only
`subscribe()` calls in the frontend are Supabase auth state; the only `setInterval` is
a 3-second poll of long-form job state in the long-form renderer. So:

1. Tab A and Tab B both load the project at revision 3.
2. Tab B edits the title. 800 ms later it writes with `revision = 3`, succeeds, the
   trigger bumps to 4, and Tab B adopts 4.
3. **Tab A shows the old title and still believes revision is 3, indefinitely.** No
   banner, no staleness indicator; `saveState` stays `'idle'`.
4. Tab A only finds out when *it* writes: the guard matches zero rows and the conflict
   banner appears.

**Conflict detection is write-triggered only.** A stale save is reliably prevented —
the database refuses it — which is the half FR-21 requires. But a user *reading* a
stale tab is never warned, and that is the honest limit of the current design.

Two further points:

- After Tab A resolves with "Keep my changes", **Tab B is still not notified.** It goes
  on displaying its own value until it next writes, at which point it gets its own
  conflict banner.
- **The append path has no cross-tab protection at all.** Two tabs appending versions
  concurrently each compute a version number from their own cached `version_count`.
  Within a single tab this is handled — `appendStageVersion` re-reads the artifact
  from the store first, because "a stale copy would write version 2 twice" — but
  across tabs the only thing standing in the way is the
  `unique (artifact_id, version_number)` index, which turns the second write into a
  raw error rather than a conflict banner.

Both are in [`known-limitations.md`](known-limitations.md).

## No rate limiting on the save path

The 800 ms debounce is the only thing bounding write frequency, and a debounce is not
a rate limit — a user alternating between two fields produces one write every 800 ms
indefinitely. `recordUsage()` exists in `frontend/src/lib/supabase/usage.ts` but has
**zero importers**; nothing meters project saves. The save path never reaches FastAPI,
so the backend's rate-limit handling does not apply to it.

---

## Test index (the "testable" half of FR-21)

`frontend/src/stores/project-store.test.ts` — **15 tests**, fake timers throughout,
crossing the debounce with `advanceTimersByTimeAsync(900)`.

*loadProject (2)* — hydrates project, artifact and versions; reports a missing project
instead of hanging in loading.

*patchProject (5)* — applies the edit locally straight away; debounces rather than
writing on every keystroke (three patches, one write); sends accumulated field
patches, not a whole snapshot; guards the write with the revision it loaded; adopts
the server revision so the next write is not stale; keeps the patch for retry when a
save fails.

*conflicts (3)* — surfaces a conflict rather than resolving it silently; reload
discards the local edit and rehydrates; keep-mine re-applies the local edit against the
newer revision.

*versions (5)* — appends a version and moves the head; does not touch local state when
the write fails; `setActiveVersion` only changes what is displayed; restore appends a
new head instead of rewinding.

`frontend/src/lib/supabase/projects.test.ts` — 9 tests, 7 covering `updateProject`:
revision match returns the row; the `.eq('revision', …)` guard is applied; **revision
is never in the payload**; a stale conflict when the row still exists; server state is
carried on the conflict; deleted is distinguished from stale; a real database error
propagates rather than being mislabelled a conflict.

**Not covered by tests:** `use-project-flush` (no test file exists), the `'deleted'`
conflict reason end-to-end, the stage-level append actions, and — because there is no
E2E harness — the two-tab behaviour described above, which was verified by reading the
code rather than by running two browsers.
