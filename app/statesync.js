// Phone ⇄ laptop sync of YOUR work state (not mail): Done / notes / reminders / manual
// category & priority / settings. Stored as one JSON file in the user's own Google Drive
// hidden app folder. The Android app (sync/StateSync.kt) reads and writes the same format.
//
// File: { schema: 1, threads: { <threadId>: Entry }, config: Config | null }
// Entry:  { u, status, notes, remindAt, reminderNote, categoryKey|null, priority|null, critical, processEpochDay|null, rv }
//         rv = you cleared "Needs review". File also has mailFromDay (shared first day) and stats {android, web}.
//         categoryKey / priority / processEpochDay are set only when chosen by hand.
// Config: { u, categories: [...], rules: [...], vips: [...], highNames, highRecipients }
// Merge: per thread, the entry with the newer `u` (edit time, ms) wins; the config is all-or-nothing by `u`.

export const SCHEMA = 1;

/** Same thread ids with the same message counts (key order does not matter). */
export function sameThreads(a, b) {
  if (!a || !b) return !a && !b;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && +b[k] === +a[k]);
}

/** Thread ids the other device has that this one lacks, or where it has more messages. */
export function missingFrom(peer, local) {
  if (!peer) return [];
  return Object.keys(peer).filter((id) => (local[id] ?? -1) < +peer[id]);
}

/** A thread task → its sync entry (null if the user never touched it). */
export function entryOf(t) {
  if (!t.userUpdatedAt) return null;
  return {
    u: t.userUpdatedAt,
    status: t.status,
    notes: t.notes || '',
    remindAt: t.remindAt ?? null,
    reminderNote: t.reminderNote ?? null,
    categoryKey: t.manualCategory ? t.categoryKey : null,
    priority: t.manualPriority ? t.priority : null,
    critical: !!(t.manualPriority && t.critical),
    processEpochDay: t.manualProcessDay ? t.processEpochDay : null,
    rv: !!t.reviewDismissed,
  };
}

/**
 * @param remote  file contents (may be empty / null)
 * @param localEntries  { threadId: Entry } for every thread the user edited on this device
 * @param localConfig   Config with `u`, or null if never edited here
 * @returns merged file, the remote entries that are newer than this device's (to apply here),
 *          the remote config if newer, and whether the file must be written back.
 */
export function mergeState(remote, localEntries, localConfig, { device = 'web', stats = null, mailFromDay = 0 } = {}) {
  const r = remote && typeof remote === 'object' ? remote : {};
  const rThreads = r.threads || {};
  const threads = { ...rThreads };
  const toApply = {};
  let changed = !remote || r.schema !== SCHEMA;

  for (const [id, le] of Object.entries(localEntries)) {
    const re = rThreads[id];
    if (!re || le.u > re.u) { threads[id] = le; changed = true; }
  }
  for (const [id, re] of Object.entries(rThreads)) {
    const le = localEntries[id];
    if (!le || re.u > le.u) toApply[id] = re;
  }

  let config = r.config || null;
  let applyConfig = null;
  if (localConfig && (!config || localConfig.u > config.u)) { config = localConfig; changed = true; }
  else if (config && (!localConfig || config.u > localConfig.u)) applyConfig = config;

  // Shared "mail from" day: the earliest day either device downloaded from.
  const remoteFrom = +(r.mailFromDay || 0);
  const froms = [remoteFrom, mailFromDay].filter((x) => x > 0);
  const from = froms.length ? Math.min(...froms) : 0;
  if (from !== remoteFrom) changed = true;

  // Per-device counts for the Phone ⇄ Website check (only this device's entry is written).
  const allStats = { ...(r.stats || {}) };
  if (stats) {
    const prev = allStats[device];
    if (!prev || JSON.stringify(prev.counts) !== JSON.stringify(stats.counts) || prev.total !== stats.total || !sameThreads(prev.threads, stats.threads)) { allStats[device] = stats; changed = true; }
  }
  return { merged: { schema: SCHEMA, threads, config, mailFromDay: from, stats: allStats }, toApply, applyConfig, changed, mailFromDay: from, stats: allStats };
}
