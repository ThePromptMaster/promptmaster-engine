import { expect, test } from '@playwright/test';

import { dismissBetaNotice, e2eUser } from './helpers';
import { supabaseEnv } from './env';

/**
 * 4 Oct beta blockers — a new user stranded at the door (Sean, 3 Oct: "they
 * get stranded without knowing what to do"). Signed out throughout.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function admin(path: string, body: unknown) {
  const sb = supabaseEnv();
  const res = await fetch(`${sb.API_URL}/auth/v1/admin/${path}`, {
    method: 'POST',
    headers: { apikey: sb.SERVICE_ROLE_KEY, Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`admin ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

test('a link to a page behind sign-in survives the login screen', async ({ page }) => {
  const { email, password } = e2eUser();
  await page.goto('/projects/new');
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fprojects%2Fnew$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await dismissBetaNotice(page);
  await expect(page.getByLabel('What do you want to do or figure out?')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-deep-link-after-login.png') });
});

test('signing up where confirmation is off goes straight in, not to "check your email"', async ({ page }) => {
  const email = `e2e+signup${Date.now()}@promptmaster.test`;
  await page.goto('/auth/signup');
  await dismissBetaNotice(page);
  await page.getByLabel('Full name').fill('New Tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a-good-password');
  await page.getByLabel('Confirm password').fill('a-good-password');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await dismissBetaNotice(page);
  await page.screenshot({ path: test.info().outputPath('01-signed-up-and-in.png') });
});

test('a password reset link leads to a page that sets the new password, and the new one works', async ({ page }) => {
  const email = `e2e+reset${Date.now()}@promptmaster.test`;
  await admin('users', { email, password: 'the-old-password', email_confirm: true });

  // The email's link, as an admin-issued token hash (CI runs no mail server).
  const link = await admin('generate_link', { type: 'recovery', email });
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
  expect(tokenHash).toBeTruthy();

  await page.goto(`/auth/callback?token_hash=${tokenHash}&type=recovery&next=/auth/reset`);
  await expect(page).toHaveURL(/\/auth\/reset$/);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('the-new-password');
  await page.getByLabel('Confirm new password').fill('the-new-password');
  await page.screenshot({ path: test.info().outputPath('01-set-new-password.png') });
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Sign out (clear the session), then sign in with the new password.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('the-new-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.screenshot({ path: test.info().outputPath('02-signed-in-with-new-password.png') });
});

test('an expired reset link says so and points back to sign in', async ({ page }) => {
  await page.goto('/auth/reset');
  await expect(page.getByText(/This reset link has expired or was already used/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-expired-link.png') });
});
