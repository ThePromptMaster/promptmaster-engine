# Inheritance, conflict and scoped exceptions in PromptMaster: a technical note

*24 November 2026. A plain description of how PromptMaster handles requirements set at different levels, written so the client can pass it to patent counsel. It describes what the software does; it is not a legal opinion, and it makes no claim about what the provisional application covers.*

## The levels

Work is organised in nested containers: a workspace (a firm), a client inside it, an assignment (a search) inside the client, and further folders or individual projects inside that. Each container can hold facts, requirements and documents. A requirement can be marked **required**.

## Inheritance

When a project runs, the system gathers every rule and document from the containers above it, from the top down, and resolves which apply (`resolveInherited`):

1. Every current rule of every container in the project's chain applies, and is presented to the language model with the container it came from ("from the client folder …").
2. A rule set lower down replaces a default from above **only if it explicitly points at that default**. A lower rule that merely says something different replaces nothing.
3. A **required** rule can never be replaced from below. The database refuses a replacement that points at one.
4. A replacement or exception made in a container that is not in the project's own chain has no effect on it. A second assignment for the same client therefore keeps the client's rule, as does any new assignment.

## Conflict detection

When a rule is added to a container, or a fact is added to a project, a separate check compares it with the rules inherited from above. It returns each pair that cannot both hold, with the words of each side that conflict. The system keeps a pair only if both quotes are found word for word in their sources. A pair is recorded as an open conflict. Until the user resolves it:

- **Both sides are sent to the model marked unresolved**, with an instruction to rely on neither. The newer or deeper statement does not win.
- **Each project in scope determines which of its work depends on the conflict.** A second check names the workflow stages whose task turns on it, each with words from the stage's own description. Those stages are held.
- **The automated agent skips held stages and completes the rest.** It leaves the held stages open, never resolves the conflict itself, and does not declare the work finished while any conflict is open. If only held work remains, it stops and presents the choice.

## Resolution and the scoped exception

The user is shown both statements, each with where it was set, and chooses one of the following:

- **An exception scoped to the lower container** (for example "this assignment only"). Recording it requires three things: who authorised it, how the authorisation was confirmed, and the reason. The system records the exception, the rule it sets aside and the scope. The rule no longer applies anywhere in that scope, and still applies everywhere else, including in containers created later. The exception is never edited. Revoking it restores the rule.
- **A correction of the rule** where it is set, which changes it for everything below.
- **Following the inherited rule** in this place, which withdraws the conflicting statement.
- **A replacement of a non-required default** for this place.
- **Recording that the two do not conflict.**

When the conflict is resolved, the held work is released. Work drafted afterwards reflects the resolution. In the production test, a reference-check plan written after an exception stated that the firm runs the checks, named who authorised it and why, and said that it applied to that assignment only.

## Provenance and re-checking

Every version of the work records what it was made with:

- the workflow version and the stage instruction;
- the model;
- the project's facts and the inherited rules in force, each with its container;
- the exceptions that applied;
- the documents read.

The record cannot be changed after it is written. Each version also records a key for the set of inherited rules. When a rule changes at any container, the system finds the projects in scope whose finished work was made under an earlier key, without opening them, and lists them. When such a project is opened, a check decides which finished stages relied on the change, and only those are marked for re-checking. Earlier versions are kept.

## Templates with lineage

Workflows can be copied into containers. Each copy records the version it was copied from. When the master changes, the copy shows what changed. Taking the change in merges it stage by stage and field by field: where only the master changed, the master's version is taken; where only the copy changed, the copy's edit stays; where both changed the same field, the copy's edit is kept and the user is told. The result is the copy's next version. Projects already using the copy are offered the new version, and move to it only when the user chooses.
