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
 * B2b + B4 — Go does the stage's own work with the functions the buttons
 * call, and when the next move is the user's it says so with the button
 * right there. One Guided run, one scripted plan that spans stages.
 */
test('Go generates the outline, asks for its approval with the button, drafts every section and moves on', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await createProject(page, {
    workflow: 'Book', name: 'E2E go writes',
    objective: 'A short book about giraffes [[mock:plan=generate_outline,advance_stage,advance_stage,draft_sections,advance_stage]]',
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

  // B4: approving the outline is the user's — and the button is right there.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I need your approval of outline version 1 before I can continue.', { timeout: 30_000 });
  await expect(panel.getByRole('button', { name: /^Resume$/ })).toHaveCount(0);
  await expect(page.getByLabel('Title of section 1')).toHaveValue(/Mock section 1/, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('03-go-needs-the-outline-approved.png'), fullPage: true });
  await card.getByRole('button', { name: 'Approve the outline' }).click();
  await expect(page.getByText(/Approved · v1/).first()).toBeVisible({ timeout: 15_000 });

  // The run resumes on its own: through Approval to Drafting, drafting every
  // section through the real queue, then moving on with the manuscript (A2).
  for (const move of ['Move to the next stage', 'Move to the next stage', 'Draft the sections']) {
    await expect(prompt).toContainText(move, { timeout: 30_000 });
    await prompt.getByRole('button', { name: 'Approve' }).click();
  }
  await expect(page.getByText(/3 of 3 sections written/)).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText('Move to the next stage', { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('04-go-drafted-every-section.png'), fullPage: true });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible({ timeout: 30_000 });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  const stepRows = () => serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,execution_label,changes&order=idx`);
  // The page moves on before the last step row is closed; wait for the record.
  // Guided may already have proposed one more move on Continuity (the plan is
  // exhausted, so it declares the objective complete and waits); the five
  // moves are what matter.
  await expect.poll(async () => (await stepRows()).slice(0, 5).map((s: { action_key: string; status: string }) => [s.action_key, s.status]), { timeout: 15_000 }).toEqual([
    ['generate_outline', 'succeeded'],
    ['advance_stage', 'succeeded'],
    ['advance_stage', 'succeeded'],
    ['draft_sections', 'succeeded'],
    ['advance_stage', 'succeeded'],
  ]);
  const steps = await stepRows();
  expect(steps[0].changes.version_ids).toHaveLength(1);
  expect(steps[3].changes.sections_written).toHaveLength(3);
  expect(steps[3].execution_label).toBe('designed');
  const [outlineVersion] = await serviceSelect('artifact_versions', `id=eq.${steps[0].changes.version_ids[0]}&select=source_operation`);
  expect(outlineVersion.source_operation).toBe('agent_outline');
  // The approval was the user's click, on the record.
  const approvals = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.outline_approved&select=actor`);
  expect(approvals).toEqual([{ actor: 'user' }]);
  // Outline approval has no artifact to cite, and the user approved the move:
  // it is complete, not left open (a left-open stage is one the planner then
  // keeps asking the user about).
  const approvalMoves = await serviceSelect('workflow_events', `project_id=eq.${id}&stage_id=eq.outline_approval&type=in.(stage_marked_complete,stage_advanced)&select=type,actor,payload`);
  expect(approvalMoves).toMatchObject([{ type: 'stage_marked_complete', actor: 'user' }]);
  expect(approvalMoves[0].payload?.evidence_version_id).toBeUndefined();
});

/**
 * B3 — under Autonomous, Go decides the routine findings itself and stops
 * for the ones that would change the work (Sean, 28 Sep, items 10 and 11).
 * The mock's continuity review has one major finding and two minor ones.
 */
test('Autonomous decides the routine continuity findings and leaves the major one to the user', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await bookDraftedToTheEnd(page, 'E2E go triage', 'A short book about giraffes [[mock:plan=triage_findings]]');
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible();
  await expect(stageArtifact(page).getByText(/\(read the manuscript\)/).first()).toBeVisible();
  await expect(page.getByRole('table').getByRole('combobox')).toHaveCount(3);

  const panel = goPanel(page);
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  // Two minor findings decided by Go, as a version; the major one is the user's.
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('1 finding would change the work, so it needs your decision', { timeout: 30_000 });
  const statuses = page.getByRole('table').getByRole('combobox');
  await expect(statuses.nth(0)).toContainText('Not looked at');
  await expect(statuses.nth(1)).toContainText('Accept');
  await expect(statuses.nth(2)).toContainText('Accept');
  await page.screenshot({ path: test.info().outputPath('05-autonomous-decided-the-routine-findings.png'), fullPage: true });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id,status,needs&order=created_at.desc&limit=1`);
  expect(run.status).toBe('awaiting_decision');
  expect(run.needs).toMatchObject({ kind: 'triage_findings', count: 1 });
  const steps = await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=action_key,status,execution_label,changes&order=idx`);
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ action_key: 'triage_findings', status: 'succeeded', execution_label: 'discussed' });
  expect(steps[0].changes.items_triaged).toEqual(['i2', 'i3']);
  const [version] = await serviceSelect('artifact_versions', `id=eq.${steps[0].changes.version_ids[0]}&select=source_operation,content`);
  expect(version.source_operation).toBe('agent_triage');
  const rows = JSON.parse(version.content).items as { id: string; status?: string; reason?: string }[];
  expect(rows.map((r) => r.status ?? null)).toEqual([null, 'accepted', 'accepted']);

  // The card has no button of its own ("Decide in the table below. Then press
  // Resume."), so Resume must be there — it was hidden behind every card
  // once, and a run stopped here could never continue.
  await expect(panel.getByRole('button', { name: /^Resume$/ })).toBeVisible();
  await statuses.nth(0).click();
  await page.getByRole('option', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('1 of 1 done')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: /^Resume$/ }).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await serviceSelect('agent_steps', `run_id=eq.${run.id}&select=idx`)).length, { timeout: 30_000 }).toBeGreaterThan(1);
});
