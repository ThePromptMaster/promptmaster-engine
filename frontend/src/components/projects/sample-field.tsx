'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { INPUT_LIMITS, withinLimit } from '@/lib/projects/input-limits';

/**
 * A sample of what good looks like (4 Nov, Sean: "For specialized work, we
 * could test an optional field for source material or a sample output. That
 * would give the app a concrete standard for depth and style when the user
 * wants one" — after Jordan's niche science talk "lacked the nuance he
 * needed"). Folded until wanted; every writer is told to match its depth and
 * style, never to take its facts.
 */
export function SampleField({
  value,
  onChange,
  fieldClass = '',
  labelClass = '',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  fieldClass?: string;
  labelClass?: string;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <details data-sample-field open={value.trim() ? true : undefined}>
      <summary className={`cursor-pointer ${labelClass || 'text-label text-[var(--pm-primary)]'}`}>
        {t('sample.label')} <span className="ms-1 normal-case tracking-normal text-[var(--outline)]">{t('setup.optionalTag')}</span>
      </summary>
      <p className="mb-2 mt-1 text-label text-[var(--on-surface-variant)]">{t('sample.hint')}</p>
      <textarea
        value={value}
        disabled={disabled}
        rows={value ? 8 : 3}
        aria-label={t('sample.label')}
        placeholder={t('sample.placeholder')}
        onChange={(e) => onChange(withinLimit('sample_output', e.target.value))}
        className={`${fieldClass || 'w-full rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 text-body text-[var(--on-surface)] outline-none'} max-h-96 resize-y overflow-y-auto`}
      />
      {value.length > 0 && (
        <p className="mt-1 text-end text-label text-[var(--outline)]">
          {value.length.toLocaleString()} / {INPUT_LIMITS.sample_output.toLocaleString()}
        </p>
      )}
    </details>
  );
}
