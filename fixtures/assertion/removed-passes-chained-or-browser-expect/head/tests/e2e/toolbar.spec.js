import { expect, test } from '@playwright/test';

test('the share button is as wide as its neighbours', async ({ page }) => {
  await page.goto('/article');
  await expect
    .poll(async () => {
      const share = await page.locator('#share').boundingBox();
      const print = await page.locator('#print').boundingBox();
      return share && print?.width ? share.width / print.width : 0;
    })
    .toBeGreaterThanOrEqual(0.9);
});

test('the share menu opens', async ({ page }) => {
  await page.goto('/article');
  await page.locator('#share').click();
  await expect.element(page.locator('#share-menu')).toBeVisible();
});
