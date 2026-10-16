import { test, expect, go, row } from './demo';

/** Legt Daten ab, als kämen sie von außen (Mailprogramm, Finder). */
async function dropFromOutside(page: import('@playwright/test').Page, data: { eml?: string; text?: string }) {
  await page.evaluate(({ eml, text }) => {
    const transfer = new DataTransfer();
    if (eml) transfer.items.add(new File([eml], 'mail.eml', { type: 'message/rfc822' }));
    if (text) transfer.setData('text/plain', text);
    const target = document.querySelector('.screen.active') ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, data);
}

test('ENHANCED-2: eine .eml-Datei wird eine Aufgabe im Eingang', async ({ demo: page }) => {
  await go(page, '#/inbox');
  await dropFromOutside(page, {
    eml: [
      'From: Anna <anna@example.com>',
      'Subject: =?utf-8?Q?Angebot_f=C3=BCr_das_Gartenhaus?=',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Bitte bis Freitag ansehen.',
    ].join('\r\n'),
  });
  await expect(page.getByText('Added to Inbox: Angebot für das Gartenhaus')).toBeVisible();
  await expect(row(page, 'Angebot für das Gartenhaus')).toBeVisible();
});

test('ENHANCED-2: Text wird Titel und Beschreibung', async ({ demo: page }) => {
  await go(page, '#/inbox');
  await dropFromOutside(page, { text: 'Rückruf Handwerker\nNummer steht in der Mail' });
  await expect(row(page, 'Rückruf Handwerker')).toBeVisible();
});
