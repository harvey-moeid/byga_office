// Browser privacy settings can deny storage without denying WebGL.
// Preferences are optional; a blocked store must never take down the office.
export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the selected value in React state for this visit.
  }
}
