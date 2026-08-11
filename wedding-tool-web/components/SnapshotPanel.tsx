"use client";

import { useState } from "react";
import type { ScenarioSnapshot } from "@/lib/types";

interface SnapshotPanelProps {
  listSnapshots: () => Promise<ScenarioSnapshot[]>;
  createSnapshot: (name: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
}

// Benannte Sicherungspunkte (Phase 6, "Snapshots"): den aktuellen Sitzplan
// speichern, um später verschiedene Varianten durchzuspielen und bei Bedarf
// wiederherzustellen. Siehe Migration 0004 für die Design-Entscheidung,
// warum das über ein JSONB-Abbild läuft statt über parallel existierende
// Tisch/Sitz-Zeilen.
export function SnapshotPanel({ listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot }: SnapshotPanelProps) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ScenarioSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setSnapshots(await listSnapshots());
    setLoading(false);
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    await refresh();
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await createSnapshot(trimmed);
    setName("");
    await refresh();
    setBusy(false);
  }

  async function handleRestore(snapshot: ScenarioSnapshot) {
    if (busy) return;
    if (!window.confirm(`„${snapshot.name}" laden? Der aktuelle Sitzplan wird dabei ersetzt (der bisherige Stand wird automatisch als Sicherung gespeichert).`))
      return;
    setBusy(true);
    await restoreSnapshot(snapshot.id);
    await refresh(); // Liste zeigt sonst die neue Auto-Sicherung erst nach Zu-/Aufklappen
    setBusy(false);
  }

  async function handleDelete(snapshot: ScenarioSnapshot) {
    if (busy) return;
    if (!window.confirm(`„${snapshot.name}" endgültig löschen?`)) return;
    setBusy(true);
    await deleteSnapshot(snapshot.id);
    await refresh();
    setBusy(false);
  }

  return (
    <section className="snapshot-panel">
      <button type="button" className="panel-toggle" onClick={toggle}>
        Varianten / Snapshots {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="snapshot-panel__body">
          <div className="snapshot-panel__create">
            <input
              type="text"
              placeholder={'Name, z. B. „Familien getrennt"'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              disabled={busy}
            />
            <button type="button" onClick={handleCreate} disabled={busy || !name.trim()}>
              Speichern
            </button>
          </div>
          {loading && <p className="panel-hint">Lädt …</p>}
          {!loading && snapshots?.length === 0 && <p className="panel-hint">Noch keine Snapshots gespeichert.</p>}
          {!loading && snapshots && snapshots.length > 0 && (
            <ul className="snapshot-list">
              {snapshots.map((s) => (
                <li key={s.id} className="snapshot-item">
                  <span className="snapshot-item__name" title={s.name}>
                    {s.name}
                  </span>
                  <span className="snapshot-item__actions">
                    <button type="button" onClick={() => handleRestore(s)} disabled={busy}>
                      Laden
                    </button>
                    <button type="button" className="snapshot-item__delete" onClick={() => handleDelete(s)} disabled={busy}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
