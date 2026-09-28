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
  expect(steps).toMatchObject([{ action_key: 'advance_stage', status: 'succeeded', changes: { event_types: ['stage_marked_complete'] } }]);

  const [done] = await serviceSelect(
    'workflow_events',
    `project_id=eq.${id}&stage_id=eq.drafting&type=eq.stage_marked_complete&select=payload,actor`
  );
  expect(done.actor).toBe('user'); // approved by the user under Guided
  const [snapshot] = await serviceSelect('artifact_versions', `id=eq.${done.payload.evidence_version_id}&select=source_operation,content`);
  expect(snapshot.source_operation).toBe('long_form_complete');
  expect(snapshot.content).toContain('## 1. Habitat');
});
