// Converts a Gmail API "format=full" message into the same shape the Android app stores
// (port of gmail/MessageParser.kt).

const MAX_BODY = 100_000;

function headersOf(part) {
  const m = {};
  for (const h of part.headers || []) {
    const k = (h.name || '').toLowerCase();
    if (!(k in m)) m[k] = h.value || '';
  }
  return m;
}

export function decodeBase64Url(data, charset) {
  const b64 = data.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

function walk(part, acc) {
  const mime = (part.mimeType || '').toLowerCase();
  const filename = part.filename || '';
  const body = part.body;
  if (filename) {
    acc.atts.push(`${filename}|${mime}|${(body && body.size) || 0}`);
  } else if (body && body.data) {
    const ct = headersOf(part)['content-type'] || '';
    const cs = /charset="?([\w-]+)/i.exec(ct)?.[1];
    const text = decodeBase64Url(body.data, cs);
    if (mime === 'text/plain') acc.plain += text + '\n';
    else if (mime === 'text/html') acc.html += text + '\n';
  }
  for (const p of part.parts || []) walk(p, acc);
}

/** "Mike Smith" <mike@x.com>  →  [Mike Smith, mike@x.com] */
export function parseAddress(raw) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(raw || '');
  if (m) {
    const email = m[2].trim().toLowerCase();
    return [m[1].trim() || email.split('@')[0], email];
  }
  const email = (raw || '').trim().toLowerCase();
  return [email.split('@')[0], email];
}

export const htmlEntities = (s) => (s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return m; } })
  .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } });

export function htmlToText(html) {
  let s = html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  s = htmlEntities(s);
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** @returns a message record: {id, threadId, historyId, fromName, fromEmail, toLine, subject, snippet, body, receivedAt, labelIds, attachments, hasUnsubscribe, isFromMe} */
export function parseMessage(j, selfEmail) {
  const payload = j.payload || {};
  const h = headersOf(payload);
  const [fromName, fromEmail] = parseAddress(h.from || '');
  const labels = j.labelIds || [];
  const acc = { plain: '', html: '', atts: [] };
  walk(payload, acc);
  const body = (acc.plain.trim() ? acc.plain : acc.html.trim() ? htmlToText(acc.html) : (j.snippet || ''))
    .replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY);
  return {
    id: j.id,
    threadId: j.threadId,
    historyId: +(j.historyId || 0),
    fromName, fromEmail,
    toLine: (h.to || '').slice(0, 500),
    ccLine: (h.cc || '').slice(0, 500),
    subject: (h.subject || '').trim() ? h.subject : '(no subject)',
    snippet: htmlEntities(j.snippet || ''),
    body,
    receivedAt: +(j.internalDate || 0),
    labelIds: labels.join(','),
    attachments: acc.atts.join('\n'),
    hasUnsubscribe: 'list-unsubscribe' in h,
    isFromMe: labels.includes('SENT') || (!!selfEmail && fromEmail.toLowerCase() === selfEmail.toLowerCase()),
  };
}

export const attachmentNames = (m) => (m.attachments || '').split('\n').filter((l) => l.trim()).map((l) => l.split('|')[0]);

/** Same as the app's MessageEntity.toInput(): what the classifier needs. */
export const toInput = (m) => ({
  subject: m.subject, body: m.body, fromName: m.fromName, fromEmail: m.fromEmail,
  attachments: attachmentNames(m), labels: (m.labelIds || '').split(',').filter(Boolean),
  hasUnsubscribe: m.hasUnsubscribe, receivedAt: m.receivedAt, isFromMe: m.isFromMe, to: m.toLine, cc: m.ccLine || '',
});
