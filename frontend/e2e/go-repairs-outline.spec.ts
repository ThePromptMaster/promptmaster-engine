import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceInsert, serviceSelect, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * One revision has to reach the chapter plan too (8 Nov, a rollout package test).
 * Go repaired six of seven stages and said it could not revise the plan, and
 * regenerating the plan by hand gave every written section a new id, so all
 * eight came loose. Now Go updates the plan itself: the same chapters, the same
 * ids, the approval carried on the new version, and nothing asked. The model is
 * scripted: this holds the mechanism, and the production pass holds the reasoning.
 */
test('Go brings a reopened chapter plan up to date, and every chapter keeps its id and its text', async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createProject(page, {
    workflow: 'Book',
    name: 'E2E go repairs the outline',
    objective: 'A short book about giraffes [[mock:plan=declare_objective_complete]]',
  });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');

  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('Habitat');
  await page.getByRole('button', { name: /Insert a section after/ }).click();
  await page.getByLabel('Title of section 2').fill('Diet');
  await page.waitForTimeout(1_500); // past the draft autosave
  await transitionBar(page).getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Outline approval/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Draft/ })).toBeVisible();
  await transitionBar(page).getByRole('button', { name: 'Start drafting' }).click();
  await expect(page.getByText('2 of 2 sections written')).toBeVisible({ timeout: 60_000 });

  const plan = async (): Promise<{ id: string; source_operation: string; items: { id: string; title: string }[] }> => {
    const [artifact] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.outline&select=current_version_id`);
    const [version] = await serviceSelect('artifact_versions', `id=eq.${artifact.current_version_id}&select=id,content,source_operation`);
    return { ...version, items: JSON.parse(version.content).items as { id: string; title: string }[] };
  };
  const sections = async () => {
    const [artifact] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.drafting&select=long_form`);
    return artifact.long_form as { outline: { id: string; content?: string }[]; orphans?: unknown[] };
  };
  const before = await plan();
  const written = await sections();
  expect(written.outline.every((s) => (s.content ?? '').length > 0)).toBe(true);

  // A change the plan relied on, recorded as the brief's change is: the plan needs a recheck.
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=user_id`);
  await serviceInsert('workflow_events', {
    project_id: id,
    user_id: project.user_id,
    type: 'brief_changed',
    stage_id: 'outline',
    actor: 'user',
    payload: { field: 'context', kind: 'fact', presentation_only: false, affected: [{ stage_id: 'outline', reason: 'The budget this plan was built on changed.' }] },
  });
  await page.reload();
  await expect(page.getByRole('navigation').getByText('awaiting recheck', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Go, Autonomous, routine decisions handled: it repairs the plan first.
  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  await expect.poll(async () => {
    const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status&order=created_at.desc&limit=1`);
    return run && run.status !== 'running' ? 'ended' : 'running';
  }, { timeout: 200_000 }).toBe('ended');
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  const steps = await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,params,changes,output&order=idx`);
  expect(steps[0]).toMatchObject({ action_key: 'recheck_stage', status: 'succeeded', params: { stage_id: 'outline' }, changes: { stage_closed: true } });
  expect(steps.map((s: { output: string | null }) => s.output ?? '').join(' ')).not.toContain('do not revise this kind of stage');

  // A new version of the plan, written by Go, with the same chapters under the same ids.
  const after = await plan();
  expect(after.id).not.toBe(before.id);
  expect(after.source_operation).toBe('agent_revise');
  expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));

  // The written chapters stayed attached: nothing for the user to put back.
  const kept = await sections();
  expect(kept.outline.map((s) => s.id)).toEqual(written.outline.map((s) => s.id));
  expect(kept.outline.every((s) => (s.content ?? '').length > 0)).toBe(true);
  expect(kept.orphans ?? []).toEqual([]);

  // The user approved the plan once, and that approval is carried to the new version, saying so.
  const carried = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.outline_approved&actor=eq.system&select=payload`);
  expect(carried.at(-1).payload).toMatchObject({ outline_version_id: after.id, carried_from_version_id: before.id });
  await page.screenshot({ path: test.info().outputPath('01-plan-repaired-chapters-kept.png'), fullPage: true });
});
