import { expect, test } from '@playwright/test';

import { checkStage, createProject, serviceSelect, transitionBar } from './helpers';

/**
 * C1 — PM-21 (critique intensity and tone are separate, user-chosen dials) and
 * PM-25 (the system says when no further AI pass is needed).
 *
 * The scripted evaluator echoes the intensity and tone its prompt carried, so
 * this sees the dials reach the model, not just the page.
 */

test('the critique dials are separate, remembered, and reach the evaluator', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E critique dials', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const dials = page.getByRole('region', { name: 'How to critique' });
  await expect(dials.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
  await expect(dials.getByRole('radio', { name: 'Neutral' })).toHaveAttribute('aria-checked', 'true');

  // Rigorous, but said gently: the combination the old Challenge Mode made impossible.
  await dials.getByRole('radio', { name: 'Rigorous' }).click();
  await dials.getByRole('radio', { name: 'Gentle' }).click();
  await expect(dials).toContainText('Every claim, number and step');
  await expect(dials).toContainText('Encouraging, strengths first');
  await page.screenshot({ path: test.info().outputPath('01-dials.png'), fullPage: true });

  // Remembered on the project.
  await expect
    .poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=critique_intensity,critique_tone`))[0])
    .toEqual({ critique_intensity: 'rigorous', critique_tone: 'gentle' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'How to critique' }).getByRole('radio', { name: 'Rigorous' })).toHaveAttribute('aria-checked', 'true');

  // …and they reach the evaluator's prompt.
  await checkStage(page);
  await expect(page.getByText('(intensity rigorous, tone gentle)').first()).toBeVisible();

  // PM-25: it is clean, and it says so, in words, where the next step is.
  const evaluation = page.getByRole('region', { name: 'Stage evaluation' });
  await expect(evaluation.getByRole('status')).toContainText('No further AI pass needed');
  await expect(evaluation).toContainText("it meets this stage's bar; another pass would only churn it");
  await expect(transitionBar(page)).toContainText('No further AI pass needed — Mock: it meets');
  await page.screenshot({ path: test.info().outputPath('02-no-further-pass.png'), fullPage: true });

  const [stored] = await serviceSelect('evaluations', `project_id=eq.${id}&select=further_pass_needed,further_pass_reason&order=created_at.desc&limit=1`);
  expect(stored.further_pass_needed).toBe(false);
});

test('an artifact with findings is not declared done', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E needs a pass', objective: 'A book about giraffes [[mock:findings=3]]' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await checkStage(page);

  const evaluation = page.getByRole('region', { name: 'Stage evaluation' });
  await expect(evaluation).toContainText('Another pass would help: Mock: the findings are worth one more pass.');
  await expect(evaluation.getByText('No further AI pass needed')).toHaveCount(0);
  await expect(transitionBar(page)).not.toContainText('No further AI pass needed');
  await page.screenshot({ path: test.info().outputPath('03-pass-needed.png'), fullPage: true });

  const [stored] = await serviceSelect('evaluations', `project_id=eq.${id}&select=further_pass_needed&order=created_at.desc&limit=1`);
  expect(stored.further_pass_needed).toBe(true);
});
