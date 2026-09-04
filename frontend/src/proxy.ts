import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/server';

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh session (important: must call getUser to refresh)
  const { data: { user } } = await supabase.auth.getUser();

  // Protect /session and /projects — redirect to login if not authenticated
  const isProtected =
    request.nextUrl.pathname.startsWith('/session') ||
    request.nextUrl.pathname.startsWith('/projects');
  if (isProtected && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages, into the project list.
  // /session still works during the migration, but it is no longer where a
  // signed-in user lands.
  if (request.nextUrl.pathname.startsWith('/auth') && user) {
    return NextResponse.redirect(new URL('/projects', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/session/:path*', '/projects/:path*', '/auth/:path*'],
};
