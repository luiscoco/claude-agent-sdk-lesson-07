import { test, expect } from '@playwright/test';
test('SSE error detail survives terminal error status', async ({ page }) => {
  await page.route('**/api/live', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"kind":"error","message":"Controlled injected failure"}\n\ndata: {"kind":"done","status":"error"}\n\n',
    }),
  );
  await page.goto('/');
  await page.locator('#mode').selectOption('live');
  await page.locator('#run').click();
  await expect(page.locator('#notice')).toContainText('Controlled injected failure');
  await expect(page.locator('#evidence')).toContainText('unknown');
  await expect(page.locator('#final')).toContainText('Awaiting');
});
test('step through replay, distinguish evidence and final, filter and export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load replay', exact: true }).click();
  await expect(page.locator('#position')).toContainText('0 /');
  await page.getByRole('button', { name: 'Next event', exact: true }).click();
  await expect(page.locator('#messages')).toHaveText('1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#final')).toContainText('Completed', { timeout: 15000 });
  await expect(page.locator('#evidence')).toContainText('not applicable');
  const before = await page.locator('#final').textContent();
  await page.locator('#filter').selectOption('callback');
  await expect(page.locator('#final')).toHaveText(before!);
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('lesson-07-observed-trace.json');
});
test('reset fixture discards stale state and keeps the audit', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scenario').selectOption('reset');
  await page.locator('#run').click();
  await page.locator('#play').click();
  await expect(page.locator('#final')).toContainText('Completed', { timeout: 15000 });
  await expect(page.locator('#resets')).toHaveText('1');
  await expect(page.locator('#identity')).toContainText('22222222');
  await expect(page.locator('#conversation')).not.toContainText('old conversation');
  await expect(page.locator('#events')).toContainText('conversation_reset');
  await page.locator('#mode').selectOption('live');
  await expect(page.locator('#scenario')).toHaveValue('success');
});
test('source, guide and quiz teach real API shapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '02 Field guide' }).click();
  await page.locator('#source-detail summary').click();
  await expect(page.locator('#source')).toContainText('hookSpecificOutput');
  await page.getByRole('button', { name: '03 Knowledge check' }).click();
  for (const [i, a] of [0, 1, 2, 0].entries())
    await page.locator(`input[name="q${i}"][value="${a}"]`).check();
  await page.locator('#grade').click();
  await expect(page.locator('#score')).toContainText('4 / 4');
});
test('phone layout fits and live missing-key errors are visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/live', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Configure your local key.' }),
    }),
  );
  await page.goto('/');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.locator('#mode').selectOption('live');
  await page.locator('#run').click();
  await expect(page.locator('#notice')).toContainText('Configure your local key.');
  await expect(page.locator('#run')).toBeEnabled();
});
