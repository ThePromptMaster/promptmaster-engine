/**
 * Who may sign in with what (the client's call, 4 Nov: "we can't just assume people
 * use Google"). Google is live. The others show only once their app exists and
 * Supabase is configured for it, which is what `NEXT_PUBLIC_AUTH_PROVIDERS` says:
 * a button for a provider Supabase refuses is a dead end on the first screen.
 *
 * Yahoo has no built-in Supabase provider, so it is a custom OIDC one, which is why
 * its id has a prefix. This is signing in only. Reading anyone's mail is separate.
 */
export const PROVIDERS = ['google', 'azure', 'github', 'custom:yahoo'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_NAME: Record<ProviderId, string> = {
  google: 'Google',
  azure: 'Microsoft',
  github: 'GitHub',
  'custom:yahoo': 'Yahoo',
};

/** What each provider must be asked for. Supabase's Azure guide requires `email`, or the address comes back empty. */
export const PROVIDER_SCOPES: Partial<Record<ProviderId, string>> = {
  azure: 'email',
  'custom:yahoo': 'openid email profile',
};

/** Google first, always; then what the deployment has turned on, in a fixed order. */
export function enabledProviders(raw: string | undefined): ProviderId[] {
  const asked = (raw ?? '').split(',').map((p) => p.trim());
  return PROVIDERS.filter((p) => p === 'google' || asked.includes(p));
}
