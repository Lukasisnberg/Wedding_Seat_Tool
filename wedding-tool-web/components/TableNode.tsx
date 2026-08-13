"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { getSeatLayout } from "@/lib/seatGeometry";
import { TABLE_DIMS } from "@/lib/types";
import type { Assignment, Guest, Group, Seat as SeatRow, TableRow } from "@/lib/types";
import { Seat } from "./Seat";

interface TableNodeProps {
  table: TableRow;
  seats: SeatRow[]; // bereits auf table.id gefiltert, siehe SeatingCanvas
  assignments: Assignment[];
  guestsById: Map<string, Guest>;
  groupsById: Map<string, Group>;
  violatedSeatIds: Set<string>;
  zoom: number;
  dragEnabled: boolean; // false während getrennter Verbindung (Phase 5)
  draggedByOthers: Map<string, string>; // guestId -> Presence-Farbe
  moveTable: (tableId: string, posX: number, posY: number, rotation: number) => void;
}

interface RotateState {
  centerX: number; // Bildschirmkoordinaten, bleiben während der Drehung fix
  centerY: number;
  startAngle: number; // Grad
  startRotation: number; // table.rotation zu Beginn der Geste
}

// Tische sind selbst draggable (Positionsänderung, debounced gespeichert —
// siehe useSeatingData/moveTable). dnd-kit liefert seinen `transform`-Delta
// in Bildschirm-Pixeln, unabhängig vom Canvas-Zoom. Da dieser Node aber
// innerhalb eines skalierten Eltern-Containers sitzt, muss der Delta durch
// `zoom` geteilt werden — sonst bewegt sich der Tisch bei z.B. 50% Zoom nur
// halb so weit wie der Mauszeiger (CSS-Transforms verschachteln sich
// multiplikativ). Exakt dieselbe Rechnung wie im alten Tool
// (onTableDragMove: dxCanvas = dxScreen / viewport.zoom).
//
// Der Greifpunkt ist die GANZE Tischfläche, nicht nur das Label — bei 8
// Plätzen um ein kleines Namens-Label herum war das ein zu kleiner
// Trefferbereich. Besetzte Sitze bleiben trotzdem einzeln ziehbar: ihr
// eigener Pointerdown-Handler sitzt weiter innen im DOM und feuert vor dem
// des Tisches, dnd-kit lässt dann nur den zuerst aktivierten Sensor zu.
//
// Rotieren lief im alten Tool über einen eigenen Griff (Stiel + Punkt über
// dem Tisch, siehe sitzplan.html startRotate/onRotateMove) — in der
// Migration bisher schlicht vergessen. Bewusst NICHT über dnd-kit gebaut
// (das kennt nur Verschieben zwischen Containern, keine Winkel) — eigene
// Pointer-Events mit demselben atan2-Ansatz wie im Original: Winkel vom
// Tischmittelpunkt zum Zeiger, Differenz zum Startwinkel auf die
// Start-Rotation addieren, auf 15°-Schritte einrasten (Shift = frei).
export function TableNode({
  table,
  seats,
  assignments,
  guestsById,
  groupsById,
  violatedSeatIds,
  zoom,
  dragEnabled,
  draggedByOthers,
  moveTable
}: TableNodeProps) {
  const dims = TABLE_DIMS[table.type];
  const draggable = useDraggable({
    id: `table:${table.id}`,
    data: { type: "table", tableId: table.id, basePosX: table.pos_x, basePosY: table.pos_y },
    disabled: !dragEnabled
  });

  const dx = draggable.transform ? draggable.transform.x / zoom : 0;
  const dy = draggable.transform ? draggable.transform.y / zoom : 0;

  const [liveRotation, setLiveRotation] = useState<number | null>(null);
  const rotateStateRef = useRef<RotateState | null>(null);

  function handleRotateStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !dragEnabled) return;
    e.stopPropagation(); // sonst würde die Geste zusätzlich den Tisch-Drag des Elternteils auslösen
    const tableEl = e.currentTarget.closest(".table") as HTMLElement;
    const rect = tableEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    rotateStateRef.current = {
      centerX,
      centerY,
      startAngle: (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI,
      startRotation: table.rotation
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Kein aktiver Pointer mit dieser ID (z.B. synthetische Events in
      // Tests) — die Drehung selbst läuft trotzdem über React-Zustand
      // weiter, nur das Tracking außerhalb des kleinen Griffs leidet.
    }
  }

  function handleRotateMove(e: ReactPointerEvent<HTMLDivElement>) {
    const state = rotateStateRef.current;
    if (!state) return;
    const currentAngle = (Math.atan2(e.clientY - state.centerY, e.clientX - state.centerX) * 180) / Math.PI;
    let newRotation = state.startRotation + (currentAngle - state.startAngle);
    if (!e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
    newRotation = ((newRotation % 360) + 360) % 360;
    setLiveRotation(newRotation);
  }

  function handleRotateEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (!rotateStateRef.current) return;
    rotateStateRef.current = null;
    // Zuerst committen, dann erst (best-effort) den Pointer freigeben —
    // releasePointerCapture kann werfen (z.B. wenn der Browser den Capture
    // schon selbst aufgehoben hat), das darf das Speichern der Drehung
    // nicht verhindern.
    setLiveRotation((current) => {
      if (current !== null) moveTable(table.id, table.pos_x, table.pos_y, current);
      return null;
    });
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // unkritisch, siehe oben
    }
  }

  const assignmentBySeat = new Map(assignments.map((a) => [a.seat_id, a.guest_id]));
  const seatIdByIndex = new Map(seats.map((s) => [s.seat_index, s.id]));

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      className={`table table--${table.type}`}
      style={{
        position: "absolute",
        left: table.pos_x - dims.w / 2 + dx,
        top: table.pos_y - dims.h / 2 + dy,
        width: dims.w,
        height: dims.h,
        transform: `rotate(${liveRotation ?? table.rotation}deg)`,
        zIndex: draggable.isDragging || liveRotation !== null ? 10 : 1
      }}
    >
      <div className="table__label">{table.label}</div>
      {dragEnabled && (
        <>
          <div className="rotate-handle-stem" style={{ left: dims.w / 2 - 1, top: -20 }} />
          <div
            className="rotate-handle"
            style={{ left: dims.w / 2 - 6, top: -26 }}
            title="Ziehen zum Rotieren (Shift = frei, sonst 15°-Schritte)"
            onPointerDown={handleRotateStart}
            onPointerMove={handleRotateMove}
            onPointerUp={handleRotateEnd}
          />
        </>
      )}
      {getSeatLayout(table.type).map((slot) => {
        const seatId = seatIdByIndex.get(slot.index);
        if (!seatId) return null; // seats-Zeile fehlt (sollte durch DB-Trigger nie vorkommen)
        const guestId = assignmentBySeat.get(seatId) ?? null;
        const guest = guestId ? guestsById.get(guestId) ?? null : null;
        const group = guest?.group_id ? groupsById.get(guest.group_id) ?? null : null;
        return (
          <Seat
            key={seatId}
            seatId={seatId}
            tableId={table.id}
            slot={slot}
            dims={dims}
            guestId={guestId}
            guestName={guest?.name ?? null}
            groupColor={group?.color ?? null}
            hasViolation={violatedSeatIds.has(seatId)}
            dragEnabled={dragEnabled}
            presenceColor={guestId ? draggedByOthers.get(guestId) ?? null : null}
          />
        );
      })}
    </div>
  );
}
