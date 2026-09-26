import { expect, test } from '@playwright/test';

import { createProject, e2eUser, pressTransition, serviceInsert, serviceSelect, skipStage, transitionBar } from './helpers';

/**
 * PM-03, "Finish does nothing" — reproduced against the real database.
 *
 * The browser used to number events from its last read of the log, while the
 * drain numbers them server-side. A section written after the page loaded made
 * the browser's next event a duplicate, the insert failed, and the error was
 * swallowed. This walks a project to its last stage, has "the drain" write an
 * event the page has not seen, then presses Finish.
 */
test('Finish closes the project even when the server wrote events the page has not seen', async ({ page }) => {
  const projectId = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E finish',
    objective: 'Explain the migration plan to the board',
  });

  // Input -> Review -> Output -> Realign (skip) -> Summary
  await expect(transitionBar(page).getByText('Ready to move on')).toBeVisible();
  await pressTransition(page);

  await expect(page.getByRole('heading', { name: 'Review the prompt' })).toBeVisible();
  await pressTransition(page);

  await expect(page.getByRole('heading', { name: 'Output and evaluation' })).toBeVisible();
  await expect(page.getByText('Mock output').first()).toBeVisible(); // auto-drafted
  await pressTransition(page);

  await expect(page.getByRole('heading', { name: 'Realignment' })).toBeVisible();
  await skipStage(page, 'Scores are already good');

  await expect(page.getByRole('heading', { name: 'Final review' })).toBeVisible();

  // The drain writes an event the page has not read. Its seq is exactly the one
  // the browser would have chosen, which is what used to collide.
  const before = await serviceSelect('workflow_events', `project_id=eq.${projectId}&select=seq`);
  await serviceInsert('workflow_events', {
    project_id: projectId,
    user_id: e2eUser().id,
    seq: before.length + 1,
    type: 'job_enqueued',
    stage_id: 'summary',
    actor: 'system',
  });

  await pressTransition(page);

  await expect(page.getByText('This project is finished')).toBeVisible();
  // Not getByRole('alert'): Next's route announcer is an empty alert region.
  await expect(page.getByText(/didn't go through/)).toHaveCount(0);
  await page.getByText('This project is finished').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-finished-banner.png') });

  const log = await serviceSelect(
    'workflow_events',
    `project_id=eq.${projectId}&select=seq,type,stage_id&order=seq`
  );
  expect(log.at(-1)).toMatchObject({ type: 'stage_completed', stage_id: 'summary' });
  expect(new Set(log.map((e: { seq: number }) => e.seq)).size).toBe(log.length);

  // It is filed under Finished.
  await page.getByRole('link', { name: 'All projects' }).click();
  const finished = page.getByRole('heading', { name: /^Finished · / }).locator('..');
  await expect(finished.getByText('E2E finish')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-listed-under-finished.png') });

  // And it can be reopened.
  await finished.getByText('E2E finish').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(transitionBar(page)).toBeVisible();
});
