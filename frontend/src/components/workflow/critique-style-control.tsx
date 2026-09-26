'use client';

import type { CritiqueIntensity, CritiqueTone } from '@/types';

/**
 * PM-21, Sean: "strong critique does not always need harsh wording; user
 * should be able to choose critique intensity / communication tone."
 *
 * Two dials, deliberately apart: how hard to look, and how to say what was
 * found. Stored on the project, so the stage check, Challenge, Reframe,
 * Self-audit and Go mode all read the same pair.
 */

const INTENSITY: { value: CritiqueIntensity; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Only what really matters' },
  { value: 'standard', label: 'Standard', hint: 'What a careful editor would raise' },
  { value: 'rigorous', label: 'Rigorous', hint: 'Every claim, number and step' },
];

const TONE: { value: CritiqueTone; label: string; hint: string }[] = [
  { value: 'gentle', label: 'Gentle', hint: 'Encouraging, strengths first' },
  { value: 'neutral', label: 'Neutral', hint: 'Plain and professional' },
  { value: 'direct', label: 'Direct', hint: 'Blunt, no padding' },
];

function Dial<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="text-label text-[var(--on-surface-variant)]">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-1 inline-flex flex-wrap gap-1 rounded-lg bg-[var(--surface-container-highest)] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1 text-label transition-colors disabled:opacity-60 ${
              value === o.value
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        {options.find((o) => o.value === value)?.hint}
      </p>
    </div>
  );
}

export function CritiqueStyleControl({
  intensity,
  tone,
  onChange,
  readOnly = false,
}: {
  intensity: CritiqueIntensity;
  tone: CritiqueTone;
  onChange: (patch: { critique_intensity?: CritiqueIntensity; critique_tone?: CritiqueTone }) => void;
  readOnly?: boolean;
}) {
  return (
    <section aria-label="How to critique" className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <Dial label="Critique intensity" options={INTENSITY} value={intensity} disabled={readOnly}
          onChange={(v) => onChange({ critique_intensity: v })} />
        <Dial label="Tone" options={TONE} value={tone} disabled={readOnly}
          onChange={(v) => onChange({ critique_tone: v })} />
      </div>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        Separate on purpose: intensity decides what gets found; tone only changes how it is said. Used by the stage check,
        Challenge, Reframe and Self-audit.
      </p>
    </section>
  );
}
