"use client";

import { useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useSeatingData } from "@/hooks/useSeatingData";
import { useAuth } from "@/hooks/useAuth";
import { GuestPool } from "@/components/GuestPool";
import { RowLayoutPanel } from "@/components/RowLayoutPanel";
import { SeatingCanvas, type ViewportState } from "@/components/SeatingCanvas";
import { Toasts } from "@/components/Toasts";
import { StatusBar } from "@/components/StatusBar";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SnapshotPanel } from "@/components/SnapshotPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { computeViolatedSeatIds } from "@/lib/violations";
import { isMockMode } from "@/lib/getRepository";
import type { AuthUser } from "@/lib/types";

interface DragPayload {
  type: "pool" | "seat" | "table";
  guestId?: string;
  seatId?: string;
  tableId?: string;
}

// Auth-Gate (Phase 8): vor dem Login wird useSeatingData() gar nicht erst
// gemountet — sonst liefe der erste loadScenario()-Aufruf gegen RLS-
// Policys, die für nicht angemeldete Nutzer inzwischen (Migration 0005)
// nichts mehr zurückgeben.
export default function Page() {
  const { status, user, error, signIn, signOut } = useAuth();

  if (status === "loading") return <div className="app-shell">Lädt …</div>;
  if (status === "signedOut" || !user) return <LoginScreen onSignIn={signIn} error={error} />;
  return <SeatingApp user={user} onSignOut={signOut} />;
}

function SeatingApp({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const {
    data,
    loading,
    loadError,
    toasts,
    connectionStatus,
    others,
    moveGuest,
    swapGuests,
    unassignSeat,
    moveTable,
    setOwnDragging,
    undoLastAction,
    softDeleteGuest,
    loadHistory,
    loadProfiles,
    listSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot
  } = useSeatingData(user);
  const [viewport, setViewport] = useState<ViewportState>({ zoom: 1, panX: 0, panY: 0 });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const dragEnabled = connectionStatus === "connected";

  const guestsById = useMemo(() => new Map((data?.guests ?? []).map((g) => [g.id, g])), [data]);
  const groupsById = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data]);
  const seatsById = useMemo(() => new Map((data?.seats ?? []).map((s) => [s.id, s])), [data]);
  const tablesById = useMemo(() => new Map((data?.tables ?? []).map((t) => [t.id, t])), [data]);
  const tableIdBySeatId = useMemo(() => new Map((data?.seats ?? []).map((s) => [s.id, s.table_id])), [data]);
  const assignedGuestIds = useMemo(() => new Set((data?.assignments ?? []).map((a) => a.guest_id)), [data]);
  const unassignedGuests = useMemo(
    () => (data?.guests ?? []).filter((g) => !assignedGuestIds.has(g.id)),
    [data, assignedGuestIds]
  );
  const violatedSeatIds = useMemo(
    () => computeViolatedSeatIds(data?.assignments ?? [], data?.rules ?? [], tableIdBySeatId),
    [data, tableIdBySeatId]
  );
  const draggedByOthers = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of others) {
      if (o.draggingGuestId) map.set(o.draggingGuestId, o.color);
    }
    return map;
  }, [others]);

  function handleDragStart(event: DragStartEvent) {
    const activeData = event.active.data.current as DragPayload | undefined;
    if (!activeData?.guestId) return;
    const guest = guestsById.get(activeData.guestId);
    setOwnDragging(activeData.guestId, guest?.name ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setOwnDragging(null, null);
    const { active, over, delta } = event;
    const activeData = active.data.current as DragPayload | undefined;
    if (!activeData || !data) return;

    if (activeData.type === "table" && activeData.tableId) {
      const table = data.tables.find((t) => t.id === activeData.tableId);
      if (table) {
        moveTable(table.id, table.pos_x + delta.x / viewport.zoom, table.pos_y + delta.y / viewport.zoom, table.rotation);
      }
      return;
    }

    if (!over) return;
    const overData = over.data.current as { type: "seat" | "pool"; seatId?: string } | undefined;
    if (!overData) return;

    if (activeData.type === "pool" && activeData.guestId) {
      if (overData.type === "seat" && overData.seatId) {
        const occupied = data.assignments.some((a) => a.seat_id === overData.seatId);
        if (occupied) return; // Ziel belegt: ignorieren, wie im alten Tool
        moveGuest(activeData.guestId, overData.seatId);
      }
      return;
    }

    if (activeData.type === "seat" && activeData.guestId && activeData.seatId) {
      if (overData.type === "seat" && overData.seatId) {
        if (activeData.seatId === overData.seatId) return;
        const targetGuestId = data.assignments.find((a) => a.seat_id === overData.seatId)?.guest_id;
        if (targetGuestId) {
          swapGuests(activeData.guestId, targetGuestId);
        } else {
          moveGuest(activeData.guestId, overData.seatId);
        }
      } else if (overData.type === "pool") {
        unassignSeat(activeData.seatId);
      }
    }
  }

  if (loading) return <div className="app-shell">Lädt …</div>;
  if (loadError || !data) return <div className="app-shell">Fehler beim Laden: {loadError}</div>;

  return (
    // collisionDetection: explizit closestCenter statt dnd-kits Default
    // (rectIntersection). Der Gästepool-Eintrag, den man zieht, ist als
    // Sidebar-Listenelement viel breiter (~250px) als ein einzelner Sitz
    // (~46px) — rectIntersection wählt den Droppable mit der größten
    // Überlappungsfläche zur GESAMTEN gezogenen Box, wodurch bei eng
    // beieinanderliegenden Sitzen ein falscher (ggf. bereits belegter)
    // Nachbarsitz "gewinnen" kann, obwohl der Mauszeiger sichtbar über dem
    // richtigen Sitz steht. closestCenter vergleicht stattdessen die
    // Mittelpunkte und liefert das erwartete, zeigerbasierte Verhalten.
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="app-shell">
        <StatusBar status={connectionStatus} others={others} user={user} onSignOut={onSignOut} />

        <div className="app-body">
          <aside className="sidebar">
            {isMockMode && (
              <div className="mode-banner">
                Mock-Datenmodus — keine Supabase-Credentials in .env.local. Zieh z. B. einen Gast auf
                „Tisch 2&quot;-Platz 2, um den Fehler-Rollback zu testen (simulierter Konflikt). Öffne die App in
                einem zweiten Tab, um Realtime-Sync und Presence live zu sehen.
              </div>
            )}

            <button type="button" className="undo-button" onClick={undoLastAction} disabled={!dragEnabled}>
              ↺ Letzte eigene Aktion rückgängig machen
            </button>

            <section>
              <h2>Gäste ({unassignedGuests.length} unplatziert)</h2>
              <GuestPool
                unassignedGuests={unassignedGuests}
                groupsById={groupsById}
                dragEnabled={dragEnabled}
                draggedByOthers={draggedByOthers}
                onDeleteGuest={softDeleteGuest}
              />
            </section>

            <HistoryPanel
              loadHistory={loadHistory}
              loadProfiles={loadProfiles}
              guestsById={guestsById}
              seatsById={seatsById}
              tablesById={tablesById}
            />
            <SnapshotPanel
              listSnapshots={listSnapshots}
              createSnapshot={createSnapshot}
              restoreSnapshot={restoreSnapshot}
              deleteSnapshot={deleteSnapshot}
            />

            <section>
              <RowLayoutPanel
                tables={data.tables}
                onApply={(positions) => {
                  for (const p of positions) moveTable(p.tableId, p.x, p.y, p.rotation);
                }}
              />
            </section>
          </aside>

          <SeatingCanvas
            tables={data.tables}
            seats={data.seats}
            assignments={data.assignments}
            guestsById={guestsById}
            groupsById={groupsById}
            violatedSeatIds={violatedSeatIds}
            viewport={viewport}
            onViewportChange={setViewport}
            dragEnabled={dragEnabled}
            draggedByOthers={draggedByOthers}
            moveTable={moveTable}
          />
        </div>
      </div>
      <Toasts toasts={toasts} />
    </DndContext>
  );
}
