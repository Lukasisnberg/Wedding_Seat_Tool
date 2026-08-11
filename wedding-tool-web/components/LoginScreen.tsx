"use client";

import { useState } from "react";
import { isMockMode } from "@/lib/getRepository";

interface LoginScreenProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  error: string | null;
}

// Phase 8: kleine, feste Nutzergruppe statt geteiltem Passwort — Accounts
// werden vorab angelegt (z.B. im Supabase-Dashboard), es gibt bewusst
// keine Selbstregistrierung hier.
export function LoginScreen({ onSignIn, error }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSignIn(email, password);
    } catch {
      // Fehler wird bereits über die `error`-Prop angezeigt.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Sitzordnung</h1>
        {isMockMode && (
          <div className="mode-banner">
            Mock-Datenmodus — jede E-Mail/Passwort-Kombination wird akzeptiert, der Teil vor dem „@" wird zum
            Anzeige-Namen.
          </div>
        )}
        <label className="login-field">
          <span>E-Mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="login-field">
          <span>Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Meldet an …" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
