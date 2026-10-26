// App logic for the website (the web twin of the Android MailRepository + ViewModel):
// Gmail sync, classification, user edits, reminders, alerts and phone ⇄ laptop state sync.
import * as db from './db.js';
import * as G from './gmail.js';
import * as E from './engine.js';
import { parseMessage, toInput } from './mime.js';
import { entryOf, mergeState } from './statesync.js';
import { DEFAULT_FOLDERS, DEFAULT_PEOPLE, DEFAULT_VIPS, DEFAULT_HIGH_NAMES, DEFAULT_HIGH_RECIPIENTS } from './defaults.gen.js';
const DEFAULT_CATEGORIES = DEFAULT_FOLDERS;

const DEFAULT_SETTINGS = {
  accountEmail: null, connectedAt: 0, historyId: 0, lastSyncAt: 0, lastSyncError: null,
  initialDays: 30, maxInitial: 500, queryExtra: '-in:chats -in:sent -in:drafts',
  notifyHigh: true, notifyVip: true, notifyMedium: false, notifyOtpBeep: true,
  highNames: DEFAULT_HIGH_NAMES, highRecipients: DEFAULT_HIGH_RECIPIENTS, configUpdatedAt: 0,
  people: null, folderModel: 0, sendEmptySummaries: false, payrollPinHash: '', lastReview: {},
};

export const state = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  categories: [], rules: [], vips: [],
  threads: new Map(),
  sync: { kind: 'idle', msg: '' },
  needsLogin: false,
  loadingThread: null,
  stateSync: { lastAt: 0, error: null },
  today: E.todayEpochDay(),
  toast: null,
  payrollUnlocked: false,
  audit: [],
};

// ---------------------------------------------------------------- tiny store
const listeners = new Set();
let version = 0;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => version;
const emit = () => { version++; for (const f of listeners) f(version); };

let toastTimer = null;
export function toast(msg) {
  state.toast = msg; emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; emit(); }, 3500);
}

const setSync = (kind, msg = '', quiet = false) => { if (!quiet || kind === 'error') { state.sync = { kind, msg }; emit(); } };

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
  emit();
}

// ---------------------------------------------------------------- demo mode (?demo): sample mail, nothing saved
export const isDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
async function initDemo() {
  const { demoMessages, DEMO_VIPS } = await import('./demo.js');
  for (const s of ['messages', 'threads', 'kv']) await db.clear(s); // fresh sample every time
  state.settings = { ...DEFAULT_SETTINGS, accountEmail: 'demo@example.com', lastSyncAt: Date.now(), historyId: 1 };
  state.categories = DEFAULT_CATEGORIES; state.vips = DEMO_VIPS; state.rules = [];
  const msgs = demoMessages();
  await db.put('messages', msgs);
  const eng = engine();
  for (const id of new Set(msgs.map((m) => m.threadId))) await reclassifyThread(id, eng, true);
  const t = state.threads.get('t7'); if (t) { t.remindAt = Date.now() + 2 * H; t.reminderNote = 'Use for Friday MIS'; }
  state.ready = true; emit();
}
const H = 3600_000;
const demoNote = (quiet) => { if (quiet !== true) toast('Demo mode — sample mail only. Open the site without ?demo to use your Gmail.'); };

// ---------------------------------------------------------------- startup
export async function init() {
  if (isDemo) return initDemo();
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.kvGet('settings', {})) };
  state.categories = await db.kvGet('categories', null) || DEFAULT_CATEGORIES;
  state.rules = await db.kvGet('rules', []);
  state.vips = await db.kvGet('vips', null) || DEFAULT_VIPS;
  for (const t of await db.getAll('threads')) state.threads.set(t.threadId, t);
  state.audit = await db.kvGet('audit', []);
  if ((state.settings.folderModel || 0) < 2) await upgradeToFolders();
  state.ready = true;
  emit();
  if (state.settings.accountEmail) {
    if (G.hasToken()) sync(); else { state.needsLogin = true; emit(); }
  }
  setInterval(tick, 30_000); // live check every 30 s while the page is open
}

/** One-time move from the old 18 categories to the six main folders (keeps mail, statuses, notes, reminders). */
async function upgradeToFolders() {
  state.categories = DEFAULT_FOLDERS;
  state.rules = state.rules.filter((r) => r.priority).map((r) => ({ ...r, categoryKey: null }));
  state.vips = state.vips.map((v) => ({ ...v, alwaysHigh: false }));
  for (const t of state.threads.values()) t.manualCategory = false;
  await db.kvSet('categories', state.categories); await db.kvSet('rules', state.rules); await db.kvSet('vips', state.vips);
  await saveSettings({ folderModel: 2, highNames: state.settings.highNames === 'Devendra, Vikram, Geo' ? DEFAULT_HIGH_NAMES : state.settings.highNames });
  if (state.threads.size) { await reclassifyAll(true); await audit(null, 'UPGRADE', 'Moved to the six main folders; all mail re-filed'); }
}

/** Audit trail (short labels only — never message text). Kept in this browser. */
export async function audit(threadId, kind, detail) {
  state.audit = [{ id: Date.now() + Math.random(), at: Date.now(), threadId, kind, detail: String(detail).slice(0, 300) }, ...state.audit].slice(0, 1500);
  await db.kvSet('audit', state.audit);
}
const plabel = (folder, p) => `${E.folderName(folder)} / ${E.PRIORITY_LABEL[p] || p}`;

async function tick() {
  state.today = E.todayEpochDay();
  checkReminders();
  checkWeeklyReview();
  if (state.settings.accountEmail && G.hasToken()) await sync({ quiet: true });
  else emit();
}

// ---------------------------------------------------------------- account
export async function login() {
  if (isDemo) return demoNote();
  try {
    await G.signIn(state.settings.accountEmail);
    const p = await G.profile();
    const prev = state.settings.accountEmail;
    if (prev && prev.toLowerCase() !== p.email.toLowerCase()) await clearMail();
    await saveSettings({
      accountEmail: p.email, connectedAt: Date.now(), lastSyncError: null,
      historyId: prev && prev.toLowerCase() === p.email.toLowerCase() ? state.settings.historyId : 0,
    });
    state.needsLogin = false;
    if (!G.canSyncState()) toast('Signed in. Phone sync is off because Google Drive app-data access was not allowed.');
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
    await sync();
  } catch (e) {
    toast(e.message || 'Sign-in failed');
  }
}

async function clearMail() {
  await db.clear('messages'); await db.clear('threads');
  state.threads.clear();
}

/** Revokes Google access and deletes downloaded mail from this browser. Settings are kept. */
export async function logout() {
  if (isDemo) return demoNote();
  try { await G.revoke(); } catch {}
  await clearMail();
  await saveSettings({ accountEmail: null, historyId: 0, connectedAt: 0, lastSyncAt: 0, lastSyncError: null });
  state.needsLogin = false; state.sync = { kind: 'idle', msg: '' };
  emit();
}

// ---------------------------------------------------------------- engine & classification
function engine() {
  return E.createEngine({
    categories: state.categories,
    rules: [...state.rules].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    vips: state.vips,
    highNames: E.splitList(state.settings.highNames),
    highRecipients: E.splitList(state.settings.highRecipients),
    people: state.settings.people || DEFAULT_PEOPLE,
  });
}

/** Same rules as the app's MailRepository.reclassifyThread: keeps your edits, re-opens Done mail when someone replies. */
async function reclassifyThread(threadId, eng, newMessage = false) {
  const msgs = (await db.byThread(threadId)).sort((a, b) => a.receivedAt - b.receivedAt);
  if (!msgs.length) return;
  const latest = msgs[msgs.length - 1];
  const focus = [...msgs].reverse().find((m) => !m.isFromMe) || latest;
  const earlier = msgs.filter((m) => m.id !== focus.id);
  const c = eng.classify({ latest: { ...toInput(focus), isFromMe: latest.isFromMe }, earlier: earlier.map(toInput) });
  const old = state.threads.get(threadId);

  const newer = !!old && old.latestMessageId !== latest.id;
  let status;
  if (!old) status = c.status;
  else if (newer && latest.isFromMe && (old.status === 'NEW' || old.status === 'TO_DO')) status = 'WAITING';
  else if (newer && !latest.isFromMe && !E.isPending(old.status) && c.status === 'NEW') status = 'NEW';
  else if (newer && !latest.isFromMe && old.status === 'WAITING') status = 'NEW';
  else status = old.status;
  const folder = old?.manualCategory ? old.categoryKey : c.categoryKey;
  const priority = old?.manualPriority ? old.priority : c.priority;
  // A manual priority below a mandatory High is kept, but flagged so it is not silently missed.
  const overridesMandatory = !!old?.manualPriority && c.mandatoryHigh && old.priority !== 'HIGH';
  const reasons = [...c.reasons, ...(overridesMandatory ? [`You set ${E.PRIORITY_LABEL[old.priority]} by hand, overriding a mandatory High rule`] : [])];
  if (!old) await audit(threadId, 'CLASSIFIED', plabel(folder, priority));
  else if (old.categoryKey !== folder || old.priority !== priority) await audit(threadId, 'CHANGED', `${plabel(old.categoryKey, old.priority)} → ${plabel(folder, priority)} (${c.reasons[0] || ''})`);

  const t = {
    threadId, latestMessageId: latest.id, latestAt: latest.receivedAt,
    subject: focus.subject, fromName: focus.fromName, fromEmail: focus.fromEmail, messageCount: msgs.length,
    categoryKey: folder,
    tags: c.tags.join(', '),
    priority,
    critical: old?.manualPriority ? old.critical : c.critical,
    vipName: c.vipName, suggestedAction: c.suggestedAction,
    processEpochDay: old?.manualProcessDay ? old.processEpochDay : c.processEpochDay,
    status, summary: c.summary, deadline: c.deadline?.text ?? null, otpCode: c.otpCode, reasons: reasons.join('\n'),
    needsReview: c.needsReview || overridesMandatory, details: c.details.map(([k, v]) => `${k}: ${v}`).join('\n'),
    notes: old?.notes || '',
    manualCategory: !!old?.manualCategory, manualPriority: !!old?.manualPriority, manualProcessDay: !!old?.manualProcessDay,
    notifiedMessageId: old?.notifiedMessageId ?? null,
    unread: (newMessage && newer) || !old ? !latest.isFromMe : old.unread,
    remindAt: old?.remindAt ?? null, reminderNote: old?.reminderNote ?? null,
    userUpdatedAt: old?.userUpdatedAt || 0,
    updatedAt: Date.now(),
  };
  state.threads.set(threadId, t);
  await db.put('threads', t);
}

export async function reclassifyAll(silent = false) {
  const eng = engine();
  const ids = [...state.threads.keys()];
  for (let i = 0; i < ids.length; i++) {
    if (!silent && i % 25 === 0) setSync('running', `Re-checking ${i + 1} / ${ids.length}…`);
    await reclassifyThread(ids[i], eng);
  }
  setSync('done');
}

// ---------------------------------------------------------------- Gmail sync
let syncing = false;

export async function sync({ quiet = false } = {}) {
  if (isDemo) return demoNote();
  const s = state.settings;
  if (!s.accountEmail || syncing) return;
  if (!G.hasToken()) { state.needsLogin = true; emit(); return; }
  syncing = true;
  try {
    setSync('running', 'Checking Gmail…', quiet);
    const initial = !s.historyId;
    const refs = [];
    let newHistoryId = s.historyId;
    if (initial) {
      newHistoryId = (await G.profile()).historyId;
      refs.push(...await listRecent(`newer_than:${s.initialDays}d ${s.queryExtra}`, s.maxInitial, quiet));
    } else {
      try {
        let page = null;
        do {
          const h = await G.listHistory(s.historyId, page);
          refs.push(...h.refs);
          newHistoryId = Math.max(newHistoryId, h.historyId);
          page = h.next;
        } while (page);
      } catch (e) {
        if (!(e instanceof G.HistoryExpired)) throw e;
        newHistoryId = (await G.profile()).historyId;
        refs.push(...await listRecent(`newer_than:7d ${s.queryExtra}`, 300, quiet));
      }
    }
    const { added, failed } = await fetchAndStore(refs, quiet);
    // Only move the history pointer forward if every new mail was downloaded, so none is ever skipped.
    if (!failed) await saveSettings({ historyId: newHistoryId });
    if (initial) { for (const t of state.threads.values()) t.notifiedMessageId = t.latestMessageId; await db.put('threads', [...state.threads.values()]); }
    else if (added) notifyNew();
    await saveSettings({ lastSyncAt: Date.now(), lastSyncError: null });
    setSync('done', '', quiet);
    await syncState().catch((e) => { state.stateSync.error = e.message; });
  } catch (e) {
    if (e instanceof G.AuthNeeded) { state.needsLogin = true; setSync('error', e.message); }
    else {
      const msg = navigator.onLine === false ? 'No internet connection. Will retry automatically.' : (e.message || String(e));
      await saveSettings({ lastSyncError: msg });
      setSync('error', msg);
    }
  } finally {
    syncing = false;
    emit();
  }
}

async function listRecent(q, limit, quiet) {
  const out = [];
  let page = null;
  do {
    setSync('running', `Listing emails… ${out.length}`, quiet);
    const p = await G.listMessages(q, page, Math.min(100, limit - out.length));
    out.push(...p.refs);
    page = p.next;
  } while (page && out.length < limit);
  return out;
}

async function fetchAndStore(refs, quiet) {
  const unique = [...new Map(refs.map((r) => [r.id, r])).values()];
  if (!unique.length) return { added: 0, failed: false };
  const have = new Set(await db.existingIds(unique.map((r) => r.id)));
  const todo = unique.filter((r) => !have.has(r.id));
  const self = state.settings.accountEmail;
  const touched = new Set();
  let done = 0, failed = false;
  for (let i = 0; i < todo.length; i += 25) {
    const chunk = todo.slice(i, i + 25);
    const parsed = [];
    // 5 at a time — well inside Gmail's per-user quota.
    for (let j = 0; j < chunk.length; j += 5) {
      const res = await Promise.allSettled(chunk.slice(j, j + 5).map((r) => G.getMessage(r.id)));
      for (const r of res) {
        if (r.status === 'fulfilled') parsed.push(parseMessage(r.value, self));
        else if (r.reason instanceof G.AuthNeeded) throw r.reason;
        else failed = true;
      }
    }
    await db.put('messages', parsed);
    parsed.forEach((m) => touched.add(m.threadId));
    done += parsed.length;
    setSync('running', `Downloading emails… ${done} / ${todo.length}`, quiet);
  }
  const eng = engine();
  for (const id of touched) await reclassifyThread(id, eng, true);
  return { added: done, failed };
}

/** Downloads the whole conversation when a mail is opened (older mails + your replies). */
export async function loadFullThread(threadId) {
  if (isDemo) return;
  if (!state.settings.accountEmail || !G.hasToken()) return;
  state.loadingThread = threadId; emit();
  try {
    const j = await G.getThread(threadId);
    const self = state.settings.accountEmail;
    const parsed = (j.messages || []).map((m) => parseMessage(m, self))
      .filter((m) => !m.labelIds.split(',').some((l) => ['DRAFT', 'SPAM', 'TRASH', 'CHAT'].includes(l)));
    const have = new Set(await db.existingIds(parsed.map((m) => m.id)));
    const missing = parsed.filter((m) => !have.has(m.id));
    if (missing.length) { await db.put('messages', missing); await reclassifyThread(threadId, engine()); }
  } catch (e) {
    if (e instanceof G.AuthNeeded) state.needsLogin = true;
  } finally {
    state.loadingThread = null; emit();
  }
}

export const messagesOf = async (threadId) => (await db.byThread(threadId)).sort((a, b) => a.receivedAt - b.receivedAt);

// ---------------------------------------------------------------- alerts (while the page is open)
let beepAudio = null;
export function beep() {
  try {
    beepAudio = beepAudio || new Audio('beep.wav');
    beepAudio.currentTime = 0;
    beepAudio.play().catch(() => {});
  } catch {}
}

function systemNotify(title, body, threadId) {
  try {
    if (window.Notification && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: 'icon.svg', tag: threadId || 'weekly-review' });
      n.onclick = () => { window.focus(); location.hash = threadId ? `#/mail/${threadId}` : '#/weekly'; n.close(); };
    }
  } catch {}
}

function notifyNew() {
  const s = state.settings;
  let beeped = false;
  const changed = [];
  for (const t of state.threads.values()) {
    if (t.notifiedMessageId === t.latestMessageId) continue;
    t.notifiedMessageId = t.latestMessageId;
    changed.push(t);
    if (!E.isPending(t.status) || t.status === 'WAITING') continue;
    const otp = t.otpCode && s.notifyOtpBeep;
    const high = t.priority === 'HIGH';
    const want = otp || (high && t.vipName && s.notifyVip) || (high && s.notifyHigh) || (t.priority === 'MEDIUM' && s.notifyMedium);
    if (!want) continue;
    let title, body;
    if (t.otpCode) { title = t.categoryKey === E.FOLDERS.REMINDER ? '🔑 Bill.com OTP received (Olivia)' : '🔑 Verification code received'; body = 'Open the app to view the code.'; }
    else if (t.categoryKey === E.FOLDERS.PAYROLL) { title = `💼 New payroll email (${E.PRIORITY_LABEL[t.priority]})`; body = 'Open the app to view — confidential.'; }
    else { title = (t.vipName ? `★ ${t.vipName}: ` : '') + t.subject; body = `${E.folderName(t.categoryKey)} · ${t.fromName} · ${t.summary.split('\n').pop()}`; }
    systemNotify(title, body, t.threadId);
    toast(title);
    audit(t.threadId, 'NOTIFIED', plabel(t.categoryKey, t.priority) + (t.otpCode ? ' (OTP)' : ''));
    if (otp && !beeped) { beep(); beeped = true; }
  }
  if (changed.length) db.put('threads', changed);
}

async function checkReminders() {
  const fired = new Set(await db.kvGet('firedReminders', []));
  const now = Date.now();
  let any = false;
  for (const t of state.threads.values()) {
    if (!t.remindAt || t.remindAt > now) continue;
    const key = `${t.threadId}:${t.remindAt}`;
    if (fired.has(key)) continue;
    fired.add(key); any = true;
    systemNotify(`🔔 Reminder: ${t.subject}`, t.reminderNote || t.summary.split('\n').pop(), t.threadId);
    toast(`🔔 Reminder: ${t.subject}`);
    beep();
  }
  if (any) await db.kvSet('firedReminders', [...fired].slice(-500));
}

// ---------------------------------------------------------------- your edits (synced to the phone)
async function editThread(id, patch) {
  const t = state.threads.get(id);
  if (!t) return;
  const n = { ...t, ...patch, userUpdatedAt: Date.now(), updatedAt: Date.now() };
  state.threads.set(id, n);
  await db.put('threads', n);
  emit();
  scheduleStateSync();
}

export const setStatus = (id, status) => { audit(id, 'MANUAL_STATUS', E.STATUS[status]?.label || status); return editThread(id, { status }); };
export const markDone = (id) => { toast('Marked resolved ✓'); audit(id, 'MANUAL_STATUS', 'Resolved'); return editThread(id, { status: 'DONE' }); };
export async function markReviewed(id) {
  const t = state.threads.get(id); if (!t) return;
  t.needsReview = false; await db.put('threads', t); await audit(id, 'REVIEWED', 'Needs Review cleared'); emit();
}
export const setNotes = (id, notes) => { toast('Notes saved'); return editThread(id, { notes }); };
export const setProcessDay = (id, day) => editThread(id, { processEpochDay: day, manualProcessDay: true });
export const setReminder = (id, at, note) => editThread(id, { remindAt: at, reminderNote: (note || '').trim() || null });
export const clearReminder = (id) => editThread(id, { remindAt: null, reminderNote: null });

export async function markRead(id) {
  const t = state.threads.get(id);
  // Opening marks it read, and a New item becomes Pending — reading never marks it Resolved.
  if (t && (t.unread || t.status === 'NEW')) { t.unread = false; if (t.status === 'NEW') t.status = 'TO_DO'; await db.put('threads', t); emit(); }
}
export async function markAllSeen() {
  const changed = [];
  for (const t of state.threads.values()) if (t.unread) { t.unread = false; changed.push(t); }
  await db.put('threads', changed); emit();
}

export async function setPriority(id, p, critical, alwaysForSender) {
  const before = state.threads.get(id);
  const mandatory = (before?.reasons || '').includes('(mandatory)') && p !== 'HIGH';
  await editThread(id, { priority: p, critical: !!critical && p === 'HIGH', manualPriority: true, ...(mandatory ? { needsReview: true } : {}) });
  await audit(id, 'MANUAL_PRIORITY', `${E.PRIORITY_LABEL[before?.priority]} → ${E.PRIORITY_LABEL[p]}${mandatory ? ' (overrides a mandatory High rule)' : ''}`);
  if (alwaysForSender) await addRule({ field: 'FROM', pattern: state.threads.get(id).fromEmail, categoryKey: null, priority: p });
}
export async function setCategory(id, key, alwaysForSender) {
  const before = state.threads.get(id);
  await editThread(id, { categoryKey: key, manualCategory: true });
  await audit(id, 'MANUAL_FOLDER', `${E.folderName(before?.categoryKey)} → ${E.folderName(key)}`);
  if (alwaysForSender) await addRule({ field: 'FROM', pattern: state.threads.get(id).fromEmail, categoryKey: key, priority: null });
}
export async function resetAutomatic(id) {
  await editThread(id, { manualCategory: false, manualPriority: false, manualProcessDay: false });
  await reclassifyThread(id, engine()); emit();
}

// ---------------------------------------------------------------- configuration (synced to the phone)
async function saveConfig(patch, { reclassify = true } = {}) {
  if (patch.categories) { state.categories = patch.categories; await db.kvSet('categories', state.categories); }
  if (patch.rules) { state.rules = patch.rules; await db.kvSet('rules', state.rules); }
  if (patch.vips) { state.vips = patch.vips; await db.kvSet('vips', state.vips); }
  await saveSettings({ configUpdatedAt: Date.now(), ...(patch.settings || {}) });
  if (reclassify) await reclassifyAll();
  scheduleStateSync();
}

export const saveFolderDays = (key, days) => saveConfig({ categories: state.categories.map((c) => (c.key === key ? { ...c, processDays: days } : c)) });
export const savePeople = (people) => saveConfig({ settings: { people } }).then(() => toast('People saved — all mail re-checked'));
export const addRule = (r) => saveConfig({ rules: [{ id: Date.now(), createdAt: Date.now(), ...r }, ...state.rules] });
export const deleteRule = (id) => saveConfig({ rules: state.rules.filter((r) => r.id !== id) });
export const saveVip = (v) => saveConfig({ vips: v.id ? state.vips.map((x) => (x.id === v.id ? v : x)) : [...state.vips, { ...v, id: Date.now() }] });
export const deleteVip = (id) => saveConfig({ vips: state.vips.filter((v) => v.id !== id) });
export const saveHighRules = (highNames, highRecipients) => saveConfig({ settings: { highNames, highRecipients } });
export const updateSettings = (patch) => saveSettings(patch); // local-only preferences (notifications)

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const payrollLocked = () => !!state.settings.payrollPinHash && !state.payrollUnlocked;
export async function unlockPayroll(pin) {
  const ok = (await sha256('tlg-payroll:' + pin)) === state.settings.payrollPinHash;
  if (ok) { state.payrollUnlocked = true; emit(); } else toast('Wrong PIN');
  return ok;
}
export async function setPayrollPin(pin) {
  await saveSettings({ payrollPinHash: pin ? await sha256('tlg-payroll:' + pin) : '' });
  state.payrollUnlocked = !pin; emit();
  toast(pin ? 'Payroll PIN set' : 'Payroll PIN removed');
}

// ---------------------------------------------------------------- weekly review
// Monday & Friday: Reminder Summary · Wednesday: Customer Invoicing · Friday: Call Center Bonus · Saturday: Payroll.
export function foldersForDay(dow) { return state.categories.filter((c) => E.parseDays(c.processDays).has(dow)).map((c) => c.key); }

export function weeklySummary(key, since) {
  const today = state.today;
  const inFolder = [...state.threads.values()].filter((t) => t.categoryKey === key);
  const open = inFolder.filter((t) => E.isPending(t.status));
  const byP = (p) => open.filter((t) => t.priority === p).sort((a, b) => b.latestAt - a.latestAt);
  const facts = [...open].sort((a, b) => (E.PRIORITY[b.priority] - E.PRIORITY[a.priority]) || (b.latestAt - a.latestAt))
    .flatMap((t) => (t.details || '').split('\n').filter((l) => /^(Invoice|Amount|Customer|Employee)/.test(l)))
    .concat(open.filter((t) => t.deadline).map((t) => `Deadline: ${t.deadline}`));
  const sum = {
    key, name: E.folderName(key), since,
    newCount: inFolder.filter((t) => t.latestAt >= since).length,
    high: byP('HIGH'), medium: byP('MEDIUM'), low: byP('LOW'),
    pending: open.length, overdue: open.filter((t) => t.processEpochDay < today).length,
    resolved: inFolder.filter((t) => !E.isPending(t.status) && t.status !== 'NO_ACTION' && (t.updatedAt || 0) >= since).length,
    keyFacts: [...new Set(facts)].slice(0, 8),
  };
  sum.isEmpty = !sum.newCount && !sum.high.length && !sum.medium.length && !sum.pending && !sum.resolved;
  sum.line = `${sum.newCount} new · ${sum.high.length} High · ${sum.medium.length} Medium · ${sum.low.length} Low · ${sum.pending} pending (${sum.overdue} overdue) · ${sum.resolved} resolved`;
  return sum;
}

/** While the page is open on a review day, show the day's summary once (empty ones skipped unless enabled). */
function checkWeeklyReview() {
  const now = new Date();
  if (now.getHours() < 9 || !state.settings.accountEmail) return;
  const startToday = E.msOfEpochDay(state.today);
  const last = state.settings.lastReview || {};
  const due = foldersForDay(E.dayOfWeek(state.today)).filter((k) => (last[k] || 0) < startToday);
  if (!due.length) return;
  const weekAgo = Date.now() - 7 * 864e5;
  const sums = due.map((k) => weeklySummary(k, last[k] || weekAgo));
  const send = state.settings.sendEmptySummaries ? sums : sums.filter((x) => !x.isEmpty);
  if (send.length) {
    const title = '📋 Review today — ' + send.map((x) => x.name).join(', ');
    systemNotify(title, send.map((x) => `${x.name}: ${x.line}`).join('\n'), null);
    toast(title);
    audit(null, 'REVIEW', title);
  }
  const map = { ...last }; for (const k of due) map[k] = Date.now();
  saveSettings({ lastReview: map });
}
export function markWeeklyReviewed(keys) {
  const map = { ...(state.settings.lastReview || {}) }; for (const k of keys) map[k] = Date.now();
  saveSettings({ lastReview: map }); audit(null, 'REVIEW', 'Reviewed: ' + keys.map(E.folderName).join(', ')); toast('Marked as reviewed');
}

// ---------------------------------------------------------------- phone ⇄ laptop state sync
let stateTimer = null;
function scheduleStateSync() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => syncState().catch((e) => { state.stateSync.error = e.message; emit(); }), 1500);
}

const configObject = () => ({
  u: state.settings.configUpdatedAt,
  folderModel: 2,
  people: state.settings.people ? JSON.stringify(state.settings.people) : '',
  categories: state.categories,
  rules: state.rules.map(({ field, pattern, categoryKey, priority, createdAt }) => ({ field, pattern, categoryKey: categoryKey ?? null, priority: priority ?? null, createdAt: createdAt || 0 })),
  vips: state.vips.map(({ name, emails, alwaysHigh }) => ({ name, emails, alwaysHigh: alwaysHigh !== false })),
  highNames: state.settings.highNames,
  highRecipients: state.settings.highRecipients,
});

let stateSyncing = false;
export async function syncState() {
  if (isDemo) return;
  if (stateSyncing || !state.settings.accountEmail || !G.hasToken() || !G.canSyncState()) return;
  stateSyncing = true;
  try {
    const files = await G.driveFindSyncFiles();
    let remote = null;
    for (const f of files) {
      const data = await G.driveDownload(f.id);
      remote = remote ? mergeState(remote, data.threads || {}, data.config || null).merged : data;
    }
    const local = {};
    for (const t of state.threads.values()) { const e = entryOf(t); if (e) local[t.threadId] = e; }
    const localConfig = state.settings.configUpdatedAt ? configObject() : null;
    const { merged, toApply, applyConfig, changed } = mergeState(remote, local, localConfig);

    let needReclassify = false;
    const applied = [];
    for (const [id, e] of Object.entries(toApply)) {
      const t = state.threads.get(id);
      if (!t) continue; // applied later, when this mail arrives here
      Object.assign(t, {
        status: e.status, notes: e.notes || '', remindAt: e.remindAt ?? null, reminderNote: e.reminderNote ?? null,
        manualCategory: e.categoryKey != null, manualPriority: e.priority != null, manualProcessDay: e.processEpochDay != null,
        userUpdatedAt: e.u,
      });
      if (e.categoryKey != null) t.categoryKey = e.categoryKey;
      if (e.priority != null) { t.priority = e.priority; t.critical = !!e.critical; }
      if (e.processEpochDay != null) t.processEpochDay = e.processEpochDay;
      applied.push(t);
    }
    if (applied.length) {
      await db.put('threads', applied);
      const eng = engine();
      for (const t of applied) await reclassifyThread(t.threadId, eng); // restore automatic values where not manual
    }
    if (applyConfig) {
      // Older app versions synced 18 categories; only take folder lists from the six-folder model.
      const cats = applyConfig.folderModel >= 2 ? (applyConfig.categories || []).filter((c) => E.FOLDER_KEYS.includes(c.key)) : [];
      if (cats.length === E.FOLDER_KEYS.length) state.categories = cats;
      if (applyConfig.people) { try { state.settings.people = JSON.parse(applyConfig.people); } catch {} }
      state.rules = (applyConfig.rules || []).map((r, i) => ({ id: (r.createdAt || 0) + i, ...r }));
      state.vips = (applyConfig.vips || []).map((v, i) => ({ id: i + 1, ...v }));
      await db.kvSet('categories', state.categories); await db.kvSet('rules', state.rules); await db.kvSet('vips', state.vips);
      await saveSettings({ people: state.settings.people, highNames: applyConfig.highNames ?? state.settings.highNames, highRecipients: applyConfig.highRecipients ?? state.settings.highRecipients, configUpdatedAt: applyConfig.u });
      needReclassify = true;
    }
    if (needReclassify) await reclassifyAll(true);

    if (changed || files.length > 1) {
      if (files[0]) await G.driveUpdate(files[0].id, merged); else await G.driveCreate(merged);
      for (const f of files.slice(1)) await G.driveDelete(f.id).catch(() => {});
    }
    state.stateSync = { lastAt: Date.now(), error: null };
  } finally {
    stateSyncing = false;
    emit();
  }
}

// ---------------------------------------------------------------- views of the data (same rules as the app)
export function taskViews() {
  const byKey = new Map(state.categories.map((c) => [c.key, c]));
  const today = state.today;
  const dow = E.dayOfWeek(today);
  return [...state.threads.values()].map((t) => {
    const cat = byKey.get(t.categoryKey);
    const scheduledToday = !!cat && E.parseDays(cat.processDays).has(dow);
    const pending = E.isPending(t.status);
    const overdue = pending && t.processEpochDay < today;
    return { t, pending, categoryName: E.folderName(t.categoryKey), scheduledToday, overdue,
      rank: E.rankScore(t.priority, t.critical, !!t.vipName, pending, t.processEpochDay, today, scheduledToday) };
  });
}
