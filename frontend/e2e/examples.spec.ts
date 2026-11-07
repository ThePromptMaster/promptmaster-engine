import { expect, test, type Page } from '@playwright/test';

import { API_URL } from './env';
import { servicePatch, serviceSelect, transitionBar } from './helpers';

/**
 * The curated examples (the client's call, 4 Nov): a visitor with no account can
 * see what one does, try it on invented material, and nothing that costs
 * anything runs until they press something that says it will.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Every test here starts with nothing stored, so the beta notice always comes, but
 * only after hydration. The shared helper looks once: on a slow run it misses the
 * notice, which then sits over the stage's Continue button until the test times out.
 */
async function pressGotIt(page: Page) {
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 15_000 });
}

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
  await pressGotIt(page);
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
  // What it is about is one line above it, not a form it has to be scrolled past.
  await expect(page.getByLabel('Objective').first()).toBeHidden();
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
  await pressGotIt(page);
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
  await pressGotIt(page);
  await expect(page.getByRole('heading', { name: 'There is no example here' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Business analysis/ })).toBeVisible();
});

test('suggest work: nothing is sent until the press, and a suggestion starts a real project', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = backendCalls(page);
  await page.goto('/examples');
  await pressGotIt(page);
  await page.getByRole('button', { name: /Three quick questions/ }).click();
  await page.getByLabel(/on your plate/).fill('A board deck by Friday, and a budget review on Tuesday');
  await page.screenshot({ path: test.info().outputPath('01-before-press.png'), fullPage: true });
  expect(calls).toEqual([]);

  await page.getByRole('button', { name: 'Suggest work for me' }).click();
  await expect(page.getByRole('region', { name: 'Work you could start' })).toBeVisible({ timeout: 30_000 });
  expect(calls).toEqual(['/api/suggest-workflows']);
  await page.screenshot({ path: test.info().outputPath('02-suggestions.png'), fullPage: true });

  await page.getByRole('button', { name: 'Start this' }).first().click();
  await expect(page).toHaveURL(/\/projects\/new$/, { timeout: 30_000 });
  await expect(page.getByRole('textbox').first()).toHaveValue(/Mock: produce the work/);
  await page.screenshot({ path: test.info().outputPath('03-start-box.png'), fullPage: true });
});

test('deal screening: the sample batch fills the box, and only Assess runs anything', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = backendCalls(page);
  await page.goto('/examples/deal-screening');
  await pressGotIt(page);
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

test('deal screening under Go: it judges the sample batch itself, and does not check the prepared criteria', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = backendCalls(page);
  await page.goto('/examples/deal-screening');
  await pressGotIt(page);
  await page.getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Mandate and criteria' })).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  // A real planner moves on once the criteria are approved; the scripted one is told to.
  await servicePatch('projects', `id=eq.${id}`, { objective: 'Screen the deals [[mock:plan=advance_stage]]' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mandate and criteria' })).toBeVisible();

  await page.getByRole('button', { name: 'Let Go run this' }).click();
  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('I approve these criteria for judging every deal', { timeout: 30_000 });
  // The prepared text was read by nobody but the user: no check, no rewrite.
  expect(calls).not.toContain('/api/generate-stage-artifact');
  expect(calls).not.toContain('/api/evaluate-stage');
  const versions = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=source_operation`);
  expect(versions).toEqual([{ source_operation: 'example_prewritten' }]);

  await card.getByRole('button', { name: 'Approve and resume' }).click();
  await expect.poll(() => calls.filter((c) => c === '/api/assess-batch').length, { timeout: 60_000 }).toBe(1);
  await expect(page.getByRole('table').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('01-go-judged-the-batch.png'), fullPage: true });
  const steps = await serviceSelect('agent_steps', `project_id=eq.${id}&action_key=eq.assess_batch&select=status,output`);
  expect(steps[0].status).toBe('succeeded');
  expect(steps[0].output).toContain('from the sample batch');
});

test('a preview shows what a real run produced, dated, with no account and nothing spent', async ({ page }) => {
  const calls = backendCalls(page);
  await page.goto('/examples/deal-screening');
  await pressGotIt(page);
  await expect(page.getByRole('heading', { name: 'What it produced' })).toBeVisible();
  await expect(page.getByText(/A real run of this example on /)).toBeVisible();
  await expect(page.locator('[data-finished-result]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the finished result' }).click();
  await expect(page.locator('[data-finished-result]')).toContainText('Tamarack Ridge Fasteners');
  await page.screenshot({ path: test.info().outputPath('01-finished-result.png'), fullPage: true });
  expect(calls).toEqual([]);
});

test('the slide deck example asks for slides in the form the PowerPoint export reads', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/examples/slide-deck');
  await pressGotIt(page);
  await expect(page.getByRole('heading', { name: 'Slide deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Audience and message' })).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=output_format,example_key`);
  expect(project.example_key).toBe('slide_deck');
  expect(project.output_format).toContain('Speaker notes:');
});

test('Prompty offers a way in once, after the beta notice, and stays on as Help', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Prompty' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Got it' }).click();

  const prompty = page.getByRole('dialog', { name: 'Prompty' });
  await expect(prompty).toContainText('Want to see an example, or start with your own project?');
  await page.screenshot({ path: test.info().outputPath('prompty-landing.png') });
  await prompty.getByRole('link', { name: 'Show me an example' }).click();
  await expect(page.locator('#examples')).toBeInViewport();
  await expect(prompty).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  await expect(prompty).toHaveCount(0);
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(prompty).toBeVisible();
});
