import { supabase } from "./supabase";
import { toSeatingError } from "./errors";
import type { AuthRepository } from "./authRepository";
import type { AuthUser } from "./types";
import type { User } from "@supabase/supabase-js";

// Holt den Anzeige-Namen aus `profiles` (siehe Migration 0005). Die Zeile
// existiert immer schon (Trigger legt sie bei Account-Anlage an) — ein
// fehlender Eintrag wäre ein Datenfehler, kein normaler Zustand, deshalb
// hier ein simpler Fallback auf die E-Mail statt eines harten Fehlers.
async function toAuthUser(client: NonNullable<typeof supabase>, user: User): Promise<AuthUser> {
  const { data } = await client.from("profiles").select("display_name").eq("id", user.id).single();
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: data?.display_name ?? user.email ?? "Unbekannt"
  };
}

export function createSupabaseAuthRepository(): AuthRepository {
  if (!supabase) {
    throw new Error("createSupabaseAuthRepository() ohne konfigurierten Supabase-Client aufgerufen.");
  }
  const client = supabase;

  return {
    async getUser() {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      return user ? toAuthUser(client, user) : null;
    },

    onAuthChange(callback) {
      const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          toAuthUser(client, session.user).then(callback);
        } else {
          callback(null);
        }
      });
      return () => subscription.subscription.unsubscribe();
    },

    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw toSeatingError({ message: `LOGIN_FAILED: ${error.message}` });
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw toSeatingError(error);
    },

    async updateDisplayName(name) {
      const { data } = await client.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) return;
      const { error } = await client.from("profiles").update({ display_name: name }).eq("id", userId);
      if (error) throw toSeatingError(error);
    }
  };
}
