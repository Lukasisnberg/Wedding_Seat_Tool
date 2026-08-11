-- Sitzplan: Zugriffsschutz mit Supabase Auth (Phase 8)
--
-- Bisher liefen alle RLS-Policys bewusst offen für `anon` UND
-- `authenticated`, weil es noch keinen Login gab (siehe Kommentar in
-- 0001_seating_schema.sql). Jetzt, wo die App unter einer echten Domain
-- öffentlich erreichbar ist, wird das geschlossen: nur noch angemeldete
-- Nutzer aus der kleinen, festen Nutzergruppe dürfen lesen und schreiben.
--
-- Zwei Dinge in einer Migration, weil sie zusammengehören:
--   1. `profiles` — verknüpft eine `auth.users`-Zeile mit einem
--      Anzeige-Namen, damit Historie und Presence echte Namen zeigen
--      können statt anonymer Client-IDs (das war der ganze Punkt, warum
--      Auth vor Historie/Presence-Klarnamen kommen musste).
--   2. Alle bisherigen `anon`-Policys durch `authenticated`-only ersetzt.

-- ---------------------------------------------------------------------
-- profiles — ein Anzeige-Name pro Account. Zeilen entstehen ausschließlich
-- über den Trigger unten (bei Account-Anlage), nicht durch Client-Inserts.
-- ---------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  updated_at   timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;

create policy profiles_select_all on profiles for select to authenticated using (true);
create policy profiles_update_own on profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Standard-Supabase-Muster: SECURITY DEFINER, weil zum Zeitpunkt der
-- Account-Anlage noch keine eingeloggte Session mit eigenen RLS-Rechten
-- auf `profiles` existiert. Anzeige-Name default: der Teil vor dem "@" der
-- E-Mail, überschreibbar über raw_user_meta_data beim Anlegen des Accounts
-- (z.B. im Supabase-Dashboard) oder später in der App selbst.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Bugfix, der erst hier auffällt: log_assignment_history() (Migration
-- 0004) lief bisher als SECURITY INVOKER (Postgres-Default) — das
-- Trigger-INSERT in assignment_history wäre also mit den RLS-Rechten der
-- aufrufenden Rolle geprüft worden. Es gibt aber absichtlich KEINE
-- Insert-Policy für assignment_history (Nutzer sollen die Historie nur
-- lesen, nie direkt beschreiben — nur der Trigger darf). Ohne diesen Fix
-- hätte jeder move_guest/swap_guests/unassign_seat-Aufruf unter RLS mit
-- "new row violates row-level security policy" fehlgeschlagen, sobald
-- echte (nicht-Mock-)Datenbank-Policies greifen. SECURITY DEFINER lässt
-- den Trigger mit den Rechten des Funktionsbesitzers schreiben, unabhängig
-- von den Rechten der aufrufenden Rolle auf assignment_history selbst.
create or replace function log_assignment_history()
returns trigger
language plpgsql
security definer
set search_path = public
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
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (old.guest_id, old.seat_id, 'unassigned', auth.uid(), coalesce(v_client_id, new.client_id));
    insert into assignment_history (guest_id, seat_id, event, changed_by, client_id)
    values (new.guest_id, new.seat_id, 'assigned', auth.uid(), coalesce(v_client_id, new.client_id));
    return new;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS: alle bisherigen anon+authenticated-Policys durch authenticated-only
-- ersetzen. Gleiches Muster pro Tabelle: alte Policys droppen, neue mit
-- `to authenticated` statt `to anon, authenticated` anlegen. SELECT war
-- bisher ohne `to`-Klausel (also implizit für jede Rolle) — jetzt ebenso
-- auf authenticated eingeschränkt, weil Gästelisten mit echten Namen kein
-- öffentliches Datum sind.
-- ---------------------------------------------------------------------

-- scenarios
drop policy scenarios_select_all  on scenarios;
drop policy scenarios_insert_open on scenarios;
drop policy scenarios_update_open on scenarios;
drop policy scenarios_delete_open on scenarios;
create policy scenarios_select on scenarios for select to authenticated using (true);
create policy scenarios_insert on scenarios for insert to authenticated with check (true);
create policy scenarios_update on scenarios for update to authenticated using (true) with check (true);
create policy scenarios_delete on scenarios for delete to authenticated using (true);

-- groups
drop policy groups_select_all  on groups;
drop policy groups_insert_open on groups;
drop policy groups_update_open on groups;
drop policy groups_delete_open on groups;
create policy groups_select on groups for select to authenticated using (true);
create policy groups_insert on groups for insert to authenticated with check (true);
create policy groups_update on groups for update to authenticated using (true) with check (true);
create policy groups_delete on groups for delete to authenticated using (true);

-- guests
drop policy guests_select_all  on guests;
drop policy guests_insert_open on guests;
drop policy guests_update_open on guests;
drop policy guests_delete_open on guests;
create policy guests_select on guests for select to authenticated using (true);
create policy guests_insert on guests for insert to authenticated with check (true);
create policy guests_update on guests for update to authenticated using (true) with check (true);
create policy guests_delete on guests for delete to authenticated using (true);

-- tables
drop policy tables_select_all  on tables;
drop policy tables_insert_open on tables;
drop policy tables_update_open on tables;
drop policy tables_delete_open on tables;
create policy tables_select on tables for select to authenticated using (true);
create policy tables_insert on tables for insert to authenticated with check (true);
create policy tables_update on tables for update to authenticated using (true) with check (true);
create policy tables_delete on tables for delete to authenticated using (true);

-- seats
drop policy seats_select_all  on seats;
drop policy seats_insert_open on seats;
drop policy seats_update_open on seats;
drop policy seats_delete_open on seats;
create policy seats_select on seats for select to authenticated using (true);
create policy seats_insert on seats for insert to authenticated with check (true);
create policy seats_update on seats for update to authenticated using (true) with check (true);
create policy seats_delete on seats for delete to authenticated using (true);

-- rules
drop policy rules_select_all  on rules;
drop policy rules_insert_open on rules;
drop policy rules_update_open on rules;
drop policy rules_delete_open on rules;
create policy rules_select on rules for select to authenticated using (true);
create policy rules_insert on rules for insert to authenticated with check (true);
create policy rules_update on rules for update to authenticated using (true) with check (true);
create policy rules_delete on rules for delete to authenticated using (true);

-- assignments
drop policy assignments_select_all  on assignments;
drop policy assignments_insert_open on assignments;
drop policy assignments_update_open on assignments;
drop policy assignments_delete_open on assignments;
create policy assignments_select on assignments for select to authenticated using (true);
create policy assignments_insert on assignments for insert to authenticated with check (true);
create policy assignments_update on assignments for update to authenticated using (true) with check (true);
create policy assignments_delete on assignments for delete to authenticated using (true);

-- assignment_history (nur select — Schreiben bleibt exklusiv dem
-- SECURITY DEFINER-Trigger vorbehalten, siehe oben)
drop policy assignment_history_select_all on assignment_history;
create policy assignment_history_select on assignment_history for select to authenticated using (true);

-- scenario_snapshots
drop policy scenario_snapshots_select_all  on scenario_snapshots;
drop policy scenario_snapshots_insert_open on scenario_snapshots;
drop policy scenario_snapshots_delete_open on scenario_snapshots;
create policy scenario_snapshots_select on scenario_snapshots for select to authenticated using (true);
create policy scenario_snapshots_insert on scenario_snapshots for insert to authenticated with check (true);
create policy scenario_snapshots_delete on scenario_snapshots for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- RPC-Grants: von `anon, authenticated` auf `authenticated` allein.
-- ---------------------------------------------------------------------

revoke execute on function move_guest(uuid, uuid, uuid)      from anon;
revoke execute on function swap_guests(uuid, uuid, uuid)     from anon;
revoke execute on function unassign_seat(uuid, uuid)         from anon;
revoke execute on function undo_last_action(uuid)            from anon;
revoke execute on function soft_delete_guest(uuid, uuid)     from anon;
revoke execute on function create_snapshot(uuid, text)       from anon;
revoke execute on function restore_snapshot(uuid, uuid)      from anon;
