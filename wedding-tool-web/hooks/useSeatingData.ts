"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRepository } from "@/lib/getRepository";
import { SeatingError } from "@/lib/errors";
import { useDebouncedKeyedCallback } from "./useDebouncedKeyedCallback";
import type { Assignment, AuthUser, ConnectionStatus, PresenceState, SeatingData } from "@/lib/types";

const TABLE_POSITION_DEBOUNCE_MS = 500;

export interface ToastMessage {
  id: number;
  text: string;
  tone: "error" | "info";
}

// Zentrale Datenhaltung + optimistische Mutationen + Realtime-Sync +
// Presence für eine Szenario-Ansicht. Wird erst nach erfolgreichem Login
// gemountet (siehe app/page.tsx) — `user` ist deshalb hier immer bekannt,
// nicht optional.
export function useSeatingData(user: AuthUser) {
  const repo = useMemo(() => getRepository(), []);
  const [data, setData] = useState<SeatingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [others, setOthers] = useState<PresenceState[]>([]);
  const dataRef = useRef<SeatingData | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    repo
      .loadScenario()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Laden fehlgeschlagen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const pushToast = useCallback((text: string, tone: ToastMessage["tone"]) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const reportError = useCallback(
    (err: unknown) => {
      const message = err instanceof SeatingError ? err.message : "Aktion fehlgeschlagen.";
      pushToast(message, "error");
    },
    [pushToast]
  );

  // Voller Neu-Ladevorgang für seltene Bulk-Änderungen (Snapshot-Restore,
  // Gast-Löschung), die nicht granular über Realtime nachverfolgt werden —
  // siehe onRefreshNeeded-Kommentar in lib/repository.ts.
  const refresh = useCallback(() => {
    repo
      .loadScenario()
      .then((loaded) => setData(loaded))
      .catch((err: unknown) => reportError(err));
  }, [repo, reportError]);

  // ---- Realtime: Änderungen anderer Clients live einspielen ----
  // (eigene Echos sind hier schon herausgefiltert, siehe Repository)

  useEffect(() => {
    const unsubscribe = repo.subscribeToChanges({
      onAssignmentChange: (assignment, kind) => {
        setData((prev) => {
          if (!prev) return prev;
          if (kind === "delete") {
            return { ...prev, assignments: prev.assignments.filter((a) => a.seat_id !== assignment.seat_id) };
          }
          const withoutConflicts = prev.assignments.filter(
            (a) => a.seat_id !== assignment.seat_id && a.guest_id !== assignment.guest_id
          );
          return { ...prev, assignments: [...withoutConflicts, assignment] };
        });
      },
      onTableChange: (table) => {
        setData((prev) => (prev ? { ...prev, tables: prev.tables.map((t) => (t.id === table.id ? table : t)) } : prev));
      },
      onStatusChange: setConnectionStatus,
      onRefreshNeeded: refresh
    });
    return unsubscribe;
  }, [repo, refresh]);

  // ---- Presence: eigenen Beitritt melden, andere beobachten ----
  // setPresenceIdentity() muss VOR subscribeToPresence() laufen, sonst
  // ginge die erste Presence-Meldung noch ohne echten Namen raus.

  useEffect(() => {
    repo.setPresenceIdentity(user.id, user.displayName);
    const unsubscribe = repo.subscribeToPresence(setOthers);
    repo.updateOwnPresence(null, null);
    return () => {
      unsubscribe();
      setOthers([]);
    };
  }, [repo, user.id, user.displayName]);

  const setOwnDragging = useCallback(
    (guestId: string | null, guestName: string | null) => {
      repo.updateOwnPresence(guestId, guestName);
    },
    [repo]
  );

  // ---- Sitzplatz-Zuweisungen: sofort, ungedrosselt ----

  const moveGuest = useCallback(
    async (guestId: string, targetSeatId: string) => {
      const previous = dataRef.current;
      if (!previous) return;
      setData({
        ...previous,
        assignments: [
          ...previous.assignments.filter((a) => a.guest_id !== guestId),
          { seat_id: targetSeatId, guest_id: guestId, updated_at: new Date().toISOString(), updated_by: null, client_id: null }
        ]
      });
      try {
        await repo.moveGuest(guestId, targetSeatId);
      } catch (err) {
        setData(previous);
        reportError(err);
      }
    },
    [repo, reportError]
  );

  const swapGuests = useCallback(
    async (guestA: string, guestB: string) => {
      const previous = dataRef.current;
      if (!previous) return;
      const aAssign = previous.assignments.find((a) => a.guest_id === guestA);
      const bAssign = previous.assignments.find((a) => a.guest_id === guestB);
      if (!aAssign || !bAssign) return;

      const assignments: Assignment[] = previous.assignments.map((a) => {
        if (a.guest_id === guestA) return { ...a, seat_id: bAssign.seat_id, updated_at: new Date().toISOString() };
        if (a.guest_id === guestB) return { ...a, seat_id: aAssign.seat_id, updated_at: new Date().toISOString() };
        return a;
      });
      setData({ ...previous, assignments });
      try {
        await repo.swapGuests(guestA, guestB);
      } catch (err) {
        setData(previous);
        reportError(err);
      }
    },
    [repo, reportError]
  );

  const unassignSeat = useCallback(
    async (seatId: string) => {
      const previous = dataRef.current;
      if (!previous) return;
      setData({ ...previous, assignments: previous.assignments.filter((a) => a.seat_id !== seatId) });
      try {
        await repo.unassignSeat(seatId);
      } catch (err) {
        setData(previous);
        reportError(err);
      }
    },
    [repo, reportError]
  );

  // ---- Tischposition: lokal sofort sichtbar, Schreiben debounced ----
  // (kontinuierlicher Wert, nur der Endzustand zählt — anders als bei
  // Sitzplatz-Zuweisungen, die diskrete Ereignisse sind, siehe oben)

  const persistTablePosition = useDebouncedKeyedCallback(
    (tableId: string, posX: number, posY: number, rotation: number) => {
      repo.updateTablePosition(tableId, posX, posY, rotation).catch((err) => reportError(err));
    },
    TABLE_POSITION_DEBOUNCE_MS
  );

  const moveTable = useCallback(
    (tableId: string, posX: number, posY: number, rotation: number) => {
      setData((prev) =>
        prev
          ? { ...prev, tables: prev.tables.map((t) => (t.id === tableId ? { ...t, pos_x: posX, pos_y: posY, rotation } : t)) }
          : prev
      );
      persistTablePosition(tableId, tableId, posX, posY, rotation);
    },
    [persistTablePosition]
  );

  // ---- Phase 6: Sicherheitsnetz (Undo, Soft-Delete, Snapshots) ----
  // Kein Optimistic Update hier: das sind seltene, bewusste Aktionen (kein
  // Drag-Hotpath), bei denen ein korrekter, vollständiger Neuladevorgang
  // nach Erfolg wichtiger ist als gefühlte Verzögerungsfreiheit.

  const undoLastAction = useCallback(async () => {
    try {
      await repo.undoLastAction();
      refresh();
    } catch (err) {
      reportError(err);
    }
  }, [repo, refresh, reportError]);

  const softDeleteGuest = useCallback(
    async (guestId: string) => {
      const previous = dataRef.current;
      if (!previous) return;
      setData({ ...previous, guests: previous.guests.filter((g) => g.id !== guestId) });
      try {
        await repo.softDeleteGuest(guestId);
        refresh();
      } catch (err) {
        setData(previous);
        reportError(err);
      }
    },
    [repo, refresh, reportError]
  );

  const loadHistory = useCallback(async () => {
    if (!dataRef.current) return [];
    try {
      return await repo.loadHistory(dataRef.current.scenario.id);
    } catch (err) {
      reportError(err);
      return [];
    }
  }, [repo, reportError]);

  const loadProfiles = useCallback(async () => {
    try {
      return await repo.loadProfiles();
    } catch (err) {
      reportError(err);
      return {};
    }
  }, [repo, reportError]);

  const listSnapshots = useCallback(async () => {
    if (!dataRef.current) return [];
    try {
      return await repo.listSnapshots(dataRef.current.scenario.id);
    } catch (err) {
      reportError(err);
      return [];
    }
  }, [repo, reportError]);

  const createSnapshot = useCallback(
    async (name: string) => {
      if (!dataRef.current) return;
      try {
        await repo.createSnapshot(dataRef.current.scenario.id, name);
        pushToast(`Snapshot „${name}" gespeichert.`, "info");
      } catch (err) {
        reportError(err);
      }
    },
    [repo, reportError, pushToast]
  );

  const restoreSnapshot = useCallback(
    async (snapshotId: string) => {
      try {
        await repo.restoreSnapshot(snapshotId);
        refresh();
        pushToast("Snapshot wiederhergestellt. Der vorherige Stand wurde automatisch als Sicherung gespeichert.", "info");
      } catch (err) {
        reportError(err);
      }
    },
    [repo, refresh, reportError, pushToast]
  );

  const deleteSnapshot = useCallback(
    async (snapshotId: string) => {
      try {
        await repo.deleteSnapshot(snapshotId);
      } catch (err) {
        reportError(err);
      }
    },
    [repo, reportError]
  );

  return {
    data,
    loading,
    loadError,
    toasts,
    connectionStatus,
    others,
    moveGuest,
    swapGuests,
    unassignSeat,
    moveTable,
    setOwnDragging,
    undoLastAction,
    softDeleteGuest,
    loadHistory,
    loadProfiles,
    listSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot
  };
}
