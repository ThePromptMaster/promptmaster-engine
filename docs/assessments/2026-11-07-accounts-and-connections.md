# Reading email, files and calendar: what it takes (2026-11-07)

From the 4 Nov call: opt-in access to someone's email and files, so PromptMaster can suggest real work and prepare a briefing for an upcoming meeting. This is what each provider requires, as read in November 2026. Nothing here is built. What shipped instead works from what people type or attach (see the end).

## The short version

**MCP does not get around any of this.** It changes how the calls are made, not whose approval is needed. Google's own Gmail MCP server [needs our OAuth client and `gmail.readonly`](https://developers.google.com/workspace/guides/configure-mcp-servers), and it is in Developer Preview. No Google page says this outright; it is a reading of those rules.

**Connector tools skip the audit only by using the vendor's Google app.** That moves the risk rather than removing it (see below).

| What | Possible | Approval | Cost and time | Who acts |
|---|---|---|---|---|
| Gmail, up to 100 named testers | Yes, with an "unverified" warning | None while in Testing | Free | John, testers' emails from Sean or Heather |
| Gmail, everyone | Yes | Google verification and a yearly security assessment | About $540–$5,400 a year, 2–3 months (estimate from assessor prices) | Sean's decision |
| Google Calendar, everyone | Yes | Free Google review | Up to 10 business days stated; one blog reports 4–6 weeks | John; needs privacy page, domain check, demo video |
| Drive, files the user picks | Yes | No audit | Free | John |
| Microsoft sign-in | Yes | Self-serve; "unverified" until publisher verification | Free | John |
| Outlook and OneDrive | Personal accounts should work (untested). New work tenants need their admin | Publisher verification, then each company's admin | Free; partner check 3–5 business days | PromptMaster LLC, then each customer's IT |
| Yahoo mail | Not practical | Application form and a commercial agreement | Unknown | Not worth pursuing |
| LinkedIn sign-in | Yes | Company page and a product request | Free | Sean or John |

## Google

- **Scopes.** [Gmail's read scopes are restricted](https://developers.google.com/workspace/gmail/api/auth/scopes), including `gmail.metadata`, which reads headers only. So are [`drive.readonly` and `drive.metadata.readonly`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). `drive.file` is non-sensitive. Calendar is sensitive per [Nylas](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/); Google's [page](https://developers.google.com/workspace/calendar/api/auth) implies it without a per-scope label.
- **The audit.** [Yearly, by an authorized lab](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Google charges nothing. Lab prices: [TAC](https://tacsecurity.com/google-casa-cloud-application-security-assessment/) $675–$855 at the lower level and $5,400 at the higher one; [one company paid $540](https://meetorbis.com/blog/how-we-passed-google-casa-tier-2-with-claude) in February 2026. Sources disagree: [Unipile](https://www.unipile.com/integrating-google-oauth-2-0-user-authentication-into-your-app/) cites $15,000–$75,000 for older apps. Google's stated [timeline is 6 weeks](https://support.google.com/cloud/answer/13463817); plan on 2–3 months.
- **No exemption for approved text.** The trigger is [data reached "from or through" a server](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Reading in the browser but sending what the user ticks through our server to a model still counts. That is our reading.
- **Testing mode.** [Up to 100 listed test users](https://support.google.com/cloud/answer/15549945), with a warning screen and [refresh tokens that expire in 7 days](https://developers.google.com/identity/protocols/oauth2). An unverified production app is capped at [100 users over the project's whole life, and that can't be reset](https://support.google.com/cloud/answer/15549945). Exhausting it can [disable Google sign-in](https://support.google.com/cloud/answer/13463817).
- **Keep sign-in safe.** Use new Google projects, not the sign-in one, and a separate project for Gmail so it can't hold up Calendar's review. The cost is that a Gmail tester grants consent twice. No Google page says to do this; it follows from [unapproved scopes causing "Sign-in disabled"](https://support.google.com/cloud/answer/13463817).
- **AI rules.** The [Workspace policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) bars training on this data beyond the user's own personalized model, requires tokens encrypted at rest and **protection against prompt injection**, and lists "generative AI summaries" as an approved Gmail use. Inbox mining for workflow suggestions fits less clearly than briefings, which matters if the audit goes ahead. No page we found names third-party LLM providers or requires zero retention.
- **Admins.** A Workspace admin [can block or limit third-party apps](https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data). The default allows them. How often this hits business users is unknown.
- **Google's own MCP servers.** [Gmail, Drive and Calendar endpoints exist in Developer Preview](https://docs.cloud.google.com/mcp/supported-products). The [preview terms](https://developers.google.com/workspace/preview) bar public apps before general availability. Not usable yet.

## Microsoft

- **Scopes.** [`Mail.ReadBasic`, `Mail.Read`, `Calendars.Read` and `Files.Read`](https://learn.microsoft.com/en-us/graph/permissions-reference) are user-consentable in principle, including on personal accounts.
- **The block.** Microsoft's [default policy for new tenants](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies) excludes `Mail.Read`, `Mail.ReadBasic`, `Calendars.Read`, `Calendars.ReadBasic`, `Files.Read.All` and `Sites.Read.All` from what users can approve themselves. `Files.Read` isn't listed, so it may work; that needs testing. What share of existing tenants is on this policy is unknown. Private equity firms are often on Microsoft 365, so plan for IT approval as the normal route, with uploads as the fallback.
- **Publisher verification.** [Free](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview). It needs a verified AI Cloud Partner Program ID, a work account in a linked tenant, and a domain matching the partner email. [Partner checks usually take 3–5 business days](https://learn.microsoft.com/en-us/partner-center/enroll/understand-the-verification-process). `promptmasterv1.com` only has mail forwarding today, and we couldn't confirm Microsoft accepts that.
- **No audit found.** [Microsoft 365 Certification](https://learn.microsoft.com/en-us/microsoft-365-app-certification/overview) is optional, though "in some cases" a tenant may require it.
- **Microsoft's MCP.** [Work IQ MCP](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview) is generally available, but needs a [Global Admin and a billing plan](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq) on the customer's side, and [`WorkIQ.Read` requires admin consent](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions). The separate mail, calendar and OneDrive servers are preview and not for production. It removes no consent step.

## Yahoo, AOL, iCloud

- **Mail.** [Scopes are not self-serve](https://senders.yahooinc.com/developer/developer-access/): apply by form, then [a Commercial Access Agreement](https://developer.nylas.com/docs/dev-guide/provider-guides/yahoo-authentication/). Cost and time are unknown.
- **App passwords.** Possible, but [Yahoo's terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) and [iCloud's](https://www.apple.com/legal/internet-services/icloud/) bar this kind of automated access, and it isn't reasonable to ask of a business user.
- **"Yahoo has an MCP."** What the call found is probably the [Yahoo DSP server](https://help.yahooinc.com/dsp-api/docs/yahoo-dsp-mcp-server), which is for advertising. We found no first-party mail MCP; the community ones use app passwords.
- **Sign-in works.** Yahoo's [published configuration](https://api.login.yahoo.com/.well-known/openid-configuration) supports it through a Supabase custom provider, now live.

## Connector tools

| Tool | Whose Google app | Content | Low-volume price |
|---|---|---|---|
| Composio | [Theirs: "says Composio" on the consent screen](https://composio.dev/content/ship-gmail-integration-in-minutes) | Transits; [logs kept up to a year](https://docs.composio.dev/docs/security/data-retention) unless zero retention is on | [Free, Pro $29/mo](https://composio.dev/pricing) |
| Nylas | [Theirs; claims to avoid the audit](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/) | [IMAP cached 90 days](https://www.nylas.com/pricing/); Google retention unknown | [$43/mo + $2,400/yr](https://www.nylas.com/pricing/) |
| Arcade | [Shared, but they "strongly recommend" your own](https://docs.arcade.dev/en/home/auth-providers/google) | Proxied | [$25/mo + $0.01/call](https://www.arcade.dev/pricing) |
| Pipedream Connect | [Depends on the use case](https://pipedream.com/docs/connect/managed-auth/oauth-clients) | Transits | [$99–150/mo](https://pipedream.com/pricing) |
| Nango | [Yours for production Gmail](https://nango.dev/docs/api-integrations/google-mail/how-to-register-your-own-gmail-api-oauth-app) | Transits | [$50/mo + $0.29 per connection](https://nango.dev/pricing) |
| Vercel Connect | [Yours](https://vercel.com/docs/connect) | [Short-lived tokens only](https://vercel.com/docs/connect/concepts/authentication) | [$3 per 1,000 requests](https://vercel.com/docs/connect/pricing) |

Google's policies don't mention shared apps, so whether they are allowed is unsettled. Its data policy requires requests to ["accurately represent the identity of the application"](https://developers.google.com/terms/api-services-user-data-policy), which sits awkwardly with one. We found no case of a shared client being cut off. **Decision, 6 Nov: our own app, testers first.** Private equity testers shouldn't see a vendor's name on Google's screen with their mail passing through that vendor.

## MCP the other way round

PromptMaster could be an MCP server, so someone's own Claude or ChatGPT, which already holds their Gmail connection, passes content in. It needs no Google or Microsoft approval. [Claude allows custom connectors on all plans](https://support.claude.com/en/articles/11175166) (one on Free); sources disagree on which ChatGPT plans do. But it works only when the user asks, so it can't greet them with suggestions, and Gemini users can't use it. **Left out for now by decision.**

## If email text ever reaches a model

- Prompt injection is real and unsolved: [EchoLeak](https://cveawg.mitre.org/api/cve/CVE-2025-32711), [ShadowLeak](https://therecord.media/openai-fixes-zero-click-shadowleak-vulnerability), and the UK NCSC says it ["may never be totally mitigated"](https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection). The closed PR #534 holds the channel for it: a fenced block, no web search while it's present, and remote images not drawn.
- OpenRouter's [`zdr: true`](https://openrouter.ai/docs/guides/features/zdr) rules out first-party Anthropic and OpenAI. Checked on 6 Nov against its [list](https://openrouter.ai/api/v1/endpoints/zdr): Opus, Sonnet and Haiku 5.5 run on Bedrock and Google, and GPT-5.6 on Azure.
- The beta notice tells people not to enter personal data or confidential client material, and the contract requires counsel to review it. It has to change before any of this opens past a named pilot.

## What already exists

The closed PRs stay reachable by commit: #535 privacy and terms (`fb5ab402`), #534 the third-party channel (`37421349`), and #537 the Google flow, read in the browser with the token held in memory (`9ce576f1`). #537 has never run against a real Google project. Microsoft's connection and the briefing from connected accounts were never built.

## What shipped instead, 7 Nov

- GitHub and Yahoo sign-in.
- "Suggest work for me", from what someone types or attaches.
- A meeting briefing example, with `.ics` and `.eml` uploads.
- Prompty naming a few examples.
- An offer to use the workflow on your own work when an example finishes.
