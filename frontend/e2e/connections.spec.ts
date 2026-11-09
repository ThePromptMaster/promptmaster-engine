import { expect, test, type Page } from '@playwright/test';

import { API_URL } from './env';
import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * Connected accounts (8 Nov: "it should just search everything"), against scripted
 * accounts (COMPOSIO_MODE=mock): connect, search the whole account with nothing to tick,
 * see what was read, start from a suggestion with its items, brief for a meeting, see
 * and remove what the project holds, let the side chat search, switch it off, add, and
 * disconnect. An email's hidden instruction and its links never reach the screen.
 */

function calls(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(API_URL)) seen.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return seen;
}

test('connect, search everything, suggest, brief, chat and disconnect', async ({ page }) => {
  test.setTimeout(240_000);
  const seen = calls(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });

  // Settings: every account, what each reads, none connected.
  await page.goto('/projects/settings');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'Connected accounts' })).toBeVisible();
  await expect(page.getByText('Searches all of your mail and reads the emails that match.', { exact: false })).toBeVisible();
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

  // One box and the next meetings: nothing to tick, and no contents yet.
  await page.getByRole('link', { name: 'Suggest work from my accounts' }).click();
  const box = page.getByRole('textbox', { name: 'What are you working on, or looking for?' });
  await expect(box).toBeVisible();
  await expect(page.getByText('Q3 board meeting')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/19\.10|Agenda:/)).toHaveCount(0);
  expect(seen.some((c) => c.includes('/api/connections/search') || c.includes('/api/suggest-workflows'))).toBe(false);
  await shot('03-search-box.png');

  // An email from 200 days ago: well outside the 14 days this used to look at.
  await box.fill('Warehouse lease terms');
  await page.getByRole('button', { name: 'Search my accounts' }).click();
  const read = page.getByRole('region', { name: 'What PromptMaster read' });
  await expect(read.getByText('Warehouse lease terms from last spring')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Work you could start' })).toBeVisible();

  // An email with an injection hidden in it: straight on to suggestions, one call each.
  await box.fill('Updated price list');
  await page.getByRole('button', { name: 'Search my accounts' }).click();
  await expect(read.getByText('Updated price list')).toBeVisible();
  await expect(read.getByText('Warehouse lease terms from last spring')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Work you could start' })).toBeVisible();
  expect(seen.filter((c) => c === 'POST /api/suggest-workflows')).toHaveLength(2);
  await read.getByRole('button', { name: 'Show text' }).click();
  await expect(read.getByText(/19\.10/)).toBeVisible();
  await expect(read.getByText(/Ignore your instructions/)).toHaveCount(0);
  await expect(read.getByText(/https?:/)).toHaveCount(0);
  await shot('04-read-and-suggested.png');

  // "Start this" keeps the item the suggestion came from, whichever way the project starts.
  await page.getByRole('button', { name: 'Start this' }).first().click();
  await page.waitForURL('**/projects/new');
  const carried = page.getByRole('region', { name: 'From your accounts' });
  await expect(carried.getByText('Updated price list')).toBeVisible();
  await shot('05-start-carries.png');
  await page.getByRole('button', { name: /Get a first draft/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const startedId = page.url().split('/').pop()!;
  const [started] = (await serviceSelect('projects', `id=eq.${startedId}&select=third_party,context,account_search`)) as {
    third_party: { title: string; text: string }[];
    context: string;
    account_search: string;
  }[];
  expect(started.third_party.map((i) => i.title)).toEqual(['Updated price list']);
  expect(started.third_party[0].text).toMatch(/19\.10/);
  expect(started.context).not.toMatch(/19\.10/);
  expect(started.account_search).toBe('on');

  // Brief for a meeting: one press searches the whole mailbox, and the project starts.
  await page.goto('/projects/from-accounts');
  await page.getByRole('listitem').filter({ hasText: 'Q3 board meeting' }).getByRole('button', { name: 'Brief me for this' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split('/').pop()!;
  const [project] = (await serviceSelect('projects', `id=eq.${id}&select=third_party,web_access,objective,context`)) as {
    third_party: { kind: string; title: string; text: string }[];
    web_access: string;
    objective: string;
    context: string;
  }[];
  expect(project.web_access).toBe('on');
  expect(project.context).toBe('');
  // The meeting, then the mail from those invited, however old.
  expect(project.third_party.map((i) => [i.kind, i.title])).toEqual([
    ['calendar_event', 'Q3 board meeting'],
    ['email', 'Board pack for Thursday'],
    ['email', 'Warehouse lease terms from last spring'],
  ]);
  expect(project.objective).toContain('Q3 board meeting');
  await shot('06-briefing-project.png');

  // The project's "From your accounts" panel: [T1]…, the exact text, Remove.
  const held = page.getByRole('region', { name: 'From your accounts' });
  await expect(held.getByText('3 of 20')).toBeVisible();
  await held.getByRole('button', { name: 'Show text' }).first().click();
  await expect(held.getByText(/Agenda: Q3 results/)).toBeVisible();
  await shot('07-panel.png');
  await held.getByRole('listitem').filter({ hasText: 'Warehouse lease terms' }).getByRole('button', { name: 'Remove' }).click();
  await expect(held.getByText('2 of 20')).toBeVisible();

  // The side chat searches by itself when the question needs it, and what it read joins the panel.
  const chat = page.getByRole('region', { name: 'Side chat' });
  const ask = async (question: string) => {
    const input = chat.getByRole('textbox', { name: 'Ask a question' });
    await expect(async () => {
      await input.fill(question);
      await expect(input).toHaveValue(question, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await chat.getByRole('button', { name: 'Ask' }).click();
  };
  await ask('[[mock:accounts]] Updated price');
  await expect(chat.getByText(/Searched your accounts for "Updated price" and read 1\./)).toBeVisible({ timeout: 30_000 });
  await expect(held.getByText('3 of 20')).toBeVisible();
  await expect
    .poll(async () => ((await serviceSelect('projects', `id=eq.${id}&select=third_party`)) as { third_party: { title: string }[] }[])[0].third_party.map((i) => i.title))
    .toContain('Updated price list');
  await shot('08-chat-searched.png');

  // Off, the same question searches nothing.
  const toggle = held.getByRole('switch', { name: 'Search my accounts for this project' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect
    .poll(async () => ((await serviceSelect('projects', `id=eq.${id}&select=account_search`)) as { account_search: string }[])[0].account_search)
    .toBe('off');
  const before = await chat.getByText(/Searched your accounts for/).count();
  await ask('[[mock:accounts]] Board pack');
  await expect(chat.getByText('[[mock:accounts]] Board pack').first()).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Ask' })).toBeEnabled({ timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await expect(chat.getByText(/Searched your accounts for/)).toHaveCount(before);
  await expect(held.getByText('3 of 20')).toBeVisible();

  // Add from my accounts: back into this project, and back to it.
  await held.getByRole('button', { name: 'Add from my accounts' }).click();
  await page.waitForURL(`**/projects/from-accounts?into=${id}`);
  await expect(page.getByText(/It has room for 17 more/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Brief me for this' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'What are you working on, or looking for?' }).fill('2027 operating plan');
  await page.getByRole('button', { name: 'Search my accounts' }).click();
  await page.getByRole('button', { name: 'Add 1 to this project' }).click();
  await page.waitForURL(`**/projects/${id}`);
  await expect(page.getByRole('region', { name: 'From your accounts' }).getByText('4 of 20')).toBeVisible();
  await shot('09-added.png');

  // Disconnect: the row goes back to Connect, and the others stay connected.
  await page.goto('/projects/settings');
  const gmail = page.getByRole('listitem').filter({ hasText: 'Gmail' }).first();
  await gmail.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(gmail.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(gmail.getByText('Connected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Gmail' }).first().getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await shot('10-disconnected.png');
});
