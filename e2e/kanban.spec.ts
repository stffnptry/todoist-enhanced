import { test, expect, go } from './demo';

test('Kanban: ein Projekt nach Status gruppiert hat drei Spalten, und eine Karte wechselt per Ziehen', async ({ demo: page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await go(page, '#/project/site');
  await page.getByRole('button', { name: /^Display/ }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).first().click();
  await page.getByRole('button', { name: 'Grouping' }).click();
  await page.getByRole('option', { name: /Status \(Kanban\)/ }).click();
  await page.keyboard.press('Escape');

  const board = page.locator('.screen.active .board');
  await expect(board).toBeVisible();
  await expect.poll(async () => (await board.locator('strong').allInnerTexts()).slice(0, 3))
    .toEqual(['Open', 'In progress', 'Done']);

  const card = board.locator('[data-task-id]').first();
  const target = board.locator('strong', { hasText: 'In progress' });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from!.x + 40, from!.y + 15);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + 30, { steps: 5 });
  await page.mouse.move(to!.x + 40, to!.y + 80, { steps: 20 });
  await page.mouse.up();

  await expect(page.getByText('Status: In progress')).toBeVisible();
});
