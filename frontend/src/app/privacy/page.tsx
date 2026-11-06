'use client';

import { ContactLine, LegalPage } from '@/components/shared/legal-page';

/**
 * Written from what the code does, not from a template. A change to what is stored
 * or where it goes changes this page in the same pull request. Google's review reads
 * it against the app (L-187), and counsel has not yet reviewed it.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="6 November 2026">
      <p>
        PromptMaster is run by PromptMaster LLC and is in early beta. This page says what it keeps, where
        your work goes, and what happens if you connect an account.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>Your account: your email address and name, or nothing at all if you use it as a guest.</li>
        <li>Your projects: what you write, what the AI writes for you, every version, the facts you accept, the files you attach, and your chats in a project.</li>
        <li>A record of each AI call: which step, how long it took, how many tokens and what it cost. Not the text.</li>
        <li>Errors, so we can fix them, and any feedback you send us.</li>
      </ul>

      <h2>Where it goes</h2>
      <ul>
        <li>Supabase stores your account, projects and files, and handles sign-in.</li>
        <li>Vercel hosts the app and runs any code a project asks to run, in a sandbox with no network.</li>
        <li>
          OpenRouter passes each AI step to the model provider that does the work. Each step sends only what
          that step needs. We ask OpenRouter to use only providers that do not keep what they are sent.
        </li>
        <li>If a project&apos;s Web access is on, what it searches for goes to the search behind OpenRouter&apos;s web tool.</li>
      </ul>
      <p>We do not sell your data, show you ads, or use your work to train any model.</p>

      <h2>Accounts you connect</h2>
      <p>
        Connecting an account is optional, and PromptMaster works fully without it. It is offered first to a small
        group of testers.
      </p>
      <ul>
        <li>
          <strong>What can be read.</strong> Google: your next 14 days of calendar events, the sender, subject and date
          of recent email (never the message itself), and only the Drive files you pick. Microsoft: your calendar, the
          sender, subject and date of recent email, and your files.
        </li>
        <li>
          <strong>How.</strong> Your browser reads your account directly. Access is held in that browser tab&apos;s
          memory until it expires or you close the tab. It is never stored and never sent to our servers.
        </li>
        <li>
          <strong>What leaves your browser.</strong> Only items you tick, and you see the exact text before it goes.
          Pressing Send passes that text to our server and on to the AI model to make a suggestion or a briefing.
        </li>
        <li>
          <strong>What is kept.</strong> Nothing for a suggestion. For a briefing, the items you ticked are saved on that
          project until you remove them or delete the project. We keep a note of which account you connected and when.
        </li>
        <li>
          <strong>Disconnecting.</strong> Do it in Settings, or from your Google or Microsoft account&apos;s permissions
          page. Disconnecting does not delete a briefing you made; Settings lists those so you can.
        </li>
      </ul>
      <p>
        PromptMaster&apos;s use and transfer of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" className="font-medium text-[var(--pm-primary)] hover:underline">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. That data is used only to give you the suggestion or briefing you asked
        for. It is not used for advertising, not sold, not read by people except where you ask us to or the law requires
        it, and not used to train any model.
      </p>

      <h2>Keeping and deleting</h2>
      <ul>
        <li>A project you delete can be restored for 30 days, and is then removed for good.</li>
        <li>To delete your account and everything in it, write to us. There is no button for this yet.</li>
        <li>A guest&apos;s work lives on one browser unless they create an account.</li>
      </ul>

      <h2>Your browser</h2>
      <p>
        We use cookies to keep you signed in and to remember your language, and your browser&apos;s storage for
        conveniences such as your colours and which notices you have dismissed. We do not use advertising cookies.
      </p>

      <h2>Questions</h2>
      <p>
        Write to us through <ContactLine />.
      </p>
    </LegalPage>
  );
}
