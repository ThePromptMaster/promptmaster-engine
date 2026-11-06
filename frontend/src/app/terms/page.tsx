'use client';

import { ContactLine, LegalPage } from '@/components/shared/legal-page';

/** Short, for a controlled beta, and awaiting counsel (L-187). */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="6 November 2026">
      <p>
        PromptMaster is run by PromptMaster LLC. By using it you agree to these terms. It is an early beta, offered so
        we can learn from how people use it.
      </p>

      <h2>Check what it gives you</h2>
      <p>
        PromptMaster uses AI models, and what they write can be wrong, including its figures and citations. Review
        anything before you act on it. It does not replace your own professional judgement, and it is not legal, financial
        or investment advice. Production-critical reliance is not intended.
      </p>

      <h2>Your work</h2>
      <p>
        What you put in and what you get out are yours. You are responsible for having the right to use what you put in,
        and for not entering confidential client material, personal data or credentials except where a feature asks for
        it and you choose to.
      </p>

      <h2>Using it fairly</h2>
      <p>
        Do not use it to break the law or to harm anyone, do not try to get around its limits or reach other people&apos;s
        data, and do not resell it. We may limit or end access if you do.
      </p>

      <h2>The beta</h2>
      <p>
        It is provided as it is, without warranties, and it will change. Features may come and go, and it may be
        unavailable at times. As far as the law allows, we are not liable for losses from using it.
      </p>

      <h2>Questions</h2>
      <p>
        Write to us through <ContactLine />.
      </p>
    </LegalPage>
  );
}
