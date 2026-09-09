'use client';

/**
 * "Why?" — the conditionally-required sentence.
 *
 * The rule this exists to express, stated once instead of three times:
 * **statuses that dismiss demand a sentence and statuses that accept do not.**
 * "Rejected" on its own is a shrug; six months later nobody can tell a claim
 * that was checked and dropped from one that was never looked at, and that is
 * exactly the distinction a review stage exists to preserve.
 *
 * It was written for the review renderer's triage rows, and the
 * recommendations panel needs the identical control for the identical reason —
 * dismissing a recommendation is dismissing a finding. Rather than a third
 * copy of the markup, this is the second consumer of one component, and the
 * review renderer now imports it too.
 *
 * The field stays *visible* when empty rather than blocking the control that
 * revealed it: the row is simply not counted as resolved until the sentence
 * exists. Guidance is suggestive, not restrictive — the system says what is
 * missing and lets the user decide when to supply it.
 */

interface Props {
  /** Unique per row; used to bind the label. */
  id: string;
  /** "Why rejected?" — a question, not a noun. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** True when the sentence is required and absent. Rings the field. */
  missing: boolean;
  /** What the absence costs, in the caller's own terms. */
  missingMessage: string;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}

export function ReasonField({
  id,
  label,
  value,
  onChange,
  missing,
  missingMessage,
  disabled = false,
  placeholder = 'One sentence is enough.',
  rows = 2,
}: Props) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={missing}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-y rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40 ${
          missing ? 'ring-1 ring-[var(--pm-tertiary)]' : ''
        }`}
      />
      {missing && <p className="mt-1 text-label text-[var(--pm-tertiary)]">{missingMessage}</p>}
    </div>
  );
}
