# First engagement: why testers leave, and what to try next (2026-11-06)

From the 4 Nov call: "Brainstorm ways to improve first-time engagement and time spent", and
"after the update, recruit more relevant business testers and assess engagement".

## The problem

Testers sign in, don't see what to do, and leave. One tester said the same thing in their own
words: they couldn't tell what the product does, and "Go" read like a typo on the landing page.

## What shipped for it

- Four business examples, public at `/examples`: try one on invented material with no account.
- A landing page that names the work (memos, deal screens, analyses, board decks), and says what
  Go does the first time it appears.
- A small Prompty bubble that offers an example or a start on the user's own work.
- Three short questions that order the examples.
- A "How people start" panel on `/admin`, so all this can be measured.

## How to read the numbers

The panel counts, for new and existing users, guests and accounts: examples started and
finished, own projects started, own projects started after an example, and first draft reached.
It excludes admins, and its counts come from rows the product already saves.

**The baseline, last 30 days, read from the panel on 6 Nov, before any tester had seen an example:**

| Way in | People | Projects | First draft | Used Go | Finished |
|---|---|---|---|---|---|
| Their own work, with an account | 13 | 27 | 15 | 11 | 3 (1 early) |
| Their own work, as a guest | 7 | 19 | 12 | 12 | 0 |

6 of the 21 people then on the panel came back on another day: these 20, plus one of our own test
guests on an example. The median first day lasted 12 minutes. Our test guests count, so the panel
moves as we test: later that evening it read 6 of 23 and 6 minutes.

Read it as a direction. There are few people, and the guest row includes our own production test
guests. It does match what the call described: about half of account projects never reach a first
draft, 3 of 27 finish, and roughly one person in four comes back.

The question that matters from here is the share of people who start an example and then start
their own project. Finishing an example only shows the example works. Starting their own project
shows it taught them something.

## What an example costs

Run on production on 6 Nov with "Let Go run this":

| Example | Model | Cost | Time, decisions included | Default model, for comparison |
|---|---|---|---|---|
| Deal screening | Opus 5.5 | $0.78 | 7 min | n/a |
| Slide deck | Opus 5.5 | $2.59 | 22 min | n/a |
| Investment memo | Sonnet 5.5 | $1.92 | 17 min | $5.23 |
| Business analysis | Sonnet 5.5 | $1.42 | 24 min | $4.14 |
| Meeting briefing (7 Nov) | Opus 5.5 | $2.12 | 13 min | n/a |

Accepting every major finding costs more each round (about $0.30 on Sonnet), and a tester decides when to stop. Each finished result is on its example's preview page, so a visitor can read one without an account.

## What to try next, in order

| Idea | Why | Effort | Moves which number |
|---|---|---|---|
| ~~Offer "Now do this on your own work" at the end of an example~~ | Shipped 7 Nov | | Own project after an example |
| A plain recap at the end: what was done, what was checked, and the file to take away | A tester who leaves with a file has a reason to come back and someone to show it to | 4–6 h | Finished, return visits |
| Recruit by the job on someone's desk, not by profession: "a memo or a deck due this month" | People with real work stay longer than people looking around. This is the cheapest test of all | The client | Own project started |
| Ask each new tester for one sentence after a first run: "What did you expect that didn't happen?" | The funnel says where people stop, not why | 2–3 h | Explains the rest |
| Count return visits and time per person on the panel | Time spent was the call's question, and the panel doesn't answer it yet | 3–5 h | Time spent |
| The walkthrough video, guided example and own-project help | Already priced in the reply. Only worth it if the numbers above stall | 8–30 h | First draft reached |

## Not yet

**Accounts and connections were taken out of this update.** The full research is in
`2026-11-07-accounts-and-connections.md`. In short:

- **Gmail and all of Drive** are Google "restricted" scopes: verification plus a yearly paid
  security audit. Until then, Testing mode allows at most 100 listed users.
- **Calendar read-only** is "sensitive", and **Drive files the user picks** is not sensitive at
  all, so those two are the cheap start.
- **Microsoft** needs no audit, but the consent screen says "unverified" until publisher
  verification, and some work accounts will be blocked. That matters because PE firms are often
  on Microsoft 365.
- **Yahoo Mail** needs a commercial agreement for IMAP, and I found no first-party MCP.
- **Other sign-ins:** Supabase supports custom OIDC providers, so Yahoo sign-in is possible
  without Yahoo Mail.

More external tools and MCP stay after that, as agreed on the call.
