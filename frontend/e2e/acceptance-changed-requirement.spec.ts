import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, skipStage } from './helpers';

/**
 * Sean's acceptance test (6 Oct, email 1, "Promptmaster vs cowork"): one
 * project, 160 staff hours; A (150 h, $60,000), B (120 h, $45,000), C (80 h,
 * $20,000). The rule was highest contribution within capacity, so A. Then a
 * requirement is added: at least one researcher stays available for client
 * work. A is out; B and C qualify; B wins.
 *
 * What PromptMaster must do (his list): the requirement is recorded and the
 * affected work reopened; Go repairs it within delegated authority without
 * stopping on routine row decisions; earlier versions stay; and the
 * completion messages agree with what is still open. The model is scripted:
 * this holds the mechanism, and the production pass holds the reasoning.
 */
function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode' });
}

test('a changed requirement reopens what relied on it, and Go repairs it under "handle them for me"', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await createProject(page, {
    workflow: 'Single output',
    name: 'E2E acceptance: changed requirement',
    objective:
      'Choose one project within 160 staff hours: A 150 h $60,000; B 120 h $45,000; C 80 h $20,000. Highest contribution within capacity. [[mock:plan=declare_objective_complete]]',
  });
  await pressTransition(page); // input
  await pressTransition(page); // review
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await pressTransition(page); // output, finished
  await skipStage(page, 'Scores are already good');
  await expect(page.getByRole('heading', { name: 'Final review' })).toBeVisible();
  const [outputArtifact] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.output&select=id`);
  const outputVersions = async () => (await serviceSelect('artifact_versions', `artifact_id=eq.${outputArtifact.id}&select=id`)).length;
  const before = await outputVersions();

  // The authorised change, recorded as a requirement with its source.
  const facts = page.getByRole('region', { name: 'Facts and requirements' });
  await facts.getByRole('button', { name: /^Facts and requirements/ }).click();
  await facts.getByLabel('A fact or requirement to add').fill('At least one researcher must remain available for existing client commitments');
  await facts.getByLabel('Fact or requirement', { exact: true }).selectOption('requirement');
  await facts.getByRole('button', { name: 'Add' }).click();
  await expect(facts.getByRole('list', { name: 'Accepted facts' })).toContainText('Requirement: At least one researcher must remain available');

  // The finished work that relied on the old rule is reopened, and every
  // readiness message says so.
  await expect(page.getByRole('navigation').getByText('recheck', { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('group', { name: 'Stage actions' })).toContainText('needs a recheck');
  await page.screenshot({ path: test.info().outputPath('01-requirement-reopens-output.png') });

  // Go, Autonomous, routine decisions handled: it repairs before anything else.
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Handle them for me/ }).click();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  await expect.poll(async () => {
    const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=status&order=created_at.desc&limit=1`);
    return run && run.status !== 'running' ? 'ended' : 'running';
  }, { timeout: 120_000 }).toBe('ended');
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status,stop_reason&order=created_at.desc&limit=1`);
  const steps = await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,params,output&order=idx`);
  // The first move is the repair, on the stage the change reopened.
  expect(steps[0]).toMatchObject({ action_key: 'recheck_stage', status: 'succeeded', params: { stage_id: 'output' } });
  expect(steps[0].output).toContain('marked complete again; the earlier version is kept');
  // The Summary's rows carry proposals; Go confirms them under the policy
  // rather than handing over row decisions. Only the row its text does not
  // settle is left (the scripted proposer leaves one), and Go then will not
  // call the objective met while it is open — it says what is open instead.
  expect(steps.map((s: { action_key: string }) => s.action_key)).toEqual(['recheck_stage', 'confirm_proposals', 'declare_objective_complete']);
  const [summaryArtifact] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.summary&select=id`);
  const [summaryHead] = await serviceSelect('artifact_versions', `artifact_id=eq.${summaryArtifact.id}&select=content&order=created_at.desc&limit=1`);
  const rows = JSON.parse(summaryHead.content).items as { status?: string; status_source?: string }[];
  expect(rows.map((r) => r.status_source ?? null)).toEqual(['policy', 'policy', null]);
  expect(run.status).toBe('awaiting_decision');
  expect(run.stop_reason).toBe('The deliverable is written, but the work is not finished: Summary: 1 finding not yet accepted or rejected.');
  await expect(page.getByText('Confirmed under your routine-decision policy').first()).toBeVisible({ timeout: 30_000 });

  // A new version, the old one kept; the stage is closed again, citing it.
  expect(await outputVersions()).toBe(before + 1);
  const [repaired] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_marked_complete&stage_id=eq.output&select=actor,payload&order=seq.desc&limit=1`);
  expect(repaired).toMatchObject({ actor: 'system', payload: { repaired_after: expect.any(String), evidence_version_id: expect.any(String) } });
  await expect(page.getByRole('navigation').getByText('recheck', { exact: true })).toHaveCount(0, { timeout: 30_000 });

  // The stage bar agrees with Go: one thing is still open.
  await expect(page.getByRole('group', { name: 'Stage actions' })).toContainText('Summary: 1 finding not yet accepted or rejected');
  await page.screenshot({ path: test.info().outputPath('02-repaired-by-go.png'), fullPage: true });
});
