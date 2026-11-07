import { expect, test, type Page } from '@playwright/test';

import { API_URL } from './env';
import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * Connected accounts (the client's call, 7 Nov), against scripted accounts
 * (COMPOSIO_MODE=mock): connect, look without reading, tick, read the exact
 * text, suggest, brief for a meeting, disconnect. Nothing reaches a model
 * before a press that says it will, and an email's hidden instruction and its
 * links never reach the screen, let alone a prompt.
 */

function calls(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(API_URL)) seen.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return seen;
}

test('connect, look, tick, read, suggest, brief and disconnect', async ({ page }) => {
  test.setTimeout(180_000);
  const seen = calls(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });

  // Settings: every account, what each reads, none connected.
  await page.goto('/projects/settings');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'Connected accounts' })).toBeVisible();
  await expect(page.getByText('Sender, subject and date of the last 14 days of mail.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(5);
  await shot('01-settings.png');

  // Connect three: the mock returns straight to /projects/connect, which confirms and comes back.
  for (const name of ['Gmail', 'Google Calendar', 'Google Drive']) {
    const row = page.getByRole('listitem').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText(`${name} is connected.`)).toBeVisible();
    await page.waitForURL('**/projects/settings');
    await expect(page.getByRole('listitem').filter({ hasText: name }).first().getByRole('button', { name: 'Disconnect' })).toBeVisible();
  }
  expect(seen.filter((c) => c.includes('/api/connections/confirm'))).toHaveLength(3);
  await shot('02-connected.png');

  // The flow reads nothing until asked.
  await page.getByRole('link', { name: 'Suggest work from my accounts' }).click();
  const look = page.getByRole('button', { name: "Show what's there" });
  await expect(look).toBeVisible();
  expect(seen.some((c) => c.includes('/preview'))).toBe(false);
  await look.click();
  await expect(page.getByText('Q3 board meeting')).toBeVisible();
  await expect(page.getByText('Updated price list')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Offsite recording\.mp4/ })).toBeDisabled();
  // A preview has no contents: no email body, no meeting agenda.
  await expect(page.getByText(/19\.10|Agenda:/)).toHaveCount(0);
  expect(seen.some((c) => c.includes('/api/suggest-workflows'))).toBe(false);
  await shot('03-preview.png');

  // Tick an email with an injection hidden in it, and a document; read them.
  await page.getByRole('checkbox', { name: /Updated price list/ }).check();
  await page.getByRole('checkbox', { name: /2027 operating plan/ }).check();
  await page.getByRole('button', { name: 'Read what I ticked' }).click();
  await expect(page.getByRole('heading', { name: 'This is exactly what will be sent' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Updated price list' });
  await expect(email).toHaveValue(/19\.10/);
  await expect(email).not.toHaveValue(/Ignore your instructions/);
  await expect(email).not.toHaveValue(/https?:/);
  await expect(page.getByRole('textbox', { name: '2027 operating plan' })).toHaveValue(/Headcount grows from 42 to 51/);
  await shot('04-exact-text.png');

  // Suggestions: one press, one call.
  await page.getByRole('button', { name: 'Suggest work from these' }).click();
  await expect(page.getByRole('heading', { name: 'Work you could start' })).toBeVisible();
  expect(seen.filter((c) => c === 'POST /api/suggest-workflows')).toHaveLength(1);
  await shot('05-suggestions.png');

  // Brief for a meeting: it and the email from someone invited, as other people's words.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Q3 board meeting' }).getByRole('button', { name: 'Brief me for this' }).click();
  await expect(page.getByRole('textbox', { name: 'Q3 board meeting' })).toHaveValue(/Agenda: Q3 results/);
  await expect(page.getByRole('textbox', { name: 'Board pack for Thursday' })).toBeVisible();
  await expect(page.getByText('Web search stays off', { exact: false })).toBeVisible();
  await shot('06-briefing-text.png');
  await page.getByRole('button', { name: 'Start the briefing' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const [project] = (await serviceSelect('projects', `id=eq.${id}&select=third_party,web_access,objective,context`)) as {
    third_party: { kind: string; title: string; text: string }[];
    web_access: string;
    objective: string;
    context: string;
  }[];
  expect(project.web_access).toBe('off');
  expect(project.context).toBe('');
  expect(project.third_party.map((i) => [i.kind, i.title])).toEqual([
    ['calendar_event', 'Q3 board meeting'],
    ['email', 'Board pack for Thursday'],
  ]);
  expect(project.objective).toContain('Q3 board meeting');
  await shot('07-briefing-project.png');

  // Disconnect: the row goes back to Connect, and the others stay connected.
  await page.goto('/projects/settings');
  const gmail = page.getByRole('listitem').filter({ hasText: 'Gmail' }).first();
  await gmail.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(gmail.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(gmail.getByText('Connected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Gmail' }).first().getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await shot('08-disconnected.png');
});
