"use client";

import { useState } from "react";
import { groupHistoryEntries, type HistoryMove } from "@/lib/history";
import type { AssignmentHistoryEntry, Guest, Seat, TableRow } from "@/lib/types";

interface HistoryPanelProps {
  loadHistory: () => Promise<AssignmentHistoryEntry[]>;
  loadProfiles: () => Promise<Record<string, string>>;
  guestsById: Map<string, Guest>;
  seatsById: Map<string, Seat>;
  tablesById: Map<string, TableRow>;
}

function seatLabel(seatId: string | null, seatsById: Map<string, Seat>, tablesById: Map<string, TableRow>): string {
  if (!seatId) return "Gästepool";
  const seat = seatsById.get(seatId);
  if (!seat) return "unbekannter Platz";
  const table = tablesById.get(seat.table_id);
  return `${table?.label || "Tisch"} · Platz ${seat.seat_index + 1}`;
}

function moveLabel(
  move: HistoryMove,
  guestsById: Map<string, Guest>,
  seatsById: Map<string, Seat>,
  tablesById: Map<string, TableRow>,
  profiles: Record<string, string>
): string {
  const guestName = guestsById.get(move.guestId)?.name ?? "Unbekannter Gast";
  const actor = move.changedBy ? profiles[move.changedBy] ?? "Unbekannt" : null;
  const prefix = actor ? `${actor}: ` : "";
  if (move.fromSeatId && move.toSeatId) {
    return `${prefix}${guestName}: ${seatLabel(move.fromSeatId, seatsById, tablesById)} → ${seatLabel(move.toSeatId, seatsById, tablesById)}`;
  }
  if (move.toSeatId) {
    return `${prefix}${guestName}: gesetzt auf ${seatLabel(move.toSeatId, seatsById, tablesById)}`;
  }
  return `${prefix}${guestName}: entfernt von ${seatLabel(move.fromSeatId, seatsById, tablesById)}`;
}

// Zeigt die letzten Änderungen am Sitzplan (Phase 6, "Sicherheitsnetz —
// Historie"). Lädt bewusst nur auf Anfrage, nicht laufend über Realtime —
// die Historie ist ein Nachschlage-Werkzeug, kein Live-Feed. Seit Phase 8
// mit echtem Namen der handelnden Person statt anonymer Client-ID.
export function HistoryPanel({ loadHistory, loadProfiles, guestsById, seatsById, tablesById }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [moves, setMoves] = useState<HistoryMove[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    const [entries, profileMap] = await Promise.all([loadHistory(), loadProfiles()]);
    setMoves(groupHistoryEntries(entries));
    setProfiles(profileMap);
    setLoading(false);
  }

  return (
    <section className="history-panel">
      <button type="button" className="panel-toggle" onClick={toggle}>
        Verlauf {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="history-panel__body">
          {loading && <p className="panel-hint">Lädt …</p>}
          {!loading && moves?.length === 0 && <p className="panel-hint">Noch keine Änderungen.</p>}
          {!loading && moves && moves.length > 0 && (
            <ul className="history-list">
              {moves.map((move) => (
                <li key={`${move.txId}-${move.guestId}`} className="history-item">
                  <span>{moveLabel(move, guestsById, seatsById, tablesById, profiles)}</span>
                  <time>{new Date(move.changedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
