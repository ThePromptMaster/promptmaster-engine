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
