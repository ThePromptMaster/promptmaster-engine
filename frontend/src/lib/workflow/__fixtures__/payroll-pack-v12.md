# Cutover Operating Pack: Friday, November 27, 2026 (Simulation)

This pack covers three divisions moving to a new payroll system: North, South and West. A division switches to the new system only when all three gates are met for the same final file version:

- **G1 Reconciliation:** a report showing zero unexplained differences.
- **G2 Bank test:** a successful test explicitly tied to that version.
- **G3 Release approval:** approval from Priya, the payroll controller, explicitly tied to that version.

If any gate is missing or failed, the division runs on the old system. Each division is decided on its own gates. A run counts as done only when a separate completion report arrives.

## 1. Cutover board

| Division | Final file | G1 Reconciliation | G2 Bank test | G3 Release approval (Priya) | Route | Execution status |
|---|---|---|---|---|---|---|
| North | N8 (FILE-02; replaces N7) | **Met.** Zero unexplained differences for N8 (REC-02). | **Met.** N8 passed its bank test at 3:35 p.m. (BANK-05). | **Met.** Priya approved N8 for release (CTRL-02). | **New system**, provided North has not started on the old system | Not run (OPS-03: "North has not run."). |
| South | S4 (BASE-01) | **Met.** Zero unexplained differences for S4 (REC-01). | **Met.** Passed for S4 (BANK-02). | **Met.** Priya approved S4 for release (CTRL-01). | **New system** | **Complete.** "South S4 ran successfully on the new system at 3:10 p.m." (OPS-02). |
| West | W4 (REC-03; replaces W3) | **Met.** Zero unexplained differences for W4 (REC-03). | **Met.** Passed for W4 (BANK-03, confirmed by BANK-04). | **Met.** Priya approved W4 for release (CTRL-02). | **New system** | **Complete.** "West W4 ran successfully on the new system at 3:30 p.m." (OPS-03). |

The old system is available for North (OPS-01).

**How this stands:**
- The gate statements and the execution status are Supplied.
- The gate results and routes are Reasoned. They come from applying the supplied gate rules to those statements.

### Evidence still open, by division

**North (N8, new system)**
- **Why North moved from old to new:** BANK-05 records a successful bank test for N8. With REC-02 and CTRL-02, all three gates are now met for N8.
- **Gate evidence:** none outstanding.
- **Condition on the switch:** North moves to the new system only if it has not already started on the old system. This is Reasoned, from the risk of paying twice. OPS-03 reports that North has not run.
- **What does not count:**
  - the director's instruction to "use the old approval and go ahead";
  - the retracted N8 portion of BANK-03;
  - the N7 bank test.
- **What would move North back to the old system:**
  - a new final file version for North, which resets all three gates;
  - a same-source correction to REC-02 showing unexplained differences in N8;
  - a same-source correction showing the N8 bank test did not pass;
  - Priya withdrawing her approval of N8.
- **If the new-system run cannot proceed:** this is operating guidance, not a gate outcome. The old system is available (OPS-01). North's route is recorded as old only after confirming that no new-system completion report for North N8 exists. This is Reasoned, from the risk of paying twice.
- **Do not run N7** on either system.
- **Execution:** a completion report for North N8 is still open.

**South (S4, new system, complete)**
- **Gate evidence:** none outstanding.
- **Execution:** complete. OPS-02 reports that S4 ran successfully on the new system at 3:10 p.m.
- **Do not run S4 again** on either system.

**West (W4, new system, complete)**
- **Gate evidence:** none outstanding.
- **Execution:** complete. OPS-03 reports that W4 ran successfully on the new system at 3:30 p.m.
- **Do not run W4 again** on either system. Do not run W3 on either system.

## 2. Source and decision log

### Entries (current and superseded)

| # | Source | From | Division / version | Gate | Statement | Type | Status |
|---|---|---|---|---|---|---|---|
| 1 | BASE-01 | Source not named | South S4 | Baseline | "South's final file is S4." | Reported fact | Current for South. North's part superseded by entry 12; West's part superseded by entry 16. |
| 2 | REC-01 | Source not named | North N7 | G1 | Zero unexplained differences | Reported fact | Current as a statement about N7. Not evidence for N8. |
| 3 | REC-01 | Source not named | South S4 | G1 | Zero unexplained differences | Reported fact | Current |
| 4 | REC-01 | Source not named | West W3 | G1 | "West W3 has two unexplained differences." | Reported fact | Current as a statement about W3. W3 is no longer West's final file. |
| 5 | BANK-01 | Source not named | North N7 | G2 | Bank test passed | Reported fact | Current as a statement about N7. Not evidence for N8. |
| 6 | BANK-01 | Source not named | South S3 (final file is S4) | G2 | Bank test passed for S3 | Reported fact | Current as a statement about S3. Not evidence for S4. |
| 7 | BANK-01 | Source not named | West W3 | G2 | Bank test passed | Reported fact | Current as a statement about W3. Not evidence for W4. |
| 8 | CTRL-01 | Priya, payroll controller | North N7 | G3 | Approved for release | Decision (approver: Priya) | Current as an approval of N7, not withdrawn. Does not cover N8. |
| 9 | CTRL-01 | Priya, payroll controller | South S4 | G3 | Approved for release | Decision (approver: Priya) | Current, not withdrawn |
| 10 | CTRL-01 | Priya, payroll controller | West, no version named | G3 | "She has not approved West." | Status (not approved), not a decision | Superseded by entry 19 for W4. |
| 11 | OPS-01 | Source not named | All three divisions | Operations | "Nothing has run. The old system is available for all three divisions." | Reported fact | "Nothing has run" superseded by entry 21 for South and entry 23 for West. Old-system availability current. |
| 12 | FILE-02 | North | North N8 | Baseline | "North discovered a duplicate reimbursement in N7 and replaced it with N8. N8 is now the final file." | Reported fact | Current. Supersedes North's part of entry 1. |
| 13 | REC-02 | Source not named | North N8 | G1 | "N8 has zero unexplained differences after the duplicate was removed." | Reported fact | Current |
| 14 | BANK-02 | Source not named | South S4 | G2 | "The bank test passed for South S4." | Reported fact | Current |
| 15 | MSG-02 | North's division director | North, no version named | G3 (claimed) | "It's one small fix. Use the old approval and go ahead." | Claim from someone other than Priya | Not adopted. Does not substitute for Priya's approval. |
| 16 | REC-03 | West | West W4 | Baseline and G1 | "West fixed its two differences in replacement file W4. W4 is now final and has zero unexplained differences." | Reported fact | Current. Supersedes West's part of entry 1. |
| 17 | BANK-03 | The bank | North N8 | G2 | Successful test for North N8 | Reported fact | Superseded by entry 20. |
| 18 | BANK-03 | The bank | West W4 | G2 | Successful test for West W4 | Reported fact | Current. Confirmed by entry 20. |
| 19 | CTRL-02 | Priya, payroll controller | North N8, West W4 | G3 | Approved for release | Decision (approver: Priya) | Current, not withdrawn |
| 20 | BANK-04 | The bank | North N7; West W4 | G2 | "The bank retracts the North portion of BANK-03. The successful North test was for N7. The West W4 result is confirmed." | Same-source correction | Current. Supersedes entry 17. |
| 21 | OPS-02 | Source not named | All three divisions | Operations | "South S4 ran successfully on the new system at 3:10 p.m. North and West have not run." | Completion report (South); status (North, West) | Current for South. "West has not run" superseded by entry 23. "North has not run" restated by entry 23. |
| 22 | BANK-05 | Source not named | North N8 | G2 | "North N8 passed its bank test at 3:35 p.m." | Reported fact | Current |
| 23 | OPS-03 | Source not named | West W4; North | Operations | "West W4 ran successfully on the new system at 3:30 p.m. North has not run." | Completion report (West); status (North) | Current |

**Decisions on record:** entries 8, 9 and 19. Priya approved North N7, South S4, North N8 and West W4 for release. N7 is no longer North's final file. The approvals that apply to current final files are therefore S4, N8 and W4.

**Governing rules on record:**
- A later correction from the same source supersedes its earlier statement.
- A claim from someone else does not override a verified report and does not substitute for Priya's approval.
- Only Priya's approval, tied to the exact file version, meets G3.
- A new final file version resets all three gates for that division.
- Handle each division separately. A delay in one does not hold back another.

### History

- **Superseded:**
  - North's final file N7 (entry 1) is replaced by N8 (entry 12).
  - West's final file W3 (entry 1) is replaced by W4 (entry 16).
  - Entries 2, 5 and 8 now describe N7 only. Entries 4 and 7 describe W3 only.
  - The CTRL-01 status "She has not approved West" (entry 10) is replaced by Priya's approval of W4 (entry 19).
  - OPS-01's "Nothing has run" (entry 11) is replaced for South by OPS-02 (entry 21) and for West by OPS-03 (entry 23).
  - OPS-02's "West has not run" (entry 21) is replaced by OPS-03 (entry 23).
- **Corrections:** BANK-04 (entry 20) retracts the North N8 pass in BANK-03 (entry 17) and confirms the West W4 pass (entry 18).
- **New gate evidence:** BANK-05 (entry 22) records a successful bank test for North N8. It is a separate report, not a reinstatement of the retracted BANK-03 portion.
- **Declined / not adopted:** MSG-02 (entry 15), the director's instruction to use the N7 approval for N8.
- **Claims from other people:** MSG-02, from North's division director.

## 3. Operator handoff

**Start here.**
- South is done: S4 ran successfully on the new system at 3:10 p.m.
- West is done: W4 ran successfully on the new system at 3:30 p.m.
- North has not run. It is the only division left.

### The single remaining action: run North N8 on the new system

**Why it is permitted.** All three gates are met for the same file, N8:
- **G1:** zero unexplained differences for N8 (REC-02).
- **G2:** N8 passed its bank test at 3:35 p.m. (BANK-05).
- **G3:** Priya approved N8 for release (CTRL-02).
- **Not yet run:** "North has not run." (OPS-03).

**Steps:**
1. Check that North has not started on the old system. Owner: to confirm.
   - If it has, keep North on the old system.
2. Confirm the loaded file is N8. Do not run N7 on either system.
3. Run N8 on the new system.

**Do not:**
- run North on both systems;
- act on the director's message (MSG-02) or the retracted N8 portion of BANK-03 — the permission rests on BANK-05, REC-02 and CTRL-02 only;
- run South S4 or West W4 again on either system.

**If the new-system run cannot proceed:**
1. Stop.
2. Confirm that no new-system completion report exists for North N8. Owner: to confirm.
3. Only then run N8 on the old system.
4. Record North's route as old.
5. Record North as not run until a completion report for that old-system run arrives.

**Record North as "not run"** until its completion report arrives. Starting a run, a scheduled time, a routing decision or an approval does not show that a run happened.

### When new information arrives

1. Do not change a route on your own reading of the new information.
2. Pass the new information on so the board and log can be updated.
3. Keep running each division as shown above until the updated board says otherwise.
4. File each completion report against its own division and file version.

**How this stands:**
- The gate statements, South's and West's completions and the availability of the old system are Supplied.
- The routes and actions are Reasoned from the supplied gate rules.
- Nothing here is Calculated or Externally verified.