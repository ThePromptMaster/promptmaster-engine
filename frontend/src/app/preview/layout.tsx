// Force dynamic rendering, for the same reason auth/ and projects/ do it: the
// preview renders the real components, and the real components construct a
// Supabase client from runtime env vars. Prerendering this at build time asks
// for that client before the variables exist, which is exactly how the first
// production build of this route failed once the dev-only guard came off.
export const dynamic = 'force-dynamic';

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
