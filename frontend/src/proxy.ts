import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/server';

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh session (important: must call getUser to refresh)
  const { data: { user } } = await supabase.auth.getUser();

  // Protect /projects — redirect to login if not authenticated. /session is no
  // longer listed: it is a bare redirect into /projects now, and gating it
  // would send a signed-out visitor to login and then bounce them through a
  // dead route instead of the destination they can actually be shown.
  const isProtected = request.nextUrl.pathname.startsWith('/projects');
  if (isProtected && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages, into the project list.
  if (request.nextUrl.pathname.startsWith('/auth') && user) {
    return NextResponse.redirect(new URL('/projects', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/projects/:path*', '/auth/:path*'],
};
