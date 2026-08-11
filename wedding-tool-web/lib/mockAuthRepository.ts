import type { AuthRepository } from "./authRepository";
import type { AuthUser } from "./types";

// Mock-Login für den Datei-losen Entwicklungsmodus (kein echtes Supabase,
// siehe mockRepository.ts) — es gibt kein Backend, das ein Passwort prüfen
// könnte. Jede E-Mail/Passwort-Kombination wird akzeptiert (nur auf
// "nicht leer" geprüft, für ein realistisches Formulargefühl), der
// Anzeige-Name ist der Teil vor dem "@". Pro Browser-Tab in sessionStorage
// gemerkt, damit ein Reload nicht wieder zum Login-Screen zurückspringt,
// aber ein neuer Tab sich wie ein neuer "Login" anfühlt — passend zu
// CLIENT_ID, das ebenfalls pro Tab neu vergeben wird.

const STORAGE_KEY = "sitzplan-mock-user";

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

function writeStoredUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  if (user) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else window.sessionStorage.removeItem(STORAGE_KEY);
}

let idCounter = 0;
function genMockUserId() {
  return `mock-user-${Date.now()}-${++idCounter}`;
}

const listeners = new Set<(user: AuthUser | null) => void>();

export function createMockAuthRepository(): AuthRepository {
  return {
    async getUser() {
      return readStoredUser();
    },

    onAuthChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    async signInWithPassword(email, password) {
      if (!email.trim() || !password.trim()) {
        throw new Error("E-Mail und Passwort dürfen nicht leer sein.");
      }
      const existing = readStoredUser();
      const user: AuthUser = {
        id: existing?.email === email ? existing.id : genMockUserId(),
        email,
        displayName: email.split("@")[0]
      };
      writeStoredUser(user);
      listeners.forEach((fn) => fn(user));
    },

    async signOut() {
      writeStoredUser(null);
      listeners.forEach((fn) => fn(null));
    },

    async updateDisplayName(name) {
      const current = readStoredUser();
      if (!current) return;
      const updated = { ...current, displayName: name };
      writeStoredUser(updated);
      listeners.forEach((fn) => fn(updated));
    }
  };
}
