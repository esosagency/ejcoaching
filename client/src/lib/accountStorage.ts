export function accountStorageKey(userId: number | undefined, suffix: string) {
  return `ej-account-${userId && userId > 0 ? userId : "guest"}-${suffix}`;
}
export function readAccountStorage(
  key: string,
  legacyKey?: string,
  migrateOwnerLegacy = false
): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
    if (migrateOwnerLegacy && legacyKey) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        return legacy;
      }
    }
  } catch {
    /* Local storage is optional; the session remains authoritative. */
  }
  return null;
}
