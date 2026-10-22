// Google sign-in (Google Identity Services token flow) + minimal Gmail / Drive REST clients.
// Read-only Gmail access. Drive access is limited to the app's own hidden folder (appDataFolder),
// which is used only to sync Done / notes / reminders / settings with the phone app.
import { CLIENT_ID } from './config.js';

export const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
export const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';

export class AuthNeeded extends Error { constructor(m = 'Please sign in with Google') { super(m); this.name = 'AuthNeeded'; } }
export class HistoryExpired extends Error {}

let tokenClient = null;
let token = null;
let tokenExp = 0;
let grantedAppData = false;

// Keep the token for this browser tab session only (never in long-term storage).
try {
  const saved = JSON.parse(sessionStorage.getItem('tlg_token') || 'null');
  if (saved && saved.exp > Date.now() + 60_000) { token = saved.token; tokenExp = saved.exp; grantedAppData = !!saved.appdata; }
} catch { /* storage blocked */ }

const waitForGis = () => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() {
    if (window.google?.accounts?.oauth2) return resolve();
    if (Date.now() - t0 > 15000) return reject(new Error('Google sign-in could not load. Check the internet connection.'));
    setTimeout(poll, 100);
  })();
});

export const isConfigured = () => !!CLIENT_ID;
export const hasToken = () => !!token && tokenExp > Date.now() + 30_000;
export const canSyncState = () => grantedAppData;

/**
 * Opens Google's sign-in / consent popup (must be called from a click).
 * @param hint the Gmail address to pre-select
 */
export async function signIn(hint, forceConsent = false) {
  if (!CLIENT_ID) throw new Error('Website is not set up yet (Google client ID missing in config.js).');
  await waitForGis();
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: `${SCOPE_GMAIL} ${SCOPE_APPDATA}`,
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) return reject(new AuthNeeded(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_GMAIL)) return reject(new AuthNeeded('Gmail permission was not granted.'));
        grantedAppData = google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_APPDATA);
        token = resp.access_token;
        tokenExp = Date.now() + (+resp.expires_in || 3600) * 1000;
        try { sessionStorage.setItem('tlg_token', JSON.stringify({ token, exp: tokenExp, appdata: grantedAppData })); } catch {}
        resolve(token);
      },
      error_callback: (err) => reject(new AuthNeeded(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in was blocked. Allow pop-ups for this site and try again.')),
    });
    tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '', login_hint: hint || undefined });
  });
}

export function getToken() {
  if (hasToken()) return token;
  throw new AuthNeeded('Your Google session ended — click "Continue" to keep syncing.');
}

export function forgetToken() {
  token = null; tokenExp = 0;
  try { sessionStorage.removeItem('tlg_token'); } catch {}
}

export async function revoke() {
  const t = token;
  forgetToken();
  if (t && window.google?.accounts?.oauth2) await new Promise((r) => google.accounts.oauth2.revoke(t, r));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, opts = {}, { historyPath = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getToken()}` } });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    }
    const text = await res.text().catch(() => '');
    if (res.status === 401) { forgetToken(); throw new AuthNeeded(); }
    if (res.status === 404 && historyPath) throw new HistoryExpired();
    if ((res.status === 429 || (res.status === 403 && text.includes('rateLimitExceeded')) || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt); continue;
    }
    throw new Error(`Google API error ${res.status}: ${text.slice(0, 200)}`);
  }
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => u.append(k, x)); else u.append(k, v);
  }
  return u.toString();
};

// ---------------------------------------------------------------- Gmail (read-only)
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function profile() {
  const j = await request(`${GMAIL}/profile`);
  return { email: j.emailAddress, historyId: +(j.historyId || 0) };
}
export async function listMessages(q, pageToken, max = 100) {
  const j = await request(`${GMAIL}/messages?${qs({ q, pageToken, maxResults: max })}`);
  return { refs: (j.messages || []).map((m) => ({ id: m.id, threadId: m.threadId })), next: j.nextPageToken || null };
}
export const getMessage = (id) => request(`${GMAIL}/messages/${id}?format=full`);
export const getThread = (id) => request(`${GMAIL}/threads/${id}?format=full`);
export async function listHistory(startHistoryId, pageToken) {
  const j = await request(`${GMAIL}/history?${qs({ startHistoryId, pageToken, maxResults: 500, historyTypes: ['messageAdded'] })}`, {}, { historyPath: true });
  const out = new Map();
  for (const h of j.history || []) {
    for (const a of h.messagesAdded || []) {
      const labels = a.message.labelIds || [];
      if (['DRAFT', 'CHAT', 'SPAM', 'TRASH'].some((l) => labels.includes(l))) continue;
      out.set(a.message.id, { id: a.message.id, threadId: a.message.threadId });
    }
  }
  return { refs: [...out.values()], historyId: +(j.historyId || startHistoryId), next: j.nextPageToken || null };
}

// ---------------------------------------------------------------- Drive appDataFolder (sync file only)
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const SYNC_FILE = 'tlg-sync.json';

export async function driveFindSyncFiles() {
  const j = await request(`${DRIVE}?${qs({ spaces: 'appDataFolder', q: `name='${SYNC_FILE}' and trashed=false`, fields: 'files(id,modifiedTime)', pageSize: 10 })}`);
  return j.files || [];
}
export const driveDownload = (id) => request(`${DRIVE}/${id}?alt=media`).then((t) => (typeof t === 'string' ? JSON.parse(t || '{}') : t));
export async function driveCreate(obj) {
  const boundary = 'tlg' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'] })}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  return request(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}
export const driveUpdate = (id, obj) =>
  request(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
export const driveDelete = (id) => request(`${DRIVE}/${id}`, { method: 'DELETE' });
