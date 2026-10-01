import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * C5 (Sean, 28 Sep, item 16): view, reopen, return. A done stage can be
 * reopened for editing without moving the project on; closing it again on
 * changed work flags the stages after it for a recheck.
 */
test('a done stage can be reopened, edited, closed again, and the stages after it are flagged', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E reopen', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Objective and Audience done; Positioning current.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();

  // View Objective: done, read-only, with the way to reopen it.
  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  await rail.getByRole('button', { name: /Objective/ }).click();
  await expect(page.getByRole('heading', { name: /Objective/ })).toBeVisible();
  const artifact = page.getByRole('region', { name: /Objective.*work/ });
  await expect(artifact.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen to edit' }).click();
  await expect(page.getByText(/Reopened — edit it here, then mark it complete/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-reopened.png') });

  // Edit it: a new version, the stage's new evidence.
  await artifact.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit Objective and purpose').fill('A book about giraffes, for children who ask why.');
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByRole('button', { name: /^v2/ })).toBeVisible();

  // Close it again. Audience, built on the old objective, is flagged.
  await page.getByRole('button', { name: 'Mark this stage complete' }).click();
  await expect(page.getByText(/Reopened — edit it here/)).toHaveCount(0);
  await expect(rail.getByRole('button', { name: /Audience/ })).toContainText('recheck');
  await page.screenshot({ path: test.info().outputPath('02-closed-again-audience-recheck.png') });

  // The cursor never moved; the record says what happened.
  await page.getByRole('button', { name: /back to Positioning/ }).click();
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  const log = await serviceSelect('workflow_events', `project_id=eq.${projectId}&stage_id=eq.objective&type=neq.project_created&select=type,actor,payload&order=seq`);
  expect(log.map((e: { type: string }) => e.type)).toEqual(['stage_marked_complete', 'stage_reopened', 'stage_marked_complete']);
  expect(log[1].actor).toBe('user');
  expect(log[2].payload.evidence_version_id).not.toBe(log[0].payload.evidence_version_id);
});
