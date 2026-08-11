export class SeatingError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SeatingError";
    this.code = code;
  }
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  SEAT_TAKEN: "Der Platz wurde gerade von jemand anderem belegt.",
  NOT_SEATED: "Beide Gäste müssen aktuell einen Platz haben, um zu tauschen.",
  GUEST_NOT_FOUND: "Dieser Gast existiert nicht mehr.",
  SEAT_NOT_FOUND: "Dieser Platz existiert nicht.",
  SAME_GUEST: "Ein Gast kann nicht mit sich selbst tauschen.",
  LOGIN_FAILED: "E-Mail oder Passwort falsch."
};

// Die RPCs kodieren ihren Fehlergrund als Präfix in der Message
// ("SEAT_TAKEN: ..."), weil Postgres/PostgREST keinen eigenen Fehlercode
// pro RAISE EXCEPTION durchreicht, den man bequem clientseitig matchen
// könnte. Wir extrahieren das Präfix hier an einer Stelle.
export function toSeatingError(raw: { message?: string; code?: string } | null | undefined): SeatingError {
  const message = raw?.message ?? "Unbekannter Fehler.";
  const match = message.match(/^([A-Z_]+):\s*(.*)$/);
  if (match) {
    const [, code, rest] = match;
    return new SeatingError(FRIENDLY_MESSAGES[code] ?? rest, code);
  }
  return new SeatingError(FRIENDLY_MESSAGES[raw?.code ?? ""] ?? message, raw?.code ?? "UNKNOWN");
}
