'use client';

import { ContactsPart } from '@/components/outreach/contacts-part';
import { DraftsPart } from '@/components/outreach/drafts-part';
import { MessagePart } from '@/components/outreach/message-part';
import { useT } from '@/lib/i18n/i18n-provider';
import type { StageRendererProps } from './types';

/**
 * An Outreach stage (26 Nov): the contacts, the standard message, or the drafts, as the stage's
 * own data says (`stage.outreach.part`). Never which workflow it is.
 */
export function OutreachRenderer({ stage, outreach, readOnly }: StageRendererProps) {
  const t = useT();
  if (!outreach || !stage.outreach) {
    return <p className="rounded-xl bg-[var(--surface-container-low)] px-6 py-8 text-body text-[var(--on-surface-variant)]">{t('outreach.notWired')}</p>;
  }
  const props = { context: outreach, stageId: stage.id, readOnly: Boolean(readOnly) };
  switch (stage.outreach.part) {
    case 'contacts':
      return <ContactsPart {...props} />;
    case 'message':
      return <MessagePart {...props} />;
    case 'drafts':
      return <DraftsPart {...props} />;
  }
}
