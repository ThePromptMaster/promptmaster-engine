import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { supabaseEnv } from './env';

/** The first-visit beta notice covers the bottom of the page until acknowledged. */
export async function dismissBetaNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

/** The user this run signed in as (created by global-setup). */
export function e2eUser(): { id: string; email: string; password: string } {
  return JSON.parse(readFileSync(path.join(__dirname, '.auth', 'user.json'), 'utf8'));
}

/**
 * Create a project through the real entry page (PM-09): say what you want,
 * take the recommended setup, pick the workflow the test needs, start.
 * Returns the project id.
 */
export async function createProject(
  page: Page,
  { workflow, name, objective }: { workflow: 'Book' | 'Research' | 'Single output'; name: string; objective: string }
): Promise<string> {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill(objective);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(`^${workflow}`) }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  return page.url().split('/').at(-1)!;
}

/** The bar at the foot of the current stage: status, "More", and one primary action (PM-06). */
export function transitionBar(page: Page) {
  return page.getByRole('group', { name: 'Stage actions' });
}

/**
 * Move to the next stage (or finish). Since PM-06 this is the primary button
 * only when moving on is the suggested next step; otherwise it is under More.
 * Moving past a required item is an override and needs a reason; the helper
 * gives one.
 */
export async function pressTransition(page: Page) {
  const bar = transitionBar(page);
  const direct = bar.getByRole('button', { name: /^(Continue to|Finish|Override and)/ });
  if (await direct.count()) {
    await direct.click();
  } else {
    await bar.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: /^(Continue to|Finish|Override and)/ }).click();
  }
  const reason = page.getByLabel('Reason for the override');
  if (await reason.isVisible().catch(() => false)) {
    await reason.fill('Moving on for now; will come back to it.');
    await page.getByRole('button', { name: 'Override and continue' }).click();
  }
  const moveOn = page.getByRole('button', { name: 'Move on' });
  if (await moveOn.isVisible().catch(() => false)) await moveOn.click();
  // PM-14: Finish shows what is being finished before it finishes.
  const summary = page.getByRole('region', { name: 'Finish the project' });
  if (await summary.isVisible().catch(() => false)) {
    await summary.getByRole('button', { name: /^Finish (project|anyway)$/ }).click();
  }
}

/** Skip the current stage with a reason. */
export async function skipStage(page: Page, reason: string) {
  await transitionBar(page).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Skip this stage' }).click();
  await page.getByPlaceholder('Or write your own reason').fill(reason);
  await page.getByRole('button', { name: 'Skip stage' }).click();
}

/**
 * Write a row as the service role — what the job drain does server-side.
 * Local Supabase only (env.ts / global-setup refuse anything else).
 */
export async function serviceInsert(table: string, row: Record<string, unknown>) {
  const sb = supabaseEnv();
  const res = await fetch(`${sb.API_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: sb.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`service insert into ${table} failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

/** Read rows as the service role, for asserting on what the app actually wrote. */
export async function serviceSelect(table: string, query: string) {
  const sb = supabaseEnv();
  const res = await fetch(`${sb.API_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: sb.SERVICE_ROLE_KEY, Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`service select on ${table} failed: ${res.status}`);
  return res.json();
}

/** Update rows as the service role (local only). Used to seed states a test starts from. */
export async function servicePatch(table: string, query: string, patch: Record<string, unknown>) {
  const sb = supabaseEnv();
  const res = await fetch(`${sb.API_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: sb.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`service patch on ${table} failed: ${res.status} ${await res.text()}`);
}

/** The exit-criteria row for one criterion, by its label (the row also carries detail text). */
export function criterion(page: Page, label: string) {
  const checklist = page.locator('section').filter({ has: page.getByRole('heading', { name: 'To finish this stage' }) });
  return checklist.getByRole('listitem').filter({ hasText: label });
}

/**
 * The current stage's artifact, for asserting on what was drafted. Scoped
 * because other surfaces (the collapsed project brief, recommendations) can
 * hold the same text hidden, and an unscoped getByText would match them first.
 */
export function stageArtifact(page: Page) {
  return page.getByRole('region', { name: / work$/ });
}
