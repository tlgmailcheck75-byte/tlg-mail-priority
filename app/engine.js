// Classification engine for the website. A line-by-line port of the Android app's
// engine (app/src/main/java/com/tlg/mailpriority/engine/*.kt) so that a mail gets the
// same category, priority, summary and work day on the phone and on the laptop.
// engine.test.mjs runs the same cases as the Kotlin unit tests. Keep the two in step.

export const PRIORITY = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const PRIORITY_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const maxPriority = (a, b) => (PRIORITY[a] >= PRIORITY[b] ? a : b);

export const STATUS = {
  TO_DO: { label: 'To do', pending: true },
  IN_PROGRESS: { label: 'In progress', pending: true },
  WAITING: { label: 'Waiting on others', pending: true },
  DONE: { label: 'Done', pending: false },
  NO_ACTION: { label: 'No action needed', pending: false },
};
export const isPending = (status) => (STATUS[status] || STATUS.TO_DO).pending;

export const OTHER_KEY = 'other';
export const OTP_KEY = 'billcom_otp';
export const DISPUTE_KEY = 'invoice_dispute';

// Days are 0 = Monday … 6 = Sunday. TLG works Monday to Saturday.
export const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const WORK_DAYS = [0, 1, 2, 3, 4, 5];

// ---------------------------------------------------------------- dates (epoch days, local time)

export const epochDayOf = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
export const epochDayFromMs = (ms) => { const d = new Date(ms); return epochDayOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export const todayEpochDay = () => epochDayFromMs(Date.now());
export const dayOfWeek = (epochDay) => (((epochDay + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
export const ymdOf = (epochDay) => { const d = new Date(epochDay * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
/** Local midnight (ms) of an epoch day. */
export const msOfEpochDay = (epochDay) => { const { y, m, d } = ymdOf(epochDay); return new Date(y, m - 1, d).getTime(); };

export function parseDays(csv) {
  const out = new Set();
  for (const t of (csv || '').split(',')) {
    const s = t.trim().toUpperCase();
    if (!s) continue;
    const full = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const i = full.findIndex((n) => n.startsWith(s));
    if (i >= 0) out.add(i);
  }
  return out;
}
export const formatDays = (days) => WORK_DAYS.filter((d) => days.has(d)).map((d) => DAY_NAMES[d]).join(',');

export const splitList = (s) => (s || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- text analysis

export const normalize = (s) => (s || '').toLowerCase().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
const phraseCache = new Map();
/** Whole-word / whole-phrase match. A trailing '*' allows any word ending (reconcil* → reconciliation). */
export function phraseRegex(phrase, global = false) {
  const key = phrase + (global ? '/g' : '');
  let r = phraseCache.get(key);
  if (!r) {
    const p = phrase.trim().toLowerCase();
    const prefix = p.endsWith('*');
    const core = escapeRe(prefix ? p.slice(0, -1) : p).split(' ').join('\\s+');
    r = new RegExp(`(?<![a-z0-9])${core}${prefix ? '' : '(?![a-z0-9])'}`, global ? 'g' : '');
    phraseCache.set(key, r);
  }
  if (global) r.lastIndex = 0;
  return r;
}
export const contains = (text, phrase) => !!phrase && phrase.trim() !== '' && phraseRegex(phrase).test(text);
export function count(text, phrase, cap = 3) {
  if (!phrase || !phrase.trim()) return 0;
  const r = phraseRegex(phrase, true);
  let n = 0;
  while (r.exec(text)) { if (++n >= cap) break; }
  return n;
}

const lines = (s) => s.split(/\r\n|\n|\r/);

/** Removes quoted replies, forwarded history and long signatures/disclaimers. */
export function stripQuoted(body) {
  let out = '';
  for (const raw of lines(body || '')) {
    const line = raw.trim();
    if (line.startsWith('>')) continue;
    if (/^on .{4,120} wrote:?$/i.test(line)) break;
    if (line.toLowerCase().startsWith('-----original message-----')) break;
    if (line.toLowerCase().startsWith('---------- forwarded message')) { out += '\n'; continue; }
    if (/^from: .+$/i.test(line) && out.length > 40) break;
    if (line === '--' || raw.trim() === '--') break;
    if (line.toLowerCase().startsWith('confidentiality') || line.toLowerCase().startsWith('disclaimer')) break;
    out += raw + '\n';
  }
  return out.trim();
}

const URGENCY = [
  ['urgent', 3], ['urgently', 3], ['asap', 3], ['immediately', 3], ['immediate', 2],
  ['critical', 3], ['emergency', 3], ['top priority', 3], ['high priority', 2],
  ['time sensitive', 3], ['time-sensitive', 3], ['action required', 2], ['action needed', 2],
  ['eod', 2], ['end of day', 2], ['end of the day', 2], ['today itself', 3], ['right away', 3],
  ['overdue', 2], ['past due', 2], ['final notice', 3], ['final reminder', 2], ['escalat*', 2],
  ['deadline', 1], ['at the earliest', 2], ['priority', 1], ['important', 1],
  ['second reminder', 2], ['gentle reminder', 1], ['reminder', 1], ['still pending', 2],
  ['not received', 1], ['missing', 1], ['on hold', 2], ['payroll cutoff', 3], ['cut-off', 1], ['cutoff', 1],
];

/** Weighted urgency score; the subject counts double. */
export function urgencyScore(subject, body) {
  const s = normalize(subject);
  const b = normalize(body).slice(0, 6000);
  let score = 0;
  const hits = [];
  for (const [p, w] of URGENCY) {
    const inS = contains(s, p), inB = contains(b, p);
    if (inS || inB) { score += w * (inS ? 2 : 1); hits.push(p.replace(/\*$/, '')); }
  }
  return { score, hits };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const CTX = '(?:by|due(?: on| by| date(?: is)?:?)?|before|deadline(?: is)?:?|no later than|latest by|until|needed by|required by)';
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const reRelative = new RegExp(`${CTX}\\s+(?:the\\s+)?(today|tonight|eod|end of (?:the )?day|tomorrow|cob|close of business)`, 'g');
const reStandalone = /(?<![a-z])(due today|needed today|by eod|by cob|today itself|before eod|eod today|by tonight)(?![a-z])/g;
const reWeekday = new RegExp(`${CTX}\\s+(?:this\\s+|next\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)`, 'g');
const reMonthDay = new RegExp(`${CTX}\\s+(?:[a-z]+,?\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'g');
const reDayMonth = new RegExp(`${CTX}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?`, 'g');
const reNumeric = new RegExp(`${CTX}\\s+(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?(?![\\d/])`, 'g');

const allMatches = (re, t) => { re.lastIndex = 0; return [...t.matchAll(re)]; };

function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? epochDayOf(y, m, d) : null;
}
function dateOf(receivedDay, month, day, year) {
  if (month == null || day == null || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const recY = ymdOf(receivedDay).y;
  let y = year ? parseInt(year, 10) : NaN;
  y = isNaN(y) ? recY : (y < 100 ? 2000 + y : y);
  let d = validDay(y, month, day);
  if (d == null) return null;
  // "by Jan 5" written in December means next January.
  if (!year && d < receivedDay - 31) { d = validDay(y + 1, month, day); }
  return d;
}

/**
 * Earliest explicit deadline. Only dates after a deadline word ("by", "due", "before", "deadline")
 * count, so invoice dates are not mistaken for deadlines. Numeric dates are US month/day.
 */
export function detectDeadline(text, receivedDay) {
  const t = normalize(text).slice(0, 8000);
  const found = [];
  for (const m of allMatches(reStandalone, t)) found.push([receivedDay, m[0]]);
  for (const m of allMatches(reRelative, t)) found.push([m[1] === 'tomorrow' ? receivedDay + 1 : receivedDay, m[0]]);
  for (const m of allMatches(reWeekday, t)) {
    const dow = WEEKDAYS[m[1]];
    const diff = (dow - dayOfWeek(receivedDay) + 7) % 7;
    found.push([receivedDay + diff, m[0]]);
  }
  for (const m of allMatches(reMonthDay, t)) {
    const mo = MONTHS[m[1].slice(0, 3)]; if (!mo) continue;
    const d = dateOf(receivedDay, mo, parseInt(m[2], 10), m[3]); if (d != null) found.push([d, m[0]]);
  }
  for (const m of allMatches(reDayMonth, t)) {
    const mo = MONTHS[m[2].slice(0, 3)]; if (!mo) continue;
    const d = dateOf(receivedDay, mo, parseInt(m[1], 10), m[3]); if (d != null) found.push([d, m[0]]);
  }
  for (const m of allMatches(reNumeric, t)) {
    const d = dateOf(receivedDay, parseInt(m[1], 10), parseInt(m[2], 10), m[3]); if (d != null) found.push([d, m[0]]);
  }
  let best = null;
  for (const f of found) if (f[0] >= receivedDay - 1 && (best == null || f[0] < best[0])) best = f;
  return best ? { epochDay: best[0], text: best[1] } : null;
}

const RE_OTP = [
  /(?:code|otp|passcode|pin|verification)[^0-9\n]{0,40}?(?<!\d)(\d{4,8})(?!\d)/i,
  /(?<!\d)(\d{4,8})(?!\d)[^0-9\n]{0,30}(?:is your|is the) (?:verification|security|one[- ]time|login|sign[- ]in)/i,
];
export function extractOtp(subject, body) {
  const text = `${subject}\n${(body || '').slice(0, 3000)}`;
  if (!/verification|one[- ]time|otp|passcode|security code|sign[- ]in code|login code|verify/i.test(text)) return null;
  for (const r of RE_OTP) {
    const m = r.exec(text);
    if (m) {
      const code = m[1];
      if (!(code.length === 4 && +code >= 1990 && +code <= 2099)) return code;
    }
  }
  return null;
}

const distinct = (a) => [...new Set(a)];
export const extractAmounts = (text) =>
  distinct([...(text || '').slice(0, 8000).matchAll(/(?:\$|usd\s?|inr\s?|rs\.?\s?|₹\s?)\d[\d,]*(?:\.\d{1,2})?/gi)].map((m) => m[0].trim())).slice(0, 3);
export const extractInvoiceNumbers = (text) =>
  distinct([...(text || '').slice(0, 8000).matchAll(/\b(?:invoice|inv|bill)\s*(?:no\.?|number|num|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi)]
    .map((m) => m[1]).filter((id) => /\d/.test(id))).slice(0, 3);

const ACTION_WORDS = ['please', 'kindly', 'need', 'needs', 'required', 'request', 'confirm', 'approve', 'approval',
  'send', 'share', 'review', 'update', 'provide', 'check', 'fix', 'correct', 'pay', 'process',
  'reconcile', 'missing', 'difference', 'dispute', 'pending', 'follow up', 'can you', 'could you'];

/** Free, on-device extractive summary with key facts (invoice no., amounts, deadline, code) first. */
export function summarize(subject, body, keywords, deadline, otp, maxSentences = 2, maxLength = 420) {
  const clean = stripQuoted(body);
  const facts = [];
  if (otp != null) facts.push(`Code: ${otp}`);
  const inv = extractInvoiceNumbers(`${subject}\n${clean}`); if (inv.length) facts.push(`Invoice ${inv.join(', ')}`);
  const amt = extractAmounts(clean); if (amt.length) facts.push(`Amount ${amt.join(', ')}`);
  if (deadline) facts.push(`Deadline: ${deadline.text}`);

  const greet = /^(hi|hello|dear|good (morning|afternoon|evening)|hope|thanks|thank you|regards|best|sincerely)\b/i;
  const sentences = clean.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 400)
    .filter((s) => !(greet.test(s) && s.length < 60))
    .slice(0, 25);
  const kw = (keywords || []).map((k) => k.replace(/\*$/, '').toLowerCase()).filter((k) => k.length > 2);
  const scored = sentences.map((s, i) => {
    const l = s.toLowerCase();
    let score = 0;
    score += ACTION_WORDS.filter((w) => l.includes(w)).length * 2.0;
    score += kw.filter((w) => l.includes(w)).length * 1.5;
    if (/\d/.test(s)) score += 1.0;
    if (s.includes('?')) score += 1.0;
    score += Math.max(0, 5 - i) * 0.4;
    return { i, s, score };
  });
  const picked = [...scored].sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.i - b.i).map((x) => x.s);
  const text = picked.length ? picked.join(' ') : subject;
  const out = (facts.length ? facts.join(' · ') + '\n' : '') + text;
  return out.length > maxLength ? out.slice(0, maxLength - 3) + '…' : out;
}

// ---------------------------------------------------------------- schedule

/** Next TLG working day (Mon–Sat) on or after `from` that is assigned to the category. */
export function nextProcessDay(from, days) {
  let allowed = new Set([...days].filter((d) => WORK_DAYS.includes(d)));
  if (allowed.size === 0) allowed = new Set(WORK_DAYS);
  let d = from;
  for (let i = 0; i < 8; i++) { if (allowed.has(dayOfWeek(d))) return d; d++; }
  return from;
}

/** Dashboard ranking: critical > high > (scheduled today / overdue) > medium > low. */
export function rankScore(priority, critical, vip, pending, processDay, today, scheduledToday) {
  let s = PRIORITY[priority] * 100;
  if (critical) s += 200;
  if (vip) s += 40;
  if (pending) {
    if (scheduledToday) s += 60;
    if (processDay < today) s += 50 + Math.min(30, (today - processDay) * 5);
    if (processDay === today) s += 30;
  } else s -= 500;
  return s;
}

// ---------------------------------------------------------------- classifier

const NEWSLETTER_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

/** Category row (same fields as the app's CategoryEntity) → engine definition. */
export const toCategoryDef = (c) => ({
  key: c.key, name: c.name, keywords: splitList(c.keywords), senderHints: splitList(c.senderHints),
  basePriority: PRIORITY[c.basePriority] ? c.basePriority : 'MEDIUM', processDays: parseDays(c.processDays),
  action: c.action || '', enabled: c.enabled !== false,
});

/**
 * @param categories CategoryEntity-like rows   @param rules [{field, pattern, categoryKey, priority}]
 * @param vips [{name, emails, alwaysHigh}]      @param highNames / highRecipients string lists
 */
export function createEngine({ categories, rules = [], vips = [], highNames = [], highRecipients = [] }) {
  const cats = categories.map(toCategoryDef).filter((c) => c.enabled);
  const byKey = new Map(cats.map((c) => [c.key, c]));
  const vipDefs = vips.map((v) => ({ name: v.name, emails: splitList(v.emails), alwaysHigh: v.alwaysHigh !== false }));

  function ruleMatches(r, m, body) {
    const p = (r.pattern || '').trim().toLowerCase();
    if (!p) return false;
    const from = `${m.fromName} ${m.fromEmail}`.toLowerCase();
    const subj = m.subject.toLowerCase();
    switch (r.field) {
      case 'FROM': return from.includes(p);
      case 'SUBJECT': return subj.includes(p);
      case 'BODY': return body.toLowerCase().includes(p);
      default: return from.includes(p) || subj.includes(p) || body.toLowerCase().includes(p) || (m.attachments || []).some((a) => a.toLowerCase().includes(p));
    }
  }

  /** thread = { latest: EmailInput, earlier: EmailInput[] } with EmailInput like the app's. */
  function classify(thread) {
    const m = thread.latest;
    const earlier = thread.earlier || [];
    const reasons = [];
    const received = epochDayFromMs(m.receivedAt);

    const cleanBody = stripQuoted(m.body);
    const subj = normalize(m.subject);
    const body = normalize(cleanBody).slice(0, 8000);
    const sender = normalize(`${m.fromName} ${m.fromEmail}`);
    const atts = normalize((m.attachments || []).map((a) => a.replace(/_/g, ' ').replace(/-/g, ' ')).join(' '));
    const ctx = normalize(earlier.slice(-4).map((e) => e.subject + '\n' + stripQuoted(e.body).slice(0, 1500)).join('\n'));

    // 1. User rules (newest first).
    let forcedCategory = null, forcedPriority = null;
    for (const r of rules) {
      if (!ruleMatches(r, m, cleanBody)) continue;
      if (forcedCategory == null && r.categoryKey && byKey.has(r.categoryKey)) {
        forcedCategory = r.categoryKey; reasons.push(`Your rule: ${(r.field || 'ANY').toLowerCase()} contains "${r.pattern}"`);
      }
      if (forcedPriority == null && PRIORITY[r.priority]) {
        forcedPriority = r.priority; reasons.push(`Your rule sets priority ${PRIORITY_LABEL[r.priority]}`);
      }
    }

    // 2. Keyword scoring.
    const scores = new Map();
    for (const c of cats) {
      if (c.key === OTHER_KEY) continue;
      let s = 0;
      for (const k of c.keywords) {
        const w = k.trim().includes(' ') ? 2 : 1;
        if (contains(subj, k)) s += 3 * w;
        s += count(body, k, 3) * w;
        if (atts && contains(atts, k)) s += 2 * w;
        if (ctx && contains(ctx, k)) s += w;
      }
      for (const h of c.senderHints) if (h.trim() && sender.includes(h.toLowerCase().trim())) s += 3;
      scores.set(c.key, s);
    }

    const otp = extractOtp(m.subject, cleanBody);
    const fromBillCom = sender.includes('bill.com') || sender.includes('billcom');
    const ranked = [...scores.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];

    let categoryKey;
    if (forcedCategory != null) categoryKey = forcedCategory;
    else if (otp != null && fromBillCom && byKey.has(OTP_KEY)) { reasons.push('Bill.com verification code'); categoryKey = OTP_KEY; }
    else if (top && top[1] >= 2) { reasons.push(`Keywords: ${byKey.get(top[0])?.name} (score ${top[1]})`); categoryKey = top[0]; }
    else categoryKey = OTHER_KEY;
    const category = byKey.get(categoryKey);
    const topScore = top ? top[1] : 0;
    const tagKeys = ranked.filter(([k, v]) => k !== categoryKey && v >= Math.max(2, Math.trunc(topScore * 0.25))).slice(0, 3).map(([k]) => k);
    const tags = tagKeys.map((k) => byKey.get(k)?.name).filter(Boolean);

    // 3. Priority.
    const vip = vipDefs.find((v) => v.emails.some((e) => e.trim() && m.fromEmail.toLowerCase() === e.trim().toLowerCase())) || null;
    const { score: urgency, hits: urgencyHits } = urgencyScore(m.subject, cleanBody);
    const deadline = detectDeadline(`${m.subject}\n${cleanBody}`, received);
    const daysLeft = deadline ? deadline.epochDay - received : null;
    const newsletter = !!m.hasUnsubscribe || (m.labels || []).some((l) => NEWSLETTER_LABELS.has(l)) ||
      /no-?reply|newsletter|marketing|notifications?@/.test(m.fromEmail.toLowerCase());

    let priority = category ? category.basePriority : 'LOW';
    let critical = false;
    if (tagKeys.some((k) => byKey.get(k)?.basePriority === 'HIGH' && (scores.get(k) || 0) >= 3)) priority = maxPriority(priority, 'MEDIUM');
    if (urgencyHits.length) reasons.push(`Urgency words: ${urgencyHits.slice(0, 4).join(', ')}`);
    if (deadline) reasons.push(`Deadline found: "${deadline.text}"`);

    if (urgency >= 3 || (daysLeft != null && daysLeft <= 1)) priority = 'HIGH';
    else if (urgency >= 1 || (daysLeft != null && daysLeft <= 3)) priority = maxPriority(priority, 'MEDIUM');
    if (urgency >= 6 || (daysLeft != null && daysLeft <= 0)) critical = true;

    if (categoryKey === OTHER_KEY && newsletter && urgency < 3 && vip == null) { priority = 'LOW'; reasons.push('Looks like a newsletter / automated notice'); }
    if (categoryKey === OTP_KEY || otp != null) { priority = 'HIGH'; critical = true; }

    let alwaysHigh = false;
    if (!m.isFromMe) {
      const mentioned = highNames.filter((n) => n.trim() && (contains(subj, n) || contains(body, n)));
      if (mentioned.length) { alwaysHigh = true; reasons.push(`Mentions ${mentioned.join(', ')}`); }
      const toLower = (m.to || '').toLowerCase();
      const direct = highRecipients.filter((r) => r.trim() && toLower.includes(r.trim().toLowerCase()));
      if (direct.length) { alwaysHigh = true; reasons.push(`Sent directly to ${direct.join(', ')}`); }
      if (alwaysHigh) priority = 'HIGH';
    }
    if (categoryKey === DISPUTE_KEY && urgency >= 2) critical = true;

    if (vip) {
      reasons.push(`VIP sender: ${vip.name}`);
      priority = vip.alwaysHigh ? 'HIGH' : maxPriority(priority, 'MEDIUM');
      if (urgency >= 3) critical = true;
    }
    if (forcedPriority != null) priority = forcedPriority;
    if (priority !== 'HIGH') critical = false;

    // 4. Suggested action, TLG process day, initial status.
    let action;
    if (categoryKey === OTP_KEY) action = 'Use the verification code in Bill.com now — it expires within minutes.';
    else if (category && category.action.trim()) action = category.action;
    else if (newsletter) action = 'Read when convenient. No reply needed.';
    else action = 'Read and decide whether a reply or task is needed.';
    if (vip && categoryKey !== OTP_KEY) action += ` Reply to ${vip.name} promptly.`;
    if (deadline) action += ` Deadline: ${deadline.text}.`;

    let processDay = (critical || (priority === 'HIGH' && (urgency >= 3 || vip || alwaysHigh || categoryKey === OTP_KEY)))
      ? received : nextProcessDay(received, category ? category.processDays : new Set());
    if (deadline && deadline.epochDay < processDay) processDay = Math.max(deadline.epochDay, received);

    const status = m.isFromMe ? 'WAITING' : (priority === 'LOW' && categoryKey === OTHER_KEY ? 'NO_ACTION' : 'TO_DO');

    const kws = category ? category.keywords : [];
    const summary = vip ? summarize(m.subject, m.body, kws, deadline, otp, 5, 900) : summarize(m.subject, m.body, kws, deadline, otp);

    return { categoryKey, tags, priority, critical, vipName: vip ? vip.name : null, suggestedAction: action,
      processEpochDay: processDay, status, summary, deadline, otpCode: otp, reasons };
  }

  return { classify };
}
