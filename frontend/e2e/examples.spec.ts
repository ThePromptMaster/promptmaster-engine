import { expect, test, type Page } from '@playwright/test';

import { API_URL } from './env';
import { dismissBetaNotice, serviceSelect, transitionBar } from './helpers';

/**
 * The curated examples (the client's call, 4 Nov): a visitor with no account can
 * see what one does, try it on invented material, and nothing that costs
 * anything runs until they press something that says it will.
 */
test.use({ storageState: { cookies: [], origins: [] } });

function backendCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().startsWith(API_URL)) calls.push(new URL(r.url()).pathname);
  });
  return calls;
}

test('an example from a signed-out visit: nothing is spent until a press says so', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = backendCalls(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });

  await page.goto('/examples');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'Start from a real piece of work' })).toBeVisible();
  await shot('01-examples.png');
  await page.getByRole('link', { name: /Investment memo/ }).click();

  // The preview says what it is and creates nothing. No account yet.
  await expect(page).toHaveURL(/\/examples\/investment-memo$/);
  await expect(page.getByRole('heading', { name: 'Investment memo' })).toBeVisible();
  await expect(page.getByText('Financial analysis')).toBeVisible();
  await expect(page.getByText(/No account needed/)).toBeVisible();
  await page.getByRole('button', { name: 'Show the sample' }).click();
  await expect(page.getByText(/Everything below is invented/)).toBeVisible();
  await expect(page.getByText('harrowgate_financials.csv').first()).toBeVisible();
  await shot('02-preview.png');

  await page.getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split('/').at(-1)!;

  // The first stage is already there, and marked as what it is.
  await expect(page.getByRole('heading', { name: 'Deal brief' })).toBeVisible();
  await expect(page.getByText(/What would make it a yes/)).toBeVisible();
  await shot('03-prepared-stage.png');

  const [project] = await serviceSelect('projects', `id=eq.${id}&select=example_key,web_access,routine_decisions,user_id,objective`);
  expect(project).toMatchObject({ example_key: 'investment_memo', web_access: 'off', routine_decisions: 'handle' });
  const files = await serviceSelect('project_files', `project_id=eq.${id}&select=name`);
  expect(files.map((f: { name: string }) => f.name)).toEqual(['harrowgate_financials.csv']);
  const prepared = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=source_operation,model`);
  expect(prepared).toEqual([{ source_operation: 'example_prewritten', model: '' }]);

  // Moving on writes nothing and asks no model: the next stage waits for a press.
  await page.getByRole('checkbox', { name: 'I approve this brief' }).check();
  const bar = transitionBar(page);
  await bar.getByRole('button', { name: /^Continue to/ }).click();
  await expect(page.getByRole('heading', { name: 'Financial analysis' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft this stage' }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);
  expect(calls).toEqual([]);
  const usage = await serviceSelect('model_usage', `user_id=eq.${project.user_id}&select=operation`);
  expect(usage).toEqual([]);
  await shot('04-held-stage.png');

  // The press is one call.
  await page.getByRole('button', { name: 'Draft this stage' }).first().click();
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  expect(calls).toEqual(['/api/generate-stage-artifact']);
  await shot('05-drafted.png');
});

test('the same workflow on your own work is an ordinary project', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/examples/business-analysis');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you need?').fill('Should we move our support team to a four-day week?');
  await page.getByRole('button', { name: 'Start with my own work' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split('/').at(-1)!;

  // Drafted on arrival, as any project is; no sample and no hold.
  await expect(page.getByRole('heading', { name: 'The question' })).toBeVisible();
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=example_key,web_access,title,objective,context`);
  expect(project).toMatchObject({
    example_key: null,
    web_access: 'on',
    objective: 'Should we move our support team to a four-day week?',
    context: '',
  });
  const files = await serviceSelect('project_files', `project_id=eq.${id}&select=name`);
  expect(files).toEqual([]);
});

test('an unknown example says so and offers the real ones', async ({ page }) => {
  await page.goto('/examples/nothing-here');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'There is no example here' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Business analysis/ })).toBeVisible();
});

test('deal screening: the sample batch fills the box, and only Assess runs anything', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = backendCalls(page);
  await page.goto('/examples/deal-screening');
  await dismissBetaNotice(page);
  await page.getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByRole('heading', { name: 'Mandate and criteria' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I approve these criteria for judging every deal' }).check();
  await transitionBar(page).getByRole('button', { name: /^Continue to/ }).click();
  await expect(page.getByRole('heading', { name: 'Screen the deals' })).toBeVisible();

  await page.getByRole('button', { name: 'Use the sample batch' }).click();
  await expect(page.getByLabel('Paste the deals to assess')).toHaveValue(/Tamarack Ridge Fasteners/);
  await page.screenshot({ path: test.info().outputPath('01-sample-batch.png'), fullPage: true });
  expect(calls).toEqual([]);

  await page.getByRole('region', { name: 'New batch' }).getByRole('button', { name: 'Assess', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  expect(calls).toEqual(['/api/assess-batch']);
  await page.screenshot({ path: test.info().outputPath('02-verdicts.png'), fullPage: true });
});

test('a deliverable laid out as slides downloads as a PowerPoint file', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/examples/slide-deck');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'Slide deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Audience and message' })).toBeVisible();
  const [project] = await serviceSelect('projects', `id=${'eq.' + page.url().split('/').at(-1)}&select=output_format,example_key`);
  expect(project.example_key).toBe('slide_deck');
  expect(project.output_format).toContain('Speaker notes:');
});
