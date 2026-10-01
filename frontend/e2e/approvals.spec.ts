import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, serviceSelect, stageArtifact, transitionBar } from './helpers';

/**
 * 1 Oct, items 6, 7, 8 and 11 — what PromptMaster can verify it verifies;
 * what is left for the user is worded as their approval; and moving past a
 * required item is an override that carries its reason.
 */
test('an override needs a reason; verified and approval items are told apart', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Research', name: 'E2E approvals', objective: 'Why pendulums slow down' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  // Literature: the gap is the user's to confirm. Moving past it is an override.
  await expect(criterion(page, 'I confirm the gap this work addresses is identified')).toBeVisible();
  const bar = transitionBar(page);
  const direct = bar.getByRole('button', { name: /^Override and continue to/ });
  if (await direct.count()) await direct.click();
  else {
    await bar.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: /^Override and continue to/ }).click();
  }
  await expect(page.getByText(/You are overriding something this stage requires/)).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Override and continue' });
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('01-override-needs-a-reason.png') });
  await page.getByLabel('Reason for the override').fill('The gap is clear from the question; writing it up later.');
  await confirm.click();

  // Hypothesis: the rows carry a prediction and a disconfirmer, so that is
  // verified, not asked; the acceptance is the user's.
  await expect(page.getByRole('heading', { name: 'Hypothesis or proposition' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  const verified = page.getByRole('region', { name: 'Checked by PromptMaster' });
  const yours = page.getByRole('region', { name: 'For you to decide' });
  await expect(verified).toContainText('PromptMaster verified');
  await expect(verified).toContainText('Each hypothesis has a prediction and a disconfirmer');
  await expect(verified.getByRole('checkbox')).toHaveCount(0);
  await expect(yours).toContainText('You approve');
  await expect(yours.getByRole('checkbox', { name: /I accept these hypotheses as the working set/ })).toBeVisible();
  await expect(page.getByText(/this stage is waiting for your approval/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-verified-and-approval.png'), fullPage: true });

  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(rail.getByRole('button', { name: /Literature/ })).toContainText('left open');
  const [left] = await serviceSelect('workflow_events', `project_id=eq.${id}&stage_id=eq.literature&type=eq.stage_advanced&select=reason`);
  expect(left.reason).toBe('The gap is clear from the question; writing it up later.');
});
