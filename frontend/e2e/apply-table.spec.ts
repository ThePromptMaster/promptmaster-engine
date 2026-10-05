import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceInsert, serviceSelect } from './helpers';

/**
 * L1 (4 Oct, Options): applying a recommendation to a stage that holds a table.
 *
 * The Recommendations panel's Apply sent the rows through the prose revision.
 * What came back was text; it was saved as v3, the stage read "No claims yet",
 * and its criteria fell from 1/2 to 0/2. Now the rows are revised by the
 * generator that drafted them, and nothing that is not a table can become the
 * stage's current version.
 */
test('Apply on a table stage keeps the table', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E apply a table', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  // The audience stage is a table of segments, drafted on arrival.
  await expect(page.getByText(/^\d+ audience segments?$/)).toBeVisible();

  const [project] = await serviceSelect('projects', `id=eq.${projectId}&select=user_id`);
  const [artifact] = await serviceSelect('artifacts', `project_id=eq.${projectId}&stage_id=eq.audience&select=id,current_version_id`);
  const before = await serviceSelect('artifact_versions', `artifact_id=eq.${artifact.id}&select=content`);
  const rowsBefore = JSON.parse(before[0].content).items.length;
  expect(rowsBefore).toBeGreaterThan(0);

  // A stage check's correction, pending against the current table.
  await serviceInsert('recommendations', {
    user_id: project.user_id,
    project_id: projectId,
    version_id: artifact.current_version_id,
    kind: 'fix',
    category: 'e2e-sharpen-segments',
    title: 'Sharpen the segments',
    summary: 'The segments are broad.',
    suggested_change: 'Name each segment by what it does.',
    instruction: 'Make every segment specific.',
    scope: { kind: 'document', stage_id: 'audience' },
    severity: 'minor',
  });
  await page.reload();
  const panel = page.getByRole('region', { name: 'Recommendations' });
  await expect(panel.getByText('Sharpen the segments')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-a-fix-for-the-table.png'), fullPage: true });

  await panel.getByRole('button', { name: 'Apply…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();

  const versions = await serviceSelect(
    'artifact_versions',
    `artifact_id=eq.${artifact.id}&select=version_number,source_operation,content&order=version_number`
  );
  expect(versions.map((v: { source_operation: string }) => v.source_operation)).toEqual(['stage_draft', 'applied_recommendations']);
  // Still a table, still with rows — not "No segments yet".
  expect(JSON.parse(versions[1].content).items.length).toBeGreaterThan(0);
  await expect(page.getByText(/^\d+ audience segments?$/)).toBeVisible();
  await expect(page.getByText(/No .* yet\. Draft one/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-the-table-survives.png'), fullPage: true });
});
