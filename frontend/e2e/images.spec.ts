import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createProject, stageArtifact } from './helpers';

/**
 * H3 — photos in the work (3 Oct call: "attachments, pictures, photos…
 * images into [the book]"). An image is added with a caption, shown as a
 * thumbnail, and placed in a draft from the editor; the draft draws it.
 */
test('an image is added with a caption, placed in a draft, and drawn there', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E images', objective: 'A short book about lions' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const data = page.getByRole('region', { name: 'Project data' });
  await data.getByLabel('Add images').setInputFiles(join(__dirname, 'fixtures/lioness.png'));
  await data.getByLabel('Caption for lioness.png').fill('A lioness resting at dusk');
  await page.screenshot({ path: test.info().outputPath('01-caption.png'), fullPage: true });
  await data.getByRole('button', { name: 'Add this image' }).click();
  await expect(data.getByRole('list', { name: 'Images' }).getByRole('img', { name: 'A lioness resting at dusk' })).toBeVisible({ timeout: 15_000 });

  const work = stageArtifact(page);
  await work.getByRole('button', { name: 'Edit' }).click();
  await work.getByRole('button', { name: 'Insert image' }).click();
  await work.getByRole('menuitem', { name: 'A lioness resting at dusk' }).click();
  await expect(work.getByRole('textbox')).toHaveValue(/!\[A lioness resting at dusk\]\(project-file:[0-9a-f-]+\)/);
  await work.getByRole('button', { name: 'Save as new version' }).click();

  await expect(work.getByRole('img', { name: 'A lioness resting at dusk' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('02-placed-in-the-draft.png'), fullPage: true });
});
