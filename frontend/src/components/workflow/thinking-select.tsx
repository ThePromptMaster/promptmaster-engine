'use client';

/**
 * How PromptMaster thinks (26 Nov, Sean: "The way it thinks should have an
 * option to choose what way to think or have PromptMaster whatever it thinks
 * best"). One select, at setup and on every stage: "Let PromptMaster choose
 * for each step" first, then the modes, each applied to every step.
 *
 * The choice is `stage_modes`: 'stage' when PromptMaster chooses, 'project'
 * with `mode` when the user picked one way. Nothing new reaches the backend:
 * every request is sent the mode its stage resolves to (`stage-mode.ts`).
 */

import { MODE_DISPLAY } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { shownModeName } from '@/lib/i18n/stage';
import { templateWord } from '@/lib/i18n/templates';
import type { ModeType } from '@/types';

export const THINKING_AUTO = 'auto';
/** The modes a user may pick: their own persona (`custom`) is kept only when it is already theirs. */
export const PICKABLE_MODES = (Object.keys(MODE_DISPLAY) as ModeType[]).filter((m) => m !== 'custom');

export interface ThinkingChoice {
  mode: ModeType;
  stage_modes: 'stage' | 'project';
}

/** The select's value for a project or draft: 'auto' when PromptMaster chooses. */
export function thinkingValue(choice: { mode: ModeType; stage_modes?: 'stage' | 'project' | null }): string {
  if (choice.mode === 'custom') return 'custom';
  return choice.stage_modes === 'project' ? choice.mode : THINKING_AUTO;
}

/**
 * The patch a picked value makes. Back to "PromptMaster chooses", the mode left
 * is the fallback for a step with none of its own: `fallback` when given (the
 * setup suggester's pick), else the one in use.
 */
export function thinkingPatch(value: string, current: ModeType, fallback?: ModeType): ThinkingChoice {
  if (value === THINKING_AUTO) return { mode: fallback ?? current, stage_modes: 'stage' };
  return { mode: value as ModeType, stage_modes: 'project' };
}

export function ThinkingSelect({
  id,
  value,
  onChange,
  withCustom = false,
  className = '',
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** The user's own persona is theirs already: shown so the select can say so. */
  withCustom?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={className}>
      <option value={THINKING_AUTO}>{t('think.auto')}</option>
      {withCustom && <option value="custom">{t('think.customOption')}</option>}
      <optgroup label={t('think.everyGroup')}>
        {PICKABLE_MODES.map((m) => (
          <option key={m} value={m}>
            {shownModeName(m, MODE_DISPLAY[m].display_name)} — {templateWord(locale, MODE_DISPLAY[m].tagline)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
