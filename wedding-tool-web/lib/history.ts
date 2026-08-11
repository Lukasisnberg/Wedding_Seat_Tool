import type { AssignmentHistoryEntry } from "./types";

// Fasst rohe assignment_history-Zeilen (siehe Migration 0004) zu einer pro
// Anzeige-Zeile zusammen: alle Einträge mit derselben (tx_id, guest_id)
// gehören zu einer RPC-Aufruf ("eine Aktion"). Je nachdem, welche event-
// Werte dabei sind, ergibt sich ein Umzug, eine Erstplatzierung oder ein
// Freimachen — siehe Kommentar auf der assignment_history-Tabelle selbst.
export interface HistoryMove {
  txId: number;
  guestId: string;
  fromSeatId: string | null;
  toSeatId: string | null;
  changedAt: string;
  changedBy: string | null;
  clientId: string | null;
}

export function groupHistoryEntries(entries: AssignmentHistoryEntry[]): HistoryMove[] {
  const groups = new Map<string, AssignmentHistoryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.tx_id}:${entry.guest_id}`;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const moves: HistoryMove[] = [];
  for (const [, group] of groups) {
    const assigned = group.find((e) => e.event === "assigned");
    const unassigned = group.find((e) => e.event === "unassigned");
    const latest = group.reduce((a, b) => (a.changed_at > b.changed_at ? a : b));
    moves.push({
      txId: latest.tx_id,
      guestId: latest.guest_id,
      fromSeatId: unassigned?.seat_id ?? null,
      toSeatId: assigned?.seat_id ?? null,
      changedAt: latest.changed_at,
      changedBy: latest.changed_by,
      clientId: latest.client_id
    });
  }

  return moves.sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
}
