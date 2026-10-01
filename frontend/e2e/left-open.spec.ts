import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, serviceSelect } from './helpers';

/**
 * A3 — a stage moved past with a required box unticked could never be closed
 * (Sean, 28 Sep, item 20: "Positioning remained OPEN all the way through the
 * project … another view still showed 12 done / 1 to go").
 *
 * Now: browse back to it, tick the box, and the stage closes — an event
 * written by the user, cursor unmoved — and the rail count agrees.
 */

async function eventsOf(projectId: string) {
  return serviceSelect('workflow_events', `project_id=eq.${projectId}&select=type,stage_id,actor&order=seq`);
}

test('ticking the last required box on a stage you moved past closes it, and the count agrees', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E left open', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Objective and Audience: requirements met, both complete.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await pressTransition(page);

  // Positioning: its required "differentiator" box is unticked, so moving on
  // is "anyway" and leaves it open.
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Research/ })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  // The progress caption sits in the sidebar above the stage list.
  const sidebar = page.locator('aside');
  const positioningRow = rail.getByRole('button', { name: /Positioning/ });
  await expect(positioningRow).toContainText('open');
  await expect(sidebar.getByText(/2 done · 1 left open · 10 to go/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-left-open-on-rail.png') });

  // Browse back. The stage says it was left open, and its boxes are live.
  await positioningRow.click();
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await expect(page.getByText(/Left open — you moved on with requirements still unticked/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-viewing-left-open-stage.png') });

  const box = criterion(page, 'One-sentence differentiator').getByRole('checkbox');
  await expect(box).toBeEnabled();
  await box.check();

  // The stage closed: the rail badge is gone and the caption no longer counts it.
  await expect(positioningRow).not.toContainText('open');
  await expect(sidebar.getByText(/3 done · 10 to go/)).toBeVisible();
  await expect(page.getByText(/Left open — you moved on/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('03-closed-by-tick.png') });

  // On the record: the user's own event, after the advance, cursor unmoved.
  const log = await eventsOf(projectId);
  const positioning = log.filter((e: { stage_id: string }) => e.stage_id === 'positioning');
  expect(positioning.map((e: { type: string }) => e.type)).toEqual(['stage_advanced', 'stage_marked_complete']);
  expect(positioning.at(-1).actor).toBe('user');

  // A stage that is done is viewed, not edited: the box is shown but not live.
  await expect(box).toBeDisabled();
});

/**
 * 1 Oct, item 1 — "If an upstream decision changes, anything downstream that
 * may have been affected should be flagged for recheck", and a stage left
 * open must not look like the stage the project is on.
 */
test('a left-open stage is named as such, and rewriting it before closing flags the stage done after it', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E left open recheck', objective: 'A book about okapis' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await expect(page.getByRole('region', { name: / artifact$/ }).getByText(/Mock /).first()).toBeVisible({ timeout: 30_000 });
  await pressTransition(page); // "anyway": Positioning is left open
  await expect(page.getByRole('heading', { name: /Research/ })).toBeVisible();
  await expect(page.getByRole('region', { name: / artifact$/ }).getByText(/Mock /).first()).toBeVisible({ timeout: 30_000 });
  await pressTransition(page); // Research is done
  await expect(page.getByRole('heading', { name: /Outline/ })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  const positioningRow = rail.getByRole('button', { name: /Positioning/ });
  const researchRow = rail.getByRole('button', { name: /Research/ });
  await expect(positioningRow).toContainText('left open');
  await expect(positioningRow).not.toHaveAttribute('aria-current', 'step');
  await page.screenshot({ path: test.info().outputPath('01-left-open-is-not-you-are-here.png') });

  await positioningRow.click();
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await expect(page.locator('header').getByText('Left open', { exact: true })).toBeVisible();

  // Rewrite it, then close it: Research was written against the old version.
  const artifact = page.getByRole('region', { name: / artifact$/ });
  await artifact.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/^Edit Positioning/).fill('A different positioning altogether.');
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(artifact.getByRole('button', { name: 'Edit' })).toBeVisible();
  await criterion(page, 'One-sentence differentiator').getByRole('checkbox').check();

  await expect(positioningRow).not.toContainText('left open');
  await expect(researchRow).toContainText('recheck');
  await page.screenshot({ path: test.info().outputPath('02-closed-on-new-work-research-flagged.png'), fullPage: true });
});
