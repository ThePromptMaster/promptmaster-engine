import type { Page } from '@playwright/test';

/** The first-visit beta notice covers the bottom of the page until acknowledged. */
export async function dismissBetaNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}
