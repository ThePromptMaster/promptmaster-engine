import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * A3 / PM-09 — "What do you want to do or figure out?" with two ways in, and
 * PromptMaster recommending the workflow and mode instead of making the user
 * pick Book / Research / Single output before they have said anything.
 */

test('"I know what I want to do": the setup is recommended, editable, and carried into the project', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'What do you want to do or figure out?' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-what-do-you-want.png') });

  await page.getByLabel('What do you want to do or figure out?').fill('Write a short book about giraffes for curious ten-year-olds');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();

  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  // Recommended workflow, with the reason.
  await expect(page.getByText(/Recommended: Book/)).toBeVisible();
  // 2 Oct: "people won't read the generated objective, constraints, output" —
  // the suggested fields are marked as suggestions to be read and corrected.
  await expect(page.getByText(/Suggested from your brief — read these and change anything that is wrong/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('00-setup-suggested-fields-marked.png'), fullPage: true });
  await expect(page.getByRole('radio', { name: /^Book/ })).toHaveAttribute('aria-checked', 'true');
  // Mode, audience, constraints and format are pre-filled and editable.
  await expect(page.getByLabel('How PromptMaster should think')).toHaveValue('architect');
  await expect(page.getByLabel('Constraints')).toHaveValue(/giraffes/);
  await page.getByLabel('Audience').fill('Curious ten-year-olds');
  await page.getByLabel('How PromptMaster should think').selectOption('clarity');
  await page.screenshot({ path: test.info().outputPath('02-recommended-setup.png'), fullPage: true });

  await page.getByRole('button', { name: 'Start Book' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  // It all reached the project: the brief shows what was set, and the mode is in use.
  await expect(page.getByRole('textbox', { name: 'Audience' })).toHaveValue('Curious ten-year-olds');
  await expect(page.getByRole('textbox', { name: 'Constraints' })).toHaveValue(/giraffes/);
});

/**
 * 1 Oct, item 9 — "Right now it feels like a smart intake form. The next
 * level is adaptive questioning": several answers where they are not
 * mutually exclusive, typed answers as removable chips, one question at a
 * time branching on the last, and stopping when there is enough.
 */
test('"Guide me" asks one question at a time, takes several answers, and stops when it has enough', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Why do giraffes have such long necks?');
  await page.getByRole('button', { name: /Guide me/ }).click();

  await expect(page.getByRole('heading', { name: 'A few questions' })).toBeVisible();
  const question = page.getByRole('region', { name: 'Question' });
  await expect(question.getByRole('heading')).toHaveText('1. What data do you have?');
  await expect(question).toContainText('Choose any that apply.');

  // Several of the offered answers, plus one typed in — which becomes a chip that can be removed.
  await question.getByRole('button', { name: 'CRM', exact: true }).click();
  await question.getByRole('button', { name: 'Billing', exact: true }).click();
  await expect(question.getByRole('button', { name: 'CRM', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(question.getByRole('button', { name: 'Billing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await question.getByLabel('Your own answer', { exact: true }).fill('Survey results');
  await question.getByRole('button', { name: 'Add', exact: true }).click();
  await question.getByLabel('Your own answer', { exact: true }).fill('A typo');
  await question.getByRole('button', { name: 'Add', exact: true }).click();
  await question.getByRole('button', { name: 'Remove "A typo"' }).click();
  await expect(question.getByLabel('Your own answers')).toHaveText(/Survey results/);
  await expect(question.getByLabel('Your own answers')).not.toContainText('A typo');
  await page.screenshot({ path: test.info().outputPath('03-guide-me-several-answers.png'), fullPage: true });
  await question.getByRole('button', { name: 'Next question' }).click();

  // The second question follows from the first answer, and takes one answer.
  await expect(question.getByRole('heading')).toHaveText('2. Mock follow-up on: CRM; Billing; Survey results');
  await expect(question).toContainText('Choose one.');
  await expect(page.getByRole('list', { name: 'Your answers so far' })).toContainText('CRM');
  await question.getByRole('button', { name: 'Executives' }).click();
  await question.getByRole('button', { name: 'My team' }).click();
  await expect(question.getByRole('button', { name: 'Executives' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: test.info().outputPath('04-guide-me-follow-up.png'), fullPage: true });
  await question.getByRole('button', { name: 'Next question' }).click();

  // Two answers are enough for the scripted model: it says so and recommends.
  await expect(page.getByText(/Recommended: Research/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Research' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
});

test('"That\'s enough" stops the questions at any point and uses what was given', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Why do giraffes have such long necks?');
  await page.getByRole('button', { name: /Guide me/ }).click();
  const question = page.getByRole('region', { name: 'Question' });
  await question.getByRole('button', { name: 'None yet' }).click();
  const setup = page.waitForRequest((r) => r.url().includes('/api/generate-setup') && r.method() === 'POST');
  await page.getByRole('button', { name: /That's enough/ }).click();
  expect((await setup).postDataJSON().answers).toEqual([{ question: 'What data do you have?', answer: 'None yet' }]);
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible({ timeout: 30_000 });
});

test('choosing the workflow yourself is still one click away', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A board memo on the migration');
  await page.getByRole('button', { name: 'Or choose the workflow yourself' }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await expect(page.getByText(/Recommended:/)).toHaveCount(0);
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByRole('button', { name: 'Start Single output' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
});

/**
 * Harold, via Sean (9 Oct): who is it for, and why this rather than a chat?
 * The landing page said "Five phases" and "8 Modes" — the retired product.
 */
test('the landing page says who PromptMaster is for and what a chat does not do', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Work you can\s*stand behind/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'For people who answer for their work.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What a chat does not do.' })).toBeVisible();
  await expect(page.getByText('Five phases. One aligned output.')).toHaveCount(0);
  await expect(page.getByText('8 Modes')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('landing.png'), fullPage: true });
});

/** "Can't really answer any questions until they get the ball rolling": an example goal fills the box, and nothing more. */
test('an example goal opens a new project with the goal in the box', async ({ page }) => {
  const goal = 'Write a one-page memo recommending whether our 12-person team should move from Slack to Microsoft Teams. Budget is $8,000 a year.';
  await page.goto(`/projects/new?goal=${encodeURIComponent(goal)}`);
  await dismissBetaNotice(page);
  await expect(page.getByLabel('What do you want to do or figure out?')).toHaveValue(goal);
  // Still the user's choice how to start.
  await expect(page.getByRole('heading', { name: 'What do you want to do or figure out?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /I know what I want to do/ })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('example-goal-prefilled.png') });
});

test('an empty project list explains a project and offers example goals', async ({ page }) => {
  // A first-time user: the list comes back empty.
  await page.route('**/rest/v1/projects?*', async (route) => {
    if (route.request().method() === 'GET' && route.request().url().includes('deleted_at=is.null')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fallback();
  });
  await page.goto('/projects');
  await dismissBetaNotice(page);
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await expect(page.getByText(/A project takes one goal to a finished deliverable/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('empty-projects-examples.png'), fullPage: true });
  await page.getByRole('link', { name: /A recommendation memo/ }).click();
  await expect(page).toHaveURL(/\/projects\/new\?goal=/);
  await expect(page.getByLabel('What do you want to do or figure out?')).toHaveValue(/Slack to Microsoft Teams/);
});
