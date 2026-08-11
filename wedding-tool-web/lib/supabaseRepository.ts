import { supabase } from "./supabase";
import { toSeatingError } from "./errors";
import { CLIENT_ID, CLIENT_COLOR } from "./clientSession";
import type { DataChangeCallbacks, SeatingRepository } from "./repository";
import type { Assignment, AssignmentHistoryEntry, PresenceState, ScenarioSnapshot, SeatingData, TableRow } from "./types";

// Broadcast statt postgres_changes für seltene, große Umbauten (Snapshot-
// Restore, Gast-Löschung): beide räumen tables/seats bzw. guests um, und
// weder `seats` noch `guests` stehen in der supabase_realtime-Publication
// (siehe Migration 0003/0004-Kommentare) — granulares Nachführen bräuchte
// INSERT/DELETE-Handling für Tische+Sitze, das Phase 5 bewusst nicht baut,
// weil dort Tische nie gelöscht wurden. Ein Broadcast-Event "lad neu" ist
// für diese seltenen Fälle einfacher und genauso korrekt wie granulares
// Nachführen, nur ohne dessen Komplexität.
const REFRESH_EVENT = "refresh-needed";

// Echte Anbindung an Supabase inkl. Realtime (Phase 5) und Presence.
export function createSupabaseRepository(): SeatingRepository {
  if (!supabase) {
    throw new Error("createSupabaseRepository() ohne konfigurierten Supabase-Client aufgerufen.");
  }
  const client = supabase;
  let presenceChannel: ReturnType<typeof client.channel> | null = null;
  let changesChannel: ReturnType<typeof client.channel> | null = null;
  // Bis setPresenceIdentity() aufgerufen wird (siehe useSeatingData.ts,
  // sobald der angemeldete Nutzer bekannt ist) ein Platzhalter — sollte in
  // der Praxis nie sichtbar werden, da die Seite vor dem Login gar nicht
  // erst rendert.
  let presenceUserName = "…";

  function broadcastRefresh() {
    changesChannel?.send({ type: "broadcast", event: REFRESH_EVENT, payload: { clientId: CLIENT_ID } });
  }

  return {
    async loadScenario(): Promise<SeatingData> {
      const { data: scenario, error: scenarioError } = await client
        .from("scenarios")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (scenarioError || !scenario) {
        throw toSeatingError(scenarioError ?? { message: "Kein Szenario gefunden." });
      }

      const { data: tables, error: tablesError } = await client
        .from("tables")
        .select("*")
        .eq("scenario_id", scenario.id);
      if (tablesError) throw toSeatingError(tablesError);

      const tableIds = (tables ?? []).map((t) => t.id);

      const [seatsRes, guestsRes, groupsRes, rulesRes] = await Promise.all([
        tableIds.length
          ? client.from("seats").select("*").in("table_id", tableIds)
          : Promise.resolve({ data: [], error: null }),
        client.from("guests").select("*").is("deleted_at", null),
        client.from("groups").select("*"),
        client.from("rules").select("*")
      ]);
      if (seatsRes.error) throw toSeatingError(seatsRes.error);
      if (guestsRes.error) throw toSeatingError(guestsRes.error);
      if (groupsRes.error) throw toSeatingError(groupsRes.error);
      if (rulesRes.error) throw toSeatingError(rulesRes.error);

      const seatIds = (seatsRes.data ?? []).map((s) => s.id);
      const assignmentsRes = seatIds.length
        ? await client.from("assignments").select("*").in("seat_id", seatIds)
        : { data: [], error: null };
      if (assignmentsRes.error) throw toSeatingError(assignmentsRes.error);

      return {
        scenario,
        tables: tables ?? [],
        seats: seatsRes.data ?? [],
        guests: guestsRes.data ?? [],
        groups: groupsRes.data ?? [],
        rules: rulesRes.data ?? [],
        assignments: assignmentsRes.data ?? []
      };
    },

    async moveGuest(guestId, targetSeatId) {
      const { error } = await client.rpc("move_guest", {
        p_guest_id: guestId,
        p_target_seat_id: targetSeatId,
        p_client_id: CLIENT_ID
      });
      if (error) throw toSeatingError(error);
    },

    async swapGuests(guestA, guestB) {
      const { error } = await client.rpc("swap_guests", {
        p_guest_a: guestA,
        p_guest_b: guestB,
        p_client_id: CLIENT_ID
      });
      if (error) throw toSeatingError(error);
    },

    async unassignSeat(seatId) {
      const { error } = await client.rpc("unassign_seat", { p_seat_id: seatId, p_client_id: CLIENT_ID });
      if (error) throw toSeatingError(error);
    },

    async updateTablePosition(tableId, posX, posY, rotation) {
      const { error } = await client
        .from("tables")
        .update({ pos_x: posX, pos_y: posY, rotation, client_id: CLIENT_ID })
        .eq("id", tableId);
      if (error) throw toSeatingError(error);
    },

    async undoLastAction() {
      const { error } = await client.rpc("undo_last_action", { p_client_id: CLIENT_ID });
      if (error) throw toSeatingError(error);
    },

    async softDeleteGuest(guestId) {
      const { error } = await client.rpc("soft_delete_guest", { p_guest_id: guestId, p_client_id: CLIENT_ID });
      if (error) throw toSeatingError(error);
      broadcastRefresh();
    },

    async loadHistory(scenarioId, limit = 30): Promise<AssignmentHistoryEntry[]> {
      // assignment_history trägt keine scenario_id direkt (siehe Migration
      // 0004) — Zugehörigkeit läuft über seat_id -> table_id -> scenario_id.
      // Für die Anzeige reicht "die letzten N Einträge über alle Sitze
      // dieses Szenarios", per Sitz-ID-Liste gefiltert statt per Join (der
      // PostgREST-Client kann keine Joins über Fremdtabellen filtern).
      const { data: tables, error: tablesError } = await client.from("tables").select("id").eq("scenario_id", scenarioId);
      if (tablesError) throw toSeatingError(tablesError);
      const tableIds = (tables ?? []).map((t) => t.id);
      if (tableIds.length === 0) return [];

      const { data: seats, error: seatsError } = await client.from("seats").select("id").in("table_id", tableIds);
      if (seatsError) throw toSeatingError(seatsError);
      const seatIds = (seats ?? []).map((s) => s.id);
      if (seatIds.length === 0) return [];

      const { data, error } = await client
        .from("assignment_history")
        .select("*")
        .in("seat_id", seatIds)
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (error) throw toSeatingError(error);
      return data ?? [];
    },

    async listSnapshots(scenarioId): Promise<ScenarioSnapshot[]> {
      const { data, error } = await client
        .from("scenario_snapshots")
        .select("id, scenario_id, name, created_at")
        .eq("scenario_id", scenarioId)
        .order("created_at", { ascending: false });
      if (error) throw toSeatingError(error);
      return data ?? [];
    },

    async createSnapshot(scenarioId, name) {
      const { error } = await client.rpc("create_snapshot", { p_scenario_id: scenarioId, p_name: name });
      if (error) throw toSeatingError(error);
    },

    async restoreSnapshot(snapshotId) {
      const { error } = await client.rpc("restore_snapshot", { p_snapshot_id: snapshotId, p_client_id: CLIENT_ID });
      if (error) throw toSeatingError(error);
      broadcastRefresh();
    },

    async deleteSnapshot(snapshotId) {
      const { error } = await client.from("scenario_snapshots").delete().eq("id", snapshotId);
      if (error) throw toSeatingError(error);
    },

    subscribeToChanges(callbacks: DataChangeCallbacks) {
      const channel = client
        .channel("seating-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "assignments" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as Partial<Assignment>;
              if (old.seat_id) {
                callbacks.onAssignmentChange({ ...old, guest_id: "", updated_at: "", updated_by: null, client_id: null } as Assignment, "delete");
              }
              return;
            }
            const row = payload.new as Assignment;
            if (row.client_id === CLIENT_ID) return; // eigenes Echo ignorieren
            callbacks.onAssignmentChange(row, "upsert");
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tables" },
          (payload) => {
            if (payload.eventType === "DELETE") return; // Tische werden in Phase 4 nicht gelöscht
            const row = payload.new as TableRow;
            if (row.client_id === CLIENT_ID) return;
            callbacks.onTableChange(row);
          }
        )
        .on("broadcast", { event: REFRESH_EVENT }, (payload) => {
          const senderId = (payload.payload as { clientId?: string } | undefined)?.clientId;
          if (senderId === CLIENT_ID) return; // eigenen Refresh nicht doppelt auslösen
          callbacks.onRefreshNeeded();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") callbacks.onStatusChange("connected");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") callbacks.onStatusChange("disconnected");
          else if (status === "CLOSED") callbacks.onStatusChange("disconnected");
        });
      changesChannel = channel;

      return () => {
        client.removeChannel(channel);
        changesChannel = null;
      };
    },

    setPresenceIdentity(_userId, displayName) {
      presenceUserName = displayName;
    },

    subscribeToPresence(onUpdate: (others: PresenceState[]) => void) {
      const channel = client.channel("seating-presence", {
        config: { presence: { key: CLIENT_ID } }
      });
      presenceChannel = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();
        const others: PresenceState[] = [];
        for (const [key, entries] of Object.entries(state)) {
          if (key === CLIENT_ID) continue;
          const entry = entries[0] as unknown as PresenceState | undefined;
          if (entry) others.push(entry);
        }
        onUpdate(others);
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            clientId: CLIENT_ID,
            color: CLIENT_COLOR,
            userName: presenceUserName,
            draggingGuestId: null,
            draggingGuestName: null
          } satisfies PresenceState);
        }
      });

      return () => {
        client.removeChannel(channel);
        presenceChannel = null;
      };
    },

    updateOwnPresence(draggingGuestId, draggingGuestName) {
      presenceChannel?.track({
        clientId: CLIENT_ID,
        color: CLIENT_COLOR,
        userName: presenceUserName,
        draggingGuestId,
        draggingGuestName
      } satisfies PresenceState);
    },

    async loadProfiles(): Promise<Record<string, string>> {
      const { data, error } = await client.from("profiles").select("id, display_name");
      if (error) throw toSeatingError(error);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.display_name]));
    }
  };
}
