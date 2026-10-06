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

/**
 * G1 (Sean, 5 Oct: "A proposed revision is empty, malformed, or drops required
 * content. The revision should fail validation, the populated artifact should
 * remain current … The failed attempt should remain visible in history.")
 *
 * A row the user decided is not in the regenerated table, so the revision is
 * refused, the current version stays, and the refusal is shown on the stage.
 */
test('a revision that drops a row the user decided is refused, and says so', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E refused revision', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByText(/^\d+ audience segments?$/)).toBeVisible();

  const [project] = await serviceSelect('projects', `id=eq.${projectId}&select=user_id`);
  const [artifact] = await serviceSelect('artifacts', `project_id=eq.${projectId}&stage_id=eq.audience&select=id`);
  const [draft] = await serviceSelect('artifact_versions', `artifact_id=eq.${artifact.id}&select=content`);
  const doc = JSON.parse(draft.content);
  // The user's own row, with their decision on it.
  doc.items.push({ id: 'mine', segment: 'Zoo volunteers', status: 'accepted', status_source: 'user' });
  await serviceInsert('artifact_versions', {
    user_id: project.user_id, project_id: projectId, artifact_id: artifact.id,
    source_operation: 'stage_edit', content: JSON.stringify(doc), instruction: '', model: '', mode: 'architect',
  });
  const [head] = await serviceSelect('artifacts', `id=eq.${artifact.id}&select=current_version_id`);
  await serviceInsert('recommendations', {
    user_id: project.user_id, project_id: projectId, version_id: head.current_version_id,
    kind: 'fix', category: 'e2e-refused', title: 'Sharpen the segments', summary: 'The segments are broad.',
    suggested_change: 'Name each segment by what it does.', instruction: 'Make every segment specific.',
    scope: { kind: 'document', stage_id: 'audience' }, severity: 'minor',
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /^v2/ })).toBeVisible();

  const panel = page.getByRole('region', { name: 'Recommendations' });
  await panel.getByRole('button', { name: 'Apply…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(page.getByRole('status', { name: 'Refused revision' })).toContainText(
    'A revision was refused: The revision dropped a row you had decided ("Zoo volunteers"), so the current version was kept. v2 stays current.'
  );
  const versions = await serviceSelect('artifact_versions', `artifact_id=eq.${artifact.id}&select=version_number`);
  expect(versions).toHaveLength(2);
  const [event] = await serviceSelect('workflow_events', `project_id=eq.${projectId}&type=eq.revision_refused&select=actor,reason,payload`);
  expect(event).toMatchObject({ actor: 'user', payload: { operation: 'applied_recommendations' } });
  await page.screenshot({ path: test.info().outputPath('03-refused-in-the-dialog.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('status', { name: 'Refused revision' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('04-refusal-kept-on-the-stage.png') });
});
