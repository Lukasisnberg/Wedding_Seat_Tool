import { TABLE_DIMS } from "./types";

// Direkt aus dem alten Tool portiert (computeRowLayout in sitzplan.html).
// WICHTIG — das ist die korrigierte Version: KEINE ovale Anordnung. Jede
// "Reihe" ist eine Spalte aus 2-4 Tischen, die vertikal vom Brautpaar-Tisch
// weg verläuft (Tische um 90° gedreht, Sitzplatz-Längsseite zeigt seitlich
// zur Spalte). Mehrere Reihen liegen nebeneinander und fächern so
// horizontal auf — klassische Bankett-Aufstellung, kein Oval.

export interface RowLayoutParams {
  count: number; // Anzahl Gästetische (Brautpaar-Tisch zählt nicht mit)
  perRow: number; // Tische pro Reihe, 2-4
  tableGap: number; // Abstand zwischen Tischen in derselben Reihe
  rowGap: number; // Abstand zwischen benachbarten Reihen
  startDistance: number; // Abstand von der Vorderkante des Brautpaar-Tisches
}

export interface LayoutPosition {
  x: number;
  y: number;
  rotation: number;
}

export const DEFAULT_ROW_LAYOUT_PARAMS: RowLayoutParams = {
  count: 4,
  perRow: 3,
  tableGap: 10,
  rowGap: 120,
  startDistance: 120
};

export function computeRowLayout(
  anchor: { x: number; y: number },
  params: RowLayoutParams
): LayoutPosition[] {
  const dims = TABLE_DIMS.standard;
  const perRow = Math.max(1, params.perRow);
  const rowWidth = dims.h; // Spaltenbreite nach der 90°-Drehung
  const tableDepth = dims.w; // Tischtiefe innerhalb der Spalte nach der Drehung

  const rows: number[] = [];
  let remaining = params.count;
  while (remaining > 0) {
    const tablesInRow = Math.min(perRow, remaining);
    rows.push(tablesInRow);
    remaining -= tablesInRow;
  }

  const totalWidth = rows.length * rowWidth + (rows.length - 1) * params.rowGap;
  const startX = anchor.x - totalWidth / 2 + rowWidth / 2;

  const positions: LayoutPosition[] = [];
  rows.forEach((tablesInRow, r) => {
    const x = startX + r * (rowWidth + params.rowGap);
    for (let d = 0; d < tablesInRow; d++) {
      positions.push({
        x: Math.round(x),
        y: Math.round(anchor.y + params.startDistance + tableDepth / 2 + d * (tableDepth + params.tableGap)),
        rotation: 90
      });
    }
  });
  return positions;
}
