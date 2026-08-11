import type { AuthUser } from "./types";

export interface AuthRepository {
  // Aktuelle Session (oder null) beim ersten Laden abfragen.
  getUser(): Promise<AuthUser | null>;

  // Liefert Änderungen an der Session (Login, Logout, Token-Refresh).
  // Die zurückgegebene Funktion meldet ab.
  onAuthChange(callback: (user: AuthUser | null) => void): () => void;

  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
}
