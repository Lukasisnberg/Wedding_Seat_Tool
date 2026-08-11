import type {
  Assignment,
  AssignmentHistoryEntry,
  ConnectionStatus,
  PresenceState,
  ScenarioSnapshot,
  SeatingData,
  TableRow
} from "./types";

export interface DataChangeCallbacks {
  onAssignmentChange: (assignment: Assignment, kind: "upsert" | "delete") => void;
  onTableChange: (table: TableRow) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  // Grobe "etwas Größeres hat sich geändert"-Benachrichtigung für Vorgänge,
  // die nicht granular über postgres_changes verfolgt werden (Snapshot-
  // Restore, Gast-Löschung) — siehe Kommentar in supabaseRepository.ts.
  onRefreshNeeded: () => void;
}

export interface SeatingRepository {
  loadScenario(): Promise<SeatingData>;
  moveGuest(guestId: string, targetSeatId: string): Promise<void>;
  swapGuests(guestA: string, guestB: string): Promise<void>;
  unassignSeat(seatId: string): Promise<void>;
  updateTablePosition(tableId: string, posX: number, posY: number, rotation: number): Promise<void>;

  // Phase 6: Sicherheitsnetz
  undoLastAction(): Promise<void>;
  softDeleteGuest(guestId: string): Promise<void>;
  loadHistory(scenarioId: string, limit?: number): Promise<AssignmentHistoryEntry[]>;
  listSnapshots(scenarioId: string): Promise<ScenarioSnapshot[]>;
  createSnapshot(scenarioId: string, name: string): Promise<void>;
  restoreSnapshot(snapshotId: string): Promise<void>;
  deleteSnapshot(snapshotId: string): Promise<void>;

  // Realtime: liefert laufende Änderungen anderer Clients, bis die
  // zurückgegebene Funktion aufgerufen wird (Unsubscribe).
  subscribeToChanges(callbacks: DataChangeCallbacks): () => void;

  // Presence: eigenen Zustand veröffentlichen (z.B. "ziehe Guest X gerade")
  // und über den Zustand anderer Clients informiert werden. Muss VOR dem
  // ersten subscribeToPresence-Aufruf gesetzt sein, sobald der angemeldete
  // Nutzer bekannt ist (Phase 8) — sonst würde die erste Presence-Meldung
  // noch ohne echten Namen rausgehen.
  setPresenceIdentity(userId: string, displayName: string): void;
  subscribeToPresence(onUpdate: (others: PresenceState[]) => void): () => void;
  updateOwnPresence(draggingGuestId: string | null, draggingGuestName: string | null): void;

  // Phase 8: Anzeige-Namen für assignment_history.changed_by auflösen.
  loadProfiles(): Promise<Record<string, string>>;
}
