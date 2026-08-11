-- Sitzplan: atomare Operationen für Umsetzen und Tauschen
--
-- Warum das überhaupt eigene Funktionen sind statt zwei Client-seitiger
-- DELETE/INSERT-Aufrufe: "Gast umsetzen" ist logisch ein Schritt, technisch
-- aber zwei Schreibvorgänge (alten Platz freigeben, neuen Platz belegen).
-- Passiert dazwischen etwas (Verbindungsabbruch, Constraint-Verstoß), sitzt
-- der Gast sonst nirgends oder doppelt. Beide Funktionen laufen deshalb als
-- eine einzige Transaktion — pro Aufruf entweder ganz oder gar nicht.

-- ---------------------------------------------------------------------
-- move_guest — setzt einen Gast auf einen (neuen oder erstmaligen) Platz.
-- Funktioniert für beide Fälle: Gast war noch nirgends (kein bestehender
-- assignments-Eintrag, DELETE betrifft dann 0 Zeilen) und Gast wird
-- umgesetzt (bestehender Eintrag wird zuerst entfernt).
-- ---------------------------------------------------------------------

create or replace function move_guest(p_guest_id uuid, p_target_seat_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from guests where id = p_guest_id and deleted_at is null) then
    raise exception 'GUEST_NOT_FOUND: Gast existiert nicht (oder wurde gelöscht).' using errcode = 'P0002';
  end if;

  if not exists (select 1 from seats where id = p_target_seat_id) then
    raise exception 'SEAT_NOT_FOUND: Zielplatz existiert nicht.' using errcode = 'P0002';
  end if;

  -- Alten Platz freigeben (0 Zeilen betroffen, falls der Gast noch nirgends saß).
  delete from assignments where guest_id = p_guest_id;

  -- Neuen Platz belegen. Ist er inzwischen von jemand anderem belegt worden,
  -- schlägt der PRIMARY KEY auf seat_id fehl (23505) — die obige DELETE wird
  -- dann mitsamt diesem INSERT zurückgerollt (PL/pgSQL-Exception-Blöcke
  -- laufen auf einem impliziten SAVEPOINT), der Gast bleibt also auf seinem
  -- alten Platz statt unversehens gar keinen mehr zu haben.
  begin
    insert into assignments (seat_id, guest_id, updated_by)
    values (p_target_seat_id, p_guest_id, auth.uid());
  exception
    when unique_violation then
      raise exception 'SEAT_TAKEN: Der Platz wurde bereits von jemand anderem belegt.' using errcode = '23505';
  end;
end;
$$;

grant execute on function move_guest(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- swap_guests — tauscht die Plätze zweier bereits sitzender Gäste in
-- einem einzigen UPDATE-Statement. Bewusst NICHT als "erst A wegnehmen,
-- dann B setzen, dann A setzen" gebaut: über zwei Aufrufe (oder auch nur
-- zwei einzelne Schreibvorgänge) entstünde ein Zeitfenster, in dem der
-- Platz von A kurzzeitig frei ist — genau da könnte ein dritter Client
-- reingrätschen. Ein einzelnes UPDATE, das beide Zeilen gleichzeitig
-- über eine CASE-Zuweisung ändert, hat dieses Zeitfenster nicht: Postgres
-- prüft UNIQUE-Constraints bei einem Mehrzeilen-UPDATE erst, nachdem alle
-- betroffenen Zeilen ihren neuen Wert haben, nicht Zeile für Zeile.
-- ---------------------------------------------------------------------

create or replace function swap_guests(p_guest_a uuid, p_guest_b uuid)
returns void
language plpgsql
as $$
declare
  v_seat_a uuid;
  v_seat_b uuid;
begin
  if p_guest_a = p_guest_b then
    raise exception 'SAME_GUEST: Ein Gast kann nicht mit sich selbst tauschen.' using errcode = 'P0001';
  end if;

  select seat_id into v_seat_a from assignments where guest_id = p_guest_a;
  select seat_id into v_seat_b from assignments where guest_id = p_guest_b;

  if v_seat_a is null or v_seat_b is null then
    raise exception 'NOT_SEATED: Beide Gäste müssen aktuell einen Platz haben, um zu tauschen.' using errcode = 'P0001';
  end if;

  update assignments
  set guest_id   = case seat_id when v_seat_a then p_guest_b else p_guest_a end,
      updated_at = now(),
      updated_by = auth.uid()
  where seat_id in (v_seat_a, v_seat_b);
end;
$$;

grant execute on function swap_guests(uuid, uuid) to anon, authenticated;
