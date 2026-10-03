import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, stageArtifact } from './helpers';

/**
 * H5 — open-ended work, round after round (3 Oct call: "a theory of
 * everything… this is going to go on forever, which is fine… but it would
 * still stop you"). Go proposes the next round; the user starts it, and the
 * new round is built on the last one's findings.
 */
function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

test('an exploration round ends in a proposed next round that the user starts', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/projects/new');
  await createProject(page, {
    workflow: 'Exploration', name: 'E2E exploration',
    objective: 'A theory of everything as a thought experiment [[mock:plan=propose_next_round]]',
  });
  await expect(page.getByRole('heading', { name: 'The idea' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page); // → Explore
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page); // → Test (a table)
  await expect(page.getByRole('heading', { name: 'Test it' })).toBeVisible();
  await pressTransition(page); // → Findings
  await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page); // → Next question
  await expect(page.getByRole('heading', { name: 'Next question' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Suggest the next round', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  const card = page.getByRole('region', { name: /Go mode/ }).filter({ hasText: 'This round is done.' }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-next-round-proposed.png'), fullPage: true });
  await card.getByRole('button', { name: 'Start the next round from Explore' }).click();
  await expect(page.getByRole('heading', { name: 'Explore' })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('02-round-two.png'), fullPage: true });
});

test('“Keep going” lets an autonomous run continue for up to 20 windows', async ({ page }) => {
  await createProject(page, { workflow: 'Exploration', name: 'E2E keep going', objective: 'Why is there something rather than nothing' });
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Authorize Go mode' });
  await dialog.getByLabel('Further windows without asking').selectOption('20');
  await expect(dialog).toContainText('each new round of open-ended work is yours to start');
  await page.screenshot({ path: test.info().outputPath('03-keep-going.png'), fullPage: true });
});
