import { expect, test } from '@playwright/test';

import { createProject, pressTransition, transitionBar } from './helpers';

/**
 * A4 / PM-10, PM-11 — the original PromptMaster core, reconnected inside a
 * workflow stage: the Refine family and Realign as new versions, Challenge /
 * Reframe / Self-audit as commentary, Continue Document when a draft was cut
 * off, the project brief on every stage, and the side chat's Save as New Version.
 */

async function openMore(page: import('@playwright/test').Page) {
  await transitionBar(page).getByRole('button', { name: /^More/ }).click();
}

test('refine and critique a stage draft with the original core', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E core', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // A rewrite lands as a new version, labelled with what produced it.
  await openMore(page);
  await page.getByRole('menuitem', { name: 'Refine: make it shorter' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  await expect(page.getByText('Refined: shorter').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-refined-new-version.png') });

  // A critique is commentary beside the draft; the draft is untouched.
  await openMore(page);
  await expect(page.getByRole('menuitem', { name: 'Realign to the objective' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Self-audit (Cold Critic)' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Challenge this draft' }).click();
  const critique = page.getByRole('region', { name: 'The case against this draft' });
  await expect(critique).toBeVisible();
  await expect(critique).toContainText('nothing has been changed');
  await expect(page.getByRole('button', { name: 'v3' })).toHaveCount(0);
  await critique.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-challenge-commentary.png') });
});

test('a draft cut off at the length limit makes "Continue writing" the next step', async ({ page }) => {
  await createProject(page, {
    workflow: 'Book',
    name: 'E2E continue',
    objective: 'A book about giraffes [[mock:length]]',
  });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  const bar = transitionBar(page);
  await expect(bar.getByRole('button', { name: 'Continue writing' })).toBeVisible();
  await expect(bar).toContainText('stopped before it was finished');
  await bar.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-continue-writing-primary.png') });
  await bar.getByRole('button', { name: 'Continue writing' }).click();
  await expect(page.getByText('Continued').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
});

test('the project brief travels with every stage', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E brief', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();

  // On this stage too, collapsed to one line; open, it is editable.
  const brief = page.getByText('Project brief');
  await expect(brief).toBeVisible();
  await expect(page.locator('details').filter({ hasText: 'Project brief' })).toContainText('A book about giraffes');
  await brief.click();
  await page.locator('#brief-constraints').fill('No more than 40 pages');
  await expect(page.locator('#brief-constraints')).toHaveValue('No more than 40 pages');
  await page.screenshot({ path: test.info().outputPath('04-project-brief.png') });
});

test('the side chat can save the discussion as a new version', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E chat save', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill('Is the objective specific enough?');
  await chat.getByRole('button', { name: 'Ask' }).click();
  const save = chat.getByRole('button', { name: 'Save this discussion as a new version' });
  await expect(save).toBeVisible();
  await save.click();
  await chat.getByRole('button', { name: 'Apply as new version' }).click();
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();
  await expect(page.getByText('Saved from the discussion').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('05-chat-saved-version.png') });
});
