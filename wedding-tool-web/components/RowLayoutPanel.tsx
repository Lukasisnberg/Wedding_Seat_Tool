"use client";

import { useState } from "react";
import { computeRowLayout, DEFAULT_ROW_LAYOUT_PARAMS, type RowLayoutParams } from "@/lib/rowLayout";
import type { TableRow } from "@/lib/types";

interface RowLayoutPanelProps {
  tables: TableRow[];
  onApply: (positions: { tableId: string; x: number; y: number; rotation: number }[]) => void;
}

// Parametrisierbare Layout-Komponente (Phase-4-Vorgabe). Repositioniert nur
// die BESTEHENDEN Gästetische (kein Anlegen/Löschen — das bräuchte eigene
// Repository-Methoden, die außerhalb des Drag-and-Drop-Umfangs dieser Phase
// liegen). Reihen = Spalten aus 2-4 Tischen, die vertikal vom Brautpaar-Tisch
// weg verlaufen und horizontal auffächern (siehe lib/rowLayout.ts).
export function RowLayoutPanel({ tables, onApply }: RowLayoutPanelProps) {
  const [params, setParams] = useState<RowLayoutParams>(DEFAULT_ROW_LAYOUT_PARAMS);

  const headTable = tables.find((t) => t.type === "head");
  const guestTables = tables.filter((t) => t.type !== "head");
  const anchor = headTable ? { x: headTable.pos_x, y: headTable.pos_y } : { x: 500, y: 120 };

  function apply() {
    const positions = computeRowLayout(anchor, { ...params, count: guestTables.length });
    onApply(
      guestTables.map((table, i) => ({
        tableId: table.id,
        x: positions[i].x,
        y: positions[i].y,
        rotation: positions[i].rotation
      }))
    );
  }

  function field(key: keyof RowLayoutParams, label: string, min: number, max: number, step: number) {
    return (
      <label className="layout-field">
        <span>
          {label} <output>{params[key]}</output>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={params[key]}
          onChange={(e) => setParams((p) => ({ ...p, [key]: Number(e.target.value) }))}
        />
      </label>
    );
  }

  return (
    <div className="layout-panel">
      <h2>Tische in Reihen anordnen</h2>
      {field("perRow", "Tische pro Reihe", 2, 4, 1)}
      {field("tableGap", "Abstand in der Reihe", 0, 60, 5)}
      {field("rowGap", "Abstand zwischen Reihen", 60, 300, 10)}
      {field("startDistance", "Startabstand vom Brautpaar-Tisch", 40, 320, 10)}
      <button type="button" onClick={apply} disabled={guestTables.length === 0}>
        Anordnen ({guestTables.length} Tische)
      </button>
    </div>
  );
}
