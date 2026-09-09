# Phase 2 Functional Requirements (FR-01 – FR-23)

Verbatim from Exhibit A of the First Amendment to the Joint Development Agreement
(Phase 2). **This is contract text — do not paraphrase it here, and do not treat a
summary elsewhere in the repo as authoritative.**

Extracted into the repository on 2026-09-08, after an implementation pass had to stop:
FR-11 through FR-15 existed nowhere in the codebase, and the only surviving trace was
two paraphrase fragments in a migration comment. Requirements that live only in a
contract on someone's laptop get built from memory, which is how they get built wrong.

---


## FR-01 — Persistent Projects

Authenticated users can create, save, reopen, and manage multiple independent projects.

**Acceptance criteria**

Objective, audience, constraints, workflow, stage, artifacts, versions, evaluations, recommendations, and unresolved tasks survive refresh, logout, and later login.
A user can reopen a project from another supported browser session and see the same durable state.

## FR-02 — Deterministic Project State

The application and database maintain authoritative project and workflow state; model output may propose but does not silently own state transitions.

**Acceptance criteria**

Current stage, completed stages, skipped stages, deliberate skip reason, and stage history are stored as application data.
State-changing model output is validated and recorded before persistence.

## FR-03 — Declarative Workflow Engine

Workflow templates are stored as configurable data rather than separate hard-coded product paths.

**Acceptance criteria**

Book and Research templates operate using the same workflow engine.
A qualified developer or administrator can revise stage definitions through configuration or stored workflow data.

## FR-04 — Workflow-State Visibility

The interface clearly shows what phase the project and active artifact are in.

**Acceptance criteria**

Users can see current stage, completed and skipped stages, next suggested stage, remaining sections or tasks, and active generation state.
Long-form work visibly distinguishes planning, outlining, drafting, expansion, evaluation, revision, and final review.

## FR-05 — Queued or Resumable Long-Form Generation

Long-form generation is divided into persisted jobs or checkpoints rather than depending on one uninterrupted browser request.

**Acceptance criteria**

A ten-section test project can begin generation, preserve at least three completed sections, survive browser closure, and resume from an incomplete section.
Completed sections are not regenerated unless the user requests it.

## FR-06 — Long-Form Continuity Records

The system stores structured continuity records and supplies relevant records to later generation passes.

**Acceptance criteria**

Approved outline, section summaries, glossary terms, definitions, TODOs, continuity notes, references, and important decisions can be persisted.
A later section-generation request receives project-level context beyond only the immediately preceding section.

## FR-07 — Outline Management

Users can generate, directly edit, reorder, add, remove, regenerate, version, and approve outline items.

**Acceptance criteria**

Outline approval creates a visible workflow event.
Drafting uses the approved outline version.

## FR-08 — Conversational and Direct Editing

Users can directly edit artifacts and use AI to revise selected text, a section, or a full document subject to agreed technical limits.

**Acceptance criteria**

Selection-based revision creates a recoverable new version.
Section-level revision can be accepted, discarded, or restored.

## FR-09 — Apply-to-Output

A user can apply a recommendation or direct instruction to a defined scope without manually copying side-chat text.

**Acceptance criteria**

Supported scopes include selection, section, and full document where feasible.
The affected scope is shown before application and the prior version remains recoverable.

## FR-10 — Version Intelligence

Major revisions create recoverable version records with understandable provenance.

**Acceptance criteria**

Users can view and restore prior versions.
Versions include timestamp, source operation, instruction or recommendation, model where applicable, and a change summary or comparison.

## FR-11 — Evaluation Engine

A separate evaluation process assesses Alignment, Drift, Clarity, and Completeness.

**Acceptance criteria**

Each result includes a rating or score, concise explanation, associated artifact/version, and corrective recommendation when warranted.
Defined test artifacts with intentional defects trigger relevant findings.

## FR-12 — Drift and Realignment

Drift is compared against the objective, audience, constraints, approved outline, and current stage.

**Acceptance criteria**

When thresholds are crossed, the system offers a corrective recommendation.
Users may accept, modify, reject, or proceed without applying it.

## FR-13 — Context-Aware Recommendations

The interface surfaces a limited number of high-value Quick Actions, workflow recommendations, and contextual recommendations.

**Acceptance criteria**

An active project can display at least one workflow recommendation and one contextual or evaluation-driven recommendation where applicable.
Recommendations can be applied or dismissed.

## FR-14 — Recommendation Rationale

Workflow and contextual recommendations include a concise explanation of why the action is being suggested.

**Acceptance criteria**

The explanation identifies the triggering issue, relevant stage or objective, expected benefit, and affected scope where applicable.

## FR-15 — Multi-Select Refinement

Users can combine a limited number of compatible recommendations into one coordinated revision operation.

**Acceptance criteria**

Selected actions are visible and removable.
The combined instruction is visible, prior version is retained, and obvious conflicts trigger a warning where detectable.

## FR-16 — User-Facing Error Recovery

Common provider and job failures are translated into understandable recovery options.

**Acceptance criteria**

Insufficient credits, token/output limits, timeouts, rate limits, failed jobs, and interrupted work produce plain-language messages.
Available actions may include retry, shorten, split, switch configured model, resume saved progress, pause, or view technical details.

## FR-17 — Authentication and User Isolation

The system maintains authenticated access and database-level user isolation.

**Acceptance criteria**

A test user cannot retrieve another test user's projects or artifacts through the interface or authenticated API.
Provider keys remain server-side and protected.

## FR-18 — Usage and Cost Controls

The system logs provider usage and includes reasonable rate, generation-size, and insufficient-credit controls.

**Acceptance criteria**

Large jobs can trigger a warning where practical.
Provider-credit exhaustion is handled without exposing raw errors as the default experience.

## FR-19 — Operational Logging

Server-side logging supports diagnosis of authentication, model calls, background jobs, workflow transitions, and application errors.

**Acceptance criteria**

Moran receives reasonable visibility into failed jobs, major errors, and usage/cost information available from configured providers.

## FR-20 — Data Deletion and Export

Users can delete projects and export primary artifacts or core project data in agreed formats.

**Acceptance criteria**

Destructive deletion requires confirmation.
At least one text-based export format is supported; additional export formats, if any, will be identified through a Written Direction.

## FR-21 — Autosave and Edit Protection

Direct edits are persisted and accidental overwrite from stale browser state or multiple open tabs is addressed.

**Acceptance criteria**

The agreed autosave or save behavior is documented and testable.
Conflicting stale saves are prevented or clearly warned against.

## FR-22 — Beta Notice and Feedback

The controlled beta warns users not to enter sensitive information and collects lightweight real-world usage feedback.

**Acceptance criteria**

Notice states that the product is early beta, outputs require review, and production-critical reliance is not intended.
Feedback captures task/use case, value, confusion or blockage, and likelihood of reuse.

## FR-23 — Documentation and Administrative Control

Phase 2 includes technical documentation and the access needed for PromptMaster LLC to operate the product.

**Acceptance criteria**

Architecture, schemas, API boundaries, deployment, environment variables, job system, tests, limitations, and extension points are documented.
Repository, deployment, database, provider, logging, and other agreed administrative access is transferred or confirmed.
