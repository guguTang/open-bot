import type { LastActiveSelection, ListFoldState } from "../../types/app-ui";

const STORAGE_SCHEMA_VERSION = 1;

const lastActiveStorageKey = (userId: string) => `openbot_last_active_v${STORAGE_SCHEMA_VERSION}_${userId}`;

export function readLastActiveSelection(userId: string): LastActiveSelection | null {
  try {
    const raw = localStorage.getItem(lastActiveStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastActiveSelection>;
    if ((parsed.kind === "agent" || parsed.kind === "channel") && typeof parsed.id === "string" && parsed.id) {
      return { kind: parsed.kind, id: parsed.id };
    }
  } catch {
    // Ignore malformed or unavailable localStorage entries.
  }
  return null;
}

export function writeLastActiveSelection(userId: string, selection: LastActiveSelection) {
  try {
    localStorage.setItem(lastActiveStorageKey(userId), JSON.stringify(selection));
  } catch {
    // Ignore unavailable localStorage.
  }
}

const listFoldStorageKey = (userId: string) => `openbot_list_fold_v${STORAGE_SCHEMA_VERSION}_${userId}`;

export function readListFoldState(userId: string): ListFoldState {
  try {
    const raw = localStorage.getItem(listFoldStorageKey(userId));
    if (!raw) return { assistantsCollapsed: false, groupsCollapsed: false };
    const parsed = JSON.parse(raw) as Partial<ListFoldState>;
    return {
      assistantsCollapsed: Boolean(parsed.assistantsCollapsed),
      groupsCollapsed: Boolean(parsed.groupsCollapsed),
    };
  } catch {
    return { assistantsCollapsed: false, groupsCollapsed: false };
  }
}

export function writeListFoldState(userId: string, next: ListFoldState) {
  try {
    localStorage.setItem(listFoldStorageKey(userId), JSON.stringify(next));
  } catch {
    // Ignore unavailable localStorage.
  }
}
