import path from 'node:path';

import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * S1b (5 Oct, email 8): "should we put the attachment/image stuff in the
 * beginning screen so it recognizes it when creating prompt?"
 *
 * A PDF brief and a Word note attached on the start screen are read before the
 * setup is suggested, their words go into the project context, and the files
 * are part of the project once it starts.
 */
const FIXTURES = path.join(__dirname, '..', 'src', 'lib', 'data', '__fixtures__');

test('a brief attached on the start screen shapes the setup and lands in the project', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Explain the margin decline to the board.');
  await page.getByLabel('Attach files').setInputFiles([path.join(FIXTURES, 'brief.pdf'), path.join(FIXTURES, 'brief.docx')]);
  const attached = page.getByRole('list', { name: 'Attached' });
  await expect(attached).toContainText('brief.pdf');
  await expect(attached).toContainText('goes into the project context');
  await expect(attached).toContainText('brief.docx');
  await page.screenshot({ path: test.info().outputPath('01-brief-attached-on-the-start-screen.png') });

  // The setup call is given the brief's words.
  const setupRequest = page.waitForRequest((r) => r.url().endsWith('/api/generate-setup'));
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  const body = (await setupRequest).postDataJSON() as { material?: string };
  expect(body.material).toContain('Gross margin fell from 31.2% to 24.8% in FY2025.');
  expect(body.material).toContain('Funding is secured through Q3 2026.');

  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  const context = page.getByLabel('Project context');
  await expect(context).toHaveValue(/### From brief\.pdf[\s\S]*31\.2% to 24\.8%/);
  await expect(context).toHaveValue(/### From brief\.docx[\s\S]*Funding is secured/);
  await context.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-brief-text-in-the-setup.png') });

  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E start attachments');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  const files = await serviceSelect('project_files', `project_id=eq.${id}&select=name&order=name`);
  expect(files.map((f: { name: string }) => f.name)).toEqual(['brief.docx', 'brief.pdf']);
  const data = page.getByRole('region', { name: 'Project data' });
  await expect(data).toContainText('brief.pdf');
  await data.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-files-in-the-project.png') });
});

test('a Word brief added on a later stage can go into the project context', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Write a short funding memo.');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E stage document');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page.getByText('Mock output').first()).toBeVisible();

  await page.getByLabel('Attach data files').setInputFiles(path.join(FIXTURES, 'brief.docx'));
  await page.getByRole('button', { name: 'Add its text to the project context' }).click();
  await expect(page.locator('#setup-context')).toHaveValue(/### From brief\.docx[\s\S]*Funding is secured through Q3 2026\./);
  await page.locator('#setup-context').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('04-docx-text-added-on-a-stage.png') });
});

/**
 * P1a (6 Oct, email 9: "Attachments aren't working"). A file whose name has
 * an accent, a dash and curly quotes was refused by Storage as "Invalid key",
 * and on the start screen that took the whole project back out. The name the
 * user gave is kept; only the storage key is made safe.
 */
test('a file with accents and curly quotes in its name attaches, at the start and from the chat', async ({ page }) => {
  const fs = await import('node:fs/promises');
  const pdf = await fs.readFile(path.join(FIXTURES, 'brief.pdf'));
  const docx = await fs.readFile(path.join(FIXTURES, 'brief.docx'));
  const pdfName = 'Résumé – “final”.pdf';
  const docxName = 'Notes – “Café”.docx';

  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Explain the margin decline to the board.');
  await page.getByLabel('Attach files').setInputFiles([{ name: pdfName, mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('list', { name: 'Attached' })).toContainText(pdfName);
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E accented attachments');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  let files = await serviceSelect('project_files', `project_id=eq.${id}&select=name,path`);
  expect(files.map((f: { name: string }) => f.name)).toEqual([pdfName]);
  expect(files[0].path).toMatch(/-Resume-final\.pdf$/);
  await page.screenshot({ path: test.info().outputPath('05-accented-name-at-the-start.png') });

  // The side chat has a paperclip, and it stores the file the same way.
  await expect(page.getByText('Mock output').first()).toBeVisible();
  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat
    .getByLabel('Attach a file to the project')
    .setInputFiles([{ name: docxName, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }]);
  await expect(chat.getByRole('status')).toContainText(`Attached to the project: ${docxName}.`);
  await chat.getByRole('button', { name: 'Add its text to the project context' }).click();
  await expect(page.locator('#setup-context')).toHaveValue(/### From Notes – “Café”\.docx[\s\S]*Funding is secured/);
  files = await serviceSelect('project_files', `project_id=eq.${id}&select=name&order=name`);
  expect(files.map((f: { name: string }) => f.name)).toEqual([docxName, pdfName]);
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('06-attached-from-the-chat.png') });
});
