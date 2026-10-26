// Website screens — same features as the Android app: six folders with High / Medium / Low, Action today,
// Overdue, Needs review, Search & filter, Weekly review, What's New, Pending, Reminders, Week plan,
// mail detail (full conversation, folder/priority/status changes, details, reasons), and all settings.
import { html, render, useState, useEffect } from './vendor/preact-htm-3.1.1.js';
import * as C from './core.js';
import * as E from './engine.js';
import * as G from './gmail.js';
import { attachmentNames } from './mime.js';
import { DEFAULT_PEOPLE } from './defaults.gen.js';

const { state } = C;

// ---------------------------------------------------------------- hooks & helpers
function useStore() {
  const [, setV] = useState(0);
  useEffect(() => C.subscribe((v) => setV(v)), []);
  return state;
}
function useRoute() {
  const get = () => location.hash.replace(/^#/, '') || '/mails';
  const [r, setR] = useState(get());
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
function useWide() {
  const q = matchMedia('(min-width: 960px)');
  const [w, setW] = useState(q.matches);
  useEffect(() => { const f = () => setW(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, []);
  return w;
}
const go = (r) => { location.hash = r; };

const pad = (n) => String(n).padStart(2, '0');
const timeOf = (d) => { let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayFmt = (epochDay) => { const { m, d } = E.ymdOf(epochDay); return `${WD[E.dayOfWeek(epochDay)]} ${d} ${MON[m - 1]}`; };
const shortTime = (ms) => { const d = new Date(ms); return E.epochDayFromMs(ms) === E.todayEpochDay() ? timeOf(d) : `${d.getDate()} ${MON[d.getMonth()]}`; };
const fullTime = (ms) => { const d = new Date(ms); return `${WD[E.dayOfWeek(E.epochDayFromMs(ms))]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${timeOf(d)}`; };
function reminderText(ms) {
  const day = E.epochDayFromMs(ms), today = E.todayEpochDay();
  return `${day === today ? 'Today' : day === today + 1 ? 'Tomorrow' : dayFmt(day)}, ${timeOf(new Date(ms))}`;
}
const PL = E.PRIORITY_LABEL;
const PRIOS = ['HIGH', 'MEDIUM', 'LOW'];
const NEW_WINDOW = 3 * 24 * 3600 * 1000;
const isNew = (v, now) => v.t.unread && v.t.latestAt >= now - NEW_WINDOW;

function openInGmail(threadId) {
  const a = state.settings.accountEmail;
  window.open(`https://mail.google.com/mail/${a ? `?authuser=${encodeURIComponent(a)}` : ''}#all/${threadId}`, '_blank', 'noopener');
}

// ---------------------------------------------------------------- small components
const Pill = ({ text, cls = '' }) => html`<span class="pill ${cls}">${text}</span>`;
const PriorityPill = ({ t }) => html`<${Pill} cls=${`p-${t.priority} ${t.critical || t.priority === 'HIGH' ? 'filled' : ''}`} text=${PL[t.priority] + (t.critical ? ' · Urgent' : '')} />`;
const Empty = ({ text }) => html`<p class="empty">${text}</p>`;

function SectionHead({ title, count, cls = '', open, onToggle }) {
  return html`<div class="section-head ${cls} ${onToggle ? 'clickable' : ''}" onClick=${onToggle}>
    <span>${title}</span>${count != null && html`<${Pill} text=${count} cls=${cls} />`}
    ${onToggle && html`<span class="toggle">${open ? 'Hide ▴' : 'Show ▾'}</span>`}
  </div>`;
}

function MailCard({ v, selected }) {
  const t = v.t;
  const hidden = C.payrollLocked() && t.categoryKey === E.FOLDERS.PAYROLL;
  const icons = (t.otpCode ? '🔑 ' : '') + (t.vipName ? '⭐ ' : '') + (t.remindAt ? '🔔 ' : '');
  const foot = [t.needsReview && '⚑ Needs review', `${v.categoryName} · ${PL[t.priority]}`,
    v.pending && t.status !== 'WAITING' && E.STATUS[t.status]?.label,
    v.overdue && `⏰ pending since ${dayFmt(t.processEpochDay)}`,
    t.status === 'WAITING' && 'waiting for reply',
    t.messageCount > 1 && `${t.messageCount} msgs`].filter(Boolean).join(' · ');
  return html`<div class="card mail p-${t.priority} ${t.vipName ? 'vip' : ''} ${selected ? 'selected' : ''}" onClick=${() => go(`/mail/${t.threadId}`)}>
    <div class="bar"></div>
    <div class="body">
      <div class="row1">
        ${t.unread && html`<span class="dot"></span>`}
        <span class="from ${t.unread ? 'b' : ''}">${icons}${t.fromName}</span>
        <span class="time">${shortTime(t.latestAt)}</span>
      </div>
      <div class="subject">${hidden ? '🔒 Payroll email (locked)' : t.subject}</div>
      ${hidden ? html`<div class="summary">Enter the Payroll PIN to view.</div>`
        : t.otpCode ? html`<div class="otp">🔑 One-time code received — open to view</div>`
        : html`<div class="summary ${t.vipName ? 'long' : ''}">${t.summary.replace(/\n/g, ' ')}</div>`}
      <div class="foot ${v.overdue || t.needsReview ? 'err' : ''}">${foot}</div>
    </div>
    ${v.pending && html`<button class="icon-btn done" title="Mark resolved" onClick=${(e) => { e.stopPropagation(); C.markDone(t.threadId); }}>✓</button>`}
  </div>`;
}

const List = ({ items, selectedId }) => items.map((v) => html`<${MailCard} key=${v.t.threadId} v=${v} selected=${v.t.threadId === selectedId} />`);

function PinGate() {
  const [pin, setPin] = useState('');
  return html`<div class="pin-gate">
    <div class="big">🔒</div><h3>Payroll Process is locked</h3>
    <p class="hint">Payroll mail is confidential. Enter your Payroll PIN (set on this computer) to view it.</p>
    <input class="field pin" type="password" inputmode="numeric" maxlength="8" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))}
      onKeyDown=${(e) => { if (e.key === 'Enter') C.unlockPayroll(pin).then((ok) => ok && setPin('')); }} />
    <button class="btn primary" onClick=${() => C.unlockPayroll(pin).then((ok) => ok && setPin(''))}>Unlock</button>
  </div>`;
}

function SyncLine() {
  const s = state.settings;
  if (state.sync.kind === 'running') return html`<div class="syncline"><div class="progress"></div>${state.sync.msg}</div>`;
  if (state.sync.kind === 'error') return html`<div class="syncline err">⚠ ${state.sync.msg}</div>`;
  if (s.lastSyncAt) return html`<div class="syncline">✓ Updated ${shortTime(s.lastSyncAt)} · checks every 30 s while this page is open
    ${G.canSyncState() && state.stateSync.lastAt ? ' · 📱 synced with phone' : ''}</div>`;
  return null;
}

function Banners() {
  const s = state.settings;
  const out = [];
  if (C.isDemo) return html`<div class="banner gold"><b>Demo mode — sample mail</b><p>Pretend mail to try the website. Nothing here is real or saved to your account.</p><a class="btn" href="./">Use my Gmail</a></div>`;
  if (!G.isConfigured()) out.push(html`<div class="banner err"><b>Website setup pending</b><p>The Google sign-in client ID is not set in config.js yet.</p></div>`);
  else if (!s.accountEmail) out.push(html`<div class="banner"><b>Sign in with Google</b><p>Read-only access to your Gmail. Your password is entered only on Google's own screen.</p><button class="btn primary" onClick=${C.login}>Sign in with Google</button></div>`);
  else if (state.needsLogin) out.push(html`<div class="banner warn"><b>Continue as ${s.accountEmail}</b><p>For your security, Google sign-in lasts one session. Click to keep checking mail.</p><button class="btn primary" onClick=${C.login}>Continue</button></div>`);
  if (s.accountEmail && state.vips.some((v) => !v.emails)) out.push(html`<div class="banner gold"><b>Set up Mike & April</b><p>Add their email addresses so the Mike and April rules work.</p><button class="btn" onClick=${() => go('/settings/vips')}>Add addresses</button></div>`);
  return out;
}

/** "✓ Same as the phone" or "⟳ N mails differ — matching…" on the dashboard. */
function PeerSyncLine() {
  const peer = state.settings.peerStats;
  if (!peer?.threads) return null;
  const diff = C.differences(peer.threads, [...state.threads.values()]);
  if (diff < 0) return null;
  return html`<div class=${'syncline ' + (diff ? 'err' : 'ok')}>${diff === 0 ? `✓ Same as the phone · checked ${shortTime(state.stateSync.lastAt || Date.now())}` : `⟳ ${diff} mail(s) differ from the phone — matching on the next sync (30 s)`}</div>`;
}

// ---------------------------------------------------------------- dashboard
function views() { return C.taskViews(); }
function actionToday(vs) { const today = state.today; return vs.filter((v) => v.pending && !v.overdue && (v.t.processEpochDay <= today || v.t.priority === 'HIGH')).sort((a, b) => b.rank - a.rank); }

function FolderCard({ k, vs }) {
  const list = vs.filter((v) => v.t.categoryKey === k);
  const open = list.filter((v) => v.pending);
  const locked = k === E.FOLDERS.PAYROLL && C.payrollLocked();
  return html`<div class="card folder-card" onClick=${() => go(`/folder/${k}`)}>
    <b>${E.FOLDER_ICONS[k]} ${E.folderName(k)}${locked ? ' 🔒' : ''}</b>
    <div class="foot">${list.length} total · ${list.filter((v) => v.t.unread).length} unread · ${open.length} pending</div>
    <div class="prio-row">${PRIOS.map((p) => {
      const n = open.filter((v) => v.t.priority === p).length;
      return html`<button class="prio-chip p-${p} ${n ? 'has' : ''}" onClick=${(e) => { e.stopPropagation(); go(`/folder/${k}/${p}`); }}>${PL[p][0]} ${n}</button>`;
    })}</div>
  </div>`;
}

function Dashboard({ selectedId }) {
  const vs = views();
  const now = Date.now();
  const pending = vs.filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const reviewToday = C.foldersForDay(E.dayOfWeek(state.today));
  const high = pending.filter((v) => v.t.priority === 'HIGH');
  return html`<div class="view">
    <button class="search-btn" onClick=${() => go('/search')}>🔍 Search & filter — sender, customer, employee, folder, priority, status, date</button>
    <div class="tiles four">
      <button class="tile blue" onClick=${() => go('/today')}><b>${actionToday(vs).length}</b><span>Action today</span></button>
      <button class="tile red" onClick=${() => go('/overdue')}><b>${pending.filter((v) => v.overdue).length}</b><span>Overdue</span></button>
      <button class="tile amber" onClick=${() => go('/review')}><b>${vs.filter((v) => v.pending && v.t.needsReview).length}</b><span>Needs review</span></button>
      <button class="tile teal" onClick=${() => go('/new')}><b>${vs.filter((v) => isNew(v, now)).length}</b><span>What's New</span></button>
    </div>
    <${Banners} />
    ${reviewToday.length > 0 && html`<div class="card info clickable review-banner" onClick=${() => go('/weekly')}>
      <span class="ficon">📋</span><div class="grow"><b>Today's review: ${reviewToday.map(E.folderName).join(', ')}</b>
      <div class="foot">Pending work, new mail and key amounts for this review</div></div><span class="chev">›</span></div>`}
    <${SyncLine} />
    <${PeerSyncLine} />
    <${SectionHead} title="Folders" />
    <div class="folder-grid">${E.FOLDER_KEYS.map((k) => html`<${FolderCard} key=${k} k=${k} vs=${vs} />`)}</div>
    <${SectionHead} title="🔴 High priority — all folders" count=${high.length} cls="p-HIGH" />
    ${high.length ? html`<${List} items=${high} selectedId=${selectedId} />` : html`<${Empty} text="Nothing urgent right now 🎉" />`}
  </div>`;
}

// ---------------------------------------------------------------- folder (High / Medium / Low)
function FolderView({ k, only, selectedId }) {
  const [status, setStatus] = useState('OPEN');
  const [open, setOpen] = useState(() => Object.fromEntries(PRIOS.map((p) => [p, !only || only === p])));
  useEffect(() => setOpen(Object.fromEntries(PRIOS.map((p) => [p, !only || only === p]))), [k, only]);
  if (k === E.FOLDERS.PAYROLL && C.payrollLocked()) return html`<${PinGate} />`;
  const inFolder = views().filter((v) => v.t.categoryKey === k);
  const shown = inFolder.filter((v) => (status === 'OPEN' ? v.pending : status === 'RESOLVED' ? !v.pending : true))
    .sort((a, b) => (b.rank - a.rank) || (b.t.latestAt - a.t.latestAt));
  return html`<div class="view">
    <div class="folder-head"><h2>${E.FOLDER_ICONS[k]} ${E.folderName(k)}</h2>
      <div class="foot">${inFolder.length} total · ${inFolder.filter((v) => v.t.unread).length} unread · ${inFolder.filter((v) => v.pending).length} pending</div></div>
    <div class="chips">${[['OPEN', 'Open (New / Pending / In progress)'], ['ALL', 'All'], ['RESOLVED', 'Resolved']].map(([x, l]) => html`<button class="chip ${status === x ? 'on' : ''}" onClick=${() => setStatus(x)}>${l}</button>`)}</div>
    ${PRIOS.map((p) => {
      const list = shown.filter((v) => v.t.priority === p);
      return html`<${SectionHead} title=${`${PL[p]} Priority`} count=${list.length} cls=${`p-${p}`} open=${open[p]} onToggle=${() => setOpen({ ...open, [p]: !open[p] })} />
        ${open[p] && (list.length ? html`<${List} items=${list} selectedId=${selectedId} />` : html`<${Empty} text=${`No ${PL[p].toLowerCase()} priority mail here.`} />`)}`;
    })}
  </div>`;
}

/** Action today / Overdue / Needs review, grouped by folder. */
function TaskListView({ kind, selectedId }) {
  const vs = views();
  const pending = vs.filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const [hint, list] = kind === 'today' ? ['Pending mail planned for today, plus every High-priority item.', actionToday(vs)]
    : kind === 'overdue' ? ['Pending mail past its planned day. It stays here until you mark it Resolved.', pending.filter((v) => v.overdue)]
      : ['The app was not sure about these. Check the folder and priority, then click "Mark reviewed" on the mail.', pending.filter((v) => v.t.needsReview)];
  return html`<div class="view">
    <p class="hint">${hint}</p>
    ${!list.length && html`<${Empty} text="Nothing here. 🎉" />`}
    ${E.FOLDER_KEYS.map((k) => { const l = list.filter((v) => v.t.categoryKey === k); return l.length ? html`<${SectionHead} title=${`${E.FOLDER_ICONS[k]} ${E.folderName(k)}`} count=${l.length} /><${List} items=${l} selectedId=${selectedId} />` : null; })}
  </div>`;
}

// ---------------------------------------------------------------- what's new / pending / search / weekly
function NewView({ selectedId }) {
  const now = Date.now();
  const vs = views();
  const fresh = vs.filter((v) => isNew(v, now)).sort((a, b) => b.t.latestAt - a.t.latestAt);
  const today = vs.filter((v) => !isNew(v, now) && v.t.latestAt >= now - 864e5).sort((a, b) => b.t.latestAt - a.t.latestAt);
  return html`<div class="view">
    <${SyncLine} />
    <div class="row-between"><${SectionHead} title="🆕 Not opened yet" count=${fresh.length} />
      ${fresh.length > 0 && html`<button class="btn" onClick=${C.markAllSeen}>Mark all seen</button>`}</div>
    ${fresh.length ? html`<${List} items=${fresh} selectedId=${selectedId} />` : html`<${Empty} text="You've seen everything new. 🎉" />`}
    ${today.length > 0 && html`<${SectionHead} title="Earlier in the last 24 hours" count=${today.length} cls="muted" /><${List} items=${today} selectedId=${selectedId} />`}
  </div>`;
}

function PendingView({ selectedId }) {
  const today = state.today;
  const pending = views().filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const waiting = pending.filter((v) => v.t.status === 'WAITING');
  const active = pending.filter((v) => v.t.status !== 'WAITING');
  const groups = [
    ['⏰ Overdue (past its day)', active.filter((v) => v.overdue), 'err'],
    ['Today', active.filter((v) => !v.overdue && v.t.processEpochDay <= today), ''],
    ['Later this week / next week', active.filter((v) => v.t.processEpochDay > today), 'muted'],
    ["Waiting for someone's reply", waiting, 'tert'],
  ];
  return html`<div class="view">
    <p class="hint">Everything not Resolved yet. Click ✓ when a mail's work is finished.</p>
    ${!pending.length && html`<${Empty} text="Nothing pending. 🎉" />`}
    ${groups.filter(([, l]) => l.length).map(([title, l, cls]) => html`<${SectionHead} title=${title} count=${l.length} cls=${cls} /><${List} items=${l} selectedId=${selectedId} />`)}
  </div>`;
}

function SearchView({ selectedId }) {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState(null);
  const [prio, setPrio] = useState(null);
  const [status, setStatus] = useState('ANY');
  const [range, setRange] = useState('ALL');
  const [reviewOnly, setReviewOnly] = useState(false);
  const now = Date.now();
  const since = range === 'TODAY' ? E.msOfEpochDay(state.today) : range === '7' ? now - 7 * 864e5 : range === '30' ? now - 30 * 864e5 : 0;
  const query = q.trim().toLowerCase();
  const locked = C.payrollLocked();
  const list = views().filter(({ t, pending }) =>
    (!folder || t.categoryKey === folder) && (!prio || t.priority === prio) &&
    (status === 'ANY' || (status === 'NEW' && t.status === 'NEW') || (status === 'PENDING' && (t.status === 'TO_DO' || t.status === 'WAITING')) ||
      (status === 'IN_PROGRESS' && t.status === 'IN_PROGRESS') || (status === 'RESOLVED' && !pending)) &&
    t.latestAt >= since && (!reviewOnly || t.needsReview) &&
    (!query || ([t.subject, t.fromName, t.fromEmail, t.details, t.notes, t.summary].some((x) => (x || '').toLowerCase().includes(query)) &&
      !(locked && t.categoryKey === E.FOLDERS.PAYROLL && !t.fromName.toLowerCase().includes(query))))).sort((a, b) => b.t.latestAt - a.t.latestAt);
  const chip = (on, label, click) => html`<button class="chip ${on ? 'on' : ''}" onClick=${click}>${label}</button>`;
  return html`<div class="view">
    <input class="search" placeholder="🔍 Sender, customer, employee, invoice no., subject…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="chips">${chip(!folder, 'All folders', () => setFolder(null))}${E.FOLDER_KEYS.map((k) => chip(folder === k, E.folderName(k), () => setFolder(folder === k ? null : k)))}</div>
    <div class="chips">${chip(!prio, 'Any priority', () => setPrio(null))}${PRIOS.map((p) => chip(prio === p, PL[p], () => setPrio(prio === p ? null : p)))}${chip(reviewOnly, '⚑ Needs review', () => setReviewOnly(!reviewOnly))}</div>
    <div class="chips">${[['ANY', 'Any status'], ['NEW', 'New'], ['PENDING', 'Pending'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved']].map(([k, l]) => chip(status === k, l, () => setStatus(k)))}</div>
    <div class="chips">${[['ALL', 'Any date'], ['TODAY', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(([k, l]) => chip(range === k, l, () => setRange(k)))}</div>
    <p class="hint">${list.length} result${list.length === 1 ? '' : 's'}</p>
    <${List} items=${list} selectedId=${selectedId} />
  </div>`;
}

function WeeklyView({ selectedId }) {
  const last = state.settings.lastReview || {};
  const weekAgo = Date.now() - 7 * 864e5;
  const dueToday = C.foldersForDay(E.dayOfWeek(state.today));
  const reviewed = state.categories.filter((c) => E.parseDays(c.processDays).size).map((c) => c.key);
  const order = [...dueToday, ...reviewed.filter((k) => !dueToday.includes(k))];
  const vs = views();
  return html`<div class="view">
    <p class="hint">Review days: Monday & Friday — Reminder Summary · Wednesday — Customer Invoicing · Friday — Call Center Bonus · Saturday — Payroll Process. Mail is sorted the moment it arrives; this view brings pending work into focus.</p>
    ${order.map((k) => {
      const s = C.weeklySummary(k, last[k] || weekAgo);
      const locked = k === E.FOLDERS.PAYROLL && C.payrollLocked();
      const top = [...s.high, ...s.medium].slice(0, 8).map((t) => vs.find((v) => v.t.threadId === t.threadId)).filter(Boolean);
      return html`<div class="card info col">
        <b class=${dueToday.includes(k) ? 'pri-text' : ''}>${dueToday.includes(k) ? '📋 Today · ' : ''}${E.FOLDER_ICONS[k]} ${s.name}</b>
        <div class="foot">Since ${fullTime(s.since)}</div>
        ${locked ? html`<p class="small">🔒 Locked — enter the Payroll PIN in the Payroll Process folder to see details.</p>` : html`
          <ol class="review-list">
            <li>New emails received: <b>${s.newCount}</b></li>
            <li class="p-text-HIGH">High priority needing action: <b>${s.high.length}</b></li>
            <li class="p-text-MEDIUM">Medium follow-ups: <b>${s.medium.length}</b></li>
            <li class="p-text-LOW">Low / informational: <b>${s.low.length}</b></li>
            <li>Pending: <b>${s.pending}</b> (overdue ${s.overdue})</li>
            <li>Resolved: <b>${s.resolved}</b></li>
            ${s.keyFacts.length > 0 && html`<li>Key details:<ul>${s.keyFacts.map((f) => html`<li>${f}</li>`)}</ul></li>`}
          </ol>`}
        ${dueToday.includes(k) && html`<button class="btn primary" onClick=${() => C.markWeeklyReviewed([k])}>Mark reviewed</button>`}
      </div>
      ${!locked && html`<${List} items=${top} selectedId=${selectedId} />`}`;
    })}
  </div>`;
}

function RemindersView() {
  const now = Date.now();
  const list = views().filter((v) => v.t.remindAt).sort((a, b) => a.t.remindAt - b.t.remindAt);
  const card = (v) => html`<div class="card reminder" key=${v.t.threadId} onClick=${() => go(`/mail/${v.t.threadId}`)}>
    <div class="grow"><b class="tert-text">🔔 ${reminderText(v.t.remindAt)}</b>
      ${v.t.reminderNote && html`<div class="note">${v.t.reminderNote}</div>`}
      <div class="subject">${v.t.subject}</div><div class="foot">${v.t.fromName} · ${v.categoryName}</div></div>
    <button class="btn text" onClick=${(e) => { e.stopPropagation(); C.clearReminder(v.t.threadId); }}>Clear</button></div>`;
  const due = list.filter((v) => v.t.remindAt <= now), up = list.filter((v) => v.t.remindAt > now);
  return html`<div class="view">
    <p class="hint">To set a reminder: open any mail → 🔔 Remind me → pick a day and time. On this website the beep and pop-up come while the page is open; your phone app reminds you even when closed.</p>
    ${!list.length && html`<${Empty} text="No reminders yet." />`}
    ${due.length > 0 && html`<${SectionHead} title="Due now" count=${due.length} cls="err" />${due.map(card)}`}
    ${up.length > 0 && html`<${SectionHead} title="Upcoming" count=${up.length} cls="tert" />${up.map(card)}`}
  </div>`;
}

function WeekView({ selectedId }) {
  const today = state.today;
  const dow = E.dayOfWeek(today);
  const monday = dow === 6 ? today + 1 : today - dow;
  const pending = views().filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const overdue = pending.filter((v) => v.overdue);
  const later = pending.filter((v) => v.t.processEpochDay > monday + 5);
  return html`<div class="view">
    <${SyncLine} />
    <${SectionHead} title="Overdue — carried forward" count=${overdue.length} cls="err" />
    ${overdue.length ? html`<${List} items=${overdue} selectedId=${selectedId} />` : html`<${Empty} text="Nothing overdue." />`}
    ${E.WORK_DAYS.map((i) => {
      const d = monday + i;
      if (d < today) return null;
      const l = pending.filter((v) => v.t.processEpochDay === d);
      return html`<${SectionHead} title=${(d === today ? 'Today · ' : '') + dayFmt(d)} count=${l.length} cls=${d === today ? '' : 'muted'} />
        ${l.length ? html`<${List} items=${l} selectedId=${selectedId} />` : html`<${Empty} text="Nothing planned." />`}`;
    })}
    ${later.length > 0 && html`<${SectionHead} title="Next week and later" count=${later.length} cls="muted" /><${List} items=${later} selectedId=${selectedId} />`}
  </div>`;
}

// ---------------------------------------------------------------- dialogs
function Modal({ title, onClose, children, actions }) {
  return html`<div class="modal-bg" onClick=${onClose}><div class="modal" onClick=${(e) => e.stopPropagation()}>
    <h3>${title}</h3><div class="modal-body">${children}</div><div class="modal-actions">${actions}</div></div></div>`;
}

function ReminderDialog({ t, onClose }) {
  const today = state.today;
  const init = t.remindAt ? new Date(t.remindAt) : null;
  const nextDow = (target) => today + (((target - E.dayOfWeek(today) + 7) % 7) || 7);
  const toInputDate = (ed) => { const { y, m, d } = E.ymdOf(ed); return `${y}-${pad(m)}-${pad(d)}`; };
  const [date, setDate] = useState(init ? toInputDate(E.epochDayFromMs(t.remindAt)) : toInputDate(today + 1));
  const [time, setTime] = useState(init ? `${pad(init.getHours())}:${pad(init.getMinutes())}` : '10:00');
  const [note, setNote] = useState(t.reminderNote || '');
  const [err, setErr] = useState('');
  const days = [['Today', today], ['Tomorrow', today + 1], ['Friday', nextDow(4)], ['Next Monday', nextDow(0)]];
  const times = [['9:00 AM', '09:00'], ['10:00 AM', '10:00'], ['1:00 PM', '13:00'], ['5:00 PM', '17:00']];
  const at = () => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
  const save = () => {
    const ms = at();
    if (!(ms > Date.now())) return setErr('That time has already passed — pick a later time.');
    C.setReminder(t.threadId, ms, note); C.toast(`🔔 Reminder set for ${reminderText(ms)}`); onClose();
  };
  return html`<${Modal} title="🔔 Remind me about this mail" onClose=${onClose} actions=${html`
      <button class="btn text" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Set reminder</button>`}>
    <label>Day</label>
    <div class="chips wrap">${days.map(([l, d]) => html`<button class="chip ${date === toInputDate(d) ? 'on' : ''}" onClick=${() => setDate(toInputDate(d))}>${l}</button>`)}
      <input type="date" value=${date} min=${toInputDate(today)} onInput=${(e) => setDate(e.target.value)} /></div>
    <label>Time</label>
    <div class="chips wrap">${times.map(([l, v]) => html`<button class="chip ${time === v ? 'on' : ''}" onClick=${() => setTime(v)}>${l}</button>`)}
      <input type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /></div>
    <p class="strong">Reminder: ${date && time ? reminderText(at()) : '—'}</p>
    <input class="field" placeholder="Note (optional), e.g. Use for Friday MIS" value=${note} onInput=${(e) => setNote(e.target.value)} />
    ${err && html`<p class="err-text">${err}</p>`}
  <//>`;
}

function FolderDialog({ t, onClose }) {
  const [sel, setSel] = useState(t.categoryKey);
  const [always, setAlways] = useState(false);
  return html`<${Modal} title="Move to folder" onClose=${onClose} actions=${html`<button class="btn text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => { C.setCategory(t.threadId, sel, always); onClose(); }}>Save</button>`}>
    ${E.FOLDER_KEYS.map((k) => html`<label class="radio"><input type="radio" checked=${sel === k} onChange=${() => setSel(k)} /> ${E.FOLDER_ICONS[k]} ${E.folderName(k)}</label>`)}
    <label class="check"><input type="checkbox" checked=${always} onChange=${(e) => setAlways(e.target.checked)} /> Always use this for ${t.fromEmail}</label>
  <//>`;
}

function PriorityDialog({ t, onClose }) {
  const [sel, setSel] = useState(t.priority);
  const [crit, setCrit] = useState(!!t.critical);
  const [always, setAlways] = useState(false);
  const mandatory = (t.reasons || '').includes('(mandatory)');
  return html`<${Modal} title="Change priority" onClose=${onClose} actions=${html`<button class="btn text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => { C.setPriority(t.threadId, sel, crit, always); onClose(); }}>Save</button>`}>
    ${PRIOS.map((p) => html`<label class="radio p-text-${p}"><input type="radio" checked=${sel === p} onChange=${() => setSel(p)} /> ${PL[p]}</label>`)}
    ${sel === 'HIGH' && html`<label class="check"><input type="checkbox" checked=${crit} onChange=${(e) => setCrit(e.target.checked)} /> Urgent (pin to top)</label>`}
    ${mandatory && sel !== 'HIGH' && html`<p class="err-text small">A mandatory High rule applies to this mail. Your choice is kept but the mail is flagged "Needs review".</p>`}
    <label class="check"><input type="checkbox" checked=${always} onChange=${(e) => setAlways(e.target.checked)} /> Always for ${t.fromEmail} (never lowers a mandatory High)</label>
  <//>`;
}

function DayDialog({ t, onClose }) {
  const today = state.today;
  const monday = today - E.dayOfWeek(today);
  const opts = [...Array(14).keys()].map((i) => monday + i).filter((d) => E.dayOfWeek(d) !== 6 && d >= today);
  return html`<${Modal} title="Plan for which day?" onClose=${onClose} actions=${html`<button class="btn text" onClick=${onClose}>Cancel</button>`}>
    ${opts.map((d) => html`<button class="list-btn" onClick=${() => { C.setProcessDay(t.threadId, d); onClose(); }}>${d === today ? 'Today · ' : ''}${dayFmt(d)}</button>`)}
  <//>`;
}

// ---------------------------------------------------------------- mail detail
function MessageBlock({ m, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => setOpen(startOpen), [m.id, startOpen]);
  return html`<div class="msg">
    <div class="msg-head" onClick=${() => setOpen(!open)}>
      <span class=${m.isFromMe ? 'tert-text b' : 'pri-text b'}>${m.isFromMe ? 'You' : m.fromName} ${open ? '▴' : '▾'}</span>
      <span class="time">${fullTime(m.receivedAt)}</span>
    </div>
    ${open ? html`
      ${!m.isFromMe && html`<div class="foot">To: ${m.toLine}</div>`}
      ${m.ccLine && html`<div class="foot">Cc: ${m.ccLine}</div>`}
      ${m.attachments && html`<div class="foot">📎 ${attachmentNames(m).join(', ')}</div>`}
      <pre class="msg-body">${m.body}</pre>`
    : html`<div class="snippet">${m.snippet}</div>`}
  </div>`;
}

function DetailView({ id, onClose }) {
  const t = state.threads.get(id);
  const [msgs, setMsgs] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(t?.notes || '');
  const v = C.getVersion();
  useEffect(() => { C.markRead(id); C.loadFullThread(id); }, [id]);
  useEffect(() => { C.messagesOf(id).then(setMsgs); }, [id, v]);
  useEffect(() => setNotes(t?.notes || ''), [id, t?.notes]);
  if (!t) return html`<div class="detail"><${Empty} text="This mail is not on this device yet." /></div>`;
  if (t.categoryKey === E.FOLDERS.PAYROLL && C.payrollLocked()) return html`<div class="detail">${onClose && html`<div class="detail-top"><button class="btn text" onClick=${onClose}>✕ Close</button></div>`}<${PinGate} /></div>`;
  const pending = E.isPending(t.status);
  const latest = msgs.find((m) => m.id === t.latestMessageId);
  const copy = () => { navigator.clipboard?.writeText(t.otpCode); C.toast('Code copied'); };
  const selected = (k) => t.status === k || (k === 'TO_DO' && t.status === 'WAITING') || (k === 'DONE' && t.status === 'NO_ACTION');

  return html`<div class="detail">
    <div class="detail-top">${onClose && html`<button class="btn text" onClick=${onClose}>✕ Close</button>`}</div>
    <div class="pills"><${PriorityPill} t=${t} />${t.vipName && html`<${Pill} cls="gold filled" text=${`⭐ ${t.vipName}`} />`}<${Pill} cls=${pending ? 'tert' : 'muted'} text=${E.STATUS[t.status]?.label || t.status} /></div>
    <div class="pri-text b folder-line">${E.FOLDER_ICONS[t.categoryKey]} ${E.folderName(t.categoryKey)}</div>
    <h2>${t.subject}</h2>
    <div class="foot">${t.fromName} ${`<${t.fromEmail}>`}</div>
    ${latest?.toLine && html`<div class="foot">To: ${latest.toLine}</div>`}
    ${latest?.ccLine && html`<div class="foot">Cc: ${latest.ccLine}</div>`}
    <div class="foot">${fullTime(t.latestAt)}</div>

    <div class="actions">
      <button class="btn primary" onClick=${() => openInGmail(t.threadId)}>Open in Gmail</button>
      <button class="btn tonal" onClick=${() => setDialog('remind')}>🔔 Remind me</button>
      ${pending ? html`<button class="btn" onClick=${() => C.markDone(t.threadId)}>✓ Mark as resolved</button>`
        : html`<button class="btn" onClick=${() => C.setStatus(t.threadId, 'TO_DO')}>↺ Reopen</button>`}
    </div>

    ${t.needsReview && html`<div class="card info review-card"><div class="grow"><b>⚑ Needs review</b><div class="foot">The app was not fully sure. Check the folder and priority below.</div></div>
      <button class="btn text" onClick=${() => C.markReviewed(t.threadId)}>Mark reviewed</button></div>`}

    ${t.remindAt && html`<div class="card info tert-bg"><div class="grow"><b>🔔 Reminder: ${reminderText(t.remindAt)}</b>${t.reminderNote && html`<div class="foot">${t.reminderNote}</div>`}</div>
      <button class="btn text" onClick=${() => setDialog('remind')}>Change</button><button class="btn text" onClick=${() => C.clearReminder(t.threadId)}>Remove</button></div>`}

    ${t.otpCode && html`<div class="card info otp-card"><div class="grow"><div class="foot">Verification code</div><div class="otp-big">${t.otpCode}</div></div>
      <button class="btn primary" onClick=${copy}>Copy</button></div>`}

    <div class="card info col"><h4>Status</h4><div class="chips wrap">
      ${E.STATUS_CHOICES.map((k) => html`<button class="chip ${selected(k) ? 'on' : ''}" onClick=${() => C.setStatus(t.threadId, k)}>${E.STATUS[k].label}</button>`)}</div>
      ${t.status === 'WAITING' && html`<div class="foot">You replied last — waiting for their answer.</div>`}</div>

    <div class="card info col"><h4>Classification</h4>
      <div class="kv" onClick=${() => setDialog('folder')}><span>Folder</span><span>${E.folderName(t.categoryKey)}</span><span>✎</span></div>
      <div class="kv" onClick=${() => setDialog('prio')}><span>Priority</span><span>${PL[t.priority]}${t.critical ? ' (urgent)' : ''}</span><span>✎</span></div>
      <div class="kv" onClick=${() => setDialog('day')}><span>Work day</span><span>${dayFmt(t.processEpochDay)}</span><span>✎</span></div>
      ${(t.manualCategory || t.manualPriority || t.manualProcessDay) && html`<button class="btn text" onClick=${() => C.resetAutomatic(t.threadId)}>Reset to automatic</button>`}
      <div class="foot">Why:</div><ul class="reasons">${(t.reasons || 'No strong signals').split('\n').map((r) => html`<li>${r}</li>`)}</ul></div>

    ${t.details && html`<div class="card info col"><h4>Details</h4>
      ${t.details.split('\n').filter(Boolean).map((l) => { const i = l.indexOf(': '); return html`<div class="kv static"><span>${l.slice(0, i)}</span><span>${l.slice(i + 2)}</span><span></span></div>`; })}</div>`}

    <div class="card info col"><h4>${t.vipName ? `Summary (${t.vipName})` : 'Summary'}</h4><pre class="summary-text">${t.summary}</pre>
      <div class="foot">Required action</div><div class="pri-text">➜ ${t.suggestedAction}</div></div>

    <div class="card info col"><h4>Conversation (${msgs.length} mail${msgs.length === 1 ? '' : 's'})</h4>
      ${state.loadingThread === id && html`<div class="foot">Loading the full conversation from Gmail…</div>`}
      ${msgs.map((m, i) => html`<${MessageBlock} key=${m.id} m=${m} startOpen=${i === msgs.length - 1 || msgs.length <= 3} />`)}
      ${msgs.length > 1 && html`<div class="foot">Click any mail to open or close it.</div>`}
    </div>

    <button class="btn text" onClick=${() => setNotesOpen(!notesOpen)}>${notesOpen ? 'Hide notes ▴' : 'My notes ▾'}</button>
    ${notesOpen && html`<div class="card info col">
      <textarea class="field" rows="4" placeholder="Notes (synced with your phone)" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
      ${notes !== (t.notes || '') && html`<button class="btn" onClick=${() => C.setNotes(t.threadId, notes)}>Save notes</button>`}</div>`}

    ${dialog === 'remind' && html`<${ReminderDialog} t=${t} onClose=${() => setDialog(null)} />`}
    ${dialog === 'folder' && html`<${FolderDialog} t=${t} onClose=${() => setDialog(null)} />`}
    ${dialog === 'prio' && html`<${PriorityDialog} t=${t} onClose=${() => setDialog(null)} />`}
    ${dialog === 'day' && html`<${DayDialog} t=${t} onClose=${() => setDialog(null)} />`}
  </div>`;
}

// ---------------------------------------------------------------- settings
function Group({ title, children }) { return html`<div class="card group"><h4>${title}</h4>${children}</div>`; }
function Toggle({ label, value, onChange }) {
  return html`<label class="toggle-row"><span>${label}</span><input type="checkbox" class="switch" checked=${value} onChange=${(e) => onChange(e.target.checked)} /></label>`;
}

function SettingsView() {
  const s = state.settings;
  const [names, setNames] = useState(s.highNames);
  const [rcpt, setRcpt] = useState(s.highRecipients);
  const [confirm, setConfirm] = useState(false);
  const [pinDialog, setPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  useEffect(() => { setNames(s.highNames); setRcpt(s.highRecipients); }, [s.highNames, s.highRecipients]);
  const notifState = window.Notification ? Notification.permission : 'unsupported';
  return html`<div class="view settings">
    <${Group} title="Google account">
      ${s.accountEmail ? html`
        <p><b>Signed in: ${s.accountEmail}</b></p>
        <p class="small">Gmail access is read-only — this site cannot send, reply, delete or change mail, issue credits, change rates or make payments.
          ${G.canSyncState() ? ' Status, notes, reminders and settings sync with your phone app through a hidden app folder in your own Google Drive.' : ' Phone sync is off (Drive app-folder access not allowed).'}</p>
        ${s.lastSyncAt > 0 && html`<p class="small">Last sync: ${fullTime(s.lastSyncAt)}${state.stateSync.lastAt ? ` · phone sync ${shortTime(state.stateSync.lastAt)}` : ''}</p>`}
        ${(s.lastSyncError || state.stateSync.error) && html`<p class="err-text small">Last error: ${s.lastSyncError || state.stateSync.error}</p>`}
        <div class="row"><button class="btn primary" onClick=${() => (G.hasToken() ? C.sync() : C.login())}>Sync now</button>
          <button class="btn" onClick=${() => setConfirm(true)}>Sign out & remove data</button></div>`
      : html`<button class="btn primary" onClick=${C.login}>Sign in with Google</button>`}
    <//>

    <${SyncCheck} />

    <${Group} title="Mandatory High priority (Mike & April)">
      <p class="small">Rule A — Mike or April mentions any of these names:</p>
      <input class="field" value=${names} onInput=${(e) => setNames(e.target.value)} placeholder="Dev, Devendra, Geo, Vikram" />
      <p class="small">Rule B — Mike sends to any of these addresses (To:):</p>
      <textarea class="field" rows="2" value=${rcpt} onInput=${(e) => setRcpt(e.target.value)}></textarea>
      <p class="hint">Separate with commas.</p>
      ${(names !== s.highNames || rcpt !== s.highRecipients) && html`<button class="btn primary" onClick=${() => C.saveHighRules(names.trim(), rcpt.trim().toLowerCase())}>Save & re-check all mail</button>`}
    <//>

    <${Group} title="Alerts on this computer">
      <${Toggle} label="🔑 OTP mail: beep-beep sound" value=${s.notifyOtpBeep} onChange=${(x) => C.updateSettings({ notifyOtpBeep: x })} />
      <${Toggle} label="Mike & April — High priority mail" value=${s.notifyVip} onChange=${(x) => C.updateSettings({ notifyVip: x })} />
      <${Toggle} label="High priority mail (all folders)" value=${s.notifyHigh} onChange=${(x) => C.updateSettings({ notifyHigh: x })} />
      <${Toggle} label="Medium priority mail" value=${s.notifyMedium} onChange=${(x) => C.updateSettings({ notifyMedium: x })} />
      <${Toggle} label="Weekly review: show even when empty" value=${s.sendEmptySummaries} onChange=${(x) => C.updateSettings({ sendEmptySummaries: x })} />
      <div class="row">
        <button class="btn" onClick=${C.beep}>▶ Test beep</button>
        ${notifState !== 'granted' && notifState !== 'unsupported' && html`<button class="btn" onClick=${() => Notification.requestPermission().then(() => C.toast('Thanks!'))}>Allow pop-up notifications</button>`}
      </div>
      <p class="hint">OTP codes are never shown in notifications; payroll notifications never show details. Alerts work while this page is open (checks every 30 s).</p>
    <//>

    <${Group} title="Work setup">
      <button class="list-btn" onClick=${() => go('/settings/people')}>👥 People & addresses (Olivia, Syed, Janilin, Edna…) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/vips')}>⭐ Mike & April (email addresses) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/folderdays')}>📅 Folder review days <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/weekly')}>📋 Weekly review <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/week')}>🗓 This week's work plan (Mon–Sat) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/rules')}>🧠 My saved rules (from corrections) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/audit')}>📜 Activity log <span class="chev">›</span></button>
      <button class="btn text" onClick=${() => C.reclassifyAll().then(() => C.toast('All emails re-checked'))}>Re-check all emails now</button>
    <//>

    <${Group} title="Payroll privacy">
      <p class="small">${s.payrollPinHash ? 'Payroll Process is locked with a PIN (this computer only).' : 'No PIN set. Anyone using this browser can open the Payroll Process folder.'}</p>
      <div class="row"><button class="btn" onClick=${() => { setPin(''); setPinDialog(true); }}>${s.payrollPinHash ? 'Change PIN' : 'Set Payroll PIN'}</button>
        ${s.payrollPinHash && html`<button class="btn text" onClick=${() => C.setPayrollPin(null)}>Remove PIN</button>`}</div>
    <//>

    <${Group} title="Privacy">
      <p class="small">Mail is read straight from Google into this browser and stored only here (IndexedDB). There is no server in between and no AI service. <a href="../privacy.html" target="_blank">Privacy policy</a></p>
    <//>

    ${confirm && html`<${Modal} title="Sign out?" onClose=${() => setConfirm(false)} actions=${html`<button class="btn text" onClick=${() => setConfirm(false)}>Cancel</button>
        <button class="btn primary" onClick=${() => { setConfirm(false); C.logout(); }}>Sign out</button>`}>
      <p>This revokes this website's Google access and deletes downloaded mail from this browser. Your phone app and synced settings are not affected.</p><//>`}
    ${pinDialog && html`<${Modal} title="Payroll PIN" onClose=${() => setPinDialog(false)} actions=${html`<button class="btn text" onClick=${() => setPinDialog(false)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (pin.length >= 4) { C.setPayrollPin(pin); setPinDialog(false); } }}>Save</button>`}>
      <input class="field pin" type="password" inputmode="numeric" maxlength="8" placeholder="4–8 digits" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))} /><//>`}
  </div>`;
}

/** Phone ⇄ Website check: pending counts per folder and priority on both sides. */
function SyncCheck() {
  const peer = state.settings.peerStats;
  const mine = C.countStats();
  let allMatch = true;
  const rows = E.FOLDER_KEYS.map((k) => html`<tr><td>${E.folderName(k)}</td>${PRIOS.map((p) => {
    const a = mine.counts[k][p], b = peer?.counts?.[k]?.[p] ?? 0;
    if (a !== b) allMatch = false;
    return html`<td class=${a === b ? '' : 'err-text'}>${a} / ${b} ${a === b ? '✓' : '✗'}</td>`;
  })}</tr>`);
  return html`<${Group} title="Phone ⇄ Website check">
    ${!peer ? html`<p class="small">The phone has not sent its counts yet. Open the app on the phone (v1.0.9 or newer) and wait a minute.</p>` : html`
      <table class="sync-table"><thead><tr><th>Pending</th><th>High</th><th>Medium</th><th>Low</th></tr><tr class="sub"><th></th><th colspan="3">website / phone</th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${(() => {
        if (!peer.threads) return null;
        const cnt = (v) => (Array.isArray(v) ? v[0] : +v);
        const onlyPhone = Object.keys(peer.threads).filter((id) => !(id in mine.threads)).length;
        const onlyWeb = Object.keys(mine.threads).filter((id) => !(id in peer.threads)).length;
        const diff = Object.keys(mine.threads).filter((id) => id in peer.threads && cnt(peer.threads[id]) !== cnt(mine.threads[id])).length;
        return onlyPhone + onlyWeb + diff ? html`<p class="err-text small">Different mail: ${onlyWeb} only on website · ${onlyPhone} only on phone · ${diff} with a different number of messages. They are downloaded automatically on the next sync.</p>` : null;
      })()}
      <p class="hint">Mail on website: ${mine.total} · on phone: ${peer.total} · phone counted ${shortTime(peer.at)}${state.settings.sharedFromDay ? ` · both keep all mail since ${dayFmt(state.settings.sharedFromDay)}` : ''}</p>
      <p class=${allMatch ? 'pri-text small' : 'err-text small'}>${allMatch ? '✓ Phone and website match.' : 'Counts differ right now — they catch up after both have synced (a minute or two). Click Sync now here and open the app on the phone.'}</p>`}
    <button class="btn" onClick=${() => (G.hasToken() ? C.sync() : C.login())}>Sync now</button>
  <//>`;
}

function PeopleView() {
  const base = state.settings.people || DEFAULT_PEOPLE;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(base)));
  const set = (role, k, v) => setDraft({ ...draft, [role]: { ...draft[role], [k]: v } });
  return html`<div class="view settings">
    <p class="hint">The folder rules recognise these people by email address (exact) or by name in the sender's display name. Adding email addresses makes the match more reliable. Separate several with commas.</p>
    ${Object.entries(draft).map(([role, g]) => html`<${Group} title=${g.label}>
      <label>Names</label><input class="field" value=${g.names} onInput=${(e) => set(role, 'names', e.target.value)} />
      <label>Email addresses</label><input class="field" value=${g.emails} onInput=${(e) => set(role, 'emails', e.target.value.toLowerCase())} />
    <//>`)}
    <button class="btn primary save-btn" onClick=${() => C.savePeople(draft)}>Save & re-check all mail</button>
  </div>`;
}

function FolderDaysView() {
  return html`<div class="view settings">
    <p class="hint">Scheduled review days. Mail is always sorted the moment it arrives; on these days the app shows a review summary and plans non-urgent work. High-priority mail is always due the day it arrives.</p>
    ${state.categories.map((c) => { const d = E.parseDays(c.processDays); return html`<${Group} title=${`${E.FOLDER_ICONS[c.key]} ${c.name}`}>
      <div class="chips wrap">${E.WORK_DAYS.map((x) => html`<button class="chip ${d.has(x) ? 'on' : ''}" onClick=${() => { const n = new Set(d); n.has(x) ? n.delete(x) : n.add(x); C.saveFolderDays(c.key, E.formatDays(n)); }}>${WD[x]}</button>`)}</div>
      ${!d.size && html`<p class="hint">No review day — mail is planned for the next working day.</p>`}<//>`; })}
  </div>`;
}

function AuditView() {
  return html`<div class="view">
    <p class="hint">Classifications, changes, your manual corrections, notifications and reviews (newest first). Only short labels are kept — never email text.</p>
    ${!state.audit.length && html`<${Empty} text="No activity yet." />`}
    ${state.audit.slice(0, 300).map((a) => html`<div class="audit-row ${a.threadId ? 'clickable' : ''}" key=${a.id} onClick=${() => a.threadId && go(`/mail/${a.threadId}`)}>
      <div class="grow"><div class="pri-text small b">${a.kind.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</div><div class="small">${a.detail}</div></div>
      <span class="time">${shortTime(a.at)}</span></div>`)}
  </div>`;
}

function VipsView() {
  const [edit, setEdit] = useState(null);
  return html`<div class="view">
    <p class="hint">Enter Mike's and April's exact email address(es), separated by commas. Their mail goes to "Mike and April Mail"; it is High only when a rule says so (Dev/Geo/Vikram mention, Mike to the three addresses, or a direct instruction).</p>
    ${state.vips.map((v) => html`<div class="card info col clickable" key=${v.id} onClick=${() => setEdit({ ...v })}>
      <b class="gold-text">⭐ ${v.name}</b><div class="small">${v.emails || 'No address yet — click to add'}</div></div>`)}
    <button class="btn text" onClick=${() => setEdit({ name: '', emails: '', alwaysHigh: false })}>+ Add person</button>
    ${edit && html`<${Modal} title=${edit.id ? `Edit ${edit.name}` : 'Add person'} onClose=${() => setEdit(null)} actions=${html`
        ${edit.id && html`<button class="btn text err-text" onClick=${() => { C.deleteVip(edit.id); setEdit(null); }}>Delete</button>`}
        <button class="btn text" onClick=${() => setEdit(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (edit.name.trim()) C.saveVip({ ...edit, name: edit.name.trim(), emails: edit.emails.trim().toLowerCase(), alwaysHigh: false }); setEdit(null); }}>Save</button>`}>
      <label>Name</label><input class="field" value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} />
      <label>Email address(es)</label><input class="field" value=${edit.emails} onInput=${(e) => setEdit({ ...edit, emails: e.target.value })} />
    <//>`}
  </div>`;
}

function RulesView() {
  const [add, setAdd] = useState(null);
  const rules = [...state.rules].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return html`<div class="view">
    <p class="hint">Rules saved from your corrections ("Always…" when you change a folder or priority). They never lower a mandatory High rule. Newest rule wins.</p>
    <button class="btn text" onClick=${() => setAdd({ field: 'FROM', pattern: '', categoryKey: null, priority: null })}>+ Add rule</button>
    ${!rules.length && html`<${Empty} text="No rules yet." />`}
    ${rules.map((r) => html`<div class="card info" key=${r.id}><div class="grow"><div>If ${(r.field || 'ANY').toLowerCase()} contains "${r.pattern}"</div>
      <div class="pri-text small">${[r.categoryKey && `→ ${E.folderName(r.categoryKey)}`, r.priority && `→ ${PL[r.priority]} priority`].filter(Boolean).join('  ')}</div></div>
      <button class="btn text err-text" onClick=${() => C.deleteRule(r.id)}>Delete</button></div>`)}
    ${add && html`<${Modal} title="New rule" onClose=${() => setAdd(null)} actions=${html`<button class="btn text" onClick=${() => setAdd(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (add.pattern.trim() && (add.categoryKey || add.priority)) { C.addRule({ ...add, pattern: add.pattern.trim() }); setAdd(null); } }}>Add</button>`}>
      <div class="chips wrap">${['FROM', 'SUBJECT', 'BODY', 'ANY'].map((f) => html`<button class="chip ${add.field === f ? 'on' : ''}" onClick=${() => setAdd({ ...add, field: f })}>${f.toLowerCase()}</button>`)}</div>
      <input class="field" placeholder="contains…" value=${add.pattern} onInput=${(e) => setAdd({ ...add, pattern: e.target.value })} />
      <label>Folder</label><select class="field" value=${add.categoryKey || ''} onChange=${(e) => setAdd({ ...add, categoryKey: e.target.value || null })}>
        <option value="">Unchanged</option>${E.FOLDER_KEYS.map((k) => html`<option value=${k}>${E.folderName(k)}</option>`)}</select>
      <label>Priority</label><div class="chips wrap"><button class="chip ${!add.priority ? 'on' : ''}" onClick=${() => setAdd({ ...add, priority: null })}>Auto</button>
        ${PRIOS.map((p) => html`<button class="chip ${add.priority === p ? 'on' : ''}" onClick=${() => setAdd({ ...add, priority: p })}>${PL[p]}</button>`)}</div>
    <//>`}
  </div>`;
}

// ---------------------------------------------------------------- greeting
function Splash({ onDone }) {
  const h = new Date().getHours();
  const [greet, emoji] = h >= 5 && h < 12 ? ['Good Morning', '☀️'] : h < 17 && h >= 12 ? ['Good Afternoon', '🌤️'] : h < 22 && h >= 17 ? ['Good Evening', '✨'] : ['Good Night', '🌙'];
  useEffect(() => { const t = setTimeout(onDone, 2700); return () => clearTimeout(t); }, []);
  const vs = C.taskViews();
  const pending = vs.filter((v) => v.pending);
  const high = pending.filter((v) => v.t.priority === 'HIGH').length, overdue = pending.filter((v) => v.overdue).length;
  const endToday = E.msOfEpochDay(state.today + 1);
  const rem = vs.filter((v) => v.t.remindAt && v.t.remindAt < endToday).length;
  const stats = !state.threads.size ? "Let's see what's important today"
    : high + overdue + rem === 0 ? 'No urgent mail right now 🎉'
      : [high && `${high} high priority`, overdue && `${overdue} overdue`, rem && `${rem} reminder${rem > 1 ? 's' : ''} today`].filter(Boolean).join(' · ');
  return html`<div class="splash" onClick=${onDone}>
    <div class="logo-wrap"><div class="ring"></div><img src="icon-fg.svg" class="logo" alt="" /></div>
    <div class="l1">Namaste 🙏</div><div class="l2">${greet} ${emoji}</div><div class="l3">${stats}</div><div class="l4">TLG Mail Priority</div>
  </div>`;
}

// ---------------------------------------------------------------- shell
const NAV = [
  ['/mails', '🏠', 'Home'], ['/new', '🆕', "What's New"], ['/today', '✅', 'Action today'], ['/overdue', '⏰', 'Overdue'],
  ['/review', '⚑', 'Needs review'], ['/pending', '⏳', 'Pending'], ['/search', '🔍', 'Search'], ['/reminders', '🔔', 'Reminders'],
  ['/weekly', '📋', 'Weekly review'], ['/week', '🗓', 'Week plan'], ['/settings', '⚙️', 'Settings'],
];
const MOBILE_NAV = [['/mails', '🏠', 'Home'], ['/reminders', '🔔', 'Reminders'], ['/settings', '⚙️', 'Settings']];

function titleOf(r) {
  if (r.startsWith('/folder/')) return E.folderName(r.split('/')[2]);
  if (r.startsWith('/mail/')) return 'Mail';
  return ({ '/mails': 'TLG Mail Priority', '/new': "What's New", '/pending': 'Pending', '/today': 'Action today', '/overdue': 'Overdue / unresolved',
    '/review': 'Needs review', '/search': 'Search & filter', '/weekly': 'Weekly review', '/reminders': 'Reminders', '/week': 'Week plan (Mon–Sat)',
    '/settings': 'Settings', '/settings/vips': 'Mike & April', '/settings/people': 'People & addresses', '/settings/folderdays': 'Folder review days',
    '/settings/rules': 'My saved rules', '/settings/audit': 'Activity log' })[r] || 'TLG Mail Priority';
}

function ListFor({ route, selectedId }) {
  if (route.startsWith('/folder/')) { const [, , k, p] = route.split('/'); return html`<${FolderView} k=${k} only=${p || null} selectedId=${selectedId} />`; }
  switch (route) {
    case '/new': return html`<${NewView} selectedId=${selectedId} />`;
    case '/pending': return html`<${PendingView} selectedId=${selectedId} />`;
    case '/today': case '/overdue': case '/review': return html`<${TaskListView} key=${route} kind=${route.slice(1)} selectedId=${selectedId} />`;
    case '/search': return html`<${SearchView} selectedId=${selectedId} />`;
    case '/weekly': return html`<${WeeklyView} selectedId=${selectedId} />`;
    case '/reminders': return html`<${RemindersView} />`;
    case '/week': return html`<${WeekView} selectedId=${selectedId} />`;
    case '/settings': return html`<${SettingsView} />`;
    case '/settings/vips': return html`<${VipsView} />`;
    case '/settings/people': return html`<${PeopleView} />`;
    case '/settings/folderdays': return html`<${FolderDaysView} />`;
    case '/settings/rules': return html`<${RulesView} />`;
    case '/settings/audit': return html`<${AuditView} />`;
    default: return html`<${Dashboard} selectedId=${selectedId} />`;
  }
}

let lastListRoute = '/mails';

function App() {
  useStore();
  const route = useRoute();
  const wide = useWide();
  const [splash, setSplash] = useState(true);
  if (!state.ready) return html`<div class="loading">Loading…</div>`;
  if (splash) return html`<${Splash} onDone=${() => setSplash(false)} />`;

  const mailId = route.startsWith('/mail/') ? decodeURIComponent(route.slice(6)) : null;
  if (!mailId) lastListRoute = route;
  const listRoute = mailId ? lastListRoute : route;
  const dueRem = [...state.threads.values()].filter((t) => t.remindAt && t.remindAt <= Date.now()).length;
  const navItem = ([r, icon, label]) => html`<a href=${'#' + r} class="nav-item ${listRoute === r || (r !== '/mails' && r !== '/settings' && listRoute.startsWith(r)) || (r === '/settings' && listRoute.startsWith('/settings')) ? 'on' : ''}">
    <span class="nav-icon">${icon}${r === '/reminders' && dueRem > 0 && html`<span class="badge">${dueRem}</span>`}</span><span>${label}</span></a>`;
  const vs = wide ? C.taskViews() : [];
  const folderNav = (k) => {
    const n = vs.filter((v) => v.pending && v.t.categoryKey === k).length;
    return html`<a href=${'#/folder/' + k} class="nav-item ${listRoute.startsWith('/folder/' + k) ? 'on' : ''}"><span class="nav-icon">${E.FOLDER_ICONS[k]}</span><span class="grow">${E.folderName(k)}</span>${n > 0 && html`<span class="count">${n}</span>`}</a>`;
  };

  const canBack = !wide && (mailId || !['/mails', '/reminders', '/settings'].includes(route));
  return html`<div class="shell ${wide ? 'wide' : 'narrow'}">
    <header class="topbar">
      ${canBack && html`<button class="icon-btn" onClick=${() => history.back()}>←</button>`}
      <img src="icon.svg" class="top-logo" alt="" />
      <h1>${titleOf(wide ? listRoute : route)}</h1>
      <span class="grow"></span>
      ${state.settings.accountEmail && html`<span class="acct">${state.settings.accountEmail}</span>`}
      <button class="icon-btn" title="Check for new mail" onClick=${() => (G.hasToken() ? C.sync() : C.login())}>⟳</button>
    </header>
    ${wide && html`<nav class="side">${NAV.slice(0, 1).map(navItem)}<div class="nav-label">Folders</div>${E.FOLDER_KEYS.map(folderNav)}<div class="nav-label">Views</div>${NAV.slice(1).map(navItem)}</nav>`}
    <main class="main">
      ${wide
        ? html`<div class="split ${mailId ? 'has-detail' : ''}"><section class="list-pane"><${ListFor} route=${listRoute} selectedId=${mailId} /></section>
            ${mailId && html`<section class="detail-pane"><${DetailView} id=${mailId} onClose=${() => go(listRoute)} /></section>`}</div>`
        : mailId ? html`<${DetailView} id=${mailId} />` : html`<${ListFor} route=${route} />`}
    </main>
    ${!wide && html`<nav class="bottom">${MOBILE_NAV.map(navItem)}</nav>`}
    ${state.toast && html`<div class="toast">${state.toast}</div>`}
  </div>`;
}

export function start() {
  render(html`<${App} />`, document.getElementById('app'));
  C.init();
}
