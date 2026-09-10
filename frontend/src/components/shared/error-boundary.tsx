'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * The fallback shown when a stage renderer throws.
 *
 * It used to import the shadcn Button and lean on the shadcn muted-foreground token,
 * which meant the one surface guaranteed to appear at the worst possible
 * moment — this wraps every renderer in the workspace — was the one surface
 * rendered in a foreign design system. It is on the tokens now, and separates
 * by tone rather than by the border it never had.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] items-center justify-center px-6">
          <div className="max-w-[420px] rounded-2xl bg-[var(--surface-container-low)] px-8 py-10 text-center">
            <span
              aria-hidden
              className="material-symbols-outlined text-[32px] text-[var(--pm-error)]"
            >
              error
            </span>
            <h2 className="mt-3 text-headline text-[var(--on-surface)]">Something went wrong</h2>
            <p className="mx-auto mt-2 text-body text-[var(--on-surface-variant)]">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-6 rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
