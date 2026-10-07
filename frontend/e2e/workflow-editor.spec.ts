import { expect, test, type Page } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * W1–W3 — Sean, 6 Oct, email 11: "We need an obvious 'Add stage' button and
 * direct editing of each stage's name, instructions, type, and approval
 * requirements. Users should also be able to request a targeted change
 * conversationally, such as 'add a verification stage,' without regenerating
 * unrelated stages … If a requested behavior … is unsupported, the system
 * should say so." Email 10: "preserve the execution objective when generating
 * the workflow, continue justified investigation within available tools and
 * delegated authority".
 */
async function openDesigner(page: Page, objective: string) {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill(objective);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('button', { name: /Design a workflow for this work/ }).click();
  return page.getByRole('region', { name: 'Design a workflow' });
}

test('stages are edited and added directly, and a change asked in words touches only what it names', async ({ page }) => {
  const designer = await openDesigner(page, 'Profile a chef for a food magazine');
  await designer.getByLabel('What kind of work is this?').fill('a magazine feature');
  await designer.getByRole('button', { name: 'Design it' }).click();
  const stages = designer.getByRole('list', { name: 'Proposed stages' }).getByRole('listitem');
  await expect(stages).toHaveCount(5, { timeout: 30_000 });

  // Direct editing: every field of a stage.
  await designer.getByRole('button', { name: 'Edit stage 3' }).click();
  await designer.getByLabel('Instructions for stage 3').fill('Write the feature in 1,800 words, quoting at least three sources by name.');
  await designer.getByLabel('Kind of stage 3').selectOption('write');
  await designer.getByLabel('Sign-off for stage 3').fill('I approve this draft for fact-checking');
  await designer.getByLabel('Who signs off stage 3').selectOption('routine');
  await page.screenshot({ path: test.info().outputPath('01-edit-a-stage.png'), fullPage: true });

  // An obvious "Add stage".
  await designer.getByRole('button', { name: 'Add a stage after stage 1' }).click();
  await designer.getByLabel('Name of stage 2').fill('Research the chef');
  await expect(stages).toHaveCount(6);

  // A change in words: Verification goes in after stage 3; the rest is as it was.
  await designer.getByLabel('Ask for a change').fill('add a verification stage; and repeat only the analysis automatically');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/revise-workflow'));
  await designer.getByRole('button', { name: 'Make the change' }).click();
  const body = (await sent).postDataJSON() as { workflow: { stages: { label: string; instruction: string }[] } };
  expect(body.workflow.stages[3].instruction).toBe('Write the feature in 1,800 words, quoting at least three sources by name.');
  const said = designer.getByRole('status', { name: 'What changed' });
  await expect(said).toContainText('Added “Verification” after “Sources to interview”');
  await expect(said).toContainText('Everything else is as it was');
  await expect(said).toContainText('Not possible: Repeat only the analysis automatically');
  await expect(stages).toHaveCount(7);
  await expect(designer.getByLabel('Name of stage 4')).toHaveValue('Verification');
  // The edited stage kept its edits through the change.
  await designer.getByRole('button', { name: 'Edit stage 5' }).click();
  await expect(designer.getByLabel('Instructions for stage 5')).toHaveValue('Write the feature in 1,800 words, quoting at least three sources by name.');
  await page.screenshot({ path: test.info().outputPath('02-targeted-change.png'), fullPage: true });

  const name = `Edited feature ${Date.now()}`;
  await designer.getByLabel('Name', { exact: true }).fill(name);
  await designer.getByRole('button', { name: 'Use this workflow' }).click();
  await expect(page.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  const [saved] = await serviceSelect('workflow_templates', `name=eq.${encodeURIComponent(name)}&select=definition`);
  const draft = saved.definition.stages.find((s: { label: string }) => s.label === 'First draft');
  expect(draft.entry_prompt_hint).toBe('Write the feature in 1,800 words, quoting at least three sources by name.');
  expect(draft.exit_criteria.find((c: { id: string }) => c.id.endsWith('.approved'))).toMatchObject({ authority: 'delegable' });

  // A saved workflow can be edited as a copy.
  await page.getByRole('button', { name: `Edit a copy of ${name}` }).click();
  const copy = page.getByRole('region', { name: 'Design a workflow' });
  await expect(copy.getByRole('heading', { name: `Edit a copy of ${name}` })).toBeVisible();
  await expect(copy.getByRole('list', { name: 'Proposed stages' }).getByRole('listitem')).toHaveCount(7);
  await expect(copy.getByRole('button', { name: 'Save as a new workflow' })).toBeVisible();
});

test('an ongoing workflow keeps its success criterion and loops; Go starts the next round under the policy', async ({ page }) => {
  test.setTimeout(240_000);
  const designer = await openDesigner(page, 'Continue investigating the Regge Hessian until a supported result [[mock:plan=advance_stage,advance_stage,advance_stage]] [[mock:objective=open]]');
  await designer.getByLabel('What kind of work is this?').fill('research [[mock:ongoing]]');
  await designer.getByRole('button', { name: 'Design it' }).click();
  await expect(designer.getByLabel('Finite or ongoing')).toHaveValue('ongoing', { timeout: 30_000 });
  await expect(designer.getByLabel('Done means')).toHaveValue('A supported result, or a concrete blocker');
  await expect(designer).toContainText('Closes a round; the next starts from “Investigate”.');
  await page.screenshot({ path: test.info().outputPath('03-ongoing-design.png'), fullPage: true });
  const name = `Open research ${Date.now()}`;
  await designer.getByLabel('Name', { exact: true }).fill(name);
  await designer.getByRole('button', { name: 'Use this workflow' }).click();
  await expect(page.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await page.getByLabel('Project name').fill('E2E ongoing research');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode' });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByLabel('Step budget').selectOption('12');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // The round is started by Go, under the policy, along the template's loop.
  await expect.poll(
    async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=actor,stage_id,to_stage_id,payload`)).length,
    { timeout: 180_000 }
  ).toBeGreaterThan(0);
  const [round] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=actor,stage_id,to_stage_id,payload,agent_run_id`);
  expect(round).toMatchObject({ actor: 'system', stage_id: 'next_round', to_stage_id: 'investigate', payload: { next_round: true } });
  expect(round.agent_run_id).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('04-go-started-the-next-round.png'), fullPage: true });
});

test('when a round meets the objective, Go does not start another: it moves on to the write-up (L-54)', async ({ page }) => {
  test.setTimeout(240_000);
  const designer = await openDesigner(page, 'Continue investigating the Regge Hessian until a supported result [[mock:plan=advance_stage,advance_stage,advance_stage]]');
  await designer.getByLabel('What kind of work is this?').fill('research [[mock:ongoing]]');
  await designer.getByRole('button', { name: 'Design it' }).click();
  await expect(designer.getByLabel('Finite or ongoing')).toHaveValue('ongoing', { timeout: 30_000 });
  await expect(designer.getByLabel('Done means')).toHaveValue('A supported result, or a concrete blocker');
  await expect(designer).toContainText('Closes a round; the next starts from “Investigate”.');
  await page.screenshot({ path: test.info().outputPath('03-ongoing-design.png'), fullPage: true });
  const name = `Open research ${Date.now()}`;
  await designer.getByLabel('Name', { exact: true }).fill(name);
  await designer.getByRole('button', { name: 'Use this workflow' }).click();
  await expect(page.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await page.getByLabel('Project name').fill('E2E ongoing research');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode' });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByLabel('Step budget').selectOption('12');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // The round's work meets the objective: no new round; the round stage is
  // closed and the project moves on to the write-up, with the judgment recorded.
  await expect.poll(
    async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_marked_complete&stage_id=eq.next_round&select=to_stage_id,payload`)).length,
    { timeout: 180_000 }
  ).toBeGreaterThan(0);
  const [closed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_marked_complete&stage_id=eq.next_round&select=actor,to_stage_id,payload`);
  expect(closed).toMatchObject({ actor: 'system', to_stage_id: 'research_log', payload: { objective_met: true } });
  expect(await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_returned&select=id`)).toEqual([]);
  const [judged] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.objective_assessed&select=payload&order=seq&limit=1`);
  expect(judged.payload.outcome).toBe('met');
});
