import {openDraftStore} from './playground_autosave.js?v=opn-modes-1';

const HANDOFF_VERSION = 1;
const projectKey = token => `mode-project:${token}`;

/** Keep the current project across a mode reload, including imported binary files. */
export async function saveModeProject(indexedDB, targetModeId, snapshot) {
  const token = crypto.randomUUID();
  const store = await openDraftStore(indexedDB, projectKey(token));
  try {
    await store.save({version: HANDOFF_VERSION, targetModeId, snapshot});
    return token;
  } finally {
    store.close();
  }
}

/** A handoff belongs to its selected mode and can be consumed once. */
export async function consumeModeProject(indexedDB, targetModeId, token) {
  if (typeof token !== 'string' || !token) return null;
  const store = await openDraftStore(indexedDB, projectKey(token));
  try {
    const handoff = await store.load();
    if (handoff?.version !== HANDOFF_VERSION || handoff.targetModeId !== targetModeId ||
        !handoff.snapshot || handoff.snapshot.version !== 1) return null;
    await store.remove();
    return handoff.snapshot;
  } finally {
    store.close();
  }
}
