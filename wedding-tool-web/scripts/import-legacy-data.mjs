// Einmaliges Import-Skript: liest die alte sitzplan-*.json (Format des
// ursprünglichen Datei-basierten Tools) und lädt Gruppen, Gäste, das aktive
// Szenario (als lebender Sitzplan) sowie alle übrigen Szenarien (als
// Snapshots, siehe Phase 6) in eine echte Supabase-Datenbank.
//
// Läuft NICHT als Teil der App — bewusst ein separates CLI-Skript, das mit
// dem Service-Role-Key arbeitet (umgeht RLS komplett, s. Migration 0005).
// Deshalb: niemals in .env.local eintragen, niemals committen, nur einmal
// lokal exportieren und direkt danach wieder vergessen.
//
// Aufruf (aus wedding-tool-web/):
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/import-legacy-data.mjs [Pfad zur JSON-Datei]
//
// Ohne Pfadangabe wird ../sitzplan-aktualisiert.json erwartet (relativ zu
// diesem Skript, also im Repo-Root neben wedding-tool-web/).
//
// Sicherheitsnetz: bricht ab, wenn in der Ziel-DB schon Gäste existieren —
// verhindert einen versehentlichen doppelten Import. Mit --force überschreiben
// (fügt dann trotzdem NEU hinzu, dedupliziert nichts).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FORCE = process.argv.includes("--force");
const jsonPathArg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen als Umgebungsvariablen gesetzt sein.");
  process.exit(1);
}

const jsonPath = jsonPathArg ?? path.join(__dirname, "..", "..", "sitzplan-aktualisiert.json");
const data = JSON.parse(readFileSync(jsonPath, "utf-8"));

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const { count, error: countError } = await client.from("guests").select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if (count > 0 && !FORCE) {
    console.error(
      `Es existieren bereits ${count} Gäste in der Datenbank. Abbruch, um keinen Doppel-Import zu erzeugen.\n` +
        "Mit --force trotzdem fortfahren (fügt weitere Zeilen hinzu, dedupliziert nichts)."
    );
    process.exit(1);
  }

  console.log(`Lese ${jsonPath} — ${data.guests.length} Gäste, ${data.groups.length} Gruppen, ${data.scenarios.length} Szenarien.`);

  // ---- 1. Gruppen ----
  const groupIdByName = new Map();
  for (const g of data.groups) {
    const { data: row, error } = await client.from("groups").insert({ name: g.name, color: g.color }).select("id").single();
    if (error) throw error;
    groupIdByName.set(g.name, row.id);
  }
  console.log(`${groupIdByName.size} Gruppen angelegt.`);

  // ---- 2. Gäste ----
  const guestIdByOldId = new Map();
  for (const g of data.guests) {
    const { data: row, error } = await client
      .from("guests")
      .insert({ name: g.name, group_id: groupIdByName.get(g.group) ?? null, note: g.note ?? "" })
      .select("id")
      .single();
    if (error) throw error;
    guestIdByOldId.set(g.id, row.id);
  }
  console.log(`${guestIdByOldId.size} Gäste angelegt.`);

  // ---- 3. Aktives Szenario -> lebender Sitzplan ----
  const activeScenario = data.scenarios.find((s) => s.id === data.activeScenarioId);
  if (!activeScenario) throw new Error(`activeScenarioId ${data.activeScenarioId} nicht in scenarios gefunden.`);

  const { data: scenarioRow, error: scenarioError } = await client
    .from("scenarios")
    .insert({ name: activeScenario.name })
    .select("id")
    .single();
  if (scenarioError) throw scenarioError;
  const scenarioId = scenarioRow.id;

  await importActiveScenario(activeScenario, scenarioId, guestIdByOldId);
  console.log(`Aktives Szenario "${activeScenario.name}" importiert (${activeScenario.tables.length} Tische).`);

  // ---- 4. Restliche Szenarien -> Snapshots ----
  const others = data.scenarios.filter((s) => s.id !== data.activeScenarioId);
  for (const s of others) {
    const snapshot = buildSnapshotJson(s, guestIdByOldId);
    const { error } = await client.from("scenario_snapshots").insert({ scenario_id: scenarioId, name: s.name, snapshot });
    if (error) throw error;
    console.log(`Snapshot "${s.name}" importiert.`);
  }

  console.log("Fertig.");
}

async function importActiveScenario(scenario, scenarioId, guestIdByOldId) {
  const assignmentsByTable = new Map();
  for (const [key, oldGuestId] of Object.entries(scenario.assignments)) {
    const [tableId, seatIndexStr] = key.split(":");
    const list = assignmentsByTable.get(tableId) ?? [];
    list.push({ seatIndex: Number(seatIndexStr), oldGuestId });
    assignmentsByTable.set(tableId, list);
  }

  for (const t of scenario.tables) {
    const { data: tableRow, error: tableError } = await client
      .from("tables")
      .insert({ scenario_id: scenarioId, label: t.label, type: t.type, pos_x: t.x, pos_y: t.y, rotation: t.rotation })
      .select("id")
      .single();
    if (tableError) throw tableError;

    // seats wurden per Trigger automatisch angelegt (create_seats_for_table,
    // siehe Migration 0001) — hier nur nachladen und auf seat_index mappen.
    const { data: seats, error: seatsError } = await client.from("seats").select("id, seat_index").eq("table_id", tableRow.id);
    if (seatsError) throw seatsError;
    const seatIdByIndex = new Map(seats.map((s) => [s.seat_index, s.id]));

    for (const { seatIndex, oldGuestId } of assignmentsByTable.get(t.id) ?? []) {
      const seatId = seatIdByIndex.get(seatIndex);
      const guestId = guestIdByOldId.get(oldGuestId);
      if (!seatId || !guestId) {
        console.warn(`Übersprungen: ${t.id}:${seatIndex} -> ${oldGuestId} (Sitz oder Gast nicht gefunden)`);
        continue;
      }
      const { error: assignError } = await client.from("assignments").insert({ seat_id: seatId, guest_id: guestId });
      if (assignError) throw assignError;
    }
  }
}

// Baut dasselbe JSONB-Format wie create_snapshot() in Migration 0004, aber
// für ein Szenario, das nie live in tables/seats/assignments stand — die
// IDs innerhalb des Blobs sind rein intern (verknüpfen nur Tische/Sitze/
// Zuweisungen untereinander), siehe Kommentar in restore_snapshot().
function buildSnapshotJson(scenario, guestIdByOldId) {
  const tables = scenario.tables.map((t, i) => ({
    id: `t-${i}`,
    label: t.label,
    type: t.type,
    pos_x: t.x,
    pos_y: t.y,
    rotation: t.rotation
  }));
  const newTableIdByOldId = new Map(scenario.tables.map((t, i) => [t.id, `t-${i}`]));

  const seats = [];
  const seatIdByTableAndIndex = new Map();
  for (const t of tables) {
    const count = t.type === "head" ? 2 : 8;
    for (let i = 0; i < count; i++) {
      const seatId = `${t.id}-seat-${i}`;
      seats.push({ id: seatId, table_id: t.id, seat_index: i });
      seatIdByTableAndIndex.set(`${t.id}:${i}`, seatId);
    }
  }

  const assignments = [];
  for (const [key, oldGuestId] of Object.entries(scenario.assignments)) {
    const [oldTableId, seatIndexStr] = key.split(":");
    const newTableId = newTableIdByOldId.get(oldTableId);
    const guestId = guestIdByOldId.get(oldGuestId);
    if (!newTableId || !guestId) continue;
    const seatId = seatIdByTableAndIndex.get(`${newTableId}:${seatIndexStr}`);
    if (!seatId) continue;
    assignments.push({ seat_id: seatId, guest_id: guestId });
  }

  return { tables, seats, assignments };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
