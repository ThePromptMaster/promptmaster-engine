import { expect, test, type Page } from '@playwright/test';

import { API_URL } from './env';
import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * Connected accounts (the client's call, 7 Nov), against scripted accounts
 * (COMPOSIO_MODE=mock): connect, look without reading, tick, read the exact
 * text, suggest, start from a suggestion with its items, brief for a meeting, see,
 * remove and add what the project holds, disconnect. Nothing reaches a model
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

  // "Start this" keeps the item the suggestion came from (7 Nov), whichever way the project starts.
  await page.getByRole('button', { name: 'Start this' }).first().click();
  await page.waitForURL('**/projects/new');
  const carried = page.getByRole('region', { name: 'From your accounts' });
  await expect(carried.getByText('Updated price list')).toBeVisible();
  await expect(carried.getByText('2027 operating plan')).toHaveCount(0);
  await shot('05b-start-carries.png');
  await page.getByRole('button', { name: /Get a first draft/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const startedId = page.url().split('/').pop()!;
  const [started] = (await serviceSelect('projects', `id=eq.${startedId}&select=third_party,context`)) as {
    third_party: { title: string; text: string }[];
    context: string;
  }[];
  expect(started.third_party.map((i) => i.title)).toEqual(['Updated price list']);
  expect(started.third_party[0].text).toMatch(/19\.10/);
  expect(started.context).not.toMatch(/19\.10/);

  // Brief for a meeting: it and the email from someone invited, as other people's words.
  await page.goto('/projects/from-accounts');
  await page.getByRole('button', { name: "Show what's there" }).click();
  await page.getByRole('listitem').filter({ hasText: 'Q3 board meeting' }).getByRole('button', { name: 'Brief me for this' }).click();
  await expect(page.getByRole('textbox', { name: 'Q3 board meeting' })).toHaveValue(/Agenda: Q3 results/);
  await expect(page.getByRole('textbox', { name: 'Board pack for Thursday' })).toBeVisible();
  await expect(page.getByText('written from your brief, never from these', { exact: false })).toBeVisible();
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
  // Web access keeps the project's default: a search is written from the person's own words (L-200).
  expect(project.web_access).toBe('on');
  expect(project.context).toBe('');
  expect(project.third_party.map((i) => [i.kind, i.title])).toEqual([
    ['calendar_event', 'Q3 board meeting'],
    ['email', 'Board pack for Thursday'],
  ]);
  expect(project.objective).toContain('Q3 board meeting');
  await shot('07-briefing-project.png');

  // The project's "From your accounts" panel: [T1]…, the exact text, Remove.
  const held = page.getByRole('region', { name: 'From your accounts' });
  await expect(held.getByText('2 of 20')).toBeVisible();
  await held.getByRole('button', { name: 'Show text' }).first().click();
  await expect(held.getByText(/Agenda: Q3 results/)).toBeVisible();
  await shot('07b-panel.png');
  await held.getByRole('listitem').filter({ hasText: 'Board pack for Thursday' }).getByRole('button', { name: 'Remove' }).click();
  await expect(held.getByText('1 of 20')).toBeVisible();
  await expect
    .poll(async () => ((await serviceSelect('projects', `id=eq.${id}&select=third_party`)) as { third_party: unknown[] }[])[0].third_party.length)
    .toBe(1);

  // Add from my accounts: back into this project, and back to it.
  await held.getByRole('button', { name: 'Add from my accounts' }).click();
  await page.waitForURL(`**/projects/from-accounts?into=${id}`);
  await expect(page.getByText(/It has room for 19 more/)).toBeVisible();
  await page.getByRole('button', { name: "Show what's there" }).click();
  await expect(page.getByRole('button', { name: 'Brief me for this' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Updated price list/ }).check();
  await page.getByRole('button', { name: 'Read what I ticked' }).click();
  await page.getByRole('button', { name: 'Add 1 to this project' }).click();
  await page.waitForURL(`**/projects/${id}`);
  await expect(page.getByRole('region', { name: 'From your accounts' }).getByText('2 of 20')).toBeVisible();
  const [after] = (await serviceSelect('projects', `id=eq.${id}&select=third_party`)) as { third_party: { title: string; when?: string }[] }[];
  expect(after.third_party.map((i) => i.title)).toEqual(['Q3 board meeting', 'Updated price list']);
  expect(after.third_party[1].when).toBeTruthy();
  await shot('07c-added.png');

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
