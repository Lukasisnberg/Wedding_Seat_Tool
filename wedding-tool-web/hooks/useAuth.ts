"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthRepository } from "@/lib/getAuthRepository";
import type { AuthStatus, AuthUser } from "@/lib/types";

export function useAuth() {
  const repo = useMemo(() => getAuthRepository(), []);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo.getUser().then((u) => {
      if (cancelled) return;
      setUser(u);
      setStatus(u ? "signedIn" : "signedOut");
    });
    const unsubscribe = repo.onAuthChange((u) => {
      setUser(u);
      setStatus(u ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repo]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        await repo.signInWithPassword(email, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
        throw err;
      }
    },
    [repo]
  );

  const signOut = useCallback(() => repo.signOut(), [repo]);
  const updateDisplayName = useCallback((name: string) => repo.updateDisplayName(name), [repo]);

  return { status, user, error, signIn, signOut, updateDisplayName };
}
