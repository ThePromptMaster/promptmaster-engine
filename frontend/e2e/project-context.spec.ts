import { expect, test } from '@playwright/test';

import { dismissBetaNotice, pressTransition, serviceSelect, transitionBar } from './helpers';

/**
 * N3 (4 Oct, items 7 and 11).
 *
 * A board-level brief pasted as the objective was refused at its limit; now a
 * long first message becomes the Project context in full, with its opening as
 * an editable objective. And a figure the draft states with no source in the
 * project — the memo's invented 15–25% — is reported by the stage check.
 */
const OPENING =
  'The Board has asked management to determine why profitability has deteriorated despite continued revenue growth, decide what should be done, and produce a defensible 12-month operating plan.';
const FACTS = Array.from({ length: 40 }, (_, i) => `- Plant ${i + 1}: revenue $${(i + 1) * 7}.5m, gross margin ${20 + (i % 9)}.4%.`).join('\n');
const BRIEF = `Northstar Precision Systems — board brief\n\n${OPENING}\n\n${FACTS}`;

test('a long brief becomes the project context, and the objective stays short', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill(BRIEF);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();

  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(OPENING);
  await expect(page.getByLabel('Project context')).toHaveValue(BRIEF);
  await page.getByLabel('Project context').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-brief-kept-as-context.png') });

  await page.getByRole('radio', { name: /^Book/ }).click();
  await page.getByLabel('Project name').fill('E2E project context');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=objective,context`);
  expect(project).toEqual({ objective: OPENING, context: BRIEF });

  // The brief on every later stage shows it and can change it.
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await page.getByText('Project brief').click();
  await expect(page.getByLabel(/^Project context/)).toHaveValue(BRIEF);
  await page.screenshot({ path: test.info().outputPath('03-context-in-the-project-brief.png') });
});

test('a figure with no source in the project is reported by the stage check', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill(BRIEF);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('radio', { name: /^Book/ }).click();
  await page.getByLabel('Project name').fill('E2E unsupported figures');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // A draft quoting the brief's figures, and inventing a recovery range.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: /Edit/ }).fill(
    'Plant 1 earned $7.5m at a 20.4% margin. Recovery could reach 15–25% within a year, a bounded scenario.'
  );
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();

  await transitionBar(page).getByRole('button', { name: 'Check this stage' }).click();
  const panel = page.getByRole('region', { name: 'Act on this check' });
  await expect(panel).toContainText('A figure has no source in the project: 15–25%.');
  await expect(panel).not.toContainText('$7.5m');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-invented-range-reported.png') });
});
