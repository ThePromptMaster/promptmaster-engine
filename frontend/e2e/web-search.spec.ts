import { expect, test } from '@playwright/test';

import { createProject, serviceSelect } from './helpers';

/**
 * 20 Oct (Sean): "Can we add web search and source retrieval to research
 * workflows, with citations and saved sources? On and off button?"
 * Off by default, per project; on, a search saves the search's own sources,
 * numbered as every stage cites them. The scripted model returns two sources.
 */
test('Web access is off by default; on, a search saves its sources and every stage is sent them', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Single output', name: 'E2E web search', objective: 'Screen Harbor Industrial Services' });

  const panel = page.getByRole('region', { name: 'Web access and sources' });
  await expect(panel).toContainText('web access off');
  await panel.getByRole('button', { name: /Web sources/ }).click();
  const toggle = panel.getByRole('switch', { name: 'Web access' });
  await expect(toggle).not.toBeChecked();
  await expect(panel.getByRole('form', { name: 'Search the web' })).toHaveCount(0);

  await toggle.check();
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=web_access`))[0].web_access).toBe('on');
  // The event is written just after the switch's own row: wait for it rather than race it.
  await expect
    .poll(async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.web_access_changed&select=actor,payload`))[0])
    .toMatchObject({ actor: 'user', payload: { web_access: 'on' } });

  await panel.getByLabel('What to search the web for').fill('Harbor Industrial Services market growth');
  await panel.getByRole('button', { name: 'Search the web' }).click();
  await expect(panel.getByRole('status')).toContainText('2 new sources saved', { timeout: 30_000 });
  const list = panel.getByRole('list', { name: 'Saved sources' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('[S1] Market report 2025');
  await expect(list).toContainText('[S2] Two competitors merge');
  await page.screenshot({ path: test.info().outputPath('01-sources-saved.png'), fullPage: true });

  const rows = await serviceSelect('project_sources', `project_id=eq.${id}&select=url,title,query,origin,retired_at&order=created_at`);
  expect(rows.map((r: { url: string }) => r.url)).toEqual(['https://example.org/market-2025', 'https://news.example.com/merger']);
  expect(rows[0]).toMatchObject({ query: 'Harbor Industrial Services market growth', origin: 'user', retired_at: null });

  // The same search again saves nothing twice.
  await panel.getByLabel('What to search the web for').fill('Harbor Industrial Services market growth');
  await panel.getByRole('button', { name: 'Search the web' }).click();
  await expect(panel.getByRole('status')).toContainText('0 new sources saved; 2 already on record', { timeout: 30_000 });

  // Taken out: kept in the history, no longer cited.
  await list.getByRole('button', { name: 'Take out' }).first().click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('[S1] Two competitors merge');
  const [retired] = await serviceSelect('project_sources', `project_id=eq.${id}&url=eq.https://example.org/market-2025&select=retired_at`);
  expect(retired.retired_at).not.toBeNull();

  // Off again: no search, and the database refuses a new source.
  await toggle.uncheck();
  await expect(panel.getByRole('form', { name: 'Search the web' })).toHaveCount(0);
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=web_access`))[0].web_access).toBe('off');
});
