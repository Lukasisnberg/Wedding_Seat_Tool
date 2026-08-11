"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Guest, Group } from "@/lib/types";

function GuestPoolItem({
  guest,
  group,
  dragEnabled,
  presenceColor,
  onDelete
}: {
  guest: Guest;
  group: Group | null;
  dragEnabled: boolean;
  presenceColor: string | null;
  onDelete: (guestId: string) => void;
}) {
  const draggable = useDraggable({
    id: `pool:${guest.id}`,
    data: { type: "pool", guestId: guest.id },
    disabled: !dragEnabled
  });
  return (
    <li
      ref={draggable.setNodeRef}
      className="pool-item"
      style={{
        opacity: draggable.isDragging ? 0.35 : 1,
        boxShadow: presenceColor ? `0 0 0 2px ${presenceColor}` : undefined
      }}
    >
      <span {...draggable.listeners} {...draggable.attributes} className="pool-item__drag">
        <span className="pool-item__dot" style={{ background: group?.color ?? "#c9c5bd" }} />
        <span className="pool-item__name">{guest.name}</span>
      </span>
      <button
        type="button"
        className="pool-item__delete"
        title="Gast entfernen (Soft-Delete)"
        onClick={() => {
          if (window.confirm(`${guest.name} wirklich entfernen? Der Gast bleibt in der Historie erhalten, verschwindet aber aus der Liste.`)) {
            onDelete(guest.id);
          }
        }}
      >
        ×
      </button>
    </li>
  );
}

interface GuestPoolProps {
  unassignedGuests: Guest[];
  groupsById: Map<string, Group>;
  dragEnabled: boolean;
  draggedByOthers: Map<string, string>;
  onDeleteGuest: (guestId: string) => void;
}

export function GuestPool({ unassignedGuests, groupsById, dragEnabled, draggedByOthers, onDeleteGuest }: GuestPoolProps) {
  const droppable = useDroppable({ id: "pool-container", data: { type: "pool" } });

  return (
    <ul ref={droppable.setNodeRef} className={`pool-list ${droppable.isOver ? "pool-list--drop-hover" : ""}`}>
      {unassignedGuests.length === 0 && <li className="pool-empty">Alle Gäste sind platziert.</li>}
      {unassignedGuests.map((guest) => (
        <GuestPoolItem
          key={guest.id}
          guest={guest}
          group={guest.group_id ? groupsById.get(guest.group_id) ?? null : null}
          dragEnabled={dragEnabled}
          presenceColor={draggedByOthers.get(guest.id) ?? null}
          onDelete={onDeleteGuest}
        />
      ))}
    </ul>
  );
}
