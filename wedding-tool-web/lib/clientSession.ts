// Eine pro Browser-Tab generierte Session-ID. Reist mit jeder Mutation mit
// (siehe move_guest/swap_guests/updateTablePosition), damit ein Client sein
// eigenes Realtime-Echo erkennen und ignorieren kann (siehe Migration 0003).
// Bewusst kein Bezug zu echten Nutzern — das kommt erst mit Supabase Auth
// in Phase 8; bis dahin ist "ein Client" gleichbedeutend mit "ein offener Tab".

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Für die Presence-Anzeige: eine von der Session-ID abgeleitete, stabile
// Farbe, damit derselbe Client bei einem Reload wieder dieselbe Farbe hat
// (angenehmer als eine rein zufällige Farbe pro Ladevorgang).
const PRESENCE_COLORS = [
  "#e8a0a0", "#a0c4e8", "#a0e8b8", "#e8d6a0",
  "#c8a0e8", "#e8a0c8", "#a0e8e0", "#d0d0a0"
];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

export const CLIENT_ID = generateId();
export const CLIENT_COLOR = colorForId(CLIENT_ID);
