import { TABLE_DIMS } from "./types";
import type { TableRow } from "./types";
import type { ViewportState } from "@/components/SeatingCanvas";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const PADDING = 60;

// Zentriert die Canvas-Ansicht auf den kompletten Sitzplan. Nötig, weil
// echte Layouts (anders als die Mock-Testdaten, die zufällig alle im
// positiven Koordinatenbereich lagen) auch negative Tisch-Positionen haben
// können — ohne das startet die Ansicht bei Zoom 1 / Position (0,0) und ein
// Teil der Tische liegt schlicht außerhalb des sichtbaren Bereichs.
export function fitViewportToTables(tables: TableRow[], containerWidth: number, containerHeight: number): ViewportState {
  if (tables.length === 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { zoom: 1, panX: containerWidth / 2, panY: containerHeight / 2 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    const dims = TABLE_DIMS[t.type];
    // Grobe Näherung statt exakter Rotationsberechnung: der halbe
    // Diagonalradius als Puffer reicht, damit auch gedrehte Tische
    // vollständig ins Bild passen.
    const r = Math.hypot(dims.w, dims.h) / 2;
    minX = Math.min(minX, t.pos_x - r);
    maxX = Math.max(maxX, t.pos_x + r);
    minY = Math.min(minY, t.pos_y - r);
    maxY = Math.max(maxY, t.pos_y + r);
  }

  const contentW = maxX - minX + PADDING * 2;
  const contentH = maxY - minY + PADDING * 2;
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(containerWidth / contentW, containerHeight / contentH)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    zoom,
    panX: containerWidth / 2 - centerX * zoom,
    panY: containerHeight / 2 - centerY * zoom
  };
}
