/**
 * Whether this user may connect an account (the client's call, 4 Nov).
 *
 * Connections are a pilot: `CONNECTIONS_PILOT_EMAILS` lists who may. Unset means no
 * one, as with every other list here. It stays a pilot until the beta notice, which
 * still tells people not to enter personal data, has been reviewed and reworded
 * (L-187), and for Gmail until Google's assessment. Google refuses unlisted accounts
 * anyway while its project is in Testing; this keeps them from being asked at all.
 *
 * Only tells the page what to offer. Nothing here is a security boundary: the token
 * lives in the user's browser and reads the user's own account.
 */
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { isPilotEmail } from '@/lib/connections/pilot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return NextResponse.json({ allowed: false });

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ allowed: false });
  return NextResponse.json({ allowed: isPilotEmail(data.user.email, process.env.CONNECTIONS_PILOT_EMAILS) });
}
