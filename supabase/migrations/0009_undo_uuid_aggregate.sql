-- Sitzplan: undo_last_action() ohne max(uuid)
--
-- Postgres hat kein eingebautes MAX/MIN für den Typ uuid ("function
-- max(uuid) does not exist"), obwohl uuid vergleichbar und indexierbar
-- ist — die Aggregatfunktionen selbst sind aber nur für bestimmte Typen
-- registriert, uuid gehört nicht dazu. Trat erst jetzt zum ersten Mal
-- real auf, weil Undo bisher nie gegen eine echte Datenbank lief.
--
-- Ersatz: array_agg(...)[1] statt max(...) — funktioniert für jeden Typ,
-- weil es keine Sortierung braucht, nur "den (einzigen) Wert, der zum
-- FILTER passt". Semantisch identisch: pro (tx_id, guest_id) gibt es
-- höchstens eine 'unassigned'- und höchstens eine 'assigned'-Zeile (siehe
-- log_assignment_history()), es wird also nie mehr als ein Element
-- gefiltert.

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
           (array_agg(seat_id) filter (where event = 'unassigned'))[1] as from_seat_id,
           (array_agg(seat_id) filter (where event = 'assigned'))[1]   as to_seat_id
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

grant execute on function undo_last_action(uuid) to authenticated;
