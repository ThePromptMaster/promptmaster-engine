import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * PM-11 — the stages after drafting do real work on the chapters.
 *
 * Found in the Phase A verification pass: Continuity, Critique and Fact-check
 * were sent a 320-character summary of the book and reviewed that ("the draft
 * material provided is incomplete"), and Revision re-showed the drafting panel
 * with no way to apply what they found.
 *
 * The scripted model says what it was given: review rows carry "(read the
 * manuscript)" when the chapters reached the prompt, and a rewrite names the
 * first finding it was asked to apply.
 */
test('review stages read the manuscript, and Revision applies the accepted findings', async ({ page }) => {
  test.setTimeout(180_000);
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E revision', objective: 'A short book about giraffes' });

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

  // Drafting: the stage bar leads with the real step, and each section shows its length.
  await transitionBar(page).getByRole('button', { name: 'Start drafting' }).click();
  await expect(page.getByText('2 of 2 sections written')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/\d+ words/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume drafting' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-drafted-with-word-counts.png'), fullPage: true });

  // A2: the Markdown export is the book, not a note that nothing was written.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export/ }).click();
  await page.getByRole('menuitem', { name: /Markdown document/ }).click();
  const exported = readFileSync((await (await download).path())!, 'utf8');
  expect(exported).toContain('## 1. Habitat');
  expect(exported).toContain('## 2. Diet');
  expect(exported).not.toContain('Started, but nothing was written');

  // Continuity reviews the chapters themselves.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible();

  // A2: Drafting completed *with evidence* — a saved snapshot of the manuscript,
  // cited by the event. It used to complete with none, and Go left it open.
  const drafted = (await serviceSelect(
    'workflow_events',
    `project_id=eq.${projectId}&stage_id=eq.drafting&type=eq.stage_marked_complete&select=payload`
  )) as { payload: { evidence_version_id?: string } }[];
  expect(drafted).toHaveLength(1);
  const evidenceId = drafted[0].payload.evidence_version_id;
  expect(evidenceId).toBeTruthy();
  const [snapshot] = (await serviceSelect(
    'artifact_versions',
    `id=eq.${evidenceId}&select=source_operation,content`
  )) as { source_operation: string; content: string }[];
  expect(snapshot.source_operation).toBe('long_form_complete');
  expect(snapshot.content).toContain('## 1. Habitat');
  expect(snapshot.content).toContain('## 2. Diet');
  await expect(stageArtifact(page).getByText(/\(read the manuscript\)/).first()).toBeVisible();
  const statuses = page.getByRole('table').getByRole('combobox');
  await statuses.first().click();
  await page.getByRole('option', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await page.screenshot({ path: test.info().outputPath('02-continuity-read-the-manuscript.png'), fullPage: true });

  // Revision: one primary action that applies what was accepted.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Revision' })).toBeVisible();
  const apply = transitionBar(page).getByRole('button', { name: 'Apply 1 finding to every section' });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByText('2 of 2 sections revised')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: '1. Habitat' }).click();
  await expect(page.getByText(/Revised by the mock model, applying: - \(Continuity.*\) Mock finding 1/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-revision-applied-the-finding.png'), fullPage: true });
});
