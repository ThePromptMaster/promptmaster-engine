import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * B0 — Go mode on a Book (Sean, 28 Sep, items 1 and 2, screenshot 3).
 *
 * Go read Drafting's head version, which does not exist (the chapters live in
 * artifacts.long_form), so it saw "(empty — nothing drafted yet)" on a
 * finished book, marked the stage blocked, and every Resume re-blocked it.
 * Now the planner is told what is written, and a completed manuscript is the
 * evidence Drafting is marked complete with (A2).
 */

function goPanel(page: Page) {
  return page.getByRole('region', { name: 'Go mode', exact: true });
}

async function bookDraftedToTheEnd(page: Page, name: string, objective: string) {
  const id = await createProject(page, { workflow: 'Book', name, objective });
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
  return id;
}

test('Go on a fully drafted stage moves on and marks it complete with the manuscript as evidence', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await bookDraftedToTheEnd(page, 'E2E go book', 'A short book about giraffes [[mock:plan=advance_stage]]');

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  // The planner proposes moving on — not "the artifact is empty, mark blocked".
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Move to the next stage', { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-go-proposes-moving-on.png'), fullPage: true });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('02-drafting-done-by-go.png'), fullPage: true });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status&order=created_at.desc&limit=1`);
  const steps = await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,changes&order=idx`);
  // Guided keeps proposing after the move (the scripted plan then declares
  // the objective complete and waits); the move itself is what matters here.
  expect(steps[0]).toMatchObject({ action_key: 'advance_stage', status: 'succeeded', changes: { event_types: ['stage_marked_complete'] } });

  const [done] = await serviceSelect(
    'workflow_events',
    `project_id=eq.${id}&stage_id=eq.drafting&type=eq.stage_marked_complete&select=payload,actor`
  );
  expect(done.actor).toBe('user'); // approved by the user under Guided
  const [snapshot] = await serviceSelect('artifact_versions', `id=eq.${done.payload.evidence_version_id}&select=source_operation,content`);
  expect(snapshot.source_operation).toBe('long_form_complete');
  expect(snapshot.content).toContain('## 1. Habitat');
});

/**
 * B2b — Go does the stage's own work with the functions the buttons call.
 * The scripted plan spans stages: generate_outline on Outline, draft_sections
 * on Drafting, then move on. The outline's approval stays the user's.
 */
test('Go generates the outline, and once it is approved, drafts every section and moves on', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await createProject(page, {
    workflow: 'Book', name: 'E2E go writes', objective: 'A short book about giraffes [[mock:plan=generate_outline,draft_sections,advance_stage]]',
  });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');
  await expect(page.getByRole('heading', { name: 'Outline', exact: true })).toBeVisible();

  // Outline: Go generates it (the same call as "Generate the outline").
  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Generate the outline', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('list', { name: 'Go mode steps' }).getByRole('listitem').filter({ hasText: 'Generated an outline' })).toHaveCount(1, { timeout: 30_000 });
  // Guided then proposes the next move (moving on); approving the outline is
  // the user's, so decline it and approve by hand. (B4 makes Go ask for exactly this.)
  await expect(prompt).toContainText('Move to the next stage', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Decline' }).click();
  // The panel shows the version Go saved, unapproved: approving stays the user's.
  await expect(page.getByLabel('Title of section 1')).toHaveValue(/Mock section 1/, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('03-go-generated-the-outline.png'), fullPage: true });
  await transitionBar(page).getByRole('button', { name: 'Approve this outline' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Outline approval/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Draft/ })).toBeVisible();

  // Drafting: Go writes every section through the queue and waits for them.
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await expect(prompt).toContainText('Draft the sections', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/3 of 3 sections written/)).toBeVisible({ timeout: 90_000 });
  // …then proposes moving on, with the manuscript as evidence (A2).
  await expect(prompt).toContainText('Move to the next stage', { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('04-go-drafted-every-section.png'), fullPage: true });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible({ timeout: 30_000 });

  const runs = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at`);
  const steps = await serviceSelect('agent_steps', `run_id=in.(${runs.map((r: { id: string }) => r.id).join(',')})&select=action_key,status,execution_label,changes&order=started_at`);
  expect(steps.map((s: { action_key: string; status: string }) => [s.action_key, s.status])).toEqual([
    ['generate_outline', 'succeeded'],
    ['advance_stage', 'cancelled'], // declined: the outline was the user's to approve
    ['draft_sections', 'succeeded'],
    ['advance_stage', 'succeeded'],
  ]);
  expect(steps[0].changes.version_ids).toHaveLength(1);
  expect(steps[2].changes.sections_written).toHaveLength(3);
  expect(steps[2].execution_label).toBe('designed');
  const [outlineVersion] = await serviceSelect('artifact_versions', `id=eq.${steps[0].changes.version_ids[0]}&select=source_operation`);
  expect(outlineVersion.source_operation).toBe('agent_outline');
});
