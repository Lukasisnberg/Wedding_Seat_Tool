-- Sitzplan: Historie, Undo, Snapshots, Soft-Delete (Phase 6)
--
-- Vier vom Migrationsleitfaden geforderte Bausteine, in einer Migration,
-- weil sie sich ein gemeinsames Mittel teilen: eine pro-Transaktion gesetzte
-- Postgres-Session-Variable ("app.acting_client_id"), mit der der aufrufende
-- Client sich seinen eigenen Schreibvorgängen zuordnet, ohne dass jede
-- Funktion das einzeln durchreichen muss (siehe unten).

-- ---------------------------------------------------------------------
-- assignment_history — Audit-Trail für move_guest, swap_guests und
-- unassign_seat, per Trigger auf `assignments` befüllt, nicht durch
-- Frontend-Code. Fängt damit AUCH Schreibzugriffe ab, die nicht über eine
-- der RPCs laufen (z.B. ein künftiger Admin-Fix direkt in der DB).
--
-- Bewusst NICHT als eine Zeile "von Sitz X nach Sitz Y" modelliert: ein
-- move_guest ist intern ein DELETE + ein INSERT (zwei Statements), ein
-- swap_guests ist ein einzelnes UPDATE über zwei Zeilen. Beides sauber auf
-- ein gemeinsames "von/nach"-Schema abzubilden bräuchte fragile Annahmen
-- über welche Operation gerade lief. Stattdessen: jede Zeile ist ein
-- atomares "Gast X wurde von Sitz Y entfernt" ODER "Gast X wurde auf Sitz Y
-- gesetzt" — und `tx_id` (die Postgres-Transaktions-ID) verklammert alle
-- Zeilen, die zur selben RPC-Aufruf gehören (move_guest/swap_guests/
-- unassign_seat laufen jeweils als eine einzige Transaktion). Damit lässt
-- sich "Gast X: von A nach B" beim Lesen einfach durch Gruppieren nach
-- (tx_id, guest_id) rekonstruieren — inklusive der Fälle "nur assigned"
-- (Erstplatzierung) und "nur unassigned" (auf den Gästepool zurückgelegt).
-- ---------------------------------------------------------------------

create table assignment_history (
  id         uuid primary key default gen_random_uuid(),
  tx_id      bigint not null default txid_current(),
  guest_id   uuid not null references guests(id) on delete cascade,
  seat_id    uuid references seats(id) on delete set null,
  event      text not null check (event in ('assigned', 'unassigned')),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  client_id  uuid,
  undone     boolean not null default false
);

create index idx_assignment_history_tx on assignment_history(tx_id);
create index idx_assignment_history_client on assignment_history(client_id, changed_at desc);
create index idx_assignment_history_recent on assignment_history(changed_at desc);

-- `app.acting_client_id` wird von move_guest/swap_guests/unassign_seat/
-- undo_last_action/restore_snapshot per set_config(..., true) gesetzt
-- ("true" = nur für die laufende Transaktion sichtbar, danach automatisch
-- wieder weg). Der Trigger liest sie hier aus. Fallback auf die client_id-
-- Spalte der Zeile selbst, falls die GUC aus irgendeinem Grund nicht
-- gesetzt ist (z.B. ein direkter SQL-Write ohne RPC).
create or replace function log_assignment_history()
returns trigger
language plpgsql
as $$
declare
  v_client_id uuid;
begin
  v_client_id := nullif(current_setting('app.acting_client_id', true), '')::uuid;

  if tg_op = 'INSERT' then
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (new.guest_id, new.seat_id, 'assigned', auth.uid(), coalesce(v_client_id, new.client_id));
    return new;
  elsif tg_op = 'DELETE' then
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (old.guest_id, old.seat_id, 'unassigned', auth.uid(), coalesce(v_client_id, old.client_id));
    return old;
  elsif tg_op = 'UPDATE' then
    -- Nur swap_guests aktualisiert bestehende assignments-Zeilen (der Sitz
    -- bleibt derselbe PK, der Gast wechselt) — als "alter Gast verlässt
    -- diesen Sitz" + "neuer Gast kommt hier an" geloggt, beide mit
    -- derselben tx_id, weil UPDATE über zwei Zeilen in einem Statement
    -- läuft und Postgres denselben txid_current() für beide liefert.
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (old.guest_id, old.seat_id, 'unassigned', auth.uid(), coalesce(v_client_id, new.client_id));
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (new.guest_id, new.seat_id, 'assigned', auth.uid(), coalesce(v_client_id, new.client_id));
    return new;
  end if;
  return null;
end;
$$;

create trigger trg_assignment_history
  after insert or update or delete on assignments
  for each row execute function log_assignment_history();

alter table assignment_history enable row level security;
create policy assignment_history_select_all on assignment_history for select using (true);
-- Keine insert/update/delete-Policy für anon/authenticated: Zeilen entstehen
-- ausschließlich über den Trigger (SECURITY DEFINER-Kontext der Tabellen-
-- Funktion, nicht über direkte Client-Writes).

-- ---------------------------------------------------------------------
-- unassign_seat — bisher ein direktes DELETE vom Client aus (siehe
-- supabaseRepository.ts). Wird jetzt zur RPC, aus zwei Gründen:
--   1. Nur so kann die aufrufende client_id sauber an den History-Trigger
--      durchgereicht werden (ein DELETE trägt selbst keine "wer löscht
--      gerade"-Information, die alte assignments-Zeile kennt nur, wer sie
--      zuletzt BESETZT hat, nicht wer sie gerade FREIMACHT).
--   2. Konsistent mit move_guest/swap_guests, die aus demselben Grund
--      ebenfalls RPCs sind statt roher Client-Writes.
-- ---------------------------------------------------------------------

create or replace function unassign_seat(p_seat_id uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
begin
  perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);
  delete from assignments where seat_id = p_seat_id;
end;
$$;

grant execute on function unassign_seat(uuid, uuid) to anon, authenticated;

-- move_guest/swap_guests: unverändert in Signatur, ergänzt nur um dasselbe
-- set_config(...) wie unassign_seat, damit alle drei Schreibpfade dieselbe
-- Attributionslogik im History-Trigger durchlaufen.

create or replace function move_guest(p_guest_id uuid, p_target_seat_id uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
begin
  perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);

  if not exists (select 1 from guests where id = p_guest_id and deleted_at is null) then
    raise exception 'GUEST_NOT_FOUND: Gast existiert nicht (oder wurde gelöscht).' using errcode = 'P0002';
  end if;

  if not exists (select 1 from seats where id = p_target_seat_id) then
    raise exception 'SEAT_NOT_FOUND: Zielplatz existiert nicht.' using errcode = 'P0002';
  end if;

  delete from assignments where guest_id = p_guest_id;

  begin
    insert into assignments (seat_id, guest_id, updated_by, client_id)
    values (p_target_seat_id, p_guest_id, auth.uid(), p_client_id);
  exception
    when unique_violation then
      raise exception 'SEAT_TAKEN: Der Platz wurde bereits von jemand anderem belegt.' using errcode = '23505';
  end;
end;
$$;

grant execute on function move_guest(uuid, uuid, uuid) to anon, authenticated;

create or replace function swap_guests(p_guest_a uuid, p_guest_b uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
declare
  v_seat_a uuid;
  v_seat_b uuid;
begin
  perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);

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
      updated_by = auth.uid(),
      client_id  = p_client_id
  where seat_id in (v_seat_a, v_seat_b);
end;
$$;

grant execute on function swap_guests(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- undo_last_action — macht die letzte NICHT bereits rückgängig gemachte
-- Aktion DIESES Clients rückgängig (client_id-Filter = "eigene Session",
-- siehe Migrationsleitfaden Phase 6: "Undo für die letzten Aktionen der
-- eigenen Session", nicht global für alle Nutzer).
--
-- Findet die jüngste tx_id, gruppiert deren Zeilen je Gast (ein Swap
-- betrifft zwei Gäste in einer tx_id, ein move_guest/unassign nur einen)
-- und spielt die Umkehrung über dieselben Primitiven wie move_guest ab:
--   assigned + unassigned für denselben Gast  -> Umzug: zurück auf from_seat
--   nur assigned                              -> Erstplatzierung: freimachen
--   nur unassigned                            -> Freimachen: zurücksetzen
-- Danach werden die rückgängig gemachten Zeilen als `undone = true`
-- markiert, damit ein zweites Undo NICHT dieselbe Aktion nochmal anfasst,
-- sondern zur nächstälteren eigenen Aktion weitergeht. Die Umkehrung
-- selbst erzeugt neue History-Zeilen (neue tx_id) — Undo ist damit selbst
-- eine nachvollziehbare, ggf. wieder rückgängig machbare Aktion.
-- ---------------------------------------------------------------------

create or replace function undo_last_action(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  v_tx_id bigint;
  r record;
begin
  select tx_id into v_tx_id
  from assignment_history
  where client_id = p_client_id and undone = false
  order by changed_at desc
  limit 1;

  if v_tx_id is null then
    raise exception 'NOTHING_TO_UNDO: Keine eigene Aktion zum Rückgängigmachen gefunden.' using errcode = 'P0001';
  end if;

  for r in
    select guest_id,
           max(seat_id) filter (where event = 'unassigned') as from_seat_id,
           max(seat_id) filter (where event = 'assigned')   as to_seat_id
    from assignment_history
    where tx_id = v_tx_id
    group by guest_id
  loop
    if r.from_seat_id is not null and r.to_seat_id is not null then
      perform move_guest(r.guest_id, r.from_seat_id, p_client_id);
    elsif r.to_seat_id is not null then
      perform unassign_seat(r.to_seat_id, p_client_id);
    elsif r.from_seat_id is not null then
      perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);
      begin
        insert into assignments (seat_id, guest_id, updated_by, client_id)
        values (r.from_seat_id, r.guest_id, auth.uid(), p_client_id);
      exception
        when unique_violation then
          raise exception 'SEAT_TAKEN: Der ursprüngliche Platz ist inzwischen belegt, Rückgängig nicht möglich.' using errcode = '23505';
      end;
    end if;
  end loop;

  update assignment_history set undone = true where tx_id = v_tx_id;
end;
$$;

grant execute on function undo_last_action(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Soft-Delete für Gäste. `guests.deleted_at` existiert bereits seit Phase 2
-- (siehe Kommentar in 0001_seating_schema.sql). Ein gelöschter Gast wird
-- zuerst von seinem aktuellen Platz entfernt (der Platz muss wieder frei
-- werden), dann erst markiert — beides in einer Transaktion, damit nicht
-- versehentlich ein "gelöschter" Gast noch auf einem Sitz sitzen bleibt.
-- ---------------------------------------------------------------------

create or replace function soft_delete_guest(p_guest_id uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
begin
  perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);
  delete from assignments where guest_id = p_guest_id;
  update guests set deleted_at = now() where id = p_guest_id;
end;
$$;

grant execute on function soft_delete_guest(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Snapshots — benannte Sicherungspunkte des aktuellen Sitzplans.
--
-- Bewusst NICHT als zweite Menge lebender tables/seats/assignments-Zeilen
-- umgesetzt (siehe Diskussion): assignments.guest_id trägt ein globales
-- UNIQUE-Constraint (ein Gast sitzt nie an zwei Tischen gleichzeitig,
-- Phase 2). Würde ein Snapshot als eigene, parallel existierende
-- Tisch/Sitz/Zuweisungs-Zeilen gespeichert, würde das Duplizieren der
-- Zuweisungen genau dieses Constraint verletzen, sobald derselbe Gast in
-- der aktuell aktiven Variante UND im Snapshot sitzt — was für so gut wie
-- jeden Snapshot der Fall wäre. Das Constraint aufzuweichen (z.B. auf
-- UNIQUE(guest_id, scenario_id)) würde die Kernsicherheit aus Phase 2 für
-- eine Funktion aufgeben, die das nicht braucht.
--
-- Stattdessen: ein Snapshot ist ein reines JSONB-Abbild (tables/seats/
-- assignments) zu einem Zeitpunkt, keine eigenen relationalen Zeilen.
-- "Zwischen Varianten wechseln" heißt hier: einen Snapshot restaurieren,
-- was den aktuell aktiven Stand des Szenarios ersetzt. Das ist die
-- einfachere UND ehrlichere Lesart von "Varianten" für ein Tool, bei dem
-- immer alle verbundenen Nutzer gemeinsam auf EINEM aktuellen Stand
-- arbeiten (Kernidee der ganzen Migration) — zwei Szenarien gleichzeitig
-- "live" und gemeinsam bearbeitbar zu halten wäre ein eigenes, größeres
-- Feature (eigene Szenario-Auswahl pro Nutzer, eigene Realtime-Kanäle je
-- Szenario) und stand nicht im Leitfaden.
-- ---------------------------------------------------------------------

create table scenario_snapshots (
  id          uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  name        text not null,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create index idx_scenario_snapshots_scenario on scenario_snapshots(scenario_id, created_at desc);

alter table scenario_snapshots enable row level security;
create policy scenario_snapshots_select_all  on scenario_snapshots for select using (true);
create policy scenario_snapshots_insert_open on scenario_snapshots for insert to anon, authenticated with check (true);
create policy scenario_snapshots_delete_open on scenario_snapshots for delete to anon, authenticated using (true);

create or replace function create_snapshot(p_scenario_id uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_snapshot jsonb;
begin
  select jsonb_build_object(
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'type', t.type,
        'pos_x', t.pos_x, 'pos_y', t.pos_y, 'rotation', t.rotation
      ))
      from tables t where t.scenario_id = p_scenario_id
    ), '[]'::jsonb),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'table_id', s.table_id, 'seat_index', s.seat_index))
      from seats s
      join tables t on t.id = s.table_id
      where t.scenario_id = p_scenario_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('seat_id', a.seat_id, 'guest_id', a.guest_id))
      from assignments a
      join seats s on s.id = a.seat_id
      join tables t on t.id = s.table_id
      where t.scenario_id = p_scenario_id
    ), '[]'::jsonb)
  ) into v_snapshot;

  insert into scenario_snapshots (scenario_id, name, snapshot, created_by)
  values (p_scenario_id, p_name, v_snapshot, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function create_snapshot(uuid, text) to anon, authenticated;

-- restore_snapshot — ersetzt den kompletten aktuellen Stand des Szenarios
-- durch den gespeicherten. Tisch-IDs ändern sich dabei zwangsläufig (neue
-- Zeilen, seats werden wie beim ursprünglichen Anlegen per Trigger
-- automatisch erzeugt) — seat_index bleibt pro Tischtyp deterministisch
-- (0..7 bzw. 0..1), darüber lassen sich alte auf neue Sitz-IDs mappen, um
-- die Zuweisungen korrekt zu übertragen. Zuweisungen zu Gästen, die es
-- nicht mehr gibt, werden übersprungen (defensiv; die guest_id-FK würde
-- sonst ohnehin fehlschlagen).
create or replace function restore_snapshot(p_snapshot_id uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
declare
  v_snapshot scenario_snapshots%rowtype;
  v_old_table jsonb;
  v_new_table_id uuid;
  v_seat_map jsonb := '{}'::jsonb;
  v_seat jsonb;
  v_new_seat_id uuid;
  v_assignment jsonb;
begin
  select * into v_snapshot from scenario_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'SNAPSHOT_NOT_FOUND: Snapshot existiert nicht.' using errcode = 'P0002';
  end if;

  perform set_config('app.acting_client_id', coalesce(p_client_id::text, ''), true);

  -- Kompletten aktuellen Stand des Szenarios verwerfen (cascade räumt
  -- seats + assignments mit ab, inkl. History-Trigger-Einträgen dafür).
  delete from tables where scenario_id = v_snapshot.scenario_id;

  for v_old_table in select * from jsonb_array_elements(v_snapshot.snapshot -> 'tables')
  loop
    insert into tables (scenario_id, label, type, pos_x, pos_y, rotation)
    values (
      v_snapshot.scenario_id,
      v_old_table ->> 'label',
      v_old_table ->> 'type',
      (v_old_table ->> 'pos_x')::numeric,
      (v_old_table ->> 'pos_y')::numeric,
      (v_old_table ->> 'rotation')::numeric
    )
    returning id into v_new_table_id;

    for v_seat in
      select value from jsonb_array_elements(v_snapshot.snapshot -> 'seats') value
      where value ->> 'table_id' = v_old_table ->> 'id'
    loop
      select id into v_new_seat_id
      from seats
      where table_id = v_new_table_id and seat_index = (v_seat ->> 'seat_index')::int;

      v_seat_map := v_seat_map || jsonb_build_object(v_seat ->> 'id', v_new_seat_id::text);
    end loop;
  end loop;

  for v_assignment in select * from jsonb_array_elements(v_snapshot.snapshot -> 'assignments')
  loop
    v_new_seat_id := nullif(v_seat_map ->> (v_assignment ->> 'seat_id'), '')::uuid;
    if v_new_seat_id is not null and exists (select 1 from guests where id = (v_assignment ->> 'guest_id')::uuid) then
      insert into assignments (seat_id, guest_id, updated_by, client_id)
      values (v_new_seat_id, (v_assignment ->> 'guest_id')::uuid, auth.uid(), p_client_id)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

grant execute on function restore_snapshot(uuid, uuid) to anon, authenticated;
