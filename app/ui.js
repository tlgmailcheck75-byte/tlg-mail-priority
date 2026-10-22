// Website screens. Same features as the Android app: Mails overview, What's New, Pending, Folders,
// Reminders, Week plan, mail detail with full conversation, Remind me, OTP beep, and all settings.
import { html, render, useState, useEffect, useRef } from './vendor/preact-htm-3.1.1.js';
import * as C from './core.js';
import * as E from './engine.js';
import * as G from './gmail.js';
import { attachmentNames } from './mime.js';

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
  const icons = (t.otpCode ? '🔑 ' : '') + (t.vipName ? '⭐ ' : '') + (t.remindAt ? '🔔 ' : '');
  const foot = [v.categoryName,
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
      <div class="subject">${t.subject}</div>
      ${t.otpCode
        ? html`<div class="otp">Code: ${t.otpCode}</div>`
        : html`<div class="summary ${t.vipName ? 'long' : ''}">${t.summary.replace(/\n/g, ' ')}</div>`}
      <div class="foot ${v.overdue ? 'err' : ''}">${foot}</div>
    </div>
    ${v.pending && html`<button class="icon-btn done" title="Mark done" onClick=${(e) => { e.stopPropagation(); C.markDone(t.threadId); }}>✓</button>`}
  </div>`;
}

const List = ({ items, selectedId }) => items.map((v) => html`<${MailCard} key=${v.t.threadId} v=${v} selected=${v.t.threadId === selectedId} />`);

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
  if (C.isDemo) return html`<div class="banner gold"><b>Demo mode — sample mail</b><p>This is pretend mail to try the website. Nothing here is real or saved to your account.</p><a class="btn" href="./">Use my Gmail</a></div>`;
  if (!G.isConfigured()) out.push(html`<div class="banner err"><b>Website setup pending</b><p>The Google sign-in client ID is not set in config.js yet.</p></div>`);
  else if (!s.accountEmail) out.push(html`<div class="banner"><b>Sign in with Google</b><p>Read-only access to your Gmail. Your password is entered only on Google's own screen.</p><button class="btn primary" onClick=${C.login}>Sign in with Google</button></div>`);
  else if (state.needsLogin) out.push(html`<div class="banner warn"><b>Continue as ${s.accountEmail}</b><p>For your security, Google sign-in lasts one session. Click to keep checking mail.</p><button class="btn primary" onClick=${C.login}>Continue</button></div>`);
  if (s.accountEmail && state.vips.some((v) => !v.emails)) out.push(html`<div class="banner gold"><b>Set up Mike & April</b><p>Add their email addresses so their mail is always on top.</p><button class="btn" onClick=${() => go('/settings/vips')}>Add addresses</button></div>`);
  return out;
}

// ---------------------------------------------------------------- Mails overview
const FILTERS = [['ALL', 'All'], ['HIGH', '🔴 High'], ['VIP', '⭐ Mike & April'], ['MEDIUM', '🟠 Medium'], ['LOW', '⚪ Low'], ['OTP', '🔑 OTP'], ['DONE', '✓ Done']];
const NEW_WINDOW = 3 * 24 * 3600 * 1000;
const isNew = (v, now) => v.t.unread && v.t.latestAt >= now - NEW_WINDOW;

function matches(v, q) {
  if (!q) return true;
  const t = v.t;
  return [t.subject, t.fromName, t.fromEmail, t.summary, t.notes, v.categoryName].some((x) => (x || '').toLowerCase().includes(q));
}

function MailsView({ selectedId }) {
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState({ m: true, l: false, d: false });
  const views = C.taskViews();
  const q = query.trim().toLowerCase();
  const all = views.filter((v) => matches(v, q));
  const pending = all.filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const done = all.filter((v) => !v.pending).sort((a, b) => b.t.latestAt - a.t.latestAt);
  const endToday = E.msOfEpochDay(state.today + 1);
  const reminders = all.filter((v) => v.t.remindAt && v.t.remindAt < endToday).sort((a, b) => a.t.remindAt - b.t.remindAt);
  const vip = pending.filter((v) => v.t.vipName);
  const by = (p) => pending.filter((v) => v.t.priority === p && !v.t.vipName);
  const now = Date.now();
  const counts = {
    ALL: pending.length, HIGH: pending.filter((v) => v.t.priority === 'HIGH').length, VIP: vip.length,
    MEDIUM: pending.filter((v) => v.t.priority === 'MEDIUM').length, LOW: pending.filter((v) => v.t.priority === 'LOW').length,
    OTP: all.filter((v) => v.t.otpCode).length, DONE: done.length,
  };
  const flat = {
    HIGH: pending.filter((v) => v.t.priority === 'HIGH'),
    VIP: all.filter((v) => v.t.vipName).sort((a, b) => (b.pending - a.pending) || (b.t.latestAt - a.t.latestAt)),
    MEDIUM: pending.filter((v) => v.t.priority === 'MEDIUM'), LOW: pending.filter((v) => v.t.priority === 'LOW'),
    OTP: all.filter((v) => v.t.otpCode).sort((a, b) => b.t.latestAt - a.t.latestAt), DONE: done,
  };
  const toggle = (k) => setOpen({ ...open, [k]: !open[k] });

  return html`<div class="view">
    <input class="search" placeholder="🔍 Search mail" value=${query} onInput=${(e) => setQuery(e.target.value)} />
    <div class="tiles">
      <button class="tile blue" onClick=${() => go('/new')}><b>🆕 ${views.filter((v) => isNew(v, now)).length}</b><span>What's New</span></button>
      <button class="tile amber" onClick=${() => go('/pending')}><b>⏳ ${views.filter((v) => v.pending).length}</b><span>Pending</span></button>
      <button class="tile teal" onClick=${() => go('/folders')}><b>📁 ${new Set(views.map((v) => v.t.categoryKey)).size}</b><span>Folders</span></button>
    </div>
    <div class="chips">${FILTERS.map(([k, l]) => html`<button class="chip ${filter === k ? 'on' : ''}" onClick=${() => setFilter(k)}>${l} ${counts[k]}</button>`)}</div>
    <${Banners} />
    <${SyncLine} />
    ${filter !== 'ALL'
      ? (flat[filter].length ? html`<${List} items=${flat[filter]} selectedId=${selectedId} />` : html`<${Empty} text="Nothing here." />`)
      : html`
        ${reminders.length > 0 && html`<${SectionHead} title="🔔 Reminders for today" count=${reminders.length} cls="tert" /><${List} items=${reminders} selectedId=${selectedId} />`}
        <${SectionHead} title="⭐ Mike & April" count=${vip.length} cls="gold" />
        ${vip.length ? html`<${List} items=${vip} selectedId=${selectedId} />` : html`<${Empty} text="No pending mail from Mike or April." />`}
        <${SectionHead} title="🔴 High priority" count=${by('HIGH').length} cls="p-HIGH" />
        ${by('HIGH').length ? html`<${List} items=${by('HIGH')} selectedId=${selectedId} />` : html`<${Empty} text="Nothing urgent right now 🎉" />`}
        <${SectionHead} title="🟠 Medium priority" count=${by('MEDIUM').length} cls="p-MEDIUM" open=${open.m} onToggle=${() => toggle('m')} />
        ${open.m && html`<${List} items=${by('MEDIUM')} selectedId=${selectedId} />`}
        <${SectionHead} title="⚪ Low priority / info" count=${by('LOW').length} cls="p-LOW" open=${open.l} onToggle=${() => toggle('l')} />
        ${open.l && html`<${List} items=${by('LOW')} selectedId=${selectedId} />`}
        <${SectionHead} title="✓ Done" count=${done.length} cls="muted" open=${open.d} onToggle=${() => toggle('d')} />
        ${open.d && html`<${List} items=${done.slice(0, 100)} selectedId=${selectedId} />`}`}
  </div>`;
}

// ---------------------------------------------------------------- What's New / Pending / Folders / Reminders / Week
function NewView({ selectedId }) {
  const now = Date.now();
  const views = C.taskViews();
  const fresh = views.filter((v) => isNew(v, now)).sort((a, b) => b.t.latestAt - a.t.latestAt);
  const today = views.filter((v) => !isNew(v, now) && v.t.latestAt >= now - 864e5).sort((a, b) => b.t.latestAt - a.t.latestAt);
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
  const pending = C.taskViews().filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const waiting = pending.filter((v) => v.t.status === 'WAITING');
  const active = pending.filter((v) => v.t.status !== 'WAITING');
  const groups = [
    ['⏰ Overdue (past its day)', active.filter((v) => v.overdue), 'err'],
    ['Today', active.filter((v) => !v.overdue && v.t.processEpochDay <= today), ''],
    ['Later this week / next week', active.filter((v) => v.t.processEpochDay > today), 'muted'],
    ["Waiting for someone's reply", waiting, 'tert'],
  ];
  return html`<div class="view">
    <p class="hint">Everything not marked Done yet. Click ✓ when a mail's work is finished.</p>
    ${!pending.length && html`<${Empty} text="Nothing pending. 🎉" />`}
    ${groups.filter(([, l]) => l.length).map(([title, l, cls]) => html`<${SectionHead} title=${title} count=${l.length} cls=${cls} /><${List} items=${l} selectedId=${selectedId} />`)}
  </div>`;
}

function FoldersView() {
  const views = C.taskViews();
  const groups = {};
  for (const c of state.categories.filter((c) => c.enabled !== false)) (groups[c.groupName] ||= []).push(c);
  return html`<div class="view">
    <p class="hint">Every mail is filed automatically into one folder by its category.</p>
    ${Object.entries(groups).map(([g, cats]) => html`<${SectionHead} title=${g} />
      ${cats.map((c) => {
        const list = views.filter((v) => v.t.categoryKey === c.key);
        const p = list.filter((v) => v.pending).length;
        const h = list.filter((v) => v.pending && v.t.priority === 'HIGH').length;
        return html`<div class="card folder" onClick=${() => go(`/folder/${c.key}`)}>
          <span class="ficon">📁</span>
          <div class="grow"><b>${c.name}</b><div class="foot ${h ? 'p-text-HIGH' : ''}">${list.length} mails · ${p} pending${h ? ` · ${h} high` : ''}</div></div>
          <span class="chev">›</span></div>`;
      })}`)}
  </div>`;
}

function FolderView({ catKey, selectedId }) {
  const list = C.taskViews().filter((v) => v.t.categoryKey === catKey);
  const pending = list.filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
  const done = list.filter((v) => !v.pending).sort((a, b) => b.t.latestAt - a.t.latestAt);
  return html`<div class="view">
    <${SectionHead} title="Pending" count=${pending.length} />
    ${pending.length ? html`<${List} items=${pending} selectedId=${selectedId} />` : html`<${Empty} text="Nothing pending in this folder." />`}
    ${done.length > 0 && html`<${SectionHead} title="Done / no action" count=${done.length} cls="muted" /><${List} items=${done.slice(0, 200)} selectedId=${selectedId} />`}
  </div>`;
}

function RemindersView() {
  const now = Date.now();
  const list = C.taskViews().filter((v) => v.t.remindAt).sort((a, b) => a.t.remindAt - b.t.remindAt);
  const card = (v) => html`<div class="card reminder" key=${v.t.threadId} onClick=${() => go(`/mail/${v.t.threadId}`)}>
    <div class="grow"><b class="tert-text">🔔 ${reminderText(v.t.remindAt)}</b>
      ${v.t.reminderNote && html`<div class="note">${v.t.reminderNote}</div>`}
      <div class="subject">${v.t.subject}</div><div class="foot">${v.t.fromName}</div></div>
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
  const pending = C.taskViews().filter((v) => v.pending).sort((a, b) => b.rank - a.rank);
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

function CategoryDialog({ t, onClose }) {
  const [sel, setSel] = useState(t.categoryKey);
  const [always, setAlways] = useState(false);
  return html`<${Modal} title="Change category" onClose=${onClose} actions=${html`<button class="btn text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => { C.setCategory(t.threadId, sel, always); onClose(); }}>Save</button>`}>
    ${state.categories.map((c) => html`<label class="radio"><input type="radio" checked=${sel === c.key} onChange=${() => setSel(c.key)} /> ${c.name}</label>`)}
    <label class="check"><input type="checkbox" checked=${always} onChange=${(e) => setAlways(e.target.checked)} /> Always use this for ${t.fromEmail}</label>
  <//>`;
}

function PriorityDialog({ t, onClose }) {
  const [sel, setSel] = useState(t.priority);
  const [crit, setCrit] = useState(!!t.critical);
  const [always, setAlways] = useState(false);
  return html`<${Modal} title="Change priority" onClose=${onClose} actions=${html`<button class="btn text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => { C.setPriority(t.threadId, sel, crit, always); onClose(); }}>Save</button>`}>
    ${['HIGH', 'MEDIUM', 'LOW'].map((p) => html`<label class="radio p-text-${p}"><input type="radio" checked=${sel === p} onChange=${() => setSel(p)} /> ${PL[p]}</label>`)}
    ${sel === 'HIGH' && html`<label class="check"><input type="checkbox" checked=${crit} onChange=${(e) => setCrit(e.target.checked)} /> Urgent (pin to top)</label>`}
    <label class="check"><input type="checkbox" checked=${always} onChange=${(e) => setAlways(e.target.checked)} /> Always for ${t.fromEmail}</label>
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
      ${m.attachments && html`<div class="foot">📎 ${attachmentNames(m).join(', ')}</div>`}
      <pre class="msg-body">${m.body}</pre>`
    : html`<div class="snippet">${m.snippet}</div>`}
  </div>`;
}

function DetailView({ id, onClose }) {
  const t = state.threads.get(id);
  const [msgs, setMsgs] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [more, setMore] = useState(false);
  const [notes, setNotes] = useState(t?.notes || '');
  const v = C.getVersion();
  useEffect(() => { C.markRead(id); C.loadFullThread(id); setMore(false); }, [id]);
  useEffect(() => { C.messagesOf(id).then(setMsgs); }, [id, v]);
  useEffect(() => setNotes(t?.notes || ''), [id, t?.notes]);
  if (!t) return html`<div class="detail"><${Empty} text="This mail is not on this device yet." /></div>`;
  const cat = state.categories.find((c) => c.key === t.categoryKey);
  const pending = E.isPending(t.status);
  const copy = () => { navigator.clipboard?.writeText(t.otpCode); C.toast('Code copied'); };

  return html`<div class="detail">
    <div class="detail-top">
      ${onClose && html`<button class="btn text" onClick=${onClose}>✕ Close</button>`}
    </div>
    <div class="pills"><${PriorityPill} t=${t} />${t.vipName && html`<${Pill} cls="gold filled" text=${`⭐ ${t.vipName}`} />`}${!pending && html`<${Pill} cls="muted" text=${E.STATUS[t.status].label} />`}</div>
    <h2>${t.subject}</h2>
    <div class="foot">${t.fromName} ${`<${t.fromEmail}>`}</div>
    <div class="foot">${fullTime(t.latestAt)}</div>

    <div class="actions">
      <button class="btn primary" onClick=${() => openInGmail(t.threadId)}>Open in Gmail</button>
      <button class="btn tonal" onClick=${() => setDialog('remind')}>🔔 Remind me</button>
      ${pending ? html`<button class="btn" onClick=${() => C.markDone(t.threadId)}>✓ Mark as done</button>`
        : html`<button class="btn" onClick=${() => C.setStatus(t.threadId, 'TO_DO')}>↺ Reopen</button>`}
    </div>

    ${t.remindAt && html`<div class="card info tert-bg"><div class="grow"><b>🔔 Reminder: ${reminderText(t.remindAt)}</b>${t.reminderNote && html`<div class="foot">${t.reminderNote}</div>`}</div>
      <button class="btn text" onClick=${() => setDialog('remind')}>Change</button><button class="btn text" onClick=${() => C.clearReminder(t.threadId)}>Remove</button></div>`}

    ${t.otpCode && html`<div class="card info otp-card"><div class="grow"><div class="foot">Verification code</div><div class="otp-big">${t.otpCode}</div></div>
      <button class="btn primary" onClick=${copy}>Copy</button></div>`}

    <div class="card info col"><h4>${t.vipName ? `Summary (${t.vipName})` : 'Summary'}</h4><pre class="summary-text">${t.summary}</pre>
      <div class="pri-text small">➜ ${t.suggestedAction}</div></div>

    <div class="card info col"><h4>Conversation (${msgs.length} mail${msgs.length === 1 ? '' : 's'})</h4>
      ${state.loadingThread === id && html`<div class="foot">Loading the full conversation from Gmail…</div>`}
      ${msgs.map((m, i) => html`<${MessageBlock} key=${m.id} m=${m} startOpen=${i === msgs.length - 1 || msgs.length <= 3} />`)}
      ${msgs.length > 1 && html`<div class="foot">Click any mail to open or close it.</div>`}
    </div>

    <button class="btn text" onClick=${() => setMore(!more)}>${more ? 'Hide options ▴' : 'More options (category, priority, notes…) ▾'}</button>
    ${more && html`
      <div class="card info col"><h4>Status</h4><div class="chips wrap">
        ${Object.entries(E.STATUS).map(([k, s]) => html`<button class="chip ${t.status === k ? 'on' : ''}" onClick=${() => C.setStatus(t.threadId, k)}>${s.label}</button>`)}</div></div>
      <div class="card info col"><h4>Classification</h4>
        <div class="kv" onClick=${() => setDialog('cat')}><span>Category</span><span>${cat?.name || 'Other Emails'}</span><span>✎</span></div>
        ${t.tags && html`<div class="kv"><span>Also about</span><span>${t.tags}</span><span></span></div>`}
        <div class="kv" onClick=${() => setDialog('prio')}><span>Priority</span><span>${PL[t.priority]}${t.critical ? ' (urgent)' : ''}</span><span>✎</span></div>
        <div class="kv" onClick=${() => setDialog('day')}><span>Work day</span><span>${dayFmt(t.processEpochDay)}</span><span>✎</span></div>
        ${(t.manualCategory || t.manualPriority || t.manualProcessDay) && html`<button class="btn text" onClick=${() => C.resetAutomatic(t.threadId)}>Reset to automatic</button>`}
        <div class="foot">Why: ${(t.reasons || 'no strong signals').replace(/\n/g, '; ')}</div></div>
      <div class="card info col"><h4>My notes</h4>
        <textarea class="field" rows="4" placeholder="Notes (synced with your phone)" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
        ${notes !== (t.notes || '') && html`<button class="btn" onClick=${() => C.setNotes(t.threadId, notes)}>Save notes</button>`}</div>`}

    ${dialog === 'remind' && html`<${ReminderDialog} t=${t} onClose=${() => setDialog(null)} />`}
    ${dialog === 'cat' && html`<${CategoryDialog} t=${t} onClose=${() => setDialog(null)} />`}
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
  useEffect(() => { setNames(s.highNames); setRcpt(s.highRecipients); }, [s.highNames, s.highRecipients]);
  const notifState = window.Notification ? Notification.permission : 'unsupported';
  return html`<div class="view settings">
    <${Group} title="Google account">
      ${s.accountEmail ? html`
        <p><b>Signed in: ${s.accountEmail}</b></p>
        <p class="small">Gmail access is read-only — this site cannot send, reply, delete or change mail.
          ${G.canSyncState() ? ' Done / notes / reminders / settings sync with your phone app through a hidden app folder in your own Google Drive.' : ' Phone sync is off (Drive app-folder access not allowed).'}</p>
        ${s.lastSyncAt > 0 && html`<p class="small">Last sync: ${fullTime(s.lastSyncAt)}${state.stateSync.lastAt ? ` · phone sync ${shortTime(state.stateSync.lastAt)}` : ''}</p>`}
        ${(s.lastSyncError || state.stateSync.error) && html`<p class="err-text small">Last error: ${s.lastSyncError || state.stateSync.error}</p>`}
        <div class="row"><button class="btn primary" onClick=${() => (G.hasToken() ? C.sync() : C.login())}>Sync now</button>
          <button class="btn" onClick=${() => setConfirm(true)}>Sign out & remove data</button></div>`
      : html`<button class="btn primary" onClick=${C.login}>Sign in with Google</button>`}
    <//>

    <${Group} title="Always High priority">
      <p class="small">Mail that mentions any of these names:</p>
      <input class="field" value=${names} onInput=${(e) => setNames(e.target.value)} placeholder="Devendra, Vikram, Geo" />
      <p class="small">Mail sent directly (To:) to any of these addresses:</p>
      <textarea class="field" rows="2" value=${rcpt} onInput=${(e) => setRcpt(e.target.value)}></textarea>
      <p class="hint">Separate with commas.</p>
      ${(names !== s.highNames || rcpt !== s.highRecipients) && html`<button class="btn primary" onClick=${() => C.saveHighRules(names.trim(), rcpt.trim().toLowerCase())}>Save & re-check all mail</button>`}
    <//>

    <${Group} title="Alerts on this computer">
      <${Toggle} label="🔑 OTP mail: beep-beep sound" value=${s.notifyOtpBeep} onChange=${(v) => C.updateSettings({ notifyOtpBeep: v })} />
      <${Toggle} label="Mike & April (VIP) mail" value=${s.notifyVip} onChange=${(v) => C.updateSettings({ notifyVip: v })} />
      <${Toggle} label="High priority mail" value=${s.notifyHigh} onChange=${(v) => C.updateSettings({ notifyHigh: v })} />
      <${Toggle} label="Medium priority mail" value=${s.notifyMedium} onChange=${(v) => C.updateSettings({ notifyMedium: v })} />
      <div class="row">
        <button class="btn" onClick=${C.beep}>▶ Test beep</button>
        ${notifState !== 'granted' && notifState !== 'unsupported' && html`<button class="btn" onClick=${() => Notification.requestPermission().then(() => C.toast('Thanks!'))}>Allow pop-up notifications</button>`}
      </div>
      <p class="hint">On a computer, alerts and beeps work while this page is open in a browser tab (it checks every 30 seconds). Keep the tab open during work; your phone app alerts you even when closed.</p>
    <//>

    <${Group} title="Work setup">
      <button class="list-btn" onClick=${() => go('/settings/vips')}>⭐ Mike & April (VIP email addresses) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/week')}>This week's work plan (Mon–Sat) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/schedule')}>Weekly TLG schedule (Mon–Sat) <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/categories')}>Categories & keywords <span class="chev">›</span></button>
      <button class="list-btn" onClick=${() => go('/settings/rules')}>My classification rules <span class="chev">›</span></button>
      <button class="btn text" onClick=${() => C.reclassifyAll().then(() => C.toast('All emails re-checked'))}>Re-check all emails now</button>
    <//>

    <${Group} title="Privacy">
      <p class="small">Mail is read straight from Google into this browser and stored only here (IndexedDB). There is no server in between and no AI service. <a href="../privacy.html" target="_blank">Privacy policy</a></p>
    <//>

    ${confirm && html`<${Modal} title="Sign out?" onClose=${() => setConfirm(false)} actions=${html`<button class="btn text" onClick=${() => setConfirm(false)}>Cancel</button>
        <button class="btn primary" onClick=${() => { setConfirm(false); C.logout(); }}>Sign out</button>`}>
      <p>This revokes this website's Google access and deletes downloaded mail from this browser. Your phone app and synced settings are not affected.</p><//>`}
  </div>`;
}

function VipsView() {
  const [edit, setEdit] = useState(null);
  return html`<div class="view">
    <p class="hint">Enter each VIP's exact email address(es), separated by commas. Matching is on the address, not the name.</p>
    ${state.vips.map((v) => html`<div class="card info col clickable" key=${v.id} onClick=${() => setEdit({ ...v })}>
      <b class="gold-text">⭐ ${v.name}</b><div class="small">${v.emails || 'No address yet — click to add'}</div>
      <div class="foot">${v.alwaysHigh !== false ? 'Always High priority' : 'At least Medium priority'}</div></div>`)}
    <button class="btn text" onClick=${() => setEdit({ name: '', emails: '', alwaysHigh: true })}>+ Add VIP</button>
    ${edit && html`<${Modal} title=${edit.id ? `Edit ${edit.name}` : 'Add VIP'} onClose=${() => setEdit(null)} actions=${html`
        ${edit.id && html`<button class="btn text err-text" onClick=${() => { C.deleteVip(edit.id); setEdit(null); }}>Delete</button>`}
        <button class="btn text" onClick=${() => setEdit(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (edit.name.trim()) C.saveVip({ ...edit, name: edit.name.trim(), emails: edit.emails.trim().toLowerCase() }); setEdit(null); }}>Save</button>`}>
      <label>Name</label><input class="field" value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} />
      <label>Email address(es)</label><input class="field" value=${edit.emails} onInput=${(e) => setEdit({ ...edit, emails: e.target.value })} />
      <label class="check"><input type="checkbox" checked=${edit.alwaysHigh !== false} onChange=${(e) => setEdit({ ...edit, alwaysHigh: e.target.checked })} /> Always High priority</label>
    <//>`}
  </div>`;
}

function ScheduleView() {
  const cats = state.categories.filter((c) => c.key !== E.OTHER_KEY);
  const toggle = (c, day, on) => {
    const d = E.parseDays(c.processDays);
    on ? d.add(day) : d.delete(day);
    C.saveCategory({ ...c, processDays: E.formatDays(d) });
  };
  return html`<div class="view">
    <p class="hint">Pick which categories you work on each day. Mail is planned for the next matching day, stays visible as overdue until Done, and urgent mail always goes to the top.</p>
    <div class="table-wrap"><table class="sched"><thead><tr><th>Category</th>${E.WORK_DAYS.map((d) => html`<th>${WD[d]}</th>`)}</tr></thead>
      <tbody>${cats.map((c) => { const days = E.parseDays(c.processDays); return html`<tr><td>${c.name}</td>
        ${E.WORK_DAYS.map((d) => html`<td><input type="checkbox" checked=${days.has(d)} onChange=${(e) => toggle(c, d, e.target.checked)} /></td>`)}</tr>`; })}</tbody></table></div>
  </div>`;
}

function CategoriesView() {
  const [edit, setEdit] = useState(null);
  const [merge, setMerge] = useState(null);
  const groups = {};
  for (const c of state.categories) (groups[c.groupName] ||= []).push(c);
  const isNewCat = edit && !state.categories.some((c) => c.key === edit.key);
  const isOther = edit && edit.key === E.OTHER_KEY;
  const ed = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  return html`<div class="view">
    <p class="hint">Keywords are matched in the subject, body, sender, attachment names and earlier messages. End a word with * to match endings (reconcil* → reconciliation).</p>
    <button class="btn text" onClick=${() => setEdit({ key: 'c' + Date.now(), name: '', groupName: 'Custom', keywords: '', senderHints: '', basePriority: 'MEDIUM', processDays: '', action: '', sortOrder: state.categories.length, enabled: true, builtIn: false })}>+ Add category</button>
    ${Object.entries(groups).map(([g, cs]) => html`<${SectionHead} title=${g} />${cs.map((c) => html`<div class="card info col clickable" key=${c.key} onClick=${() => setEdit({ ...c })}>
      <div class="row-between"><b>${c.name}</b><${Pill} cls=${`p-${c.basePriority}`} text=${PL[c.basePriority]} /></div>
      <div class="foot">Days: ${E.parseDays(c.processDays).size ? E.WORK_DAYS.filter((d) => E.parseDays(c.processDays).has(d)).map((d) => WD[d]).join(', ') : 'any (next working day)'}${c.enabled === false ? ' · disabled' : ''}</div>
      <div class="small muted-text clamp2">${c.keywords}</div></div>`)}`)}
    ${edit && html`<${Modal} title=${isNewCat ? 'New category' : 'Edit category'} onClose=${() => setEdit(null)} actions=${html`
        ${!isNewCat && !isOther && html`<button class="btn text" onClick=${() => { setMerge(edit); setEdit(null); }}>Merge into…</button>
          <button class="btn text err-text" onClick=${() => { C.deleteCategory(edit.key); setEdit(null); }}>Delete</button>`}
        <button class="btn text" onClick=${() => setEdit(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (edit.name.trim()) { C.saveCategory({ ...edit, name: edit.name.trim(), groupName: edit.groupName.trim() || 'Custom', enabled: edit.enabled !== false || isOther }); setEdit(null); } }}>Save</button>`}>
      <label>Name</label><input class="field" value=${edit.name} onInput=${ed('name')} />
      <label>Group</label><input class="field" value=${edit.groupName} onInput=${ed('groupName')} />
      ${!isOther && html`<label>Keywords (comma separated)</label><textarea class="field" rows="4" value=${edit.keywords} onInput=${ed('keywords')}></textarea>
        <label>Sender contains (e.g. bill.com)</label><input class="field" value=${edit.senderHints} onInput=${ed('senderHints')} />`}
      <label>Suggested action</label><textarea class="field" rows="2" value=${edit.action} onInput=${ed('action')}></textarea>
      <label>Base priority</label><div class="chips wrap">${['HIGH', 'MEDIUM', 'LOW'].map((p) => html`<button class="chip ${edit.basePriority === p ? 'on' : ''}" onClick=${() => setEdit({ ...edit, basePriority: p })}>${PL[p]}</button>`)}</div>
      ${!isOther && html`<label>TLG process days</label><div class="chips wrap">${E.WORK_DAYS.map((d) => { const days = E.parseDays(edit.processDays); return html`<button class="chip ${days.has(d) ? 'on' : ''}" onClick=${() => { days.has(d) ? days.delete(d) : days.add(d); setEdit({ ...edit, processDays: E.formatDays(days) }); }}>${WD[d]}</button>`; })}</div>
        <label class="check"><input type="checkbox" checked=${edit.enabled !== false} onChange=${(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>`}
    <//>`}
    ${merge && html`<${Modal} title=${`Merge "${merge.name}" into…`} onClose=${() => setMerge(null)} actions=${html`<button class="btn text" onClick=${() => setMerge(null)}>Cancel</button>`}>
      ${state.categories.filter((c) => c.key !== merge.key).map((c) => html`<button class="list-btn" onClick=${() => { C.mergeCategory(merge.key, c.key); setMerge(null); }}>${c.name}</button>`)}<//>`}
  </div>`;
}

function RulesView() {
  const [add, setAdd] = useState(null);
  const catName = (k) => state.categories.find((c) => c.key === k)?.name || k;
  const rules = [...state.rules].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return html`<div class="view">
    <p class="hint">Rules override keyword matching. They are created when you tick "Always…" while correcting a mail, or add them here. Newest rule wins.</p>
    <button class="btn text" onClick=${() => setAdd({ field: 'FROM', pattern: '', categoryKey: null, priority: null })}>+ Add rule</button>
    ${!rules.length && html`<${Empty} text="No rules yet." />`}
    ${rules.map((r) => html`<div class="card info" key=${r.id}><div class="grow"><div>If ${(r.field || 'ANY').toLowerCase()} contains "${r.pattern}"</div>
      <div class="pri-text small">${[r.categoryKey && `→ ${catName(r.categoryKey)}`, r.priority && `→ ${PL[r.priority]} priority`].filter(Boolean).join('  ')}</div></div>
      <button class="btn text err-text" onClick=${() => C.deleteRule(r.id)}>Delete</button></div>`)}
    ${add && html`<${Modal} title="New rule" onClose=${() => setAdd(null)} actions=${html`<button class="btn text" onClick=${() => setAdd(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => { if (add.pattern.trim() && (add.categoryKey || add.priority)) { C.addRule({ ...add, pattern: add.pattern.trim() }); setAdd(null); } }}>Add</button>`}>
      <div class="chips wrap">${['FROM', 'SUBJECT', 'BODY', 'ANY'].map((f) => html`<button class="chip ${add.field === f ? 'on' : ''}" onClick=${() => setAdd({ ...add, field: f })}>${f.toLowerCase()}</button>`)}</div>
      <input class="field" placeholder="contains…" value=${add.pattern} onInput=${(e) => setAdd({ ...add, pattern: e.target.value })} />
      <label>Category</label><select class="field" value=${add.categoryKey || ''} onChange=${(e) => setAdd({ ...add, categoryKey: e.target.value || null })}>
        <option value="">Unchanged</option>${state.categories.map((c) => html`<option value=${c.key}>${c.name}</option>`)}</select>
      <label>Priority</label><div class="chips wrap"><button class="chip ${!add.priority ? 'on' : ''}" onClick=${() => setAdd({ ...add, priority: null })}>Auto</button>
        ${['HIGH', 'MEDIUM', 'LOW'].map((p) => html`<button class="chip ${add.priority === p ? 'on' : ''}" onClick=${() => setAdd({ ...add, priority: p })}>${PL[p]}</button>`)}</div>
    <//>`}
  </div>`;
}

// ---------------------------------------------------------------- greeting
function Splash({ onDone }) {
  const h = new Date().getHours();
  const [greet, emoji] = h >= 5 && h < 12 ? ['Good Morning', '☀️'] : h < 17 && h >= 12 ? ['Good Afternoon', '🌤️'] : h < 22 && h >= 17 ? ['Good Evening', '✨'] : ['Good Night', '🌙'];
  useEffect(() => { const t = setTimeout(onDone, 2700); return () => clearTimeout(t); }, []);
  const views = C.taskViews().filter((v) => v.pending);
  const high = views.filter((v) => v.t.priority === 'HIGH').length, vip = views.filter((v) => v.t.vipName).length;
  const endToday = E.msOfEpochDay(state.today + 1);
  const rem = C.taskViews().filter((v) => v.t.remindAt && v.t.remindAt < endToday).length;
  const stats = !state.threads.size ? "Let's see what's important today"
    : high + vip + rem === 0 ? 'No urgent mail right now 🎉'
      : [high && `${high} high priority`, vip && `${vip} from Mike & April`, rem && `${rem} reminder${rem > 1 ? 's' : ''} today`].filter(Boolean).join(' · ');
  return html`<div class="splash" onClick=${onDone}>
    <div class="logo-wrap"><div class="ring"></div><img src="icon-fg.svg" class="logo" alt="" /></div>
    <div class="l1">Namaste 🙏</div><div class="l2">${greet} ${emoji}</div><div class="l3">${stats}</div><div class="l4">TLG Mail Priority</div>
  </div>`;
}

// ---------------------------------------------------------------- shell
const NAV = [
  ['/mails', '✉️', 'Mails'], ['/new', '🆕', "What's New"], ['/pending', '⏳', 'Pending'], ['/folders', '📁', 'Folders'],
  ['/reminders', '🔔', 'Reminders'], ['/week', '📅', 'Week plan'], ['/settings', '⚙️', 'Settings'],
];
const MOBILE_NAV = [['/mails', '✉️', 'Mails'], ['/reminders', '🔔', 'Reminders'], ['/settings', '⚙️', 'Settings']];

function titleOf(r) {
  if (r.startsWith('/folder/')) return state.categories.find((c) => c.key === r.slice(8))?.name || 'Folder';
  if (r.startsWith('/mail/')) return 'Mail';
  return ({ '/mails': 'TLG Mail Priority', '/new': "What's New", '/pending': 'Pending', '/folders': 'Folders', '/reminders': 'Reminders',
    '/week': 'Week plan (Mon–Sat)', '/settings': 'Settings', '/settings/vips': 'Mike & April (VIP)', '/settings/schedule': 'Weekly schedule',
    '/settings/categories': 'Categories', '/settings/rules': 'Rules' })[r] || 'TLG Mail Priority';
}

function ListFor({ route, selectedId }) {
  if (route === '/new') return html`<${NewView} selectedId=${selectedId} />`;
  if (route === '/pending') return html`<${PendingView} selectedId=${selectedId} />`;
  if (route === '/folders') return html`<${FoldersView} />`;
  if (route.startsWith('/folder/')) return html`<${FolderView} catKey=${route.slice(8)} selectedId=${selectedId} />`;
  if (route === '/reminders') return html`<${RemindersView} />`;
  if (route === '/week') return html`<${WeekView} selectedId=${selectedId} />`;
  if (route === '/settings') return html`<${SettingsView} />`;
  if (route === '/settings/vips') return html`<${VipsView} />`;
  if (route === '/settings/schedule') return html`<${ScheduleView} />`;
  if (route === '/settings/categories') return html`<${CategoriesView} />`;
  if (route === '/settings/rules') return html`<${RulesView} />`;
  return html`<${MailsView} selectedId=${selectedId} />`;
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
  const navItem = ([r, icon, label]) => html`<a href=${'#' + r} class="nav-item ${listRoute === r || (r !== '/mails' && listRoute.startsWith(r)) ? 'on' : ''}">
    <span class="nav-icon">${icon}${r === '/reminders' && dueRem > 0 && html`<span class="badge">${dueRem}</span>`}</span><span>${label}</span></a>`;

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
    ${wide && html`<nav class="side">${NAV.map(navItem)}</nav>`}
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
