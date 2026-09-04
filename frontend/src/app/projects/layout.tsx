// Force dynamic rendering — project pages depend on Supabase runtime env vars.
export const dynamic = 'force-dynamic';

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[var(--surface)]">{children}</div>;
}
