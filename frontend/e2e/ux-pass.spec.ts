import { expect, test } from '@playwright/test';

import { createProject, pressTransition, skipStage, transitionBar } from './helpers';

/**
 * A2 — the UX pass (PM-06, PM-07, PM-08). Sean, Sep 10, on "a book about
 * giraffes": "there's just a lot of buttons, I don't know exactly which one to
 * press", and he could not read "v1 stage_draft" or the circles and squares.
 */

test('each stage offers one next step, in words a new user can read', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E UX', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const bar = transitionBar(page);
  // PM-06: one primary button; everything else behind More.
  await expect(bar.getByRole('button', { name: 'Check this stage' })).toBeVisible();
  await expect(bar.getByRole('button')).toHaveCount(2); // More + the primary
  await expect(bar).toContainText('One model call scores it against your objective');

  // PM-07: plain labels.
  await expect(page.getByText('AI draft').first()).toBeVisible();
  await expect(page.getByText('stage_draft')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'To finish this stage' })).toBeVisible();
  await expect(page.getByText('checked for you as you work')).toBeVisible();
  await page.getByText('What the icons mean').click();
  await expect(page.getByText('You are here')).toBeVisible();
  await page.getByRole('heading', { name: 'To finish this stage' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-one-primary-action.png') });

  // More holds the rest.
  await bar.getByRole('button', { name: /^More/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Regenerate this stage' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Continue to Audience/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-more-menu.png') });
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: /^More/ }).click(); // close

  // Check -> the next step is to move on, and it says nothing needs another pass (PM-25).
  await bar.getByRole('button', { name: 'Check this stage' }).click();
  await expect(bar.getByRole('button', { name: 'Continue to Audience' })).toBeVisible();
  await expect(bar).toContainText('nothing here needs another pass');
  await bar.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-checked-then-continue.png') });

  // Mode cards used to be buttons that did nothing.
  const analyst = page.getByRole('button', { name: /^Architect|^Analyst|^Clarity|^Critic|^Coach/ }).first();
  await analyst.click();
  await expect(analyst).toHaveAttribute('aria-pressed', 'true');
  await expect(analyst).toContainText('In use');
});

test('unsaved edits make saving the next step, and a checkpoint stage never drafts', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E UX 2', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);

  // Audience: edit a field -> "Save changes" leads; saving hands the lead back.
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  const field = page.getByLabel('What they already know').first();
  await field.fill('They have seen giraffes at a zoo.');
  const bar = transitionBar(page);
  await expect(bar.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(bar).toContainText('Your edits count once they are saved');
  await bar.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('04-unsaved-edits-save-first.png') });
  await bar.getByRole('button', { name: 'Save changes' }).click();
  await expect(bar.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'v2' })).toBeVisible();

  // Walk to the Outline approval checkpoint.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');
  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('Habitat');
  await page.getByRole('button', { name: /Insert a section after/ }).click();
  await page.getByLabel('Title of section 2').fill('Diet');
  await transitionBar(page).getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);

  await expect(page.getByRole('heading', { name: 'Outline approval' })).toBeVisible();
  await expect(page.getByText('This stage is a checkpoint')).toBeVisible();
  // It used to auto-draft "items" here and fail.
  await expect(page.getByText('The draft came back empty')).toHaveCount(0);
  await expect(page.getByText(/Draft the items/)).toHaveCount(0);
  await expect(transitionBar(page).getByRole('button', { name: 'Continue to Drafting' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('05-checkpoint-stage.png') });
});
