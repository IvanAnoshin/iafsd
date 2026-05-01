import { expect, test } from '@playwright/test';

const pages = [
  '/',
  '/feed',
  '/chat',
  '/communities',
  '/people',
  '/settings',
  '/feedback',
  '/recover/phrase',
  '/register',
  '/terms',
  '/privacy',
  '/rules',
  '/safety',
  '/data',
  '/delete-account',
];

test.describe('critical public pages', () => {
  for (const path of pages) {
    test(`${path} opens without 5xx`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} status`).toBeLessThan(500);
      await expect(page.locator('body')).toBeVisible();
    });
  }
});
