# Workspaces, inheritance and scoped exceptions: assessment

*24 November 2026. This answers the client's email of 23 November ("Inheritance & exceptions"). He wants a search firm's files, facts and requirements to carry across a whole client relationship: workspace → client folder → search folder → the work. He asks which pieces PromptMaster already supported, which were interface changes and which needed work underneath, and how inheritance and exceptions can be easy to see without managing settings. All of it except folder access was built and checked on production the same day (#779–#783). Folder access needs his decisions first.*

## What he asked for, and where it stood

| He asked for | Before 24 Nov | Kind of work | Now |
|---|---|---|---|
| Workspace › client › search › subfolder | Folders, three deep, holding only projects (L-102) | Underneath | Five deep, each a workspace, client, search or folder (L-279) |
| Facts, requirements and documents at each level, carried down | Only per project | Underneath | `folder_facts` and `folder_documents`, sent with every request below, each naming its folder (L-279) |
| See what a folder inherits, from where, what differs here | Nothing to see | Interface | One line per folder and per project; opened, each rule with its source (L-279) |
| A deeper folder replaces a default only with permission | Nothing | Underneath | Only by pointing at the default; a required rule can't be replaced below, and the database refuses it (L-279) |
| A required rule changes only by an explicit exception | Conflicts recorded an approver and a source, not a scope (L-263) | Underneath | `folder_exceptions`: what applies instead, who authorised it, how it was confirmed, why, and where (L-280) |
| A mismatch shows both sources; a newer note doesn't silently win | A later instruction won (`check-conflicts`) | Underneath | A separate check of the rules handed down; both sides shown and sent as unresolved until the user chooses (L-280) |
| Apply exception to this search; the next search keeps the default | Nothing | Underneath | Yes, and checked by hand: the other search and a new one keep the client's rule (L-280) |
| Pause the work that depends on it; continue the rest | Go stopped or went on with everything | Underneath | The stages that depend on it are held; Go does the rest and stops on the choice only when nothing else is left (L-280) |
| Copy and edit templates at any level; show the version a copy came from | A copy forgot its origin | Underneath | Folder workflows remember their master; edits make new versions (L-282) |
| Master changed: show what, let the team apply it to an active search | Only for built-in workflows | Underneath + interface | "The master has changed v1 → v3", what changed in words, apply to the copy keeping its own edits, then each project is offered it (L-282) |
| Document templates (contracts, report layouts) | Nothing | Underneath | A folder document kept as a template becomes a project's standard to match; a newer one is offered (L-282) |
| See what a run used: prompt version, transcript, requirements | Not recorded | Underneath | Every version records it; "What this used" shows it (L-281) |
| Jump to the transcript passage behind a finding | Nothing | Interface | Quotes found word for word open the document at that passage (L-281) |
| A required topic added mid-search: next review uses it, earlier reviews flagged, versions kept | Next draft only, within one project | Underneath | Every request carries it; the folder lists the projects with earlier work, and opening one marks what relied on it (L-281) |
| Respect folder access by role | Every row is one user's | Underneath, large | Not built: needs decisions (below) |

## Making it easy to see without managing settings

- Nothing has to be set to open a folder or a project. Each folder's rules are one collapsed line ("Client · 2 rules set here · 3 from above · 1 document"), and so is each project's ("From your folders: 1 from Workspace · 2 from Client · 1 different here").
- What needs the user opens by itself and stays visible until settled: a mismatch, and work made under earlier rules.
- Each rule names its folder everywhere it appears, including in what a version used, so nobody has to work out where a rule came from.
- Folder kinds only change words and icons ("Apply exception to this search"). They are suggested from the parent (a client under a workspace, a search under a client), so the tree reads like the firm without any configuration.

## Folder access: what needs deciding

Every table is private to its owner by design. The contract evidence relies on that, and so do the database's composite owner keys. Folder access means organisations, members and roles, and reworking every table's privacy rules around them. That is Exhibit B, Stage 3 (team adoption). On 29 October it was estimated at 40–60 hours, and now about 50–70 hours, because folders, rules, exceptions and templates also need sharing.

Decisions needed first:
1. **Roles.** Is recruiter, consultant and partner (who can see fees and signed agreements) enough? Is a role set per folder (this client), or for the whole workspace?
2. **Who can authorise an exception.** Anyone with edit rights on the search, or only named people (a partner, the client lead)? Today the authoriser is recorded as typed.
3. **Restricted documents.** Is it the document that is restricted (fee terms), or a whole folder? If a workflow run by someone without access would have used a restricted document, is the run refused, or does it go ahead without the document and say so?
4. **Defaults.** Does a new search inherit the client folder's access? Can a consultant see another consultant's projects in the same search?
5. **Leavers.** What happens to a departed member's projects, notes and exceptions?

A first version could be a single workspace with three roles and restricted documents, about 30–40 hours, before per-folder roles.

## Trying it

On the projects page, **Set up a sample search-firm workspace** (bottom of the folders list) makes an invented firm with one client, two searches, an exception in one, a transcript-review workflow with a client copy one version behind, and an interview review to run. The starter test runs on it as he described:
1. Open the Finance Director search. The client's reference rule shows as set aside by the recorded exception. Open the other search: the rule is in force.
2. Open the interview review and let Go run it to the end. "What this used" beside each version shows the workflow version, the rules by folder and the transcript; its quotes open the transcript.
3. Add a required topic to the Finance Director search (for example "Every interview covers the candidate's current bonus"). The search's panel then lists the review as work made under earlier rules. Open the review: the stages that relied on the topics are marked for a recheck, and their earlier versions stay.
