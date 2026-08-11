// Eine pro Browser-Tab generierte Session-ID. Reist mit jeder Mutation mit
// (siehe move_guest/swap_guests/updateTablePosition), damit ein Client sein
// eigenes Realtime-Echo erkennen und ignorieren kann (siehe Migration 0003).
// Bewusst kein Bezug zu echten Nutzern — das kommt erst mit Supabase Auth
// in Phase 8; bis dahin ist "ein Client" gleichbedeutend mit "ein offener Tab".

// WICHTIG: das Ergebnis muss immer wie eine echte UUID aussehen — CLIENT_ID
// landet als `uuid`-Parameter/Spalte in der DB (move_guest(p_client_id
// uuid, ...), assignments.client_id, scenario_snapshots-Restore usw.).
// `crypto.randomUUID()` gibt es aber nur in sicheren Kontexten (HTTPS oder
// localhost) — über einfaches HTTP (z.B. eine sslip.io-IP ohne TLS) ist es
// schlicht nicht vorhanden. Der alte Fallback erzeugte dann einen
// `Date.now()-random`-String statt einer UUID, den Postgres mit
// "22P02: invalid input syntax for type uuid" ablehnte — jede Mutation
// (Sitzplatz setzen, Tisch verschieben, Snapshot laden, Undo, …) schlug
// dadurch still fehl. Auf localhost (=sicherer Kontext) trat der Bug nie
// auf, weshalb er beim lokalen Testen nicht auffiel.
// `crypto.getRandomValues()` ist dagegen auch über HTTP verfügbar und
// reicht, um von Hand eine spezifikationskonforme UUID v4 zu bauen.
function generateId(): string {
  // typeof-Check statt `in`-Operator: TS deklariert randomUUID als immer
  // vorhanden auf Crypto (die SecureContext-Einschränkung aus der Web-IDL-
  // Spec ist in lib.dom.d.ts nicht abgebildet) und würde bei einer
  // `"randomUUID" in crypto`-Prüfung den else-Zweig fälschlich auf `never`
  // schmälern, weil es die Existenz für garantiert hält — obwohl sie es
  // über HTTP zur Laufzeit gerade nicht ist.
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Letzter Notfall-Fallback (in der Praxis unerreichbar — getRandomValues
  // ist praktisch überall verfügbar), muss aus demselben Grund trotzdem wie
  // eine UUID aussehen.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
