import { test as base, expect } from '@playwright/test';
import { go, rows } from './demo';

/* Der Kalender braucht die Mac-App; hier ein Testkalender ohne Termine. */
const test = base.extend<{ cal: import('@playwright/test').Page }>({
  cal: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('skipSetup', '1');
      (window as unknown as { enhancedDesktop: unknown }).enhancedDesktop = {
        hideQuickAdd: () => {},
        calendar: async (command: string) => {
          if (command === 'access' || command === 'status') return { ok: true, granted: true, status: 'granted' };
          if (command === 'calendars') return { ok: true, calendars: [{ id: 'c1', title: 'Test', color: '#3366ff', source: 'Test' }] };
          if (command === 'events') return { ok: true, events: [] };
          return { ok: true };
        },
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore with demo data' }).click();
    await expect(rows(page).first()).toBeVisible();
    await use(page);
  },
});

test('ENHANCED-5: Zeitraum im Kalender aufziehen öffnet die Eingabe mit Uhrzeit und Dauer', async ({ cal: page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await go(page, '#/calendar');
  const column = page.locator('.cal-col').nth(2);
  await expect(column).toBeVisible();
  const box = (await column.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = 420; // im sichtbaren Teil des Rasters (es startet gescrollt bei 7 Uhr)
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 40, { steps: 5 });
  await page.mouse.move(x, y + 90, { steps: 5 });
  await expect(page.locator('.cal-draft')).toBeVisible();
  await page.screenshot({ path: process.env.SHOT_DRAG ?? 'test-results/cal-drag.png' });
  await page.mouse.up();
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: process.env.SHOT_COMPOSER ?? 'test-results/cal-composer.png' });
  await page.keyboard.type('Bericht schreiben');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cal-taskblock', { hasText: 'Bericht schreiben' })).toBeVisible();
  await page.screenshot({ path: process.env.SHOT_DONE ?? 'test-results/cal-done.png' });
});

test('ENHANCED-5: Doppelklick und Rechtsklick legen an', async ({ cal: page }) => {
  await go(page, '#/calendar');
  const column = page.locator('.cal-col').nth(1);
  const box = (await column.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, 500, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: /New task at/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(box.x + box.width / 2, 500);
  await expect(page.getByRole('dialog').last()).toBeVisible();
});
