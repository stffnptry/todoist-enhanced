import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/store';
import { useT } from '@/hooks/useT';
import {
  appleMailMessageId, htmlToText, mailTask, messageFromText, parseEml, type MailMessage,
} from '@/domain/mail';
import { Icon } from './Icon';

/**
 * E-Mails ins Fenster ziehen: jede wird eine Aufgabe im Eingang, mit dem
 * Betreff als Titel und dem Text als Beschreibung (ENHANCED-2).
 *
 * Was beim Ablegen ankommt, hängt am Mailprogramm:
 * - .eml-Dateien (aus dem Finder oder Programmen, die Dateien mitgeben) werden
 *   direkt gelesen;
 * - Apple Mail gibt einen Link `message:<Message-ID>` mit; Betreff und Text
 *   holt die Mac-App per AppleScript aus Mail;
 * - gibt das Programm Chromium nichts davon (das neue Outlook), schaut die
 *   Mac-App auf die Drag-Ablage des Systems nach Dateien und Text;
 * - sonst bleibt Text oder HTML: erste Zeile Titel, der Rest Beschreibung.
 *
 * Ziehen innerhalb der Seite (der Kalender nutzt natives Drag & Drop) und
 * Ablegen in Textfelder bleiben, wie sie sind.
 */
export function MailDrop() {
  const { t } = useT();
  const createTask = useStore((s) => s.createTask);
  const toast = useStore((s) => s.toast);
  const snapshot = useStore((s) => s.snapshot);
  const [over, setOver] = useState(false);
  const inside = useRef(false);
  const depth = useRef(0);

  const inboxId = snapshot.user?.inbox_project_id
    || Object.values(snapshot.projects).find((p) => p.inbox_project && !p.is_deleted)?.id
    || '';
  /* Die Handler hängen einmal am Fenster; was sie brauchen, lesen sie hier. */
  const latest = useRef({ inboxId, createTask, toast, t });
  latest.current = { inboxId, createTask, toast, t };

  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
    const fromOutside = (event: DragEvent) => !inside.current && !!event.dataTransfer;

    const onStart = () => { inside.current = true; };
    const onEnd = () => { inside.current = false; };
    const onEnter = (event: DragEvent) => {
      if (!fromOutside(event)) return;
      depth.current += 1;
      setOver(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!fromOutside(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onOver = (event: DragEvent) => {
      if (!fromOutside(event) || isField(event.target)) return;
      // Ohne das öffnet Electron eine abgelegte Datei als Seite.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!fromOutside(event) || isField(event.target)) return;
      event.preventDefault();
      void handleDrop(event.dataTransfer!);
    };

    window.addEventListener('dragstart', onStart, true);
    window.addEventListener('dragend', onEnd, true);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragstart', onStart, true);
      window.removeEventListener('dragend', onEnd, true);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  async function handleDrop(data: DataTransfer) {
    const { inboxId: inbox, createTask: create, toast: say, t: tr } = latest.current;
    /* Alles sofort auslesen: nach dem ersten await ist der DataTransfer leer. */
    const files = [...data.files];
    const types = [...data.types];
    const uriList = data.getData('text/uri-list');
    const plain = data.getData('text/plain');
    const html = data.getData('text/html');

    const { mails, systemTypes } = await readMails({ files, uriList, plain, html });
    if (mails.length === 0) {
      /* Welche Daten kamen an: damit lässt sich ein weiteres Mailprogramm nachrüsten. */
      const seen = [...types, ...(systemTypes ?? [])];
      say(tr('mail.unreadable', { types: seen.join(', ') || '–' }), undefined, { tone: 'error' });
      return;
    }
    const words = { from: tr('mail.from'), date: tr('mail.date'), open: tr('mail.open'), noSubject: tr('mail.noSubject') };
    let created = 0;
    for (const mail of mails) {
      const { content, description } = mailTask(mail, words);
      if (await create({ content, description, project_id: inbox || undefined })) created += 1;
    }
    if (created === 1) say(tr('mail.created', { name: mailTask(mails[0], words).content }));
    else if (created > 1) say(tr('mail.createdMany', { count: created }));
  }

  if (!over) return null;
  return (
    <div className="maildrop" aria-hidden>
      <div className="maildrop-card">
        <Icon name="inbox" />
        {t('mail.dropHint')}
      </div>
    </div>
  );
}

async function readMails(
  input: { files: File[]; uriList: string; plain: string; html: string },
): Promise<{ mails: MailMessage[]; systemTypes?: string[] }> {
  const desktop = window.enhancedDesktop?.mail;
  const mails: MailMessage[] = [];

  // 1. .eml-Dateien
  for (const file of input.files) {
    if (!/\.eml$/i.test(file.name) && file.type !== 'message/rfc822') continue;
    const mail = parseEml(await file.text());
    if (mail) mails.push(mail);
  }
  if (mails.length > 0) return { mails };

  // 2. Apple Mail: ein message:-Link je Mail
  const links = input.uriList.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const link of links) {
    const id = appleMailMessageId(link);
    if (!id) continue;
    const answer = desktop ? await desktop.fromAppleMail(id) : null;
    if (answer?.ok) {
      mails.push({ subject: answer.subject ?? '', from: answer.from, date: answer.date, body: answer.body ?? '', link });
    } else {
      /* Ohne Mac-App (oder ohne Erlaubnis, Mail zu steuern) bleibt der Text, den Mail mitgibt. */
      const fallback = messageFromText(input.plain);
      mails.push({ subject: fallback?.subject ?? '', body: fallback?.body ?? '', link });
    }
  }
  if (mails.length > 0) return { mails };

  // 3. Nichts Lesbares für Chromium: die Drag-Ablage des Systems (neues Outlook u. a.)
  if (desktop && input.files.length === 0 && !input.plain && !input.html) {
    const board = await desktop.dragPasteboard();
    if (board.ok) {
      for (const path of board.files ?? []) {
        if (!/\.eml$/i.test(path)) continue;
        const file = await desktop.readEml(path);
        const mail = file.ok && file.text ? parseEml(file.text) : null;
        if (mail) mails.push(mail);
      }
      if (mails.length > 0) return { mails };
      const text = board.text || (board.html ? htmlToText(board.html) : '');
      const mail = text ? messageFromText(text) : null;
      if (mail) return { mails: [mail] };
      return { mails: [], systemTypes: board.types ?? [] };
    }
    return { mails: [] };
  }

  // 4. Text oder HTML
  const text = input.plain || (input.html ? htmlToText(input.html) : '');
  const mail = text ? messageFromText(text) : null;
  return { mails: mail ? [mail] : [] };
}
