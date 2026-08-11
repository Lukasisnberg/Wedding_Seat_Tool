// Spiegelt exakt das Schema aus supabase/migrations/0001_seating_schema.sql.

export type TableType = "standard" | "head";
export type RuleType = "together" | "apart";

export interface Scenario {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

export interface Guest {
  id: string;
  name: string;
  group_id: string | null;
  note: string;
  deleted_at: string | null;
}

export interface TableRow {
  id: string;
  scenario_id: string;
  label: string;
  type: TableType;
  pos_x: number;
  pos_y: number;
  rotation: number;
  client_id: string | null;
}

export interface Seat {
  id: string;
  table_id: string;
  seat_index: number;
}

export interface Rule {
  id: string;
  type: RuleType;
  guest_a: string;
  guest_b: string;
}

export interface Assignment {
  seat_id: string;
  guest_id: string;
  updated_at: string;
  updated_by: string | null;
  client_id: string | null;
}

// Presence: wer ist online, welchen Gast hat diese Person gerade in der Hand.
// userName kommt erst mit Phase 8 (Supabase Auth) dazu — vorher (Mock ohne
// Login) ist es der lokal gewählte Anzeige-Name.
export interface PresenceState {
  clientId: string;
  color: string;
  userName: string;
  draggingGuestId: string | null;
  draggingGuestName: string | null;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

// Eine Zeile aus assignment_history (siehe Migration 0004). Eine "Aktion"
// (move_guest/swap_guests/unassign_seat) kann mehrere Zeilen erzeugen, die
// über tx_id zusammengehören — siehe lib/history.ts fürs Gruppieren.
export interface AssignmentHistoryEntry {
  id: string;
  tx_id: number;
  guest_id: string;
  seat_id: string | null;
  event: "assigned" | "unassigned";
  changed_at: string;
  changed_by: string | null;
  client_id: string | null;
}

export interface ScenarioSnapshot {
  id: string;
  scenario_id: string;
  name: string;
  created_at: string;
}

// Phase 8: Supabase Auth. AuthUser ist bewusst schlank — nur das, was die
// UI zur Anzeige braucht (Presence, Historie, Logout), keine vollständige
// Kopie des Supabase-Session-Objekts.
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
}

export type AuthStatus = "loading" | "signedOut" | "signedIn";

// Zusammengesetzter Ladezustand einer Szenario-Ansicht — das, was die
// Canvas-Komponenten tatsächlich zum Rendern brauchen.
export interface SeatingData {
  scenario: Scenario;
  tables: TableRow[];
  seats: Seat[];
  guests: Guest[];
  groups: Group[];
  rules: Rule[];
  assignments: Assignment[];
}

export const TABLE_DIMS: Record<TableType, { w: number; h: number }> = {
  standard: { w: 220, h: 90 },
  head: { w: 120, h: 90 }
};

export const SEAT_COUNT: Record<TableType, number> = {
  standard: 8,
  head: 2
};
