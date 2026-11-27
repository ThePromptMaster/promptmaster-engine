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

- **Go-live status.** A plain statement of whether go-live is cleared. It is judged against D1's condition that the required training and QA are complete before go-live. The approved target remains Week 6 Friday. Dev's proposed Week 7 Tuesday go-live is unapproved.
- **Open prerequisites.** Each one named, with what it blocks.
- **Budget position.** Projected spend against the $18,000 approved under D2, with the remaining amount shown by arithmetic. D2 gives no delegated authority to raise the budget, so the packet must say whether any request would require her decision.
- **Her decisions.** The choices only she can make, kept apart from risks and from reported status. These include whether to approve a replacement go-live date, and how to cover training that the three remaining slots cannot hold.

### 2.2 Dev (operations lead)

Dev needs:

- **Session plan.** The plan by slot for slots 1–3 (Week 6 Monday through Wednesday), with North and East trainee counts.
- **Coverage per slot.** On-duty coverage for every slot, showing that North never drops below 8 and East never below 6.
- **Session-count proof.** Proof of the fewest sessions needed to train everyone, and of how many staff the three available slots can train.
- **Spare capacity.** Slots 4 and 5 are canceled, so no slot remains for make-up training. Under the "no one attends twice" rule, anyone not trained in slots 1–3 has no further session in the record.
- **Unassigned tasks.** Any operational task that the supplied facts do not assign to anyone, marked as not assigned rather than given to him.

## 3. Success tests

Each test passes or fails on inspection of the packet.

| # | Test | Pass condition | Basis |
|---|---|---|---|
| S1 | Structure | The four sections appear under their supplied names — Executive update; Detailed rollout and staffing plan; Readiness and customer handoff; Decision log — in that order, with no other top-level sections | Supplied |
| S2 | Executive update length | The Executive update is 95 words or fewer, counted on the final text | Supplied |
| S3 | Figure traceability | Every figure is either quoted from the supplied facts (12, 8, North minimum 8, East minimum 6, 6 trainees per session, slots 1–3 on Week 6 Monday–Wednesday, slots 4 and 5 canceled, $18,000, $12,000, $900, QA on Week 7 Monday, target Week 6 Friday, proposed Week 7 Tuesday) or derived from them with the arithmetic shown. No other figure appears | Supplied |
| S4 | Fewest sessions, proven | A lower bound is given for each site and in total, and the packet states that the three available slots fall short of it, showing how many staff remain untrained | Reasoned from supplied figures |
| S5 | Coverage held | In every scheduled slot, North on duty is at least 8 and East on duty is at least 6 | Supplied rule |
| S6 | Training before go-live | Every scheduled session falls in slots 1–3, Week 6 Monday through Wednesday. The packet states that these slots cannot train all 20 staff, so the training prerequisite is open and unmet | Supplied rule and slot dates |
| S7 | Go-live status follows D1 | Go-live is "not cleared" while training or QA is incomplete. QA on Week 7 Monday falls after Week 6 Friday, so D1's condition cannot be met for that date, and the packet says so. Week 7 Tuesday is shown only as Dev's unapproved proposal. No date is presented as achieved or assured | Supplied |
| S8 | Budget arithmetic | Spend is shown as fixed costs plus sessions × $900, then compared with $18,000, for the session count the packet uses | Supplied |
| S9 | No invented content | No decision, role, owner, date or commitment appears beyond the supplied facts. Unassigned work reads "Owner: to confirm". Where no approver is named, the log reads "Approver not specified" | Supplied |
| S10 | Decision log hygiene | Each logged decision states something approved or a rule about who may approve. Proposals, including Week 7 Tuesday go-live, are logged as unapproved requests. Reported figures and statuses are logged as status, not as decisions | Supplied |
| S11 | Cross-section consistency | Session count, untrained count, spend, remaining budget, QA date and status, go-live status, the proposed date and decision IDs are identical wherever they appear | Reasoned |
| S12 | Customer handoff | The notification is shown as a draft until go-live readiness is confirmed, and as not sent | Supplied |
| S13 | Authority limits | Only Mira approves go-live or a budget change. Go only revises internal documents and performs routine checks | Supplied |

### 3.1 Minimum proof that S4 must contain

**Release limit per session.** Each site can release only the staff above its on-duty minimum:

$$


\begin{aligned}
\text{North release} &= 12 - 8 = 4 \\
\text{East release} &= 8 - 6 = 2
\end{aligned}
$$

**Seats per session.** Sessions may mix North and East trainees (supplied). Releasable staff per session are \( 4 + 2 = 6 \), equal to the 6-trainee cap, so each session seats at most 6.

**Lower bounds on sessions to train everyone.**

$$
\left\lceil \tfrac{12}{4} \right\rceil = 3 \text{ North sessions}, \qquad \left\lceil \tfrac{8}{2} \right\rceil = 4 \text{ East sessions}, \qquad \left\lceil \tfrac{20}{6} \right\rceil = 4 \text{ sessions in total}
$$

The highest bound is 4 sessions. A 4-session schedule exists: North 4, 4, 4, 0 and East 2, 2, 2, 2, each session within the cap and the release limits. So 4 is the fewest sessions that train everyone (Reasoned).

**Available slots.** Only slots 1–3 remain, Week 6 Monday through Wednesday. With three sessions:

$$
\begin{aligned}
\text{North trainable} &= 3 \times 4 = 12 \\
\text{East trainable} &= 3 \times 2 = 6 \\
\text{East untrained} &= 8 - 6 = 2
\end{aligned}
$$

Schedule using all three slots: North 4, 4, 4 and East 2, 2, 2, giving 6 trainees per slot, North on duty 8 and East on duty 6.

**Budget.**

$$
\begin{aligned}
\text{Projected spend (3 sessions)} &= \$12{,}000 + 3 \times \$900 = \$14{,}700 \\
\text{Remaining} &= \$18{,}000 - \$14{,}700 = \$3{,}300 \\
\text{A 4th session} &= \$12{,}000 + 4 \times \$900 = \$15{,}600
\end{aligned}
$$

**Result.** Training everyone needs 4 sessions, but only 3 slots exist, so 2 East staff cannot be trained in the available slots and the training prerequisite under D1 is unmet. This follows from the supplied figures and rules; only a changed figure or rule, such as an additional slot, would change it. A 4th session would cost $15,600 in total, within the $18,000 approved under D2, but no slot for it appears in the supplied facts.

### 3.2 Failure patterns

The packet fails if it does any of the following:

- restates the brief without these tests;
- presents the three available slots as enough to train all 20 staff;
- reports any go-live date as achieved or cleared while QA is pending and training is undelivered;
- presents Week 7 Tuesday as an approved go-live date;
- treats the proposed session plan as approved;
- names an owner or approver whom the supplied facts do not name.

## 4. Scope boundary

This section sets the objective and the tests only. The following work belongs to later stages:

- listing the supplied facts and decisions;
- producing the working packet;
- checking the packet against S1–S13.