import { describe, expect, it } from 'vitest';
import { appleMailMessageId, decodeHeader, mailTarget, mailTask, messageFromText, parseEml } from './mail';
import type { Label, Project, Section, Snapshot } from './types';

const words = { from: 'Von', date: 'Datum', open: 'In Mail öffnen', noSubject: 'Mail ohne Betreff' };

describe('E-Mails lesen', () => {
  it('dekodiert Betreffzeilen in UTF-8 und Latin-1', () => {
    expect(decodeHeader('=?utf-8?Q?Gr=C3=BC=C3=9Fe_aus_Mainz?=')).toBe('Grüße aus Mainz');
    expect(decodeHeader('=?UTF-8?B?w4RyZ2VyIG1pdCBkZXIgS8O8Y2hl?=')).toBe('Ärger mit der Küche');
    expect(decodeHeader('=?iso-8859-1?Q?M=FCller?= kommt')).toBe('Müller kommt');
    expect(decodeHeader('=?utf-8?Q?Teil_1?= =?utf-8?Q?_und_2?=')).toBe('Teil 1 und 2');
  });

  it('liest eine einfache Mail', () => {
    const mail = parseEml([
      'From: Anna <anna@example.com>',
      'Subject: Angebot',
      ' Gartenhaus',
      'Date: Fri, 16 Oct 2026 10:00:00 +0200',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hallo Steffen,=0Aanbei das Angebot f=C3=BCr das Gartenhaus.',
    ].join('\r\n'));
    expect(mail).toMatchObject({
      subject: 'Angebot Gartenhaus',
      from: 'Anna <anna@example.com>',
      date: 'Fri, 16 Oct 2026 10:00:00 +0200',
      body: 'Hallo Steffen,\nanbei das Angebot für das Gartenhaus.',
    });
  });

  it('nimmt aus einer mehrteiligen Mail den Text und lässt Anhänge liegen', () => {
    const mail = parseEml([
      'From: bot@example.com',
      'Subject: Bericht',
      'Content-Type: multipart/mixed; boundary="aaa"',
      '',
      '--aaa',
      'Content-Type: multipart/alternative; boundary=bbb',
      '',
      '--bbb',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Nur <b>HTML</b></p>',
      '--bbb',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      'RGVyIEJlcmljaHQgbGllZ3QgYmVpLg==',
      '--bbb--',
      '--aaa',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename=log.txt',
      '',
      'nicht dies',
      '--aaa--',
    ].join('\n'));
    expect(mail?.body).toBe('Der Bericht liegt bei.');
  });

  it('nimmt HTML, wenn es keinen Text gibt', () => {
    const mail = parseEml('Subject: X\nContent-Type: text/html\n\n<div>Zeile 1</div><div>Zeile&nbsp;2</div>');
    expect(mail?.body.trim()).toBe('Zeile 1\nZeile 2');
  });

  it('erkennt, wenn etwas keine Mail ist', () => {
    expect(parseEml('Einkaufsliste\nMilch')).toBeNull();
  });

  it('liest Apple-Mail-Links', () => {
    expect(appleMailMessageId('message:%3Cabc.123@mail.example.com%3E')).toBe('abc.123@mail.example.com');
    expect(appleMailMessageId('message://%3cX@Y%3e')).toBe('X@Y');
    expect(appleMailMessageId('https://example.com')).toBeNull();
  });

  it('macht aus Text Titel und Beschreibung', () => {
    expect(messageFromText('\n Rechnung März \nBitte bis Freitag zahlen.')).toEqual({
      subject: 'Rechnung März', body: 'Bitte bis Freitag zahlen.',
    });
  });

  it('baut die Aufgabe: Betreff als Titel, Absender, Datum, Link und Text als Beschreibung', () => {
    const task = mailTask({
      subject: 'Angebot', from: 'Anna', date: 'Fr, 16.10.', body: 'Hallo\n\n\n\nTschüss  \n',
      link: 'message://%3Cx%40y%3E',
    }, words);
    expect(task.content).toBe('Angebot');
    expect(task.description).toBe('**Von:** Anna\n**Datum:** Fr, 16.10.\n[In Mail öffnen](message://%3Cx%40y%3E)\n\nHallo\n\nTschüss');
    expect(mailTask({ subject: ' ', body: '' }, words).content).toBe('Mail ohne Betreff');
  });
});

describe('Ziel gezogener Mails', () => {
  const project = (id: string, extra: Partial<Project> = {}) =>
    ({ id, name: id, is_deleted: false, is_archived: false, ...extra }) as Project;
  const snapshot = {
    user: { inbox_project_id: 'in' },
    projects: { in: project('in', { name: 'Inbox', inbox_project: true }), privat: project('privat', { name: 'Privat' }), p1: project('p1', { name: 'Privat geplant', parent_id: 'privat' }), old: project('old', { is_archived: true }) },
    sections: {
      s1: { id: 's1', project_id: 'p1', name: 'A', is_deleted: false, is_archived: false } as Section,
      s2: { id: 's2', project_id: 'other', name: 'B', is_deleted: false, is_archived: false } as Section,
    },
    labels: {
      l1: { id: 'l1', name: 'privat_einkauf', is_deleted: false } as Label,
      l2: { id: 'l2', name: 'alt', is_deleted: true } as Label,
    },
  } as unknown as Pick<Snapshot, 'projects' | 'sections' | 'user' | 'labels'>;

  it('nimmt die offene Liste, samt angesprungenem Abschnitt', () => {
    expect(mailTarget({ view: 'project', id: 'p1' }, snapshot)).toEqual({ projectId: 'p1', sectionId: undefined, name: 'Privat · Privat geplant' });
    expect(mailTarget({ view: 'project', id: 'privat' }, snapshot).name).toBe('Privat · Allgemein');
    expect(mailTarget({ view: 'project', id: 'p1', sectionId: 's1' }, snapshot).sectionId).toBe('s1');
    expect(mailTarget({ view: 'project', id: 'p1', sectionId: 's2' }, snapshot).sectionId).toBeUndefined();
  });

  it('nimmt auf einer Tag-Seite den Tag mit in den Eingang', () => {
    expect(mailTarget({ view: 'label', id: 'privat_einkauf' }, snapshot))
      .toEqual({ projectId: 'in', labels: ['privat_einkauf'], name: 'privat_einkauf' });
    expect(mailTarget({ view: 'label', id: 'alt' }, snapshot)).toEqual({ projectId: 'in', name: null });
  });

  it('nimmt sonst den Eingang', () => {
    expect(mailTarget({ view: 'report' }, snapshot)).toEqual({ projectId: 'in', name: null });
    expect(mailTarget({ view: 'project', id: 'in' }, snapshot)).toEqual({ projectId: 'in', name: null });
    expect(mailTarget({ view: 'project', id: 'old' }, snapshot)).toEqual({ projectId: 'in', name: null });
    expect(mailTarget({ view: 'project', id: 'weg' }, snapshot)).toEqual({ projectId: 'in', name: null });
  });
});
