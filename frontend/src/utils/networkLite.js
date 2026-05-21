const STORAGE_KEY = "siglacast_lite_mode";

export function prefersLiteMode() {
  if (typeof navigator === "undefined") return false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return ["slow-2g", "2g"].includes(String(connection.effectiveType || "").toLowerCase());
}

export function readLiteModePreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch (_) {
    // Ignore storage failures and fall back to network hints.
  }
  return prefersLiteMode();
}

export function writeLiteModePreference(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch (_) {
    // Ignore storage failures.
  }
}
