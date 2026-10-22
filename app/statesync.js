// Phone ⇄ laptop sync of YOUR work state (not mail): Done / notes / reminders / manual
// category & priority / settings. Stored as one JSON file in the user's own Google Drive
// hidden app folder. The Android app (sync/StateSync.kt) reads and writes the same format.
//
// File: { schema: 1, threads: { <threadId>: Entry }, config: Config | null }
// Entry:  { u, status, notes, remindAt, reminderNote, categoryKey|null, priority|null, critical, processEpochDay|null }
//         categoryKey / priority / processEpochDay are set only when chosen by hand.
// Config: { u, categories: [...], rules: [...], vips: [...], highNames, highRecipients }
// Merge: per thread, the entry with the newer `u` (edit time, ms) wins; the config is all-or-nothing by `u`.

export const SCHEMA = 1;

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
  };
}

/**
 * @param remote  file contents (may be empty / null)
 * @param localEntries  { threadId: Entry } for every thread the user edited on this device
 * @param localConfig   Config with `u`, or null if never edited here
 * @returns merged file, the remote entries that are newer than this device's (to apply here),
 *          the remote config if newer, and whether the file must be written back.
 */
export function mergeState(remote, localEntries, localConfig) {
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

  return { merged: { schema: SCHEMA, threads, config }, toApply, applyConfig, changed };
}
