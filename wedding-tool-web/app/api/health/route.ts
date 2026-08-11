import { NextResponse } from "next/server";

// Health-Check für Coolify (Phase 7). Bewusst nur eine Liveness-Prüfung —
// "läuft der Next.js-Server und kann Antworten ausliefern" — statt einer
// Readiness-Prüfung mit Supabase-Zugriff: ein kurzer Netzwerk-Hänger bei
// Supabase soll nicht dazu führen, dass Coolify den Container neu startet,
// obwohl die App selbst funktionsfähig ist.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
