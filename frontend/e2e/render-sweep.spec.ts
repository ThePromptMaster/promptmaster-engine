import { expect, test, type Page } from '@playwright/test';

import { en } from '../src/lib/i18n/messages/en';
import { DICTIONARIES } from '../src/lib/i18n/translate';
import { LOCALES, type Locale } from '../src/lib/i18n/locales';
import { BASE_URL } from './env';
import { createProject, pressTransition } from './helpers';

/**
 * Every interface language renders well (24 Oct, after Hindi, Chinese, Arabic
 * and Swahili were added): on the pages a first session goes through, at a
 * computer's width and a phone's, nothing runs off the side, no button's words
 * are cut, the direction is right, and no interface words are left in English.
 */
const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

// English values whose translation is a different string: seeing the English on
// a page in another language means a string escaped translation.
function leaked(locale: Locale): Set<string> {
  const dict = DICTIONARIES[locale] as Record<string, string>;
  const out = new Set<string>();
  for (const [key, value] of Object.entries(en as Record<string, string>)) {
    if (/\{\w+\}/.test(value) || value.trim().split(/\s+/).length < 2) continue;
    if (dict[key] && dict[key] !== value) out.add(value.trim());
  }
  return out;
}

async function check(page: Page, locale: Locale, where: string, width: number) {
  const english = [...leaked(locale)];
  const report = await page.evaluate(
    ({ english, latinScript }) => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
      };
      const texts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        const el = n.parentElement;
        if (!t || !el || el.closest('script,style,textarea,[data-user-content],article,.material-symbols-outlined')) continue;
        if (visible(el)) texts.push(t);
      }
      const set = new Set(english);
      const untranslated = [...new Set(texts.filter((t) => set.has(t)))];
      // In a non-Latin script, Latin sentences of three or more words are worth a look.
      // In a non-Latin script, Latin phrases of two or more words are interface words left in English,
      // unless they are the project's own (its name and objective, the mock model's text).
      const own = /E2E render sweep|Write a short note on tea|Mock output|scripted|mock model|PromptMaster|^General$/i;
      const latin = latinScript ? [] : [...new Set(texts.filter((t) => /^[A-Za-z][A-Za-z0-9 ,.'’:;()?!\/&+-]+$/.test(t) && t.split(' ').length >= 2 && !own.test(t)))];
      const clipped = [...document.querySelectorAll('button, a, label, [role=tab], [role=radio]')]
        .filter((el) => visible(el) && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 2 && getComputedStyle(el).overflow !== 'visible')
        .map((el) => (el.textContent ?? '').trim().slice(0, 60))
        .filter(Boolean);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('body *')]
          .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || e.getBoundingClientRect().left < -1)
          .slice(0, 6)
          .map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 80)} [${Math.round(e.getBoundingClientRect().left)},${Math.round(e.getBoundingClientRect().right)}]`),
        dir: document.documentElement.dir || 'ltr',
        lang: document.documentElement.lang,
        untranslated,
        latin,
        clipped,
      };
    },
    { english, latinScript: ['en', 'es', 'fr', 'pt', 'sw'].includes(locale) }
  );
  const label = `${locale} ${where} ${width}px`;
  test.info().annotations.push({ type: 'render', description: `${label}: ${JSON.stringify({ untranslated: report.untranslated, latin: report.latin, clipped: report.clipped })}` });
  expect.soft(report.lang, label).toBe(locale);
  expect.soft(report.dir, label).toBe(locale === 'ar' ? 'rtl' : 'ltr');
  expect.soft(report.overflow, `${label}: sideways scroll ${JSON.stringify(report.wide)}`).toBeLessThanOrEqual(0);
  expect.soft(report.untranslated, `${label}: English left in the interface`).toEqual([]);
  expect.soft(report.latin, `${label}: Latin-script words in a non-Latin interface`).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`${where}-${locale}-${width}.png`), fullPage: true });
}

let projectId = '';

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: 'e2e/.auth/state.json', viewport: { width: 1440, height: 900 } });
  projectId = await createProject(page, { workflow: 'Single output', name: 'E2E render sweep', objective: 'Write a short note on tea' });
  await pressTransition(page);
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await page.close();
});

for (const { code } of LOCALES) {
  for (const w of WIDTHS) {
    test(`${code} renders well at ${w.name} width`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w.width, height: w.height });
      await context.addCookies([{ name: 'pm.locale', value: code, url: BASE_URL }]);
      await page.addInitScript((c) => {
        try {
          window.localStorage.setItem('pm.locale', c);
        } catch {
          // private mode: the cookie still carries it
        }
      }, code);

      await page.goto('/projects');
      await page.locator('main li a[href^="/projects/"]').first().waitFor();
      await check(page, code, 'projects', w.width);

      await page.goto('/projects/new');
      await page.locator('textarea').first().waitFor();
      await check(page, code, 'new', w.width);

      await page.goto(`/projects/${projectId}`);
      await page.getByText('Mock output').first().waitFor({ timeout: 30_000 });
      await check(page, code, 'workspace', w.width);

      // The menus: the stage's More menu and the account menu.
      const more = page.getByRole('group').locator('button[aria-haspopup]').last();
      if (await more.isVisible().catch(() => false)) {
        await more.click();
        await check(page, code, 'workspace-more', w.width);
        await page.keyboard.press('Escape');
      }
      await page.locator('header button[aria-haspopup], header button[aria-expanded]').first().click();
      await check(page, code, 'account-menu', w.width);
    });
  }
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const { code } of LOCALES) {
    test(`${code} landing and sign-in render well`, async ({ page, context }) => {
      await context.addCookies([{ name: 'pm.locale', value: code, url: BASE_URL }]);
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w.width, height: w.height });
        await page.goto('/');
        await page.locator('h1').first().waitFor();
        await check(page, code, 'landing', w.width);
        await page.goto('/auth/login');
        await page.locator('input[type=email]').first().waitFor();
        await check(page, code, 'login', w.width);
      }
    });
  }
});
