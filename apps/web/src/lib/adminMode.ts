export const ADMIN_MODE_STORAGE_KEY = "olly.adminModeEnabled";
const ADMIN_MODE_EVENT = "olly:adminModeEnabled";

export function getAdminModeEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(ADMIN_MODE_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function setAdminModeEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ADMIN_MODE_STORAGE_KEY,
      enabled ? "true" : "false",
    );
    window.dispatchEvent(
      new CustomEvent(ADMIN_MODE_EVENT, { detail: { enabled } }),
    );
  } catch {
    // ignore
  }
}

export function subscribeAdminModeEnabled(cb: (enabled: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const customHandler = (e: Event) => {
    const detail = (e as CustomEvent<{ enabled?: boolean }>).detail;
    if (typeof detail?.enabled === "boolean") {
      cb(detail.enabled);
      return;
    }
    cb(getAdminModeEnabled());
  };
  const handler = (e: StorageEvent) => {
    if (e.key !== ADMIN_MODE_STORAGE_KEY) return;
    cb(getAdminModeEnabled());
  };
  window.addEventListener("storage", handler);
  window.addEventListener(ADMIN_MODE_EVENT, customHandler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(ADMIN_MODE_EVENT, customHandler);
  };
}
