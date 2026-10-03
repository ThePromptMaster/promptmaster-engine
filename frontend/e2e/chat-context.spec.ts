import { expect, test, type Page } from '@playwright/test';

import { createProject, pressTransition, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * H1a — the side chat sees the project (3 Oct call).
 *
 * Given only the brief and the text on screen, the chat asked the client to
 * "paste the full text of all three chapters back in the box" and to copy the
 * outline in. It is now told the stage, the outline and the chapters; the
 * scripted model says which of them reached it.
 */

async function bookWithChapters(page: Page) {
  await createProject(page, { workflow: 'Book', name: 'E2E chat context', objective: 'A short book about lions' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');

  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('The pride');
  await page.getByRole('button', { name: /Insert a section after/ }).click();
  await page.getByLabel('Title of section 2').fill('The hunt');
  await page.waitForTimeout(1_500); // past the draft autosave
  await transitionBar(page).getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Outline approval/ })).toBeVisible();
  await pressTransition(page);
  await transitionBar(page).getByRole('button', { name: 'Start drafting' }).click();
  await expect(page.getByText('2 of 2 sections written')).toBeVisible({ timeout: 60_000 });
}

async function ask(page: Page, question: string) {
  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill(question);
  await chat.getByRole('button', { name: 'Ask' }).click();
  return chat;
}

test('the chat on the chapters and on a review stage has the outline and the chapters', async ({ page }) => {
  test.setTimeout(180_000);
  await bookWithChapters(page);

  // On Drafting: the chapters are the stage's own text.
  let chat = await ask(page, 'What is chapter 2 about?');
  await expect(chat.getByText(/Mock: I can see the Draft\w* stage, the outline, the chapters; nothing needs pasting\./)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-chat-on-drafting.png'), fullPage: true });

  // On the next stage, a review: the chapters come from Drafting.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible({ timeout: 30_000 });
  chat = await ask(page, 'Does chapter 2 contradict chapter 1?');
  await expect(chat.getByText(/Mock: I can see the Continuity.* stage, the outline, the chapters; nothing needs pasting\./)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('02-chat-on-continuity.png'), fullPage: true });
});
