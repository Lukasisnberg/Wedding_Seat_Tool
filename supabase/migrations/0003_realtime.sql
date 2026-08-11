-- Sitzplan: Realtime-Unterstützung
--
-- client_id auf tables/assignments trägt eine pro Browser-Tab generierte
-- Session-ID (siehe lib/clientSession.ts). Zweck: wenn der eigene Client
-- ein postgres_changes-Event für seine EIGENE Änderung zurückbekommt, kann
-- er das erkennen und ignorieren — sonst überschreibt das eigene Echo das
-- schon angewendete Optimistic Update (Flackern, siehe Phase 5). Das gilt
-- nur für INSERT/UPDATE: ein DELETE-Event für einen Sitz, den man gerade
-- selbst freigemacht hat, ist ohnehin idempotent (nochmal entfernen ändert
-- nichts) und braucht deshalb keine client_id-Prüfung.
--
-- REPLICA IDENTITY FULL ist nötig, damit UPDATE/DELETE-Events die
-- vollständige alte Zeile mitschicken (Supabase Realtime schickt sonst nur
-- die Primärschlüssel-Spalten im `old`-Record).

alter table tables add column client_id uuid;
alter table assignments add column client_id uuid;

alter table tables replica identity full;
alter table assignments replica identity full;

-- move_guest/swap_guests bekommen eine zusätzliche client_id-Parameter.
-- Alte Signaturen zuerst entfernen, sonst legt CREATE OR REPLACE einen
-- zweiten, überladenen Funktionsnamen an statt die Funktion zu ersetzen.
drop function if exists move_guest(uuid, uuid);
drop function if exists swap_guests(uuid, uuid);

create or replace function move_guest(p_guest_id uuid, p_target_seat_id uuid, p_client_id uuid default null)
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

-- Tabellen für Realtime freischalten (Supabase liefert postgres_changes nur
-- für Tabellen, die explizit in dieser Publication stehen).
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table assignments;
