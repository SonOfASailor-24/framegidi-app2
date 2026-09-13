// ============================================================================
// TEMPORARY STORAGE SHIM
// ============================================================================
// The app's storage code (safeGet/safeSet/listKeys) calls window.storage,
// which only exists inside Claude's Artifacts environment. Outside Claude,
// window.storage does not exist at all — without this shim, every save/load
// in the app would throw and the screen would stay blank/broken.
//
// This shim makes window.storage work using the browser's localStorage, so
// the app is functional for local testing and single-device use.
//
// IMPORTANT — THIS IS NOT REAL SHARED STORAGE:
//   - Data is stored ONLY in this one browser, on this one device.
//   - Two phones/devices will NOT see each other's jobs, inventory, etc.
//   - This does not survive clearing browser data.
//   - This is a stopgap so the app runs and can be tested, not a production
//     backend. For real multi-device shared storage (the actual V8
//     requirement), this needs to be replaced with a Supabase-backed
//     implementation with the same function shapes below.
// ============================================================================

if (typeof window !== "undefined" && !window.storage) {
  const PREFIX = "framegidi:";

  window.storage = {
    async get(key /*, shared */) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return null;
        return { key, value: raw, shared: false };
      } catch (e) {
        throw new Error("Storage get failed: " + e.message);
      }
    },

    async set(key, value /*, shared */) {
      try {
        localStorage.setItem(PREFIX + key, value);
        return { key, value, shared: false };
      } catch (e) {
        throw new Error("Storage set failed: " + e.message);
      }
    },

    async delete(key /*, shared */) {
      try {
        const existed = localStorage.getItem(PREFIX + key) !== null;
        localStorage.removeItem(PREFIX + key);
        return { key, deleted: existed, shared: false };
      } catch (e) {
        throw new Error("Storage delete failed: " + e.message);
      }
    },

    async list(prefix = "" /*, shared */) {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const fullKey = localStorage.key(i);
          if (fullKey && fullKey.startsWith(PREFIX)) {
            const bareKey = fullKey.slice(PREFIX.length);
            if (bareKey.startsWith(prefix)) keys.push(bareKey);
          }
        }
        return { keys, prefix, shared: false };
      } catch (e) {
        throw new Error("Storage list failed: " + e.message);
      }
    },
  };

  console.warn(
    "[FrameGidi] Using a local-only storage shim (localStorage). " +
    "Data will NOT sync across devices. See src/storageShim.js for details " +
    "on migrating to real shared storage (e.g. Supabase)."
  );
}
