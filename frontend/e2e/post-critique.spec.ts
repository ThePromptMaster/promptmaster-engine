import { expect, test, type Page } from '@playwright/test';

import { createProject, serviceSelect, transitionBar } from './helpers';

/**
 * C2 — PM-22: after a critique, the easy actions Sean listed — Apply
 * recommended fixes, Apply selected, Review individually, Show revised version
 * first — and "buttonize it": every point is its own Apply.
 *
 * The scripted evaluator raises three findings when the objective asks for
 * them, and the scripted reviser appends one "Applied by the mock: …" line per
 * finding it was given — so every assertion below can say exactly which fixes
 * reached the model.
 */

const OBJECTIVE = 'A book about giraffes [[mock:findings=3]]';

async function checked(page: Page, name: string) {
  const id = await createProject(page, { workflow: 'Book', name, objective: OBJECTIVE });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await transitionBar(page).getByRole('button', { name: 'Check this stage' }).click();
  const panel = page.getByRole('region', { name: 'Act on this check' });
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  return { id, panel };
}

async function versionsOf(projectId: string) {
  return (await serviceSelect(
    'artifact_versions',
    `project_id=eq.${projectId}&select=version_number,source_operation,content&order=version_number`
  )) as { version_number: number; source_operation: string; content: string }[];
}

const applied = (n: number) => `Applied by the mock: Mock finding ${n}: point ${n} is vague.`;

test('one point, one click — shown first, and nothing is saved until Keep', async ({ page }) => {
  const { id, panel } = await checked(page, 'E2E buttonize one');
  await page.screenshot({ path: test.info().outputPath('01-after-the-check.png'), fullPage: true });

  await panel.getByRole('button', { name: /^Apply: Mock finding 2/ }).click();
  const preview = page.getByRole('dialog', { name: 'Revised version' });
  await expect(preview.getByTestId('revision-diff')).toContainText(applied(2));
  await expect(preview.getByTestId('revision-diff').locator('ins')).toContainText(applied(2));
  await page.screenshot({ path: test.info().outputPath('02-revised-version-first.png') });

  // Discard: the stage is exactly as it was.
  await preview.getByRole('button', { name: 'Discard' }).click();
  await expect(preview).toHaveCount(0);
  expect(await versionsOf(id)).toHaveLength(1);

  // Again, and keep it: a new version, the old one kept.
  await panel.getByRole('button', { name: /^Apply: Mock finding 2/ }).click();
  await page.getByRole('dialog', { name: 'Revised version' }).getByRole('button', { name: 'Keep this version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  const versions = await versionsOf(id);
  expect(versions.map((v) => v.source_operation)).toEqual(['stage_draft', 'applied_findings']);
  expect(versions[1].content).toContain(applied(2));
  expect(versions[1].content).not.toContain(applied(1));
  await expect(page.getByText('Critique applied').first()).toBeVisible();
});

test('Apply selected, straight to a new version when "show first" is off', async ({ page }) => {
  const { id, panel } = await checked(page, 'E2E apply selected');
  await panel.getByRole('checkbox', { name: /^Select: Mock finding 1/ }).check();
  await panel.getByRole('checkbox', { name: /^Select: Mock finding 3/ }).check();
  await panel.getByRole('checkbox', { name: 'Show the revised version first' }).uncheck();
  await panel.getByRole('button', { name: 'Apply selected (2)' }).click();

  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  const [, v2] = await versionsOf(id);
  expect(v2.content).toContain(applied(1));
  expect(v2.content).toContain(applied(3));
  expect(v2.content).not.toContain(applied(2));
});

test('Review one by one: keep, skip, keep — then only the kept ones are applied', async ({ page }) => {
  const { id, panel } = await checked(page, 'E2E review individually');
  await panel.getByRole('button', { name: 'Review one by one' }).click();
  const review = page.getByRole('dialog', { name: 'Review one by one' });
  await expect(review).toContainText('Point 1 of 3');
  await review.getByRole('button', { name: 'Apply this' }).click();
  await expect(review).toContainText('Point 2 of 3');
  await review.getByRole('button', { name: 'Skip' }).click();
  await review.getByRole('button', { name: 'Apply this' }).click();
  await expect(review).toContainText('2 of 3 to apply');
  await page.screenshot({ path: test.info().outputPath('01-review-summary.png') });
  await review.getByRole('button', { name: 'Apply 2 fixes' }).click();

  const preview = page.getByRole('dialog', { name: 'Revised version' });
  await expect(preview).toContainText('2 points applied');
  await preview.getByRole('button', { name: 'Keep this version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  const [, v2] = await versionsOf(id);
  expect(v2.content).toContain(applied(1));
  expect(v2.content).not.toContain(applied(2));
  expect(v2.content).toContain(applied(3));
});

test('Apply all recommended fixes', async ({ page }) => {
  const { id, panel } = await checked(page, 'E2E apply all');
  await panel.getByRole('button', { name: 'Apply all 3 recommended fixes' }).click();
  const preview = page.getByRole('dialog', { name: 'Revised version' });
  await expect(preview).toContainText('3 points applied');
  await preview.getByRole('button', { name: 'Keep this version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  const [, v2] = await versionsOf(id);
  for (const n of [1, 2, 3]) expect(v2.content).toContain(applied(n));
  // The new version has not been checked, so its old findings are gone with it.
  await expect(page.getByRole('region', { name: 'Act on this check' })).toHaveCount(0);
});

test('"Buttonize it": each point of a Challenge can be applied as you go', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E buttonize critique', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await transitionBar(page).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Challenge this draft' }).click();

  const act = page.getByRole('region', { name: 'Act on this critique' });
  await expect(act.getByRole('listitem')).toHaveCount(3);
  await act.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-critique-buttonized.png'), fullPage: true });
  await act.getByRole('button', { name: /^Apply: Weak reasoning/ }).click();

  const preview = page.getByRole('dialog', { name: 'Revised version' });
  await expect(preview.getByTestId('revision-diff')).toContainText('Applied by the mock: Weak reasoning — Mock: the main claim is asserted, never shown.');
  await preview.getByRole('button', { name: 'Keep this version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  const [, v2] = await versionsOf(id);
  expect(v2).toMatchObject({ source_operation: 'applied_findings' });
  expect(v2.content).toContain('Weak reasoning');
  expect(v2.content).not.toContain('Unstated assumptions');
});
