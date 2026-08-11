"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { TableNode } from "./TableNode";
import type { Assignment, Guest, Group, Seat, TableRow } from "@/lib/types";

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;

interface SeatingCanvasProps {
  tables: TableRow[];
  seats: Seat[];
  assignments: Assignment[];
  guestsById: Map<string, Guest>;
  groupsById: Map<string, Group>;
  violatedSeatIds: Set<string>;
  viewport: ViewportState;
  onViewportChange: (next: ViewportState) => void;
  dragEnabled: boolean;
  draggedByOthers: Map<string, string>;
}

// Pan/Zoom laufen bewusst NICHT über dnd-kit (das ist für das Ziehen von
// Entitäten zwischen Containern gedacht, nicht für Canvas-Navigation) —
// eigene Pointer-Events auf dem Hintergrund, wie im alten Tool. Ein Drag
// startet nur, wenn der Pointerdown direkt auf dem Hintergrund-Div landet,
// nicht auf einem Tisch/Sitz darüber (die haben eigene dnd-kit-Listener).
export function SeatingCanvas({
  tables,
  seats,
  assignments,
  guestsById,
  groupsById,
  violatedSeatIds,
  viewport,
  onViewportChange,
  dragEnabled,
  draggedByOthers
}: SeatingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom * factor));
      const cx = (screenX - viewport.panX) / viewport.zoom;
      const cy = (screenY - viewport.panY) / viewport.zoom;
      onViewportChange({ zoom: newZoom, panX: screenX - cx * newZoom, panY: screenY - cy * newZoom });
    },
    [viewport, onViewportChange]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return; // Klick war auf einem Tisch/Sitz, nicht dem Hintergrund
      panState.current = { startX: e.clientX, startY: e.clientY, panX: viewport.panX, panY: viewport.panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [viewport]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!panState.current) return;
      onViewportChange({
        zoom: viewport.zoom,
        panX: panState.current.panX + (e.clientX - panState.current.startX),
        panY: panState.current.panY + (e.clientY - panState.current.startY)
      });
    },
    [viewport.zoom, onViewportChange]
  );

  const handlePointerUp = useCallback(() => {
    panState.current = null;
  }, []);

  const seatsByTable = new Map<string, Seat[]>();
  for (const seat of seats) {
    const list = seatsByTable.get(seat.table_id);
    if (list) list.push(seat);
    else seatsByTable.set(seat.table_id, [seat]);
  }

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ backgroundPosition: `${viewport.panX}px ${viewport.panY}px` }}
    >
      <div
        className="canvas-content"
        style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})` }}
      >
        {tables.map((table) => (
          <TableNode
            key={table.id}
            table={table}
            seats={seatsByTable.get(table.id) ?? []}
            assignments={assignments}
            guestsById={guestsById}
            groupsById={groupsById}
            violatedSeatIds={violatedSeatIds}
            zoom={viewport.zoom}
            dragEnabled={dragEnabled}
            draggedByOthers={draggedByOthers}
          />
        ))}
      </div>
    </div>
  );
}
