import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * 1 Oct, items 3, 12 and 18 — what PromptMaster already knows reaches the
 * structured field, and what it only recalls is labelled as recalled.
 */
test('recalled works are candidates; a run the draft knows was not run arrives marked, with its reason', async ({ page }) => {
  test.setTimeout(120_000);
  await createProject(page, { workflow: 'Research', name: 'E2E structured state', objective: 'Why customers churn' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);

  // Literature: every generated work is a candidate, and the stage says so.
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });
  await expect(artifact.getByRole('note')).toContainText("3 of 3 works were suggested from the model's knowledge");
  await expect(artifact.getByRole('combobox').first()).toContainText('Suggested by PromptMaster — not retrieved');
  await expect(criterion(page, 'At least three candidate works identified')).toBeVisible();
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('0 of 3');
  await page.screenshot({ path: test.info().outputPath('01-literature-candidates.png'), fullPage: true });

  // The user verifies one: the count follows once it is saved.
  await artifact.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Verified by me' }).click();
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('1 of 3');
  await expect(artifact.getByRole('note')).toContainText('2 of 3 works');

  // On to Experiment (Hypothesis and Method on the way).
  for (const heading of ['Hypothesis or proposition', 'Method', 'Experiment or investigation']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }

  // The scripted model marks run 1 "not run" with its reason, claims run 2
  // "completed", and says nothing about run 3. Only the first is kept.
  const rows = stageArtifact(page).getByRole('row');
  await expect(rows.nth(1)).toContainText('Not run');
  await expect(rows.nth(1)).toContainText('Set by PromptMaster');
  await expect(stageArtifact(page).getByLabel(/Why not run/i)).toHaveValue('Mock: the data this needs was never provided.');
  await expect(stageArtifact(page)).toContainText('2 still to resolve');
  await expect(stageArtifact(page)).toContainText('1 set by PromptMaster from what it already knew');
  // (The legend under the table names every status; the rows are what is checked.)
  await expect(stageArtifact(page).getByRole('combobox').filter({ hasText: 'Completed' })).toHaveCount(0);
  // On a check stage the checklist folds to one line until opened (3 Oct call).
  await page.getByRole('button', { name: /To finish this stage/ }).click();
  await expect(criterion(page, 'Every planned run has a result or a reason')).toContainText('2 still unresolved');
  await page.screenshot({ path: test.info().outputPath('02-experiment-not-run-prefilled.png'), fullPage: true });
});

/**
 * 1 Oct, item 15 — on a table stage the chat answered and then offered
 * sentence-level prose fixes. It now offers row changes, shown row by row
 * before they are saved.
 */
test('on a table stage a chat answer becomes row changes, reviewed before saving', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Research', name: 'E2E chat rows', objective: 'Why customers churn' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });

  const chat = page.getByRole('region', { name: 'Side chat' });
  // A discussion cannot be saved over a table as prose.
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill('Were any of these actually retrieved?');
  await chat.getByRole('button', { name: 'Ask' }).click();
  const act = chat.getByRole('region', { name: 'Act on this reply' });
  // The scripted model also offers "Rewrite it as prose"; that is refused for a table.
  await expect(act.getByRole('button')).toHaveText(['Update the first row', 'Add the missing row', 'Do nothing']);
  await expect(chat.getByRole('button', { name: 'Save this discussion as a new version' })).toHaveCount(0);

  await act.getByRole('button', { name: 'Update the first row' }).click();
  const review = chat.getByRole('region', { name: 'Review the change' });
  await expect(review).toContainText('Mock work 1');
  await expect(review).toContainText('Mock: updated from the chat.');
  await expect(review).toContainText('Status: Suggested by PromptMaster — not retrieved → Verified by me');
  await page.screenshot({ path: test.info().outputPath('01-row-change-reviewed.png'), fullPage: true });
  expect(await serviceSelect('artifact_versions', `project_id=eq.${id}&source_operation=eq.chat_rows&select=id`)).toHaveLength(0);

  await review.getByRole('button', { name: 'Save as a new version (1 row)' }).click();
  await expect(artifact).toContainText('Mock: updated from the chat.');
  await expect(artifact.getByRole('listitem')).toHaveCount(3);
  await expect(artifact.getByRole('combobox').first()).toContainText('Verified by me');
  await page.screenshot({ path: test.info().outputPath('02-row-change-saved.png'), fullPage: true });
  const [saved] = await serviceSelect('artifact_versions', `project_id=eq.${id}&source_operation=eq.chat_rows&select=content,change_summary`);
  expect(saved.change_summary).toBe('From the side chat: Update the first row (1 row).');
  expect(JSON.parse(saved.content).items[0]).toMatchObject({ status: 'verified', status_source: 'user' });
});

/**
 * 1 Oct, item 12 — "How are candidate literature references supposed to
 * become verified literature?" The first step: look each named work up. A
 * found record makes the row "Retrieved", with its DOI; one that is not found
 * stays a candidate.
 */
test('candidate works are looked up: found ones become Retrieved with a DOI, by button and by Go', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E literature lookup', objective: 'Why customers churn [[mock:plan=check_literature]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });

  // By hand: the result is shown unsaved, with what it does and does not mean.
  await artifact.getByRole('button', { name: 'Look up these works' }).click();
  await expect(artifact.getByRole('status')).toContainText('1 of 3 works found in OpenAlex.', { timeout: 30_000 });
  await expect(artifact.getByRole('status')).toContainText('2 not found — they may be misremembered, or not exist.');
  await expect(artifact.getByRole('status')).toContainText('means the work exists, not that it says what the row claims');
  await expect(artifact.getByRole('combobox').first()).toContainText('Retrieved by PromptMaster');
  await expect(artifact.getByRole('combobox').nth(1)).toContainText('Suggested by PromptMaster');
  await expect(artifact.getByLabel('DOI or link').first()).toHaveValue('https://doi.org/10.0000/mock.1');
  await expect(artifact.getByLabel('Record found').first()).toHaveValue('Mock work 1 (the record) — Mock, A. (2020)');
  await page.screenshot({ path: test.info().outputPath('01-looked-up-not-yet-saved.png'), fullPage: true });
  expect(await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`)).toHaveLength(2); // question + literature draft
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('1 of 3');

  // By Go: the same lookup, as a step that says what it used.
  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Check literature', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();
  await expect(panel).toContainText('1 of 3 works found in OpenAlex.', { timeout: 30_000 });
  await expect(panel).toContainText('Not found: Mock work 2');
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  await expect
    .poll(async () => (await serviceSelect('agent_steps', `run_id=eq.${run.id}&action_key=eq.check_literature&select=status,execution_label,tools_used`))[0], { timeout: 15_000 })
    .toMatchObject({ status: 'succeeded', execution_label: 'discussed', tools_used: ['search'] });
  await page.screenshot({ path: test.info().outputPath('02-go-looked-the-works-up.png'), fullPage: true });
});

/**
 * 2 Oct — Go chose "Check literature" on a stage with no works to check and
 * stopped. It now searches OpenAlex by topic and adds the records it finds as
 * rows the tool retrieved, with nothing said about what they establish.
 */
test('Go searches for works by topic and adds what it finds as Retrieved rows', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Research', name: 'E2E literature search', objective: 'Why customers churn [[mock:plan=check_literature]] [[mock:search]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('0 of 3');

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Guided/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();
  const prompt = page.getByRole('region', { name: 'Go mode needs your approval' });
  await expect(prompt).toContainText('Check literature', { timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Approve' }).click();

  await expect(panel).toContainText('Searched OpenAlex for "Mock: customer churn": 3 works returned.', { timeout: 30_000 });
  await expect(panel).toContainText('3 works added to this stage as "Retrieved by PromptMaster"');
  await expect(panel).toContainText('Nobody has read them');
  await expect(artifact).toContainText('Mock found work 1 on the topic', { timeout: 15_000 });
  // Three retrieved works meet the criterion, so it no longer shows a count.
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('check_circle');
  await expect(criterion(page, 'At least three works retrieved or verified')).not.toContainText(' of ');
  await page.screenshot({ path: test.info().outputPath('01-go-searched-and-added-works.png'), fullPage: true });

  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=id&order=created_at.desc&limit=1`);
  await expect
    .poll(async () => (await serviceSelect('agent_steps', `run_id=eq.${run.id}&action_key=eq.check_literature&select=status,execution_label,tools_used`))[0], { timeout: 15_000 })
    .toMatchObject({ status: 'succeeded', execution_label: 'discussed', tools_used: ['search'] });
  const [saved] = await serviceSelect('artifact_versions', `project_id=eq.${id}&source_operation=eq.literature_search&select=content,change_summary`);
  expect(saved.change_summary).toBe('Found in OpenAlex for "Mock: customer churn": 3 works added.');
  const items = JSON.parse(saved.content).items;
  expect(items).toHaveLength(6);
  expect(items[3]).toMatchObject({
    work: 'Mock, A. (2021). Mock found work 1 on the topic', link: 'https://doi.org/10.0000/mock.found.1',
    status: 'retrieved', status_source: 'tool', finding: '', relation: '',
  });
});

/**
 * 2 Oct, items 12 and 13 — rows on Validation read "Reproduced" over text
 * saying nothing had been recalculated. The statuses now say what was
 * actually done, each with one plain line, and the table asks its question
 * in plain words.
 */
test('Validation tells independent reproduction from support by earlier evidence, in plain words', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page, { workflow: 'Research', name: 'E2E validation statuses', objective: 'Why customers churn' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  for (const heading of ['Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation', 'Analysis', 'Alternative explanations', 'Reproduction or validation']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('do you accept it as sufficiently supported to move forward?');
  const legend = artifact.getByLabel('What the statuses mean');
  await expect(legend).toContainText('It agrees with earlier studies or records. Nothing was recalculated.');
  await expect(legend).toContainText('Only you can say this — PromptMaster never sets it.');

  await artifact.getByRole('combobox').first().click();
  await expect(page.getByRole('option')).toHaveText([
    'Independently reproduced', 'Supported by prior evidence', 'Consistency check only', 'Not reproduced', 'Not attempted',
  ]);
  await page.screenshot({ path: test.info().outputPath('03-validation-status-choices.png') });
  await page.getByRole('option', { name: 'Supported by prior evidence' }).click();
  await expect(artifact.getByRole('combobox').first()).toContainText('Supported by prior evidence');
  await artifact.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('04-validation-table.png'), fullPage: true });
});
