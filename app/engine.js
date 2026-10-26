// Classification engine for the website. A line-by-line port of the Android app's
// engine (app/src/main/java/com/tlg/mailpriority/engine/*.kt) so that a mail gets the
// same category, priority, summary and work day on the phone and on the laptop.
// engine.test.mjs runs the same cases as the Kotlin unit tests. Keep the two in step.

export const PRIORITY = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const PRIORITY_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const maxPriority = (a, b) => (PRIORITY[a] >= PRIORITY[b] ? a : b);

// Shown as New / Pending / In Progress / Resolved. WAITING and NO_ACTION are set automatically.
export const STATUS = {
  NEW: { label: 'New', pending: true },
  TO_DO: { label: 'Pending', pending: true },
  IN_PROGRESS: { label: 'In progress', pending: true },
  WAITING: { label: 'Pending — waiting for reply', pending: true },
  DONE: { label: 'Resolved', pending: false },
  NO_ACTION: { label: 'Resolved — no action needed', pending: false },
};
export const STATUS_CHOICES = ['NEW', 'TO_DO', 'IN_PROGRESS', 'DONE'];
export const isPending = (status) => (STATUS[status] || STATUS.TO_DO).pending;

export const OTHER_KEY = 'other';

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

// ---------------------------------------------------------------- folders, people & the folder rules
// Port of engine/ClassificationEngine.kt + engine/People.kt. Same order, same patterns, same wording.

export const FOLDERS = { REMINDER: 'reminder_summary', INVOICING: 'customer_invoicing', BONUS: 'call_center_bonus', MIKE_APRIL: 'mike_april', PAYROLL: 'payroll', OTHER: 'other' };
export const FOLDER_KEYS = [FOLDERS.REMINDER, FOLDERS.INVOICING, FOLDERS.BONUS, FOLDERS.MIKE_APRIL, FOLDERS.PAYROLL, FOLDERS.OTHER];
export const FOLDER_NAMES = {
  reminder_summary: 'Reminder Summary', customer_invoicing: 'Customer Invoicing', call_center_bonus: 'Call Center Bonus',
  mike_april: 'Mike and April Mail', payroll: 'Payroll Process', other: 'Other Mails',
};
export const FOLDER_ICONS = { reminder_summary: '🔁', customer_invoicing: '🧾', call_center_bonus: '🎧', mike_april: '⭐', payroll: '💼', other: '📥' };
export const folderName = (k) => FOLDER_NAMES[k] || 'Other Mails';

export const ROLES = { OLIVIA: 'olivia', SYED: 'syed', JANILIN: 'janilin', EDNA: 'edna', ARSLAN: 'arslan', QA: 'qa', MYRTHLE: 'myrthle', FIXED_SALARY: 'fixedSalary', CALL_CENTER: 'callCenter' };

/** people = { role: {label, names: "a, b", emails: "x, y"} } (same JSON as the phone's Settings). */
export function createPeople(people) {
  const groups = {};
  for (const [role, g] of Object.entries(people || {})) groups[role] = { label: g.label, names: splitList(g.names), emails: splitList(g.emails) };
  return {
    groups,
    isSender(role, fromName, fromEmail) {
      const g = groups[role];
      if (!g) return false;
      if (g.emails.some((e) => e.trim() && e.trim().toLowerCase() === (fromEmail || '').trim().toLowerCase())) return true;
      const name = normalize(fromName);
      return g.names.some((n) => n.trim() && contains(name, n));
    },
    mentioned(role, text) { return (groups[role]?.names || []).filter((n) => n.trim() && contains(text, n)); },
  };
}

const P = {
  REMINDER: 'payment reminder|friendly reminder|reminder:|past due|overdue|outstanding|balance due|remit|make the payment|payment is due|is due',
  PAID: "already paid|have paid|has been paid|was paid|we paid|paid (it|this|the invoice|on)|payment (was|has been) (made|sent|processed)|check (was )?(sent|mailed)|remittance",
  LATE: 'will be late|be late|pay next week|pay (it )?(by|on|at) (the )?end of|delay(ed)? (in|of) (the )?payment|payment (will be|is) delayed|need (more|some) time|extension|pay (you )?(soon|shortly|later)|late payment',
  RATE_REQ: '(change|lower|reduce|revise|adjust|increase)\\b.{0,25}\\brate|rate (change|reduction)',
  ISSUE: 'issue|problem|incorrect|wrong|dispute|error|mistake|discrepanc',
  CREDIT: 'credit',
  AGING: 'aging|ageing',
  WAGE: '\\bwages?\\b',
  SALARY_CTX: 'salary|salaries|\\bwages?\\b|payroll|payslip|pay slip|paycheck|pay check|\\bmy pay\\b|pay ?stub',
  SALARY_DELAY: "delay|late|not (yet )?(been )?(received|credited|paid|deposited)|n't (been )?(received|credited|paid)|haven'?t (got|received)|still (waiting|pending)|when will (i|we) (get|receive)",
  SALARY_WRONG: 'incorrect|wrong|short|less than|missing|mismatch|not correct',
  DEDUCTION: 'deduction|deducted',
  PAYABLE: 'payable|amount due|amount owed|invoice|hours|payment for',
  CLOSURE: 'closure',
  BONUS: 'bonus|incentive|spiff',
  CC_CTX: 'call ?cent(er|re)|\\bagents?\\b|appointment|\\bappts?\\b',
  BONUS_WRONG: 'incorrect|wrong|\\bless\\b|short|mismatch|not correct|not right|miscalculat',
  APPT_MISSING: 'appointments? (are |is |were |was )?(missing|not (counted|included|listed))|missing appointments?',
  BONUS_MISSED: "missed|excluded|not included|left out|was not paid|wasn'?t paid|add (the |my )?bonus",
  COMPLETED_APPTS: 'appointment|completed|\\blist\\b',
  WRITE_OFF: 'write[- ]?off|bad debt',
  EMAIL_CHANGE: '(change|update|new|different)\\b.{0,30}\\b(invoice|invoicing|billing)\\b.{0,20}\\be-?mail|send (the |all |future )?invoices? to',
  ACCOUNT_SUMMARY: 'account summary|statement of account|account statement|summary of (my|our|the) account',
  SYNC_SRC: 'saasant|quickbooks|\\bqbo\\b|intuit',
  SYNC_ERR: "error|failed|failure|unable|could not|couldn'?t|not (be )?synced|sync (issue|problem)",
  AGREEMENT: 'agreement|contract|onboard|new (customer|client)',
  RATES: '\\brates?\\b|slab|flat ?rate|pricing|per appointment',
  RATE_CHANGE: 'rate change|change (in |of |to )?(the )?rates?\\b|new rate|revised rate|slab|rate (is|will be|has been) (changed|updated|revised)|(increase|reduce|lower|raise|update) (the )?rates?\\b|flat ?rate',
  CREDIT_PENDING: "credit\\b.{0,20}\\bpending|pending credit|credit (not|hasn'?t been|has not been|was not) (applied|issued|given)",
  APPT_CTX: 'appointment|\\bappts?\\b|\\blead\\b|patient|no[- ]show',
  PAY_FAILED: 'payment (has )?(failed|bounced|declined|was declined|was returned|returned)|bounced|\\bnsf\\b|insufficient funds|ach return|returned payment|card (was )?declined|payment failure',
  DISPUTE: 'dispute|incorrect amount|wrong amount|duplicate (charge|invoice|billing|amount)|charged twice|billed twice|overcharg|double (charged|billed)',
  CHARGE_ADVICE: 'should be (charged|billed)|charge (them|the customer|the client)|bill (them|the customer|the client)|amount to (charge|bill)|to be charged',
  PAY_CONTEXT: 'payment|invoice|\\bpay\\b|paid|reminder|balance',
  PAYMENT_ISSUE: "payment issue|problem with (the |our )?payment|unable to pay|can'?t pay|cannot pay|payment portal|issue with (the |our )?(invoice|payment)",
  ACTION: '\\b(please|kindly|can you|could you|would you|need you|needs? to be|make sure|let me know|send|share|provide|update|fix|correct|revise|review|approve|confirm|check|process|investigate|follow up|required)\\b|\\?',
  FIN_DECISION: 'invoice|\\brates?\\b|slab|payment|write[- ]?off|approv|correct|revis|reconcil|report|credit|refund|investigat',
  ACCOUNTING: 'invoice|payment|reconcil|statement|ledger|refund|credit|vendor|balance|\\bw-?9\\b|documents?|receipt|\\btax\\b',
  ACK: '^(hi[,!]? )?(thanks|thank you|noted|received|ok|okay|got it|great|perfect|will do|sounds good)\\b',
  COMPLIANCE: '\\btax\\b|filing|\\birs\\b|1099|\\bw-?2\\b|\\bgst\\b|\\bvat\\b|compliance|audit',
  SYSTEM_ERR: 'error|failed|failure|outage|\\bdown\\b|unable to (log ?in|access|invoice|process)',
};
export const PATTERNS = P;
const reCache = new Map();
const has = (text, pattern) => { let r = reCache.get(pattern); if (!r) { r = new RegExp(pattern); reCache.set(pattern, r); } return r.test(text); };

const NEWSLETTER_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

/** Folder row (same fields as the app's CategoryEntity) → engine definition. */
export const toCategoryDef = (c) => ({ key: c.key, name: c.name, processDays: parseDays(c.processDays), enabled: c.enabled !== false });

const msgOf = (raw) => {
  const clean = stripQuoted(raw.body);
  const subj = normalize(raw.subject);
  const body = normalize(clean).slice(0, 8000);
  return { raw, clean, subj, body, text: `${subj} \n ${body}`, sender: normalize(`${raw.fromName} ${raw.fromEmail}`) };
};

/**
 * @param categories folder rows  @param rules [{field, pattern, categoryKey, priority}] newest first
 * @param vips [{name, emails}]   @param highNames Rule A names   @param highRecipients Rule B addresses
 * @param people People JSON (see createPeople)
 */
export function createEngine({ categories, rules = [], vips = [], highNames = [], highRecipients = [], people }) {
  const folders = new Map(categories.map(toCategoryDef).map((c) => [c.key, c]));
  const vipDefs = vips.map((v) => ({ name: v.name, emails: splitList(v.emails) }));
  const ppl = createPeople(people);
  const vipOf = (e) => vipDefs.find((v) => v.emails.some((x) => x.trim() && (e.fromEmail || '').toLowerCase() === x.trim().toLowerCase())) || null;
  const isMikeVip = (v) => !!v && v.name.toLowerCase() === 'mike';
  const hit = (folder, priority, reason, action, review = false) => ({ folder, priority, reason, action, review });

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
  const isAck = (m) => m.body.length <= 200 && has(m.body, P.ACK);

  function ciHit(t, m, isMike, fromSyed, urgency, daysLeft) {
    let base;
    if (has(t, P.WRITE_OFF) && isMike) return hit(FOLDERS.INVOICING, 'HIGH', 'Mike asks to write off an invoice as bad debt', 'Prepare the write-off for approval — do not post it automatically.');
    else if (has(t, P.WRITE_OFF)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'Write-off / bad debt mentioned', 'Confirm the write-off with Mike before doing anything.', true);
    else if (has(`${m.sender} ${t}`, P.SYNC_SRC) && has(t, P.SYNC_ERR)) return hit(FOLDERS.INVOICING, 'HIGH', 'SaasAnt / QuickBooks import or sync error', 'Fix the import/sync error so invoices are not missed.');
    else if (has(t, P.EMAIL_CHANGE)) return hit(FOLDERS.INVOICING, 'HIGH', 'Customer asks to change the invoice email address', 'Update the invoice email in the billing system and confirm.');
    else if ((fromSyed || isMike) && has(t, P.AGREEMENT) && has(t, P.RATES)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'New customer agreement (rates / slabs / flat rate)', "Set up the customer's rates for invoicing.");
    else if ((fromSyed || isMike) && has(t, P.RATE_CHANGE)) return hit(FOLDERS.INVOICING, 'HIGH', `${isMike ? 'Mike' : 'Syed'} sends a rate / slab change`, "Update the customer's rate/slab before the next invoice.");
    else if (fromSyed && has(t, P.CREDIT)) base = hit(FOLDERS.INVOICING, 'MEDIUM', "Syed's credit request (lead name and reason)", 'Check the lead and apply the credit on the invoice if valid.');
    else if (has(t, P.CREDIT_PENDING)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'Credit pending for a billed appointment', 'Apply the pending credit and confirm.');
    else if (has(t, P.CREDIT) && has(t, P.APPT_CTX)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'Customer requests credit for an appointment', 'Verify the appointment and decide on the credit.');
    else if (has(t, P.PAY_FAILED)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'Customer payment failed / bounced', 'Contact the customer for a new payment and note it on the invoice.');
    else if (has(t, P.DISPUTE)) base = hit(FOLDERS.INVOICING, 'MEDIUM', 'Invoice dispute (incorrect / duplicate amount)', 'Check the invoice against billing records and correct if needed.');
    else if (has(t, P.ACCOUNT_SUMMARY)) return hit(FOLDERS.INVOICING, 'LOW', 'Customer requests an account summary', 'Send the account summary when convenient.');
    else return null;
    // Urgent or financially significant unresolved invoicing issues are escalated.
    return base.priority === 'MEDIUM' && (urgency >= 3 || (daysLeft != null && daysLeft <= 1)) ? { ...base, priority: 'HIGH', reason: base.reason + ' — urgent' } : base;
  }

  function mikeAprilHit(m, who, urgency, deadline) {
    const action = has(m.text, P.ACTION);
    if (isAck(m) || !action) return hit(FOLDERS.MIKE_APRIL, 'LOW', `General message from ${who} — no Accounts action needed`, 'Read when convenient.');
    if (deadline || urgency >= 2 || has(m.text, P.FIN_DECISION)) return hit(FOLDERS.MIKE_APRIL, 'HIGH', `${who} gives a direct instruction / financial action`, `Do what ${who} asked and reply to confirm.`);
    return hit(FOLDERS.MIKE_APRIL, 'MEDIUM', `${who} asks for routine, non-urgent work`, `Do it this week and reply to ${who}.`);
  }

  /** Rule C — how much does the Accounts team need to act? */
  function generalHit(m, urgency, daysLeft, deadline, newsletter) {
    const t = m.text, action = has(t, P.ACTION), fin = has(t, P.ACCOUNTING);
    if (newsletter && urgency < 3) return hit(FOLDERS.OTHER, 'LOW', 'Newsletter / informational email', 'No action needed.');
    if (isAck(m)) return hit(FOLDERS.OTHER, 'LOW', 'Routine acknowledgment', 'No action needed.');
    if ((urgency >= 3 || (daysLeft != null && daysLeft <= 1) || (has(t, P.COMPLIANCE) && deadline) || (has(t, P.SYSTEM_ERR) && fin)) && (action || fin))
      return hit(FOLDERS.OTHER, 'HIGH', 'Time-sensitive Accounts action', 'Act on this today.');
    if (action && fin) return hit(FOLDERS.OTHER, 'MEDIUM', 'Routine Accounts request', 'Handle as routine work.');
    if (action) return hit(FOLDERS.OTHER, 'MEDIUM', 'Request that needs a reply', 'Reply when convenient.');
    if (fin) return hit(FOLDERS.OTHER, 'LOW', 'Accounts-related information, no clear action', 'Check whether anything needs recording.', true);
    return hit(FOLDERS.OTHER, 'LOW', 'Informational — no action found', 'No action needed.');
  }

  function details(m, folder, vip) {
    const out = [];
    const raw = `${m.raw.subject}\n${m.clean}`;
    const inv = extractInvoiceNumbers(raw); if (inv.length) out.push(['Invoice', inv.join(', ')]);
    const amt = extractAmounts(m.clean); if (amt.length) out.push(['Amount', amt.join(', ')]);
    const external = !vip && !m.raw.isFromMe && !Object.keys(ppl.groups).some((r) => ppl.isSender(r, m.raw.fromName, m.raw.fromEmail));
    if ((folder === FOLDERS.REMINDER || folder === FOLDERS.INVOICING) && external) out.push(['Customer', m.raw.fromName]);
    if (folder === FOLDERS.PAYROLL || folder === FOLDERS.BONUS) out.push(['Employee', m.raw.fromName]);
    let x;
    if ((x = /lead(?: name)?\s*[:\-]\s*([^\n.,;]{2,40})/i.exec(m.clean))) out.push(['Lead', x[1].trim()]);
    if ((x = /reason\s*[:\-]\s*([^\n.]{3,80})/i.exec(m.clean))) out.push(['Reason', x[1].trim()]);
    if ((x = /(\d+(?:\.\d+)?)\s*(?:hours|hrs|hr)\b/i.exec(m.clean))) out.push(['Hours', x[1]]);
    if ((x = /(?:pay period|week of|week ending)\s*[:\-]?\s*([^\n.;]{3,40})/i.exec(m.clean))) out.push(['Pay period', x[1].trim()]);
    const atts = m.raw.attachments || [];
    const pdfs = atts.filter((a) => a.toLowerCase().endsWith('.pdf')).length;
    if (atts.length) out.push(['Attachments', `${atts.length} file(s)${pdfs ? `, ${pdfs} PDF` : ''}`]);
    return out;
  }

  /** thread = { latest: EmailInput, earlier: EmailInput[] (oldest first) }. */
  function classify(thread) {
    const m = msgOf(thread.latest);
    const all = [...(thread.earlier || []), thread.latest].sort((a, b) => a.receivedAt - b.receivedAt).map(msgOf);
    const received = epochDayFromMs(m.raw.receivedAt);
    const reasons = [];
    const from = (role, x = m) => ppl.isSender(role, x.raw.fromName, x.raw.fromEmail);
    const vip = vipOf(m.raw);
    const isMike = isMikeVip(vip);
    const otp = extractOtp(m.raw.subject, m.clean);
    const fromBillCom = m.sender.includes('bill.com') || m.sender.includes('billcom');
    const { score: urgency, hits: urgencyHits } = urgencyScore(m.raw.subject, m.clean);
    const deadline = detectDeadline(`${m.raw.subject}\n${m.clean}`, received);
    const daysLeft = deadline ? deadline.epochDay - received : null;
    const newsletter = !!m.raw.hasUnsubscribe || (m.raw.labels || []).some((l) => NEWSLETTER_LABELS.has(l)) ||
      /no-?reply|newsletter|marketing|notifications?@|news@/.test((m.raw.fromEmail || '').toLowerCase());
    const pdfs = (m.raw.attachments || []).filter((a) => a.toLowerCase().endsWith('.pdf')).length;
    const t = m.text;

    // ---------------------------------------------------------------- 1. business rules (first match wins)
    const h = (() => {
      if (otp != null && fromBillCom) return hit(FOLDERS.REMINDER, 'HIGH', 'Bill.com one-time password (Olivia)', 'Use the Bill.com code now — it expires within minutes.');
      if (otp != null) return hit(FOLDERS.OTHER, 'HIGH', 'One-time password / verification code', 'Use the code now — it expires within minutes.');

      if (from(ROLES.OLIVIA) && has(t, P.AGING)) return hit(FOLDERS.REMINDER, 'HIGH', 'Olivia requests the AR Aging report', 'Send Olivia the latest AR Aging report.');

      const reminderStart = all.findIndex((x) => from(ROLES.OLIVIA, x) && has(x.text, P.REMINDER));
      if (reminderStart >= 0) {
        const after = all.slice(reminderStart + 1);
        if (after.some((x) => isMikeVip(vipOf(x.raw)))) return hit(FOLDERS.REMINDER, 'HIGH', "Mike replied to Olivia's payment reminder", "Read Mike's reply and act on it; keep Olivia updated.");
        const reply = [...after].reverse().find((x) => !x.raw.isFromMe && !from(ROLES.OLIVIA, x));
        if (!reply) return hit(FOLDERS.REMINDER, 'LOW', "Olivia's payment reminder (team in CC) — no reply yet", "No action yet; watch for the customer's reply.");
        const rt = reply.text;
        if (has(rt, P.PAID) && has(rt, P.ISSUE)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Customer says already paid but also raises an issue', 'Check the payment and the issue raised, then reply.', true);
        if (has(rt, P.PAID)) return hit(FOLDERS.REMINDER, 'LOW', 'Customer has already paid — reminder not needed', 'Match the payment in the books; tell Olivia so the reminder stops.');
        if (has(rt, P.LATE)) return hit(FOLDERS.REMINDER, 'LOW', 'Customer says the payment will be late', 'Note the promised payment date for the next reminder.');
        if (has(rt, P.RATE_REQ)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Customer asks to change the appointment rate', 'Check the agreement and confirm the rate with Mike before replying.');
        if (has(rt, P.ISSUE) || has(rt, P.CREDIT)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Customer reports an invoice payment issue / appointment credits', 'Check the invoice and the credits asked for, then reply to the customer.');
        return hit(FOLDERS.REMINDER, 'MEDIUM', "Customer replied to Olivia's payment reminder", "Read the customer's reply and decide the next step.", true);
      }

      const wagePeople = [...ppl.mentioned(ROLES.QA, t), ...ppl.mentioned(ROLES.OLIVIA, t), ...ppl.mentioned(ROLES.MYRTHLE, t)];
      if (has(t, P.WAGE) && wagePeople.length && !from(ROLES.QA)) return hit(FOLDERS.REMINDER, 'HIGH', `Wage payment for ${[...new Set(wagePeople)].join(', ')}`, 'Check and confirm the wage payment.');

      if (from(ROLES.EDNA)) return hit(FOLDERS.PAYROLL, 'MEDIUM', 'Edna Gail — weekly work hours', 'Record the weekly hours for payroll.');
      if (from(ROLES.ARSLAN)) {
        const note = pdfs === 2 ? 'with two PDF attachments' : `(${pdfs} PDF attachment${pdfs === 1 ? '' : 's'} — expected two)`;
        return hit(FOLDERS.PAYROLL, 'MEDIUM', `Arslan Shabbir — closure staff hours ${note}`, 'Record the closure staff hours from the PDFs.', pdfs !== 2 && has(t, P.CLOSURE));
      }
      if (from(ROLES.QA) && (has(t, P.PAYABLE) || has(t, P.WAGE))) return hit(FOLDERS.PAYROLL, 'MEDIUM', 'QA / QMCA team — amount payable to them', 'Verify the amount payable and schedule it.', has(t, P.WAGE));
      const salaryThread = all.some((x) => has(x.text, P.SALARY_CTX));
      if (from(ROLES.FIXED_SALARY) && (has(t, P.SALARY_CTX) || salaryThread)) return hit(FOLDERS.PAYROLL, 'HIGH', `Fixed-salary employee (${m.raw.fromName}) about salary`, 'Check the salary record and reply.');
      if (has(t, P.SALARY_CTX) && has(t, P.SALARY_DELAY)) return hit(FOLDERS.PAYROLL, 'HIGH', 'Employee asks about a delayed / missing salary', 'Check the payment status today and reply.');
      if (has(t, P.SALARY_CTX) && has(t, P.SALARY_WRONG)) return hit(FOLDERS.PAYROLL, 'HIGH', 'Employee reports an incorrect payroll amount', 'Verify the payroll amount and correct it.');

      const ccContext = has(`${m.sender} ${t}`, P.CC_CTX) || from(ROLES.CALL_CENTER);
      if (from(ROLES.JANILIN) && has(t, P.COMPLETED_APPTS)) return hit(FOLDERS.BONUS, 'HIGH', 'Janilin — completed appointments for the week', 'Verify the appointments before bonus processing.');
      if (ccContext && ((has(t, P.BONUS) && has(t, P.BONUS_WRONG)) || has(t, P.APPT_MISSING))) return hit(FOLDERS.BONUS, 'HIGH', 'Call center: incorrect bonus / missing appointment', 'Verify the appointments and the bonus amount before paying.');

      if (has(t, P.DEDUCTION) || (has(t, P.BONUS) && has(t, P.SALARY_CTX))) return hit(FOLDERS.PAYROLL, 'MEDIUM', 'Team member asks about a bonus amount / deduction', 'Check the payslip calculation and reply.');

      if (has(t, P.BONUS) && has(t, P.BONUS_MISSED)) return hit(FOLDERS.BONUS, 'MEDIUM', 'Call center requests a missed / excluded bonus', "Check why it was excluded; add it to this week's bonus if valid.");
      if (has(t, P.BONUS) && ccContext) return hit(FOLDERS.BONUS, 'MEDIUM', 'Call center bonus query', 'Answer the bonus query.');
      if (has(t, P.BONUS)) return hit(FOLDERS.BONUS, 'MEDIUM', 'Bonus query', 'Answer the bonus query.', true);

      const fromSyed = from(ROLES.SYED);
      const ci = ciHit(t, m, isMike, fromSyed, urgency, daysLeft);
      if (ci) return ci;

      if (fromSyed && has(t, P.CHARGE_ADVICE)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Sayyad advises how much the customer should be charged', 'Apply the advised charge on the next invoice.');
      if (!vip && has(t, P.RATE_REQ)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Customer requests a change in appointment rate', 'Check the agreement and confirm the rate with Mike before replying.');
      if (!vip && has(t, P.PAID) && has(t, P.PAY_CONTEXT)) return hit(FOLDERS.REMINDER, 'LOW', 'Customer says they have already paid', 'Match the payment in the books.');
      if (!vip && has(t, P.LATE) && has(t, P.PAY_CONTEXT)) return hit(FOLDERS.REMINDER, 'LOW', 'Customer informs the payment will be late', 'Note the promised payment date.');
      if (!vip && has(t, P.PAYMENT_ISSUE)) return hit(FOLDERS.REMINDER, 'MEDIUM', 'Customer reports an invoice payment issue', 'Look into the payment issue and reply.');

      const toLower = (m.raw.to || '').toLowerCase();
      const vipInTo = vipDefs.find((v) => v.emails.some((e) => e.trim() && toLower.includes(e.trim().toLowerCase())));
      if (vip) return mikeAprilHit(m, vip.name, urgency, deadline);
      if (vipInTo) { const g = generalHit(m, urgency, daysLeft, deadline, newsletter); return { ...g, folder: FOLDERS.MIKE_APRIL, reason: `Sent directly to ${vipInTo.name} — ${g.reason}` }; }

      return generalHit(m, urgency, daysLeft, deadline, newsletter);
    })();

    let folder = h.folder, priority = h.priority, review = h.review;
    reasons.push(h.reason);
    if (urgencyHits.length) reasons.push(`Urgency words: ${urgencyHits.slice(0, 4).join(', ')}`);
    if (deadline) reasons.push(`Deadline found: "${deadline.text}"`);

    // ---------------------------------------------------------------- 2. mandatory universal rules
    let mandatory = otp != null;
    if (vip && !m.raw.isFromMe) {
      const mentioned = highNames.filter((n) => n.trim() && (contains(m.subj, n) || contains(m.body, n)));
      if (mentioned.length) { mandatory = true; reasons.push(`Rule A (mandatory): ${vip.name} mentions ${mentioned.join(', ')}`); }
      if (isMike) {
        const to = (m.raw.to || '').toLowerCase();
        const direct = highRecipients.filter((r) => r.trim() && to.includes(r.trim().toLowerCase()));
        if (direct.length) { mandatory = true; reasons.push(`Rule B (mandatory): Mike wrote to ${direct.join(', ')}`); }
      }
    }
    if (mandatory) priority = 'HIGH';

    // ---------------------------------------------------------------- 3. saved correction rules
    for (const r of rules) {
      if (!ruleMatches(r, m.raw, m.clean)) continue;
      if (r.categoryKey && folders.has(r.categoryKey)) { folder = r.categoryKey; reasons.push(`Your rule: ${(r.field || 'ANY').toLowerCase()} contains "${r.pattern}" → ${folderName(r.categoryKey)}`); }
      if (PRIORITY[r.priority]) {
        if (mandatory && PRIORITY[r.priority] < PRIORITY.HIGH) reasons.push(`Your rule asks for ${PRIORITY_LABEL[r.priority]}, but a mandatory High rule applies — kept High`);
        else { priority = r.priority; reasons.push(`Your rule sets priority ${PRIORITY_LABEL[r.priority]}`); }
      }
      break;
    }

    const critical = priority === 'HIGH' && (otp != null || urgency >= 6 || (daysLeft != null && daysLeft <= 0));

    // ---------------------------------------------------------------- 4. day, status, summary, details
    let processDay = priority === 'HIGH' ? received : nextProcessDay(received, folders.get(folder)?.processDays || new Set());
    if (deadline && deadline.epochDay < processDay) processDay = Math.max(deadline.epochDay, received);
    const noActionInfo = folder === FOLDERS.OTHER && priority === 'LOW' && !review && (newsletter || isAck(m));
    const status = m.raw.isFromMe ? 'WAITING' : noActionInfo ? 'NO_ACTION' : 'NEW';
    let action = h.action;
    if (deadline) action += ` Deadline: ${deadline.text}.`;
    let summary = vip ? summarize(m.raw.subject, m.raw.body, [], deadline, null, 5, 900) : summarize(m.raw.subject, m.raw.body, [], deadline, null);
    // Never repeat the code in summaries (they appear in notifications and lists).
    if (otp != null) summary = summary.split(otp).join('••••••');

    return { categoryKey: folder, tags: [], priority, critical, vipName: vip ? vip.name : null, suggestedAction: action,
      processEpochDay: processDay, status, summary, deadline, otpCode: otp, reasons, needsReview: review,
      details: details(m, folder, vip), mandatoryHigh: mandatory };
  }

  return { classify };
}
