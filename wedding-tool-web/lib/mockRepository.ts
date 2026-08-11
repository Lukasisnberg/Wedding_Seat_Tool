import { SeatingError } from "./errors";
import { CLIENT_ID, CLIENT_COLOR } from "./clientSession";
import type { DataChangeCallbacks, SeatingRepository } from "./repository";
import type {
  Assignment,
  AssignmentHistoryEntry,
  ConnectionStatus,
  Guest,
  Group,
  PresenceState,
  Rule,
  Scenario,
  ScenarioSnapshot,
  Seat,
  SeatingData,
  TableRow
} from "./types";
import { SEAT_COUNT } from "./types";

// In-Memory-Stand-in für die echte Supabase-Anbindung, aktiv wenn keine
// Projekt-Credentials in .env.local stehen (siehe lib/supabase.ts). Bildet
// dieselben Constraints wie das DB-Schema nach (ein Sitz hat höchstens
// einen Gast, ein Gast höchstens einen Sitz), damit sich Drag-and-Drop,
// Optimistic UI und der Rollback-Pfad hier realistisch testen lassen.
//
// SEAT_ALWAYS_TAKEN simuliert absichtlich eine Race Condition: der Platz
// gilt lokal als frei (kein Eintrag in `assignments`), move_guest schlägt
// dort aber immer mit SEAT_TAKEN fehl — so, als hätte ihn eine andere
// Person im selben Moment belegt. Zieh testweise einen Gast auf "Tisch 2 /
// Platz 1", um den Rollback zu sehen.
//
// Realtime/Presence werden über die native BroadcastChannel-API zwischen
// Browser-Tabs derselben Origin simuliert (kein echtes Backend nötig) —
// zwei Tabs mit http://localhost:3000 offen synchronisieren sich dadurch
// tatsächlich live, inklusive Presence und (simuliertem) Verbindungsstatus.

const now = () => new Date().toISOString();

function seedScenario(): Scenario {
  return { id: "scn-1", name: "Hauptplan", created_at: now(), updated_at: now() };
}

function seedGroups(): Group[] {
  return [
    { id: "grp-braut", name: "Familie Braut", color: "#e8a0a0" },
    { id: "grp-groom", name: "Familie Bräutigam", color: "#a0c4e8" },
    { id: "grp-friends", name: "Freunde", color: "#a0e8b8" }
  ];
}

function seedGuests(): Guest[] {
  const names: [string, string][] = [
    ["Anna Beispiel", "grp-braut"],
    ["Bernd Beispiel", "grp-braut"],
    ["Clara Muster", "grp-groom"],
    ["David Muster", "grp-groom"],
    ["Eva Freundin", "grp-friends"],
    ["Frank Freund", "grp-friends"],
    ["Greta Braut", "grp-braut"],
    ["Hans Bräutigam", "grp-groom"],
    ["Ida Freundin", "grp-friends"],
    ["Jonas Freund", "grp-friends"],
    ["Klara Braut", "grp-braut"],
    ["Leo Bräutigam", "grp-groom"]
  ];
  return names.map(([name, group_id], i) => ({
    id: `guest-${i + 1}`,
    name,
    group_id,
    note: "",
    deleted_at: null
  }));
}

function seedTables(): TableRow[] {
  return [
    { id: "table-head", scenario_id: "scn-1", label: "Brautpaar", type: "head", pos_x: 500, pos_y: 120, rotation: 0, client_id: null },
    { id: "table-1", scenario_id: "scn-1", label: "Tisch 1", type: "standard", pos_x: 380, pos_y: 320, rotation: 90, client_id: null },
    { id: "table-2", scenario_id: "scn-1", label: "Tisch 2", type: "standard", pos_x: 620, pos_y: 320, rotation: 90, client_id: null }
  ];
}

function seedSeats(tables: TableRow[]) {
  const seats = [];
  for (const table of tables) {
    const count = SEAT_COUNT[table.type];
    for (let i = 0; i < count; i++) {
      seats.push({ id: `${table.id}-seat-${i}`, table_id: table.id, seat_index: i });
    }
  }
  return seats;
}

function seedAssignments(): Assignment[] {
  return [
    { seat_id: "table-1-seat-0", guest_id: "guest-1", updated_at: now(), updated_by: null, client_id: null },
    { seat_id: "table-1-seat-1", guest_id: "guest-2", updated_at: now(), updated_by: null, client_id: null }
  ];
}

function seedRules(): Rule[] {
  return [{ id: "rule-1", type: "apart", guest_a: "guest-3", guest_b: "guest-4" }];
}

export const MOCK_CONFLICT_SEAT_ID = "table-2-seat-1";

// Interne Erweiterung von AssignmentHistoryEntry um `undone` (Phase 6) — nur
// mock-intern relevant fürs Undo, siehe undo_last_action in Migration 0004
// für das echte Pendant. tx_id gruppiert alle Einträge EINER Aktion (move/
// swap/unassign), genau wie dort.
interface MockHistoryEntry extends AssignmentHistoryEntry {
  undone: boolean;
}

interface MockSnapshot {
  id: string;
  scenario_id: string;
  name: string;
  created_at: string;
  tables: TableRow[];
  seats: Seat[];
  assignments: Assignment[];
}

class MockStore {
  scenario = seedScenario();
  groups = seedGroups();
  guests = seedGuests();
  tables = seedTables();
  seats = seedSeats(seedTables());
  assignments = seedAssignments();
  rules = seedRules();
  history: MockHistoryEntry[] = [];
  snapshots: MockSnapshot[] = [];
}

const store = new MockStore();

let idCounter = 0;
function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

let txCounter = 0;

// Phase 8: vom angemeldeten (Mock-)Nutzer gesetzt, sobald bekannt (siehe
// setPresenceIdentity unten) — entspricht auth.uid() in der echten DB,
// nur ohne echte Session dahinter.
let identityUserId: string | null = null;
let presenceUserName = "…";

function logHistory(guestId: string, seatId: string | null, event: "assigned" | "unassigned", txId: number, clientId: string) {
  store.history.push({
    id: genId("hist"),
    tx_id: txId,
    guest_id: guestId,
    seat_id: seatId,
    event,
    changed_at: now(),
    changed_by: identityUserId,
    client_id: clientId,
    undone: false
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- cross-tab simulation ----

type SyncMessage =
  | { kind: "assignment-upsert"; clientId: string; assignment: Assignment }
  | { kind: "assignment-delete"; clientId: string; seatId: string }
  | { kind: "table-update"; clientId: string; table: TableRow }
  | { kind: "presence"; clientId: string; state: PresenceState | null }
  | { kind: "presence-request"; clientId: string }
  | { kind: "presence-leave"; clientId: string }
  // Phase 6: seltene Bulk-Umbauten (Gast löschen, Snapshot laden). Der Mock
  // hat kein gemeinsames Backend, das ein anderer Tab einfach nachladen
  // könnte (siehe Kommentar oben, "kein echtes Backend nötig") — deshalb
  // wird hier der volle neue Zustand mitgeschickt statt nur eines "lad
  // neu"-Signals wie beim echten Supabase-Repository.
  | { kind: "guests-replace"; clientId: string; guests: Guest[] }
  | { kind: "scenario-replace"; clientId: string; tables: TableRow[]; seats: Seat[]; assignments: Assignment[] };

const syncChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sitzplan-mock-sync") : null;

// Wird nachgehalten, damit ein neu beigetretener Tab per "presence-request"
// den aktuellen Stand abfragen kann — echtes Supabase Presence liefert das
// automatisch über sein "sync"-Event, das muss hier von Hand nachgebaut werden.
let ownPresenceState: PresenceState | null = null;
if (syncChannel) {
  syncChannel.addEventListener("message", (event: MessageEvent<SyncMessage>) => {
    if (event.data.kind === "presence-request" && event.data.clientId !== CLIENT_ID && ownPresenceState) {
      syncChannel.postMessage({ kind: "presence", clientId: CLIENT_ID, state: ownPresenceState } satisfies SyncMessage);
    }
  });
}

// Echtes Supabase Presence löst beim Verbindungsabbruch serverseitig ein
// "leave"-Event für andere Clients aus. BroadcastChannel weiß nichts vom
// Schließen eines Tabs — ohne diesen Hook blieben Geister-Einträge in den
// anderen Tabs zurück, bis diese selbst neu geladen werden.
if (typeof window !== "undefined" && syncChannel) {
  window.addEventListener("pagehide", () => {
    syncChannel.postMessage({ kind: "presence-leave", clientId: CLIENT_ID } satisfies SyncMessage);
  });
}

// Dev-only Schalter, um den Verbindungsstatus-Banner ohne echtes Netzwerk
// testen zu können (siehe mode-banner in app/page.tsx).
let mockConnected = true;
const statusListeners = new Set<(status: ConnectionStatus) => void>();

export function setMockConnected(connected: boolean) {
  mockConnected = connected;
  statusListeners.forEach((fn) => fn(connected ? "connected" : "disconnected"));
}

export function isMockConnected() {
  return mockConnected;
}

export function createMockRepository(): SeatingRepository {
  return {
    async loadScenario(): Promise<SeatingData> {
      await delay(150);
      return {
        scenario: store.scenario,
        tables: [...store.tables],
        seats: [...store.seats],
        // Wie supabaseRepository.ts (`.is("deleted_at", null)`): weiche
        // gelöschte Gäste tauchen nicht mehr in der aktiven Ansicht auf.
        guests: store.guests.filter((g) => !g.deleted_at),
        groups: [...store.groups],
        rules: [...store.rules],
        assignments: [...store.assignments]
      };
    },

    async moveGuest(guestId, targetSeatId) {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(250);
      if (targetSeatId === MOCK_CONFLICT_SEAT_ID) {
        throw new SeatingError("Der Platz wurde gerade von jemand anderem belegt.", "SEAT_TAKEN");
      }
      const targetTaken = store.assignments.some((a) => a.seat_id === targetSeatId);
      if (targetTaken) {
        throw new SeatingError("Der Platz wurde gerade von jemand anderem belegt.", "SEAT_TAKEN");
      }
      const txId = ++txCounter;
      const previous = store.assignments.find((a) => a.guest_id === guestId);
      if (previous) logHistory(guestId, previous.seat_id, "unassigned", txId, CLIENT_ID);
      store.assignments = store.assignments.filter((a) => a.guest_id !== guestId);
      const assignment: Assignment = { seat_id: targetSeatId, guest_id: guestId, updated_at: now(), updated_by: null, client_id: CLIENT_ID };
      store.assignments.push(assignment);
      logHistory(guestId, targetSeatId, "assigned", txId, CLIENT_ID);
      syncChannel?.postMessage({ kind: "assignment-upsert", clientId: CLIENT_ID, assignment } satisfies SyncMessage);
    },

    async swapGuests(guestA, guestB) {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(250);
      const a = store.assignments.find((x) => x.guest_id === guestA);
      const b = store.assignments.find((x) => x.guest_id === guestB);
      if (!a || !b) {
        throw new SeatingError("Beide Gäste müssen aktuell einen Platz haben, um zu tauschen.", "NOT_SEATED");
      }
      const txId = ++txCounter;
      const seatA = a.seat_id;
      const seatB = b.seat_id;
      logHistory(guestA, seatA, "unassigned", txId, CLIENT_ID);
      logHistory(guestB, seatB, "unassigned", txId, CLIENT_ID);
      a.seat_id = seatB;
      b.seat_id = seatA;
      a.updated_at = now();
      b.updated_at = now();
      a.client_id = CLIENT_ID;
      b.client_id = CLIENT_ID;
      logHistory(guestA, seatB, "assigned", txId, CLIENT_ID);
      logHistory(guestB, seatA, "assigned", txId, CLIENT_ID);
      syncChannel?.postMessage({ kind: "assignment-upsert", clientId: CLIENT_ID, assignment: a } satisfies SyncMessage);
      syncChannel?.postMessage({ kind: "assignment-upsert", clientId: CLIENT_ID, assignment: b } satisfies SyncMessage);
    },

    async unassignSeat(seatId) {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(150);
      const existing = store.assignments.find((a) => a.seat_id === seatId);
      if (existing) logHistory(existing.guest_id, seatId, "unassigned", ++txCounter, CLIENT_ID);
      store.assignments = store.assignments.filter((a) => a.seat_id !== seatId);
      syncChannel?.postMessage({ kind: "assignment-delete", clientId: CLIENT_ID, seatId } satisfies SyncMessage);
    },

    async undoLastAction() {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(150);
      const last = [...store.history].reverse().find((h) => h.client_id === CLIENT_ID && !h.undone);
      if (!last) {
        throw new SeatingError("Keine eigene Aktion zum Rückgängigmachen gefunden.", "NOTHING_TO_UNDO");
      }
      const txEntries = store.history.filter((h) => h.tx_id === last.tx_id);
      const byGuest = new Map<string, { from: string | null; to: string | null }>();
      for (const entry of txEntries) {
        const g = byGuest.get(entry.guest_id) ?? { from: null, to: null };
        if (entry.event === "unassigned") g.from = entry.seat_id;
        else g.to = entry.seat_id;
        byGuest.set(entry.guest_id, g);
      }

      const undoTxId = ++txCounter;
      for (const [guestId, { from, to }] of byGuest) {
        if (from && to) {
          // Umzug rückgängig: zurück auf den alten Platz, sofern der
          // inzwischen nicht anderweitig belegt wurde.
          if (store.assignments.some((a) => a.seat_id === from)) {
            throw new SeatingError("Der ursprüngliche Platz ist inzwischen belegt, Rückgängig nicht möglich.", "SEAT_TAKEN");
          }
          store.assignments = store.assignments.filter((a) => a.guest_id !== guestId);
          const assignment: Assignment = { seat_id: from, guest_id: guestId, updated_at: now(), updated_by: null, client_id: CLIENT_ID };
          store.assignments.push(assignment);
          logHistory(guestId, to, "unassigned", undoTxId, CLIENT_ID);
          logHistory(guestId, from, "assigned", undoTxId, CLIENT_ID);
          syncChannel?.postMessage({ kind: "assignment-upsert", clientId: CLIENT_ID, assignment } satisfies SyncMessage);
        } else if (to) {
          // Erstplatzierung rückgängig: Platz wieder freimachen.
          store.assignments = store.assignments.filter((a) => a.guest_id !== guestId);
          logHistory(guestId, to, "unassigned", undoTxId, CLIENT_ID);
          syncChannel?.postMessage({ kind: "assignment-delete", clientId: CLIENT_ID, seatId: to } satisfies SyncMessage);
        } else if (from) {
          // Freimachen rückgängig: Gast zurück auf den alten Platz.
          if (store.assignments.some((a) => a.seat_id === from)) {
            throw new SeatingError("Der ursprüngliche Platz ist inzwischen belegt, Rückgängig nicht möglich.", "SEAT_TAKEN");
          }
          const assignment: Assignment = { seat_id: from, guest_id: guestId, updated_at: now(), updated_by: null, client_id: CLIENT_ID };
          store.assignments.push(assignment);
          logHistory(guestId, from, "assigned", undoTxId, CLIENT_ID);
          syncChannel?.postMessage({ kind: "assignment-upsert", clientId: CLIENT_ID, assignment } satisfies SyncMessage);
        }
      }
      for (const entry of txEntries) entry.undone = true;
    },

    async softDeleteGuest(guestId) {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(150);
      const seat = store.assignments.find((a) => a.guest_id === guestId);
      if (seat) {
        logHistory(guestId, seat.seat_id, "unassigned", ++txCounter, CLIENT_ID);
        store.assignments = store.assignments.filter((a) => a.guest_id !== guestId);
      }
      store.guests = store.guests.map((g) => (g.id === guestId ? { ...g, deleted_at: now() } : g));
      syncChannel?.postMessage({ kind: "guests-replace", clientId: CLIENT_ID, guests: store.guests } satisfies SyncMessage);
    },

    async loadHistory(_scenarioId, limit = 30): Promise<AssignmentHistoryEntry[]> {
      await delay(100);
      return [...store.history]
        .sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1))
        .slice(0, limit);
    },

    async listSnapshots(scenarioId): Promise<ScenarioSnapshot[]> {
      await delay(100);
      return store.snapshots
        .filter((s) => s.scenario_id === scenarioId)
        .map(({ id, scenario_id, name, created_at }) => ({ id, scenario_id, name, created_at }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },

    async createSnapshot(scenarioId, name) {
      await delay(150);
      store.snapshots.push({
        id: genId("snap"),
        scenario_id: scenarioId,
        name,
        created_at: now(),
        tables: store.tables.map((t) => ({ ...t })),
        seats: store.seats.map((s) => ({ ...s })),
        assignments: store.assignments.map((a) => ({ ...a }))
      });
    },

    async restoreSnapshot(snapshotId) {
      await delay(200);
      const snap = store.snapshots.find((s) => s.id === snapshotId);
      if (!snap) throw new SeatingError("Snapshot existiert nicht.", "SNAPSHOT_NOT_FOUND");

      // Sicherheitsnetz wie beim echten restore_snapshot (Migration 0006):
      // aktuellen Stand automatisch sichern, bevor er überschrieben wird.
      store.snapshots.push({
        id: genId("snap"),
        scenario_id: store.scenario.id,
        name: `Automatische Sicherung vor "${snap.name}" (${new Date().toLocaleString("de-DE")})`,
        created_at: now(),
        tables: store.tables.map((t) => ({ ...t })),
        seats: store.seats.map((s) => ({ ...s })),
        assignments: store.assignments.map((a) => ({ ...a }))
      });

      // Neue Tisch-/Sitz-IDs erzeugen (wie beim echten restore_snapshot),
      // Zuweisungen nur für noch existierende Gäste übernehmen.
      const tableIdMap = new Map<string, string>();
      const newTables: TableRow[] = snap.tables.map((t) => {
        const newId = genId("table");
        tableIdMap.set(t.id, newId);
        return { ...t, id: newId, client_id: null };
      });
      const seatIdMap = new Map<string, string>();
      const newSeats: Seat[] = snap.seats.map((s) => {
        const newId = genId("seat");
        seatIdMap.set(s.id, newId);
        return { id: newId, table_id: tableIdMap.get(s.table_id) ?? s.table_id, seat_index: s.seat_index };
      });
      const existingGuestIds = new Set(store.guests.map((g) => g.id));
      const newAssignments: Assignment[] = snap.assignments
        .filter((a) => existingGuestIds.has(a.guest_id) && seatIdMap.has(a.seat_id))
        .map((a) => ({
          seat_id: seatIdMap.get(a.seat_id)!,
          guest_id: a.guest_id,
          updated_at: now(),
          updated_by: null,
          client_id: CLIENT_ID
        }));

      store.tables = newTables;
      store.seats = newSeats;
      store.assignments = newAssignments;
      syncChannel?.postMessage({
        kind: "scenario-replace",
        clientId: CLIENT_ID,
        tables: newTables,
        seats: newSeats,
        assignments: newAssignments
      } satisfies SyncMessage);
    },

    async deleteSnapshot(snapshotId) {
      await delay(100);
      store.snapshots = store.snapshots.filter((s) => s.id !== snapshotId);
    },

    async updateTablePosition(tableId, posX, posY, rotation) {
      if (!mockConnected) throw new SeatingError("Keine Verbindung.", "OFFLINE");
      await delay(100);
      const table = store.tables.find((t) => t.id === tableId);
      if (table) {
        table.pos_x = posX;
        table.pos_y = posY;
        table.rotation = rotation;
        table.client_id = CLIENT_ID;
        syncChannel?.postMessage({ kind: "table-update", clientId: CLIENT_ID, table } satisfies SyncMessage);
      }
    },

    subscribeToChanges(callbacks: DataChangeCallbacks) {
      callbacks.onStatusChange(mockConnected ? "connected" : "disconnected");
      const statusListener = (status: ConnectionStatus) => callbacks.onStatusChange(status);
      statusListeners.add(statusListener);

      function handleMessage(event: MessageEvent<SyncMessage>) {
        const msg = event.data;
        if (msg.clientId === CLIENT_ID) return; // eigenes Echo ignorieren
        if (msg.kind === "assignment-upsert") callbacks.onAssignmentChange(msg.assignment, "upsert");
        else if (msg.kind === "assignment-delete") {
          callbacks.onAssignmentChange(
            { seat_id: msg.seatId, guest_id: "", updated_at: "", updated_by: null, client_id: null },
            "delete"
          );
        } else if (msg.kind === "table-update") callbacks.onTableChange(msg.table);
        else if (msg.kind === "guests-replace") {
          // Jeder Tab hat seinen eigenen Store (kein gemeinsames Backend im
          // Mock) — den lokalen Stand hier direkt übernehmen, statt wie
          // beim echten Repository nur "lad neu" zu signalisieren.
          store.guests = msg.guests;
          callbacks.onRefreshNeeded();
        } else if (msg.kind === "scenario-replace") {
          store.tables = msg.tables;
          store.seats = msg.seats;
          store.assignments = msg.assignments;
          callbacks.onRefreshNeeded();
        }
      }
      syncChannel?.addEventListener("message", handleMessage);

      return () => {
        statusListeners.delete(statusListener);
        syncChannel?.removeEventListener("message", handleMessage);
      };
    },

    subscribeToPresence(onUpdate: (others: PresenceState[]) => void) {
      const known = new Map<string, PresenceState>();

      function handleMessage(event: MessageEvent<SyncMessage>) {
        const msg = event.data;
        if (msg.clientId === CLIENT_ID) return;
        if (msg.kind === "presence") {
          if (msg.state) known.set(msg.clientId, msg.state);
          else known.delete(msg.clientId);
          onUpdate([...known.values()]);
        } else if (msg.kind === "presence-leave") {
          known.delete(msg.clientId);
          onUpdate([...known.values()]);
        }
      }
      syncChannel?.addEventListener("message", handleMessage);

      // Bereits anwesende Tabs um ihren aktuellen Stand bitten — ohne das
      // würde ein neu geöffneter Tab niemanden sehen, der schon vorher da
      // war und seitdem nichts Neues gesendet hat.
      syncChannel?.postMessage({ kind: "presence-request", clientId: CLIENT_ID } satisfies SyncMessage);

      return () => {
        syncChannel?.removeEventListener("message", handleMessage);
      };
    },

    updateOwnPresence(draggingGuestId, draggingGuestName) {
      const state: PresenceState = {
        clientId: CLIENT_ID,
        color: CLIENT_COLOR,
        userName: presenceUserName,
        draggingGuestId,
        draggingGuestName
      };
      ownPresenceState = state;
      syncChannel?.postMessage({ kind: "presence", clientId: CLIENT_ID, state } satisfies SyncMessage);
    },

    setPresenceIdentity(userId, displayName) {
      identityUserId = userId;
      presenceUserName = displayName;
    },

    async loadProfiles(): Promise<Record<string, string>> {
      // Der Mock hat keinen gemeinsamen Nutzer-Store über Tabs hinweg (wie
      // schon bei den Snapshots/Presence, siehe Kommentare oben) — die
      // eigene Identität reicht aber aus, um die eigene lokale Historie
      // korrekt mit einem Namen zu beschriften.
      return identityUserId ? { [identityUserId]: presenceUserName } : {};
    }
  };
}
