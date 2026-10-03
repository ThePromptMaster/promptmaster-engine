import { expect, test } from '@playwright/test';

import { createProject } from './helpers';

/**
 * H2b — the chat opens on the question the page poses (3 Oct call: a chat
 * that "knows when it's directed", like Copilot). No model call until one is
 * pressed.
 */
test('the side chat offers the page’s own questions, and one press asks it', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E chat starters', objective: 'A short book about lions' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  const chat = page.getByRole('region', { name: 'Side chat' });
  const starters = chat.getByRole('group', { name: 'Suggested questions' });
  await expect(starters.getByRole('button')).toHaveText([
    'What is the weakest part of this draft?',
    'Does this still serve the objective?',
    'Is this ready for Audience?',
  ]);
  await page.screenshot({ path: test.info().outputPath('01-chat-starters.png'), fullPage: true });

  await starters.getByRole('button', { name: 'What is the weakest part of this draft?' }).click();
  await expect(chat.getByText('Mock reply: it reads well, but three things would help.')).toBeVisible({ timeout: 30_000 });
  await expect(starters).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-asked.png'), fullPage: true });
});
