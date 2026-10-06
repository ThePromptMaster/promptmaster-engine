import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, serviceInsert, serviceSelect, stageArtifact } from './helpers';

/**
 * D (Sean, 5 Oct): "Routine decisions: handle them for me / ask me".
 *
 * "Autonomous stopped and asked me to select something like 'I approve these
 * extracted claims and commitments.' If the system can validate the extraction
 * itself, and I have already authorized it to handle routine decisions, there
 * may be no meaningful reason for that interruption."
 */
const goPanel = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Go mode', exact: true });

test('under "handle them for me", Go checks a routine approval and commits it, and says so', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await createProject(page, { workflow: 'Book', name: 'E2E routine decisions', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  for (const heading of ['Audience', 'Positioning']) {
    await pressTransition(page);
    await expect(page.locator('header').getByRole('heading', { name: new RegExp(heading) })).toBeVisible();
  }
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await expect(criterion(page, 'I confirm the one-sentence differentiator is stated')).toContainText('routine');

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await page.screenshot({ path: test.info().outputPath('01-routine-decisions-setting.png') });
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // Committed by the policy, after a check — the user was not asked.
  await expect.poll(
    async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.criterion_committed&select=actor,stage_id,payload`)).length,
    { timeout: 120_000 }
  ).toBe(1);
  const [committed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.criterion_committed&select=actor,stage_id,agent_run_id,reason,payload`);
  expect(committed).toMatchObject({ actor: 'system', stage_id: 'positioning', payload: { criterion_id: 'pos.differentiator', policy: 'routine_decisions' } });
  expect(committed.agent_run_id).toBeTruthy();
  const [policy] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.routine_policy_changed&select=actor,payload`);
  expect(policy).toMatchObject({ actor: 'user', payload: { routine_decisions: 'handle' } });
  const steps = await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.commit_delegated&select=status,output`);
  expect(steps[0]).toMatchObject({ status: 'succeeded' });
  expect(steps[0].output).toContain('Committed under your routine-decision policy');
  // No request to tick it was ever raised.
  const runs = await serviceSelect('agent_runs', `project_id=eq.${id}&select=needs`);
  expect(runs.filter((r: { needs: { criterionId?: string } | null }) => r.needs?.criterionId === 'pos.differentiator')).toEqual([]);

  await panel.getByRole('button', { name: /^Stop/ }).click().catch(() => undefined);
  await page.getByRole('navigation').getByRole('button', { name: /Positioning/ }).click().catch(() => undefined);
  await expect(page.getByText('Committed under your routine-decision policy, after checking:')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Committed under your routine-decision policy, after checking:').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-committed-under-the-policy.png') });
});

test('a reserved approval still stops Go, and the card says why it is the user\'s', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Research', name: 'E2E reserved approval', objective: 'Why pendulums slow down [[mock:plan=derive]]' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  for (const heading of ['Literature context', 'Hypothesis or proposition']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('"I accept these hypotheses as the working set". This one is yours alone', { timeout: 30_000 });
  await expect(card).toContainText('Approving it lets me carry on from');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-reserved-approval-asked.png') });
  expect(await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.criterion_committed&select=id`)).toEqual([]);
});

test('the database refuses a policy commit when routine decisions are set to ask, or the approval is reserved', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E policy guard', objective: 'A book about giraffes' });
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=user_id,routine_decisions`);
  expect(project.routine_decisions).toBe('ask');
  // Without a run behind it, it is refused before anything else is looked at.
  await expect(
    serviceInsert('workflow_events', {
      project_id: id, user_id: project.user_id, type: 'criterion_committed', stage_id: 'positioning', actor: 'user',
      payload: { criterion_id: 'pos.differentiator' },
    })
  ).rejects.toThrow(/routine-decision policy/);
  // Nor can the policy be changed by anyone but the user.
  await expect(
    serviceInsert('workflow_events', {
      project_id: id, user_id: project.user_id, type: 'routine_policy_changed', stage_id: 'objective', actor: 'system',
      payload: { routine_decisions: 'handle' },
    })
  ).rejects.toThrow();
});
