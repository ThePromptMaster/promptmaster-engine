import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * A5 — proposals retire when the project moves past them (Sean, 28 Sep, item
 * 1: "while in Revision, old recommendations could still say Move on to
 * Drafting or Move on to Continuity").
 *
 * A derived proposal only gets a row when the user acts on it; deferring is
 * the action that leaves it pending (the task carries it forward). Leaving the
 * stage then supersedes the row, in the table and on screen.
 */
test('a proposal deferred on one stage is retired when that stage is left', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E proposals', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Objective's requirements are met, so the panel proposes moving on.
  const panel = page.getByRole('region', { name: 'Recommendations' });
  await expect(panel.getByText('Move on to Audience')).toBeVisible();
  await panel.getByRole('combobox', { name: /What to do about "Move on to Audience"/ }).click();
  await page.getByRole('option', { name: 'Not now' }).click();
  await page.getByLabel('What still needs doing?').fill('Decide the audience later.');
  await page.getByRole('button', { name: 'Add to tasks' }).click();
  // The task is what carries a deferral forward; its appearance means the rows landed.
  await expect(page.getByText('Decide the audience later.')).toBeVisible();
  // Deferred, not duplicated: the persisted row stands in for the derived one.
  await expect(panel.getByText('Move on to Audience')).toHaveCount(1);

  const pending = await serviceSelect('recommendations', `project_id=eq.${projectId}&select=id,title,status,scope`);
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ title: 'Move on to Audience', status: 'pending' });
  expect(pending[0].scope.stage_id).toBe('objective');
  await page.screenshot({ path: test.info().outputPath('01-deferred-proposal-pending.png') });

  // Leave the stage: the proposal has nothing left to say — on screen at once,
  // not only after a reload (seen on production 2026-09-28).
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await expect(panel.getByText('Move on to Positioning')).toBeVisible();
  await expect(panel.getByText('Move on to Audience')).toHaveCount(0);
  await expect(panel.getByText(/^1 for Audience/)).toBeVisible();

  const after = await serviceSelect('recommendations', `project_id=eq.${projectId}&select=title,status,resolved_at`);
  expect(after).toHaveLength(1);
  expect(after[0].status).toBe('superseded');
  expect(after[0].resolved_at).toBeTruthy();

  // And browsing back to Objective does not resurrect it.
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: /Objective/ }).click();
  await expect(page.getByRole('heading', { name: /Objective/ })).toBeVisible();
  await expect(panel.getByText('Move on to Audience')).toHaveCount(0);
  // The task it became is still there — that is what "deferred" means.
  await expect(page.getByText('Decide the audience later.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-retired-after-moving-on.png') });
});
