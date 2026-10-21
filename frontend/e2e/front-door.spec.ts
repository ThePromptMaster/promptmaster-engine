import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * C6a — Sean, 6 Oct, email 8: a conversational front door. "Build the project
 * from what I provided. Ask me questions first. Keep this as a conversation
 * for now … build a visible structured project brief … Conversational
 * brainstorming should not silently become authoritative project state …
 * 'I'm ready to create this project. These facts, requirements, and decisions
 * will become its initial authoritative state.'"
 */
test('a conversation builds a draft brief; only confirmed facts become the project record', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Choose one research project for next quarter');
  // 14 Oct call: the conversation is the way in; the other two stay one row below.
  await expect(page.getByRole('button', { name: /I know what I want to do/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Guide me — ask me questions/ })).toBeVisible();
  await page.getByRole('button', { name: /Start the conversation/ }).click();

  const convo = page.getByRole('region', { name: 'Conversation' });
  const brief = page.getByRole('complementary', { name: 'Draft brief' });
  // The first message is sent as the conversation opens, as a chat would.
  await expect(convo).toContainText('Choose one research project for next quarter');
  await expect(convo).toContainText('Mock: who is this for?', { timeout: 30_000 });
  await convo.getByLabel('Your message').fill('It is for the board. We have 160 staff hours. B needs 120 hours and returns $45,000. One researcher must stay available for client work.');
  await convo.getByRole('button', { name: 'Send' }).click();
  await expect(brief.getByRole('textbox')).not.toHaveCount(0);
  await expect(brief.locator('input[value="B needs 120 hours and returns $45,000"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(brief.locator('input[value="One researcher must stay available for client work"]')).toHaveCount(1);
  // A figure the user never gave is not in the brief.
  await expect(brief.locator('input[value*="999%"]')).toHaveCount(0);
  await expect(brief).toContainText('Outline — not a project yet');

  // The outline is the user's to change: an added requirement is kept as written.
  await brief.getByLabel('Add a requirement').fill('Decide before the March board meeting');
  await brief.getByLabel('Add a requirement').press('Enter');
  await expect(brief.locator('input[value="Decide before the March board meeting"]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('01-chat-and-outline.png'), fullPage: true });

  // One press makes the project, with the conversation coming along.
  await brief.getByRole('button', { name: 'Make it a project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const id = page.url().split('/').at(-1)!;

  const facts = await serviceSelect('project_facts', `project_id=eq.${id}&select=statement,kind,source_kind&order=created_at`);
  expect(facts.map((f: { kind: string; source_kind: string }) => [f.kind, f.source_kind])).toEqual(
    expect.arrayContaining([['requirement', 'chat'], ['fact', 'chat']])
  );
  const said = facts.map((f: { statement: string }) => f.statement);
  expect(said).not.toContain('Revenue grew 999% last year');
  expect(said).toContain('Decide before the March board meeting');
  const panel = page.getByRole('region', { name: 'Facts and requirements' });
  await expect(panel).toContainText('One researcher must stay available');
  // Labelled as the conversation it came from, and a requirement is not recorded twice.
  await expect(panel).toContainText('from your conversation');
  const statements = facts.map((f: { statement: string }) => f.statement.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim());
  expect(new Set(statements).size).toBe(statements.length);

  // The conversation is the first stage's chat.
  const chat = await serviceSelect('conversation_messages', `project_id=eq.${id}&select=role,content&order=created_at`);
  expect(chat.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(chat[0].content).toBe('Choose one research project for next quarter');
  await page.screenshot({ path: test.info().outputPath('02-project-from-chat.png'), fullPage: true });
});

test('the setup screen is still there before the project is made', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Choose one research project for next quarter');
  await page.getByRole('button', { name: /Start the conversation/ }).click();
  const brief = page.getByRole('complementary', { name: 'Draft brief' });
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Mock: who is this for?', { timeout: 30_000 });
  await brief.getByLabel('Objective').fill('Choose one research project for next quarter');
  await brief.getByRole('button', { name: 'Review the setup first' }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible({ timeout: 30_000 });
});

/** Sean, 10 Oct, email 1: the draft apart from the explanation, easy to copy; no "Ready is true". */
test('a piece of writing the conversation produces comes in its own block, ready to copy', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A short lunch invitation for my team [[mock:draft]]');
  await page.getByRole('button', { name: /Start the conversation/ }).click();
  const convo = page.getByRole('region', { name: 'Conversation' });
  const draft = convo.getByRole('region', { name: 'Draft' });
  await expect(draft).toContainText('Hi team — lunch is on Wednesday at 1:00 p.m.', { timeout: 30_000 });
  await expect(draft.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(convo).not.toContainText(/ready is true/i);
  await page.screenshot({ path: test.info().outputPath('03-draft-apart.png'), fullPage: true });
});
