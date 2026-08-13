"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { SeatSlot } from "@/lib/seatGeometry";

interface SeatProps {
  seatId: string;
  tableId: string;
  slot: SeatSlot;
  dims: { w: number; h: number }; // Tischmaße, um slot.cx/cy (relativ zur Tischmitte) in die tischlokalen CSS-Koordinaten (relativ zur oberen linken Ecke) umzurechnen
  guestId: string | null;
  guestName: string | null;
  groupColor: string | null;
  hasViolation: boolean;
  dragEnabled: boolean;
  presenceColor: string | null; // jemand anderes zieht diesen Gast gerade
}

export function Seat({
  seatId,
  tableId,
  slot,
  dims,
  guestId,
  guestName,
  groupColor,
  hasViolation,
  dragEnabled,
  presenceColor
}: SeatProps) {
  const droppable = useDroppable({ id: `seat:${seatId}`, data: { type: "seat", seatId } });
  const draggable = useDraggable({
    id: `seat:${seatId}`,
    data: { type: "seat", seatId, tableId, guestId },
    disabled: !guestId || !dragEnabled
  });

  // getSeatLayout() liefert cx/cy "relativ zur Tischmitte" (siehe
  // lib/seatGeometry.ts), das umschließende .table-Div positioniert seine
  // Kinder aber relativ zu seiner oberen linken Ecke (0,0) — ohne die
  // halbe Tischbreite/-höhe dazuzurechnen, landen alle Sitze systematisch
  // um (dims.w/2, dims.h/2) verschoben. Bei ungedrehten Tischen sieht das
  // nur nach "etwas daneben" aus; bei gedrehten Tischen (rotation != 0)
  // dreht sich dieser Versatz um den (falschen) Mittelpunkt mit und wirft
  // die Sitze weit weg vom Tisch — genau das gemeldete "Plätze an der
  // falschen Stelle".
  const style: CSSProperties = {
    position: "absolute",
    left: dims.w / 2 + slot.cx - 23,
    top: dims.h / 2 + slot.cy - 11,
    width: 46,
    height: 22,
    background: guestName ? groupColor ?? "#c9c5bd" : undefined,
    opacity: draggable.isDragging ? 0.35 : 1,
    boxShadow: presenceColor ? `0 0 0 2px ${presenceColor}` : undefined
  };

  return (
    <div
      ref={(node) => {
        droppable.setNodeRef(node);
        draggable.setNodeRef(node);
      }}
      {...draggable.listeners}
      {...draggable.attributes}
      className={[
        "seat",
        guestName ? "seat--filled" : "",
        droppable.isOver ? "seat--drop-hover" : "",
        hasViolation ? "seat--violation" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      title={guestName ?? undefined}
    >
      {guestName}
    </div>
  );
}
