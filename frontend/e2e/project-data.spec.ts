import { expect, test } from '@playwright/test';

import { join } from 'node:path';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * 1 Oct, items 16 and 17 — "Can PromptMaster currently actually execute
 * experiments if the data and tools are present? … ingest a CSV, query a
 * dataset, run statistics?" It could not: there was nowhere to put data, and
 * the sandbox ran with no input files. A file attached to the project is now
 * in /data when the project runs code, and the code is written against its
 * real columns.
 */
test('a CSV attached to the project is read by the code Go runs', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E project data',
    objective: 'Why Mid-Market customers churn [[mock:plan=run_computation]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  const data = page.getByRole('region', { name: 'Project data' });
  await expect(data).toContainText('No data attached. Without data, analyses can be planned but not run');
  await data.getByLabel('Attach data files').setInputFiles({
    name: 'accounts.csv', mimeType: 'text/csv',
    buffer: Buffer.from('account_id,plan,churned\nA1,Mid-Market,1\nA2,Enterprise,0\nA3,Mid-Market,1\n'),
  });
  await expect(data).toContainText('accounts.csv');
  await expect(data).toContainText('3 rows · account_id, plan, churned');
  // A spreadsheet is attached as one CSV per sheet that holds anything.
  await data.getByLabel('Attach data files').setInputFiles(join(__dirname, 'fixtures/churn-workbook.xlsx'));
  await expect(data.getByRole('status')).toContainText('churn-workbook.xlsx was converted to CSV — 2 files, one per sheet');
  await expect(data).toContainText('churn-workbook - Accounts.csv');
  await expect(data).toContainText('12 rows · account_id, segment, seats, churned');
  await expect(data).toContainText('churn-workbook - Notes.csv');
  await expect(data).toContainText('Data · 3 files');
  // Something that is not data is refused, and says what is accepted.
  await data.getByLabel('Attach data files').setInputFiles({ name: 'deck.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await expect(data.getByRole('alert')).toContainText('not a spreadsheet (.xlsx), CSV, TSV, JSON or text file');
  await page.screenshot({ path: test.info().outputPath('01-data-attached.png'), fullPage: true });

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  const planned = page.waitForRequest((r) => r.url().includes('/api/agent/next-action') && r.method() === 'POST');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  // The planner is told the data exists — its shape, not its contents.
  const { state } = (await planned).postDataJSON();
  expect(state.tools).toMatchObject({ datasets: true });
  expect(state.data_files[0]).toMatchObject({ name: 'accounts.csv', columns: ['account_id', 'plan', 'churned'], rows: 3 });

  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Run a computation', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  // The run really had the file: the scripted sandbox reports what was in /data.
  await expect(panel).toContainText('Data available to the code: accounts.csv', { timeout: 30_000 });
  await expect(panel).toContainText('accounts.csv: 3 rows');
  await page.screenshot({ path: test.info().outputPath('02-code-read-the-data.png'), fullPage: true });

  const [run] = await serviceSelect('sandbox_runs', `project_id=eq.${id}&select=code,stdout,status`);
  expect(run.status).toBe('ok');
  expect(run.code).toContain('/data/accounts.csv');
  expect(run.stdout).toContain('accounts.csv: 3 rows');
  const files = await serviceSelect('project_files', `project_id=eq.${id}&select=name,bytes,preview,content_type&order=created_at`);
  expect(files.map((f: { name: string }) => f.name)).toEqual(['accounts.csv', 'churn-workbook - Accounts.csv', 'churn-workbook - Notes.csv']);
  expect(files[0].preview).toMatchObject({ kind: 'table', rows: 3 });
  // The workbook is stored as the CSV it became, never as the .xlsx.
  expect(files[1]).toMatchObject({ content_type: 'text/csv', preview: { kind: 'table', rows: 12 } });
});

/**
 * 1 Oct, items 17 and 32 — a run that really executed is execution truth: it
 * settles the row it carried out ("Completed" is never the model's to say,
 * but it is the sandbox's), and the results it printed go on the stage's
 * figures without a model reading them.
 */
test('a computation that ran marks its row Completed and records what it printed', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E run recorded',
    objective: 'Why Mid-Market customers churn [[mock:plan=run_computation]] [[mock:row=2]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await page.getByRole('region', { name: 'Project data' }).getByLabel('Attach data files').setInputFiles({
    name: 'accounts.csv', mimeType: 'text/csv',
    buffer: Buffer.from('account_id,plan,churned\nA1,Mid-Market,1\nA2,Enterprise,0\nA3,Mid-Market,1\n'),
  });
  await expect(page.getByRole('region', { name: 'Project data' })).toContainText('accounts.csv');

  for (const heading of ['Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }
  // As drafted: run 1 "not run" (the model's), runs 2 and 3 undecided.
  const rows = stageArtifact(page).getByRole('row');
  await expect(stageArtifact(page)).toContainText('2 still to resolve');

  // With data attached Go does not stop for the undecided runs: it may carry one out.
  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  const planned = page.waitForRequest((r) => r.url().includes('/api/agent/next-action') && r.method() === 'POST');
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const { state } = (await planned).postDataJSON();
  expect(state.artifact_excerpt).toContain('2. [undecided]');
  expect(state.artifact_excerpt).toContain("give the row's number as `row`");
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Run a computation', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  await expect(panel).toContainText('Recorded on the table: row 2 is now "Completed"', { timeout: 30_000 });
  await expect(panel).toContainText('Recorded 1 figure the code printed');
  // (Row 1's reason has a table row of its own, so the second run is the fourth.)
  await expect(rows.nth(3)).toContainText('Completed');
  await expect(rows.nth(3)).toContainText('Recorded from a sandbox run');
  await expect(rows.nth(3)).toContainText('Ran in the sandbox (run ');
  await expect(rows.nth(3)).toContainText('accounts.csv: 3 rows');
  await expect(stageArtifact(page)).toContainText('1 still to resolve');
  await expect(stageArtifact(page)).toContainText('1 recorded from code that ran in the sandbox');
  await stageArtifact(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-run-recorded-on-its-row.png'), fullPage: true });

  const [run] = await serviceSelect('sandbox_runs', `project_id=eq.${id}&select=id,status,exit_code`);
  expect(run).toMatchObject({ status: 'ok', exit_code: 0 });
  const [version] = await serviceSelect('artifact_versions', `project_id=eq.${id}&source_operation=eq.sandbox_result&select=id,content,change_summary`);
  const items = JSON.parse(version.content).items;
  expect(items[1]).toMatchObject({ status: 'completed', status_source: 'sandbox', sandbox_run_id: run.id });
  // The model's own "not run" on row 1 is untouched, and row 3 is still the user's.
  expect(items[0]).toMatchObject({ status: 'not_run', status_source: 'model' });
  expect(items[2].status ?? '').toBe('');
  const [artifact] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.experiment&select=key_figures`);
  expect(artifact.key_figures.version_id).toBe(version.id);
  expect(artifact.key_figures.figures).toEqual([
    { name: 'accounts.csv', value: '3 rows', context: `Printed by sandbox run ${run.id.slice(0, 8)}`, source: 'sandbox' },
  ]);
  const [step] = await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.run_computation&select=status,execution_label,changes`);
  expect(step).toMatchObject({ status: 'succeeded', execution_label: 'code_executed' });
  expect(step.changes).toMatchObject({ sandbox_run_id: run.id, version_ids: [version.id], figures_recorded: 1 });
});
