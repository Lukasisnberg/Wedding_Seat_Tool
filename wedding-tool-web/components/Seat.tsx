"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { SeatSlot } from "@/lib/seatGeometry";

interface SeatProps {
  seatId: string;
  tableId: string;
  slot: SeatSlot;
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

  const style: CSSProperties = {
    position: "absolute",
    left: slot.cx - 23,
    top: slot.cy - 11,
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
