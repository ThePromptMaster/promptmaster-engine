'use client';

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-container-high)] border-t-[var(--pm-primary)]"
        role="status"
        aria-label="Loading"
      />
      {message && (
        <p className="text-body text-[var(--on-surface-variant)]">{message}</p>
      )}
    </div>
  );
}
