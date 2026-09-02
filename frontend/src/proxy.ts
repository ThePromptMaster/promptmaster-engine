import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/server';

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh session (important: must call getUser to refresh)
  const { data: { user } } = await supabase.auth.getUser();

  // Protect /session route — redirect to login if not authenticated
  if (request.nextUrl.pathname.startsWith('/session') && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (request.nextUrl.pathname.startsWith('/auth') && user) {
    const sessionUrl = new URL('/session', request.url);
    return NextResponse.redirect(sessionUrl);
  }

  return response;
}

export const config = {
  matcher: ['/session/:path*', '/auth/:path*'],
};
