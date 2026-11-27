# Alder Quay — Objective and Success

## 1. Objective

Build a reusable rollout packet for Alder Quay, a fictional six-week rollout of a scheduling product. The packet is for sponsor Mira and operations lead Dev. It uses only the facts the user supplied.

The packet has four labeled sections, in this order:

1. **Executive update.** Maximum 95 words.
2. **Detailed rollout and staffing plan.**
3. **Readiness and customer handoff.**
4. **Decision log.**

Decisions carry IDs. The four sections agree with each other on every figure, status and decision.

The packet is produced now as the working packet. Later updates in this project revise it, so its structure, IDs and status labels stay stable from one update to the next.

## 2. What each reader needs from the packet

### 2.1 Mira (sponsor)

Mira holds sole approval of go-live and of any budget change. She needs:

- **Go-live status.** A plain statement of whether Week 6 Friday go-live is cleared. It is judged against D1's condition that the required training and QA are complete before go-live.
- **Open prerequisites.** Each one named, with what it blocks.
- **Budget position.** Projected spend against the $18,000 approved under D2, with the remaining amount shown by arithmetic. D2 gives no delegated authority to raise the budget, so the packet must say whether any request would require her decision.
- **Her decisions.** The choices only she can make, kept apart from risks and from reported status.

### 2.2 Dev (operations lead)

Dev needs:

- **Session plan.** The plan by slot, with North and East trainee counts.
- **Coverage per slot.** On-duty coverage for every slot, showing that North never drops below 8 and East never below 4.
- **Session-count proof.** Proof that the session count is the fewest feasible, with any premise it rests on labeled.
- **Spare capacity.** How unused slots and the "no one attends twice" rule limit make-up training.
- **Unassigned tasks.** Any operational task that the supplied facts do not assign to anyone, marked as not assigned rather than given to him.

## 3. Success tests

Each test passes or fails on inspection of the packet.

| # | Test | Pass condition | Basis |
|---|---|---|---|
| S1 | Structure | The four sections appear under their supplied names — Executive update; Detailed rollout and staffing plan; Readiness and customer handoff; Decision log — in that order, with no other top-level sections | Supplied |
| S2 | Executive update length | The Executive update is 95 words or fewer, counted on the final text | Supplied |
| S3 | Figure traceability | Every figure is either quoted from the supplied facts (12, 8, 8, 4, 6, five slots, $18,000, $12,000, $900, Week 6 Thursday, Week 6 Friday) or derived from them with the arithmetic shown. No other figure appears | Supplied |
| S4 | Fewest sessions, proven | A lower bound and a schedule that meets it are given for each case. The premise that a session may mix North and East staff is labeled as an assumption. Without it, the fewest feasible count is 5 sessions | Reasoned; mixing is an assumption |
| S5 | Coverage held | In every scheduled slot, North on duty is at least 8 and East on duty is at least 4 | Supplied rule |
| S6 | Training before go-live | Every scheduled session falls before Week 6 Friday. The calendar position of the five slots is not supplied, so where slot timing is not stated, completion of training before go-live is flagged as an open prerequisite | Supplied rule; slot timing not supplied |
| S7 | Go-live status follows D1 | Go-live is "not cleared" while training or QA is incomplete. Week 6 Friday is never presented as achieved or assured | Supplied |
| S8 | Budget arithmetic | Spend is shown as fixed costs plus sessions × $900, then compared with $18,000, for the session count the packet uses | Supplied |
| S9 | No invented content | No decision, role, owner, date or commitment appears beyond the supplied facts. Unassigned work reads "Owner: to confirm". Where no approver is named, the log reads "Approver not specified" | Supplied |
| S10 | Decision log hygiene | Each logged decision states something approved or a rule about who may approve. Proposals are logged as unapproved requests. Reported figures and statuses are logged as status, not as decisions | Supplied |
| S11 | Cross-section consistency | Session count, mixing assumption, spend, remaining budget, QA status, go-live status and decision IDs are identical wherever they appear | Reasoned |
| S12 | Customer handoff | The notification is shown as a draft until go-live readiness is confirmed, and as not sent | Supplied |
| S13 | Authority limits | Only Mira approves go-live or a budget change. Go only revises internal documents and performs routine checks | Supplied |

### 3.1 Minimum proof that S4 must contain

**Release limit per session.** Each site can release only the staff above its on-duty minimum:

$$
\begin{aligned}
\text{North release} &= 12 - 8 = 4 \\
\text{East release} &= 8 - 4 = 4
\end{aligned}
$$

**Per-site lower bounds.** These hold in both cases:

$$
\left\lceil \tfrac{12}{4} \right\rceil = 3 \text{ North sessions}, \qquad \left\lceil \tfrac{8}{4} \right\rceil = 2 \text{ East sessions}
$$

**Case A — sessions may mix North and East staff (assumption, not supplied).**

- Seats: 4 + 4 = 8 releasable, so the 6-trainee cap binds and each session seats at most 6.
- Bound for all 20 trainees: ⌈20 / 6⌉ = 4. The highest bound is 4 sessions.
- Feasible schedule: North 4, 4, 4, 0 and East 2, 2, 2, 2. Each session has 6 or fewer trainees and releases no more than 4 from either site.
- Budget:

$$
\begin{aligned}
\text{Projected spend} &= \$12{,}000 + 4 \times \$900 = \$15{,}600 \\
\text{Remaining} &= \$18{,}000 - \$15{,}600 = \$2{,}400
\end{aligned}
$$

- Slots: 4 of 5 used, 1 spare.

**Case B — each session draws from one site only.**

- North needs 3 sessions and East needs 2: 3 + 2 = 5 sessions.
- Feasible schedule: North 4, 4, 4 and East 4, 4, one session per slot. Each session has 4 trainees, within the cap and the release limit.
- Budget:

$$
\begin{aligned}
\text{Projected spend} &= \$12{,}000 + 5 \times \$900 = \$16{,}500 \\
\text{Remaining} &= \$18{,}000 - \$16{,}500 = \$1{,}500
\end{aligned}
$$

- Slots: 5 of 5 used, none spare.

**Result.** The fewest feasible count is 4 sessions ($15,600) if sessions may mix sites, and 5 sessions ($16,500) if they may not. Both are within the $18,000 approved under D2. The packet states which case it uses and labels the mixing premise as an assumption wherever 4 sessions appears.

### 3.2 Failure patterns

The packet fails if it does any of the following:

- restates the brief without these tests;
- presents 4 sessions as the minimum without labeling the mixing assumption;
- reports Week 6 Friday go-live as achieved or cleared while QA is pending and training is undelivered;
- treats training as complete before go-live when slot timing is not stated, instead of flagging it;
- treats the proposed session plan as approved;
- names an owner or approver whom the supplied facts do not name.

## 4. Scope boundary

This section sets the objective and the tests only. The following work belongs to later stages:

- listing the supplied facts and decisions;
- producing the working packet;
- checking the packet against S1–S13.