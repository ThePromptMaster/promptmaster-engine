/**
 * Where the E2E stack lives, and how to reach the local Supabase it runs on.
 *
 * The suite runs against a real local Supabase (`npx supabase start`, every
 * migration applied), the real FastAPI app with PM_LLM_MODE=mock, and a
 * production build of this app. Only the model is scripted.
 *
 * CI exports the Supabase values; locally they are read from
 * `supabase status`, so there is nothing to configure by hand.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3100);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
export const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface SupabaseEnv {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
}

let cached: SupabaseEnv | null = null;

export function supabaseEnv(): SupabaseEnv {
  if (cached) return cached;
  const fromEnv = {
    API_URL: process.env.SUPABASE_URL,
    ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  };
  if (Object.values(fromEnv).every(Boolean)) {
    cached = fromEnv as SupabaseEnv;
    return cached;
  }

  let out: string;
  try {
    out = execSync('npx -y supabase status -o env', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start` from the repo root.');
  }
  const vars: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  cached = {
    API_URL: vars.API_URL,
    ANON_KEY: vars.ANON_KEY,
    SERVICE_ROLE_KEY: vars.SERVICE_ROLE_KEY,
    JWT_SECRET: vars.JWT_SECRET,
  };
  return cached;
}
