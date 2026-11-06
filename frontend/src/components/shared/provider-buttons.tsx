'use client';

import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { authErrorMessage } from '@/lib/auth/auth-errors';
import { forgetResetRequest } from '@/lib/auth/next-path';
import { PROVIDER_NAME, enabledProviders, type ProviderId } from '@/lib/auth/providers';
import { useT } from '@/lib/i18n/i18n-provider';

function ProviderMark({ provider }: { provider: ProviderId }) {
  if (provider === 'google') {
    return (
      <svg fill="none" height="18" viewBox="0 0 24 24" width="18" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    );
  }
  if (provider === 'azure') {
    return (
      <svg height="18" viewBox="0 0 24 24" width="18" aria-hidden="true">
        <path d="M2 2h9.5v9.5H2z" fill="#F25022" />
        <path d="M12.5 2H22v9.5h-9.5z" fill="#7FBA00" />
        <path d="M2 12.5h9.5V22H2z" fill="#00A4EF" />
        <path d="M12.5 12.5H22V22h-9.5z" fill="#FFB900" />
      </svg>
    );
  }
  if (provider === 'github') {
    return (
      <svg height="18" viewBox="0 0 24 24" width="18" aria-hidden="true" fill="currentColor">
        <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.26.82-.577 0-.285-.01-1.04-.015-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.93 0-1.31.467-2.38 1.235-3.22-.124-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.118 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.625-5.48 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .32.216.694.825.576C20.565 22.296 24 17.797 24 12.5 24 5.87 18.627.5 12 .5z" />
      </svg>
    );
  }
  return (
    <span aria-hidden className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-[#6001D2] text-[10px] font-bold leading-none text-white">
      Y!
    </span>
  );
}

/**
 * Signing in with another account, on the login and sign-up pages. Where someone
 * was going is remembered by the hook before they leave.
 */
export function ProviderButtons({
  providers = enabledProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS),
  onError,
}: {
  providers?: readonly ProviderId[];
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const { signInWithProvider } = useAuth();
  const [leaving, setLeaving] = useState<ProviderId | null>(null);

  async function go(provider: ProviderId) {
    onError(null);
    setLeaving(provider);
    // This also lands on the callback; it is not a password reset.
    forgetResetRequest();
    try {
      await signInWithProvider(provider);
    } catch (err) {
      onError(authErrorMessage(err, 'auth.err.provider', { provider: PROVIDER_NAME[provider] }));
      setLeaving(null);
    }
  }

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={leaving !== null}
          onClick={() => void go(provider)}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-[var(--surface-container-low)] text-[var(--on-surface)] text-body font-medium rounded-lg hover:bg-[var(--surface-container-high)] transition-colors disabled:opacity-60"
        >
          <ProviderMark provider={provider} />
          {leaving === provider ? t('auth.redirecting') : t('auth.signInWith', { provider: PROVIDER_NAME[provider] })}
        </button>
      ))}
    </div>
  );
}
