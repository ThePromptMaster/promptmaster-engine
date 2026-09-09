/**
 * FR-16 as a user meets it.
 *
 * The unit tests next to `recovery.ts` prove the taxonomy is right; these prove
 * it reaches the screen. What stood here before was a single line of text and a
 * Draft button, so the thing worth asserting is that a user now sees a sentence
 * telling them their work is safe and a control that does something about the
 * failure they actually have.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecoveryPanel } from './recovery-panel';
import { stageFailure } from '@/lib/errors/recovery';
import { ApiError } from '@/lib/api/client';
import type { ErrorCode } from '@/lib/jobs/errors';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    api: {
      getModels: vi.fn().mockResolvedValue({
        models: [
          { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', context_length: 200000 },
          { id: 'openai/gpt-5.4', name: 'GPT-5.4', context_length: 400000 },
        ],
      }),
    },
  };
});

const PRESERVED = { savedVersions: 6, label: 'positioning statement' };

function failureFor(code: ErrorCode, message?: string) {
  return stageFailure(
    new ApiError(message ?? 'something went wrong', 502, {
      code,
      technical: 'LLM error: OpenRouter API error: HTTP 402',
    }),
    PRESERVED
  );
}

describe('the recovery panel', () => {
  it('leads with what survived, not with a status code', () => {
    render(
      <RecoveryPanel failure={failureFor('insufficient_credits')} onRetry={() => {}} />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was lost/);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /6 saved versions of the positioning statement/
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/HTTP 402/);
  });

  it('offers no retry when retrying cannot help', () => {
    render(
      <RecoveryPanel failure={failureFor('insufficient_credits')} onRetry={() => {}} />
    );
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('retries the thing that failed', async () => {
    const onRetry = vi.fn();
    render(<RecoveryPanel failure={failureFor('provider_unavailable')} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('calls the interrupted case resume, because that is what happens', () => {
    render(<RecoveryPanel failure={failureFor('function_timeout')} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /resume from where it stopped/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('hides the raw cause behind a disclosure rather than printing it', async () => {
    render(<RecoveryPanel failure={failureFor('unknown')} onRetry={() => {}} />);

    const details = screen.getByRole('button', { name: /technical details/i });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/HTTP 402/)).toBeNull();

    await userEvent.click(details);
    expect(screen.getByText(/HTTP 402/)).toBeTruthy();
  });

  it('gives advice for the cases only the user can fix, not a button', () => {
    render(<RecoveryPanel failure={failureFor('context_length')} onRetry={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/shorten the objective/i);
    // "Shorten" and "Split" are things the panel cannot do, so it does not
    // claim it can.
    expect(screen.queryByRole('button', { name: /^shorten the inputs$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^split the work$/i })).toBeNull();
  });

  it('switches the configured model for real', async () => {
    const onSwitchModel = vi.fn();
    render(
      <RecoveryPanel
        failure={failureFor('insufficient_credits')}
        onRetry={() => {}}
        onSwitchModel={onSwitchModel}
        currentModel="openai/gpt-5.4"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /switch model/i }));
    await userEvent.click(await screen.findByRole('combobox', { name: /model/i }));
    await userEvent.click(await screen.findByRole('option', { name: /claude sonnet/i }));

    expect(onSwitchModel).toHaveBeenCalledWith('anthropic/claude-sonnet');
  });

  it('offers no model switch on a surface that cannot save one', () => {
    render(<RecoveryPanel failure={failureFor('insufficient_credits')} onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: /switch model/i })).toBeNull();
  });

  it('lets a user stop rather than sit through a backoff', async () => {
    const onDismiss = vi.fn();
    render(
      <RecoveryPanel
        failure={failureFor('rate_limited')}
        onRetry={() => {}}
        onDismiss={onDismiss}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /stop for now/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
