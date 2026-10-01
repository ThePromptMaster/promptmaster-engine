import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * 1 Oct, item 4 — "At Drafting, Go knew prose had to be written but said it
 * could not create the drafting artifact, even though the manual drafting
 * system on the same page could."
 *
 * Research has no Outline stage: its outline is built on the Drafting stage
 * from the stages already done. Go could only make an outline on a stage of
 * the `outline` kind, so on Research it had no move that led to prose.
 */

function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

test('on Research, Go builds the outline on the Drafting stage, asks for approval, and drafts the sections', async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go research drafting',
    objective: 'Why pendulums slow down [[mock:plan=generate_outline,draft_sections]]',
  });

  // Ten stages come before Drafting; move through them as a user in a hurry would.
  const drafting = page.getByRole('heading', { name: 'Drafting', exact: true });
  for (let i = 0; i < 12 && !(await drafting.isVisible().catch(() => false)); i += 1) {
    await pressTransition(page);
    await page.waitForTimeout(1_200);
  }
  await expect(drafting).toBeVisible();

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Generate the outline', { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-go-offers-to-build-the-outline.png'), fullPage: true });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText(/I need your approval of (the outline|outline version 1)/, { timeout: 30_000 });
  // The panel's own untouched copy gives way to the version Go saved.
  await expect(page.getByText('Outline history')).toBeVisible();
  await expect(page.getByText(/^Unsaved changes/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-go-asks-for-the-outline-approval.png'), fullPage: true });
  await card.getByRole('button', { name: /pprove the outline/ }).click();

  await expect(prompt).toContainText('Draft the sections', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/(\d+) of \1 sections written/)).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: test.info().outputPath('03-go-drafted-the-sections.png'), fullPage: true });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  const rows = () => serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,changes,tools_used&order=idx`);
  await expect.poll(async () => (await rows()).slice(0, 2).map((s: { action_key: string; status: string }) => [s.action_key, s.status]), { timeout: 30_000 }).toEqual([
    ['generate_outline', 'succeeded'],
    ['draft_sections', 'succeeded'],
  ]);
  const steps = await rows();
  // Built from the stages, not by a model.
  expect(steps[0].tools_used).toEqual([]);
  expect(steps[0].changes.version_ids).toHaveLength(1);
  expect(steps[1].changes.sections_written.length).toBeGreaterThan(1);
  const approvals = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.outline_approved&select=actor`);
  expect(approvals).toEqual([{ actor: 'user' }]);
});

/**
 * Found on production, 2026-10-01: on Research's Literature stage Go checked
 * the list, then applied the findings — through the text revision. The rows
 * came back as prose, the saved version held no rows, and the stage read
 * "No works yet". A table is now revised as a table.
 */
test('Go applying a check\'s findings to a list stage keeps it a list', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go applies to a table',
    objective: 'Why customers churn [[mock:findings=2]] [[mock:plan=evaluate_stage,apply_findings]]',
  });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = page.getByRole('region', { name: / work$/ });
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  for (const move of ['Check this stage', 'Apply the findings']) {
    await expect(prompt).toContainText(move, { timeout: 30_000 });
    await prompt.getByRole('button', { name: 'Approve' }).click();
  }

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  await expect
    .poll(async () => (await serviceSelect('agent_steps', `run_id=eq.${run.id}&action_key=eq.apply_findings&select=status`))[0]?.status, { timeout: 30_000 })
    .toBe('succeeded');
  // Still three works, as rows, in a new version.
  await expect(artifact).toContainText('3 works');
  await expect(artifact).not.toContainText('No works yet');
  await expect(artifact.getByRole('listitem')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('01-list-survives-apply-findings.png'), fullPage: true });
  const [head] = await serviceSelect('artifact_versions', `project_id=eq.${id}&source_operation=eq.applied_findings&select=content`);
  expect(JSON.parse(head.content).items).toHaveLength(3);
});

/**
 * 1 Oct, item 11 — "Literature is normally next, but based on this objective
 * and available internal evidence, the better next action is X." Go can say
 * so; skipping is the user's click, recorded as theirs, and can be undone.
 */
test('Go suggests skipping a stage; the user skips it, and can reopen it later', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E go suggests a skip', objective: 'Why Mid-Market customers churn [[mock:plan=propose_skip]]',
  });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  // The suggestion is itself the pause: no "approve this move" in front of it.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('Literature is normally next, but I would skip it for now.', { timeout: 30_000 });
  await expect(card).toContainText('Mock: the internal data should be looked at before any outside reading.');
  await expect(card).toContainText('a skipped stage can be reopened later');
  await expect(panel.getByRole('button', { name: /^Resume$/ })).toBeVisible(); // the other answer: do the stage
  await page.screenshot({ path: test.info().outputPath('01-go-suggests-skipping.png'), fullPage: true });
  expect(await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_skipped&select=id`)).toHaveLength(0);

  await card.getByRole('button', { name: 'Skip Literature for now' }).click();
  await expect(page.getByRole('heading', { name: 'Hypothesis or proposition' })).toBeVisible({ timeout: 30_000 });
  const [skipped] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.stage_skipped&select=actor,reason,stage_id`);
  expect(skipped).toMatchObject({ actor: 'user', stage_id: 'literature', reason: 'Mock: the internal data should be looked at before any outside reading.' });

  // And back: a skipped stage can be reopened.
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: /Literature/ }).click();
  await expect(page.getByRole('button', { name: 'Reopen to edit' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-skipped-and-reopenable.png') });
});
