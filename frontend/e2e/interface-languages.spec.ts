import { expect, test } from '@playwright/test';

import { BASE_URL } from './env';

/**
 * Sean, 24 Oct: "the next language should be Hindi and then Mandarin. Arabic
 * and Swahili." The interface in each, chosen by the same cookie the account
 * menu sets; Arabic mirrors the page.
 */
const CASES = [
  { code: 'hi', title: 'प्रोजेक्ट', create: 'नया प्रोजेक्ट', dir: 'ltr' },
  { code: 'zh', title: '项目', create: '新建项目', dir: 'ltr' },
  { code: 'ar', title: 'المشاريع', create: 'مشروع جديد', dir: 'rtl' },
  { code: 'sw', title: 'Miradi', create: 'Mradi mpya', dir: 'ltr' },
] as const;

for (const c of CASES) {
  test(`the projects list reads in ${c.code}`, async ({ page, context }) => {
    await context.addCookies([{ name: 'pm.locale', value: c.code, url: BASE_URL }]);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { level: 1, name: c.title })).toBeVisible();
    await expect(page.getByRole('link', { name: c.create })).toBeVisible();
    expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual([c.code, c.dir]);
    // Nothing runs off the side, which is where a mirrored layout breaks first.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`projects-${c.code}.png`) });

    await page.goto('/projects/new');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`new-${c.code}.png`) });
  });
}
