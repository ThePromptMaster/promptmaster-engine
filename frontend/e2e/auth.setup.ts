import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test as setup } from '@playwright/test';

/** Signs in through the real login form once, and saves the session for every spec. */
setup('sign in', async ({ page }) => {
  const { email, password } = JSON.parse(readFileSync(path.join(__dirname, '.auth', 'user.json'), 'utf8'));

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await page.context().storageState({ path: path.join(__dirname, '.auth', 'state.json') });
});
