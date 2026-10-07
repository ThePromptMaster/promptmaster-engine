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
  // The three ways in.
  await expect(page.getByRole('button', { name: /I know what I want to do/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Guide me — ask me questions/ })).toBeVisible();
  await page.getByRole('button', { name: /Keep this as a conversation for now/ }).click();

  const convo = page.getByRole('region', { name: 'Conversation' });
  const brief = page.getByRole('complementary', { name: 'Draft brief' });
  await convo.getByRole('button', { name: 'Send' }).click();
  await expect(convo).toContainText('Mock: who is this for?', { timeout: 30_000 });
  await convo.getByLabel('Your message').fill('It is for the board. We have 160 staff hours. B needs 120 hours and returns $45,000. One researcher must stay available for client work.');
  await convo.getByRole('button', { name: 'Send' }).click();
  await expect(brief).toContainText('B needs 120 hours and returns $45,000', { timeout: 30_000 });
  await expect(brief).toContainText('One researcher must stay available for client work');
  // A figure the user never gave is not in the brief.
  await expect(brief).not.toContainText('999%');
  await expect(brief).toContainText('Draft brief — not saved');
  await page.screenshot({ path: test.info().outputPath('01-draft-brief.png'), fullPage: true });

  await brief.getByRole('button', { name: 'Ready to create' }).click();
  await expect(brief.getByRole('group', { name: 'Confirm the brief' })).toContainText(
    "I'm ready to create this project. These facts, requirements and decisions will become its initial authoritative state."
  );
  await page.screenshot({ path: test.info().outputPath('02-confirm.png'), fullPage: true });
  await brief.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible({ timeout: 30_000 });
  const initial = page.getByRole('region', { name: 'Initial facts' });
  await expect(initial).toContainText('Requirement: One researcher must stay available for client work');
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E front door');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  const facts = await serviceSelect('project_facts', `project_id=eq.${id}&select=statement,kind,source_kind&order=created_at`);
  expect(facts.map((f: { kind: string; source_kind: string }) => [f.kind, f.source_kind])).toEqual(
    expect.arrayContaining([['requirement', 'chat'], ['fact', 'chat']])
  );
  expect(facts.map((f: { statement: string }) => f.statement)).not.toContain('Revenue grew 999% last year');
  await expect(page.getByRole('region', { name: 'Facts and requirements' })).toContainText('One researcher must stay available');
});
