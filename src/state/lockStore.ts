import { create } from "zustand";

/** Privacy lock: hides the Fleet page and the Assistant behind a password.
 * This is a UI gate against casual use of a shared screen, not a security
 * boundary — the salted hash lives in localStorage and anyone with dev-tools
 * access can clear it. */

const HASH_KEY = "flux.lock.hash"; // "salt:sha256hex"
const LOCKED_KEY = "flux.lock.on";
const SEEDED_KEY = "flux.lock.seeded";

/** Ships locked: first run seeds the factory password "Admin@123#"
 * (documented in packaging/README.md) and engages the lock. SEEDED_KEY
 * makes this one-time — removing the password later must stick across
 * restarts. Factory default is public knowledge; users should replace it. */
const DEFAULT_HASH =
  "9f2c41d8a6e05b73:db36a0a7670da4439bb9f6bc81ff0fd05917814f3fc0e9dc09154ee71f930285";

if (localStorage.getItem(SEEDED_KEY) === null) {
  localStorage.setItem(HASH_KEY, DEFAULT_HASH);
  localStorage.setItem(LOCKED_KEY, "1");
  localStorage.setItem(SEEDED_KEY, "1");
}

async function digest(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verify(stored: string, password: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  return (await digest(salt, password)) === hex;
}

async function makeHash(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${await digest(salt, password)}`;
}

interface LockState {
  /** null = no password configured, lock feature off. */
  hash: string | null;
  locked: boolean;
  /** Sets a new password and engages the lock. */
  setPassword: (password: string) => Promise<void>;
  lock: () => void;
  /** Returns false on wrong password. */
  unlock: (password: string) => Promise<boolean>;
  /** Replaces the password — requires the current one. The lock always
   * keeps a password; there is no way to remove it from the UI. */
  changePassword: (current: string, next: string) => Promise<boolean>;
}

export const useLockStore = create<LockState>((set, get) => ({
  hash: localStorage.getItem(HASH_KEY),
  locked:
    localStorage.getItem(LOCKED_KEY) === "1" && localStorage.getItem(HASH_KEY) !== null,

  setPassword: async (password) => {
    const hash = await makeHash(password);
    localStorage.setItem(HASH_KEY, hash);
    localStorage.setItem(LOCKED_KEY, "1");
    set({ hash, locked: true });
  },

  lock: () => {
    if (!get().hash) return;
    localStorage.setItem(LOCKED_KEY, "1");
    set({ locked: true });
  },

  unlock: async (password) => {
    const { hash } = get();
    if (!hash || !(await verify(hash, password))) return false;
    localStorage.setItem(LOCKED_KEY, "0");
    set({ locked: false });
    return true;
  },

  changePassword: async (current, next) => {
    const { hash } = get();
    if (!hash || !(await verify(hash, current))) return false;
    // Keeps the current locked/unlocked state — resetting the password
    // while unlocked must not re-engage the lock.
    const newHash = await makeHash(next);
    localStorage.setItem(HASH_KEY, newHash);
    set({ hash: newHash });
    return true;
  },
}));
