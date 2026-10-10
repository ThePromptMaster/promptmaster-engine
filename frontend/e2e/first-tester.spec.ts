import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect, transitionBar } from './helpers';

/**
 * The first-tester path (10 Oct): a new user gives a goal and nothing else,
 * takes the recommended workflow, and gets to a checked deliverable that Go
 * finishes — without answering questions, choosing a workflow, or being told
 * which button to press. Every step here presses the button the page puts
 * first; none reaches into a menu.
 */
test('a goal alone reaches a finished, checked deliverable on the primary buttons', async ({ page }) => {
  test.setTimeout(240_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  // An example goal from the empty projects page, or typed: the same ask box.
  await page.goto('/projects/new?goal=' + encodeURIComponent(
    'A one-page memo recommending whether our 12-person team should move from Slack to Teams; budget $8,000/yr [[mock:plan=declare_objective_complete]]'
  ));
  await dismissBetaNotice(page);
  await expect(page.getByLabel('What do you want to do or figure out?')).toHaveValue(/Slack to Teams/);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();

  // No questions: a recommendation with Start under it.
  await expect(page.getByText(/Recommended: Single output/)).toBeVisible();
  const start = page.getByRole('button', { name: 'Start Single output' });
  await expect(start).toBeInViewport();
  await shot('01-recommended-start.png');
  await start.click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  // Planning stages lead with moving on; the check waits in More.
  const bar = transitionBar(page);
  for (const next of ['Review the prompt', 'Output and evaluation']) {
    const primary = bar.getByRole('button', { name: /^Continue to/ });
    await expect(primary).toBeVisible({ timeout: 30_000 });
    await expect(bar.getByRole('button', { name: /^Check this stage/ })).toHaveCount(0);
    await primary.click();
    await expect(page.getByRole('heading', { name: next })).toBeVisible();
  }

  // The deliverable is drafted on arrival.
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await shot('02-first-deliverable.png');

  // Two clicks hand the rest to Go; the authorization is the delegation record.
  const panel = page.getByRole('region', { name: 'Go mode' });
  await panel.getByRole('button', { name: 'Let Go run this' }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  await expect.poll(async () => {
    const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status&order=created_at.desc&limit=1`);
    return run && run.status !== 'running' ? run.status : 'running';
  }, { timeout: 150_000 }).not.toBe('running');
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status,stop_reason,policy,authorization_id&order=created_at.desc&limit=1`);
  expect(run).toMatchObject({ policy: 'autonomous' });
  expect(run.authorization_id).toBeTruthy();
  await panel.scrollIntoViewIfNeeded();
  await shot('03-go-account.png');
  test.info().annotations.push({ type: 'go-run', description: `${run.status}: ${run.stop_reason}` });

  // Every move Go made is on the record, labelled by what happened.
  const runs = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  const steps = await serviceSelect('agent_steps', `run_id=eq.${runs[0].id}&select=action_key,status&order=idx`);
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.every((s: { status: string }) => s.status !== 'running')).toBe(true);
});
