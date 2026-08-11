import type { TableType } from "./types";

export interface SeatSlot {
  index: number;
  cx: number; // Position relativ zur Tischmitte, vor Rotation
  cy: number;
}

// 1:1 Portierung von getSeatLayout() aus sitzplan.html. Reine Geometrie,
// keine Korrektheitsfrage — bleibt deshalb Client-Logik statt in der DB zu
// stehen (siehe Kommentar in der seats-Tabelle, Phase 2).
export function getSeatLayout(type: TableType): SeatSlot[] {
  if (type === "head") {
    return [
      { index: 0, cx: -30, cy: 45 },
      { index: 1, cx: 30, cy: 45 }
    ];
  }
  const xs = [-82.5, -27.5, 27.5, 82.5];
  const seats: SeatSlot[] = [];
  xs.forEach((cx, i) => seats.push({ index: i, cx, cy: -45 }));
  xs.forEach((cx, i) => seats.push({ index: i + 4, cx, cy: 45 }));
  return seats;
}
