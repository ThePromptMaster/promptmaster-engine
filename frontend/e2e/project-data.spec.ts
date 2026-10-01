import { expect, test } from '@playwright/test';

import { createProject, serviceSelect, stageArtifact } from './helpers';

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
  // A spreadsheet is refused, and says how to bring it in.
  await data.getByLabel('Attach data files').setInputFiles({ name: 'book.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(data.getByRole('alert')).toContainText('not a CSV, TSV, JSON or text file');
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
  const files = await serviceSelect('project_files', `project_id=eq.${id}&select=name,bytes,preview`);
  expect(files).toHaveLength(1);
  expect(files[0].preview).toMatchObject({ kind: 'table', rows: 3 });
});
