/**
 * Whether this user may simulate a failed check (4 Nov, Sean: "I'd also test
 * an empty check separately to verify that it reports the failure
 * accurately").
 *
 * Only tells the page whether to show the test switch. The switch itself is
 * enforced by the backend, against `SIMULATE_FAILURE_USER_IDS`; this route
 * answers from `ADMIN_USER_IDS`, through the same `requireAdmin` the admin
 * overview uses, and an unset list means no one.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const caller = await requireAdmin(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json({ allowed: true });
}
