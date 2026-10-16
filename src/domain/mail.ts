/**
 * E-Mails als Aufgaben (Ziehen aus Apple Mail, Outlook oder als .eml-Datei).
 *
 * Eine Mail kommt auf drei Wegen an: als .eml-Datei (Finder, manche
 * Mailprogramme), über Apple Mail selbst (die Mac-App fragt Mail per
 * AppleScript nach Betreff und Text, siehe desktop/main.js) oder nur als Text
 * bzw. HTML, wenn das Programm nichts anderes mitgibt. Alles endet hier in
 * derselben Form und wird zu Titel und Beschreibung einer Aufgabe.
 */
export interface MailMessage {
  subject: string;
  from?: string;
  date?: string;
  body: string;
  /** Rückweg zur Mail, etwa `message://%3C…%3E` für Apple Mail. */
  link?: string;
}

/** Mehr Text gehört nicht in eine Aufgabe; Todoist nimmt höchstens 16 000 Zeichen. */
const BODY_LIMIT = 4000;

// ---------- .eml (RFC 5322 / MIME) ----------

interface Part {
  headers: Record<string, string>;
  body: string;
}

/** Kopfzeilen und Rumpf trennen; Fortsetzungszeilen werden angehängt. */
function splitPart(raw: string): Part {
  const text = raw.replace(/\r\n/g, '\n');
  const end = text.search(/\n\n/);
  const head = end < 0 ? text : text.slice(0, end);
  const body = end < 0 ? '' : text.slice(end + 2);
  const headers: Record<string, string> = {};
  let last = '';
  for (const line of head.split('\n')) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    last = line.slice(0, colon).trim().toLowerCase();
    headers[last] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

function param(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return match ? (match[1] ?? match[2]) : undefined;
}

function decodeBytes(bytes: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const binary = atob(clean);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function quotedPrintableBytes(text: string, header = false): Uint8Array {
  const source = header ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      out.push(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      /* Was kein Escape ist, steht als UTF-8 da (eine Datei kann trotzdem
         Umlaute im Klartext haben). */
      out.push(...new TextEncoder().encode(c));
    }
  }
  return Uint8Array.from(out);
}

/** „=?utf-8?Q?Gr=C3=BC=C3=9Fe?=“ und „=?UTF-8?B?…?=“ in Kopfzeilen. */
export function decodeHeader(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, kind: string, text: string) =>
      decodeBytes(kind.toUpperCase() === 'B' ? base64Bytes(text) : quotedPrintableBytes(text, true), charset));
}

function decodeBody(part: Part): string {
  const encoding = (part.headers['content-transfer-encoding'] ?? '').toLowerCase();
  const charset = param(part.headers['content-type'], 'charset') ?? 'utf-8';
  if (encoding === 'base64') return decodeBytes(base64Bytes(part.body), charset);
  if (encoding === 'quoted-printable') return decodeBytes(quotedPrintableBytes(part.body), charset);
  return part.body;
}

/** Der lesbare Text einer Mail: text/plain bevorzugt, sonst HTML ohne Tags. */
function textOf(part: Part, depth = 0): { plain?: string; html?: string } {
  const type = (part.headers['content-type'] ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 5) {
    const boundary = param(part.headers['content-type'], 'boundary');
    if (!boundary) return {};
    const found: { plain?: string; html?: string } = {};
    for (const chunk of part.body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith('--')) break;
      const inner = textOf(splitPart(chunk.replace(/^\r?\n/, '')), depth + 1);
      found.plain ??= inner.plain;
      found.html ??= inner.html;
    }
    return found;
  }
  if ((part.headers['content-disposition'] ?? '').toLowerCase().startsWith('attachment')) return {};
  if (type.startsWith('text/html')) return { html: decodeBody(part) };
  if (type.startsWith('text/plain')) return { plain: decodeBody(part) };
  return {};
}

/** Liest eine .eml-Datei. null, wenn es keine Mail ist. */
export function parseEml(raw: string): MailMessage | null {
  const top = splitPart(raw);
  if (!top.headers.subject && !top.headers.from) return null;
  const { plain, html } = textOf(top);
  return {
    subject: decodeHeader(top.headers.subject ?? '').trim(),
    from: top.headers.from ? decodeHeader(top.headers.from).trim() : undefined,
    date: top.headers.date,
    body: plain ?? (html ? htmlToText(html) : ''),
  };
}

// ---------- HTML und Text ----------

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** HTML als Text: Zeilen bleiben Zeilen, Tags und Stile verschwinden. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    });
}

/** Nur Text: die erste Zeile ist der Titel, der Rest die Beschreibung. */
export function messageFromText(text: string): MailMessage | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return null;
  return { subject: lines[first].trim(), body: lines.slice(first + 1).join('\n') };
}

/** Aus „message:%3Cabc@x%3E“ die Message-ID „abc@x“ (Apple Mail). */
export function appleMailMessageId(url: string): string | null {
  if (!/^message:/i.test(url.trim())) return null;
  let id = url.trim().replace(/^message:(\/\/)?/i, '');
  try { id = decodeURIComponent(id); } catch { /* bleibt, wie es ist */ }
  id = id.replace(/^<|>$/g, '').trim();
  return id || null;
}

// ---------- Aufgabe ----------

const tidy = (text: string): string => text
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** Titel und Beschreibung der Aufgabe zu einer Mail. */
export function mailTask(
  mail: MailMessage,
  words: { from: string; date: string; open: string; noSubject: string },
): { content: string; description: string } {
  const body = tidy(mail.body);
  const head = [
    mail.from ? `**${words.from}:** ${mail.from}` : '',
    mail.date ? `**${words.date}:** ${mail.date}` : '',
    mail.link ? `[${words.open}](${mail.link})` : '',
  ].filter(Boolean).join('\n');
  const text = body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT).trimEnd()} …` : body;
  return {
    content: mail.subject.trim() || words.noSubject,
    description: [head, text].filter(Boolean).join('\n\n'),
  };
}
