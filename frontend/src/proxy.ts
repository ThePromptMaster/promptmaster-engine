import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/next-path';

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
    // Keep where they were going: a link to a project used to land on the
    // project list after signing in, not on the project.
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages, into the project list
  // (or where they were going). Not the callback, which may be mid-exchange,
  // and not the password reset, which is reached *with* a recovery session.
  const path = request.nextUrl.pathname;
  const passThrough = path.startsWith('/auth/callback') || path.startsWith('/auth/reset');
  if (path.startsWith('/auth') && user && !passThrough) {
    const next = safeNext(request.nextUrl.searchParams.get('next')) ?? '/projects';
    return NextResponse.redirect(new URL(next, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/projects/:path*', '/auth/:path*'],
};
