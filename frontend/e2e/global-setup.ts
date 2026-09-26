/**
 * Creates a fresh, confirmed test user in the LOCAL Supabase for this run.
 *
 * A new user per run means every test starts from an empty project list and
 * no run depends on another's leftovers. Credentials are written to
 * e2e/.auth/ (gitignored); they exist only in the local database.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { supabaseEnv } from './env';

export const AUTH_DIR = path.join(__dirname, '.auth');
export const USER_FILE = path.join(AUTH_DIR, 'user.json');

export default async function globalSetup() {
  const sb = supabaseEnv();
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(sb.API_URL)) {
    throw new Error(`E2E refuses to create users outside a local Supabase (got ${sb.API_URL}).`);
  }

  const email = `e2e+${Date.now()}@promptmaster.test`;
  const password = `E2e-${randomBytes(9).toString('hex')}`;

  const res = await fetch(`${sb.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: sb.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Could not create the E2E user: ${res.status} ${await res.text()}`);
  const user = (await res.json()) as { id: string };

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify({ id: user.id, email, password }, null, 2));
}
