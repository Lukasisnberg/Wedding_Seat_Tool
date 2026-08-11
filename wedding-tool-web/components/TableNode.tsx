"use client";

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
export function TableNode({
  table,
  seats,
  assignments,
  guestsById,
  groupsById,
  violatedSeatIds,
  zoom,
  dragEnabled,
  draggedByOthers
}: TableNodeProps) {
  const dims = TABLE_DIMS[table.type];
  const draggable = useDraggable({
    id: `table:${table.id}`,
    data: { type: "table", tableId: table.id, basePosX: table.pos_x, basePosY: table.pos_y },
    disabled: !dragEnabled
  });

  const dx = draggable.transform ? draggable.transform.x / zoom : 0;
  const dy = draggable.transform ? draggable.transform.y / zoom : 0;

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
        transform: `rotate(${table.rotation}deg)`,
        zIndex: draggable.isDragging ? 10 : 1
      }}
    >
      <div className="table__label">{table.label}</div>
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
