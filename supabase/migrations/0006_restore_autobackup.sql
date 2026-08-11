-- Sitzplan: Sicherheitsnetz für restore_snapshot
--
-- restore_snapshot() (Migration 0004) ersetzt den kompletten aktuell
-- aktiven Sitzplan durch den gewählten Snapshot — das ist so gewollt
-- ("zwischen Varianten wechseln"), aber bisher ohne jede Absicherung: der
-- Stand VOR dem Laden ging unwiderruflich verloren, wenn er nicht selbst
-- vorher als Snapshot gespeichert wurde. Genau das ist beim ersten
-- Import passiert — der importierte "aktive" Sitzplan existierte nur
-- live, nie als eigener Snapshot, und wäre beim Laden einer der anderen
-- Varianten ersatzlos überschrieben worden.
--
-- Fix: vor dem eigentlichen Restore automatisch den aktuellen Stand als
-- Snapshot sichern. "Nie den Gesamtzustand verlieren" ist das Leitmotiv
-- der ganzen Migration (siehe Anleitung) — das muss auch für die
-- Restore-Funktion selbst gelten.

create or replace function restore_snapshot(p_snapshot_id uuid, p_client_id uuid default null)
returns void
language plpgsql
as $$
declare
  v_snapshot scenario_snapshots%rowtype;
  v_backup_name text;
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

  -- Automatische Sicherung des aktuellen Stands, bevor er überschrieben
  -- wird — siehe Kommentar oben. Name enthält Zeitstempel, damit mehrere
  -- Restores nacheinander nicht denselben Namen kollidieren lassen.
  v_backup_name := 'Automatische Sicherung vor "' || v_snapshot.name || '" (' || to_char(now(), 'DD.MM.YYYY HH24:MI') || ')';
  perform create_snapshot(v_snapshot.scenario_id, v_backup_name);

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

grant execute on function restore_snapshot(uuid, uuid) to authenticated;
