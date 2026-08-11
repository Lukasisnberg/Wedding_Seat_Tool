-- Sitzplan: Kernschema
--
-- Designentscheidung (siehe Migrationsanleitung, Phase 2): korrekte Zuordnung
-- wird über UNIQUE-Constraints in der Datenbank erzwungen, nicht nur im
-- Frontend geprüft. `assignments` ist bewusst "sparse": eine Zeile existiert
-- nur für BELEGTE Sitze (Freimachen = DELETE, nicht UPDATE auf NULL) — das
-- entspricht 1:1 dem `assignments`-Objekt im bisherigen Tool, das ebenfalls
-- nur Einträge für belegte Sitzplatz-Keys hatte.
--
-- Zwei Ergänzungen über die minimale Empfehlung der Anleitung hinaus, aus
-- demselben Grund, aus dem die ganze Migration entworfen statt nachgerüstet
-- wird — beide sind jetzt kostenlos, später eine schmerzhafte Migration:
--   1. `scenarios` existiert schon jetzt (nicht erst in Phase 6), weil
--      `tables` sich sonst später per ALTER TABLE nachträglich daran binden
--      müsste. Das alte Tool hatte Szenarien/Varianten bereits als Feature.
--   2. `guests.deleted_at` existiert schon jetzt (Soft-Delete-Spalte),
--      Anwendungslogik dafür kommt aber wie geplant erst in Phase 6.
--
-- RLS ist in dieser Phase bewusst offen für `anon` UND `authenticated`,
-- weil Supabase Auth erst in Phase 8 eingeführt wird und die App bis dahin
-- ohne Login funktionieren muss. Phase 8 verschärft die Policies, indem sie
-- Schreibzugriff auf `authenticated` einschränkt — das ist dann eine
-- einzeilige Policy-Änderung, kein Redesign.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- updated_at-Hilfsfunktion (einmal definiert, an mehreren Tabellen genutzt)
-- ---------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- scenarios — eine "Variante" der Sitzordnung (bisher: state.scenarios[])
-- ---------------------------------------------------------------------

create table scenarios (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_scenarios_updated_at
  before update on scenarios
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- groups — Gästegruppen mit Farbe (bisher: state.groups[])
-- ---------------------------------------------------------------------

create table groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_groups_updated_at
  before update on groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- guests (bisher: state.guests[], group war dort ein loser Name-String —
-- hier sauber als FK modelliert)
-- ---------------------------------------------------------------------

create table guests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  group_id   uuid references groups(id) on delete set null,
  note       text not null default '',
  deleted_at timestamptz,                     -- Soft-Delete, siehe Phase 6
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_guests_group_id on guests(group_id);
create index idx_guests_active on guests(id) where deleted_at is null;

create trigger trg_guests_updated_at
  before update on guests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- tables (bisher: scenario.tables[], type: "standard" | "head")
-- ---------------------------------------------------------------------

create table tables (
  id          uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  label       text not null default '',
  type        text not null check (type in ('standard', 'head')),
  pos_x       numeric not null default 0,
  pos_y       numeric not null default 0,
  rotation    numeric not null default 0,      -- Grad
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_tables_scenario_id on tables(scenario_id);

create trigger trg_tables_updated_at
  before update on tables
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- seats — jeder Platz eine eigene Zeile. Wird automatisch befüllt, wenn
-- ein Tisch angelegt wird (8 Plätze für "standard", 2 für "head") — die
-- Kapazitäts-Regel wandert damit in die Datenbank statt nur im Frontend
-- zu stehen (Geometrie/Position der Sitze bleibt Client-Logik, siehe
-- getSeatLayout() im alten Tool — das ist reine Darstellung, keine
-- Korrektheitsfrage, und muss deshalb nicht dupliziert werden).
-- ---------------------------------------------------------------------

create table seats (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id) on delete cascade,
  seat_index int not null,
  created_at timestamptz not null default now(),
  unique (table_id, seat_index)
);

create or replace function create_seats_for_table()
returns trigger
language plpgsql
as $$
declare
  seat_count int;
begin
  seat_count := case new.type when 'head' then 2 else 8 end;
  insert into seats (table_id, seat_index)
  select new.id, generate_series(0, seat_count - 1);
  return new;
end;
$$;

create trigger trg_create_seats_for_table
  after insert on tables
  for each row execute function create_seats_for_table();

-- ---------------------------------------------------------------------
-- rules (bisher: state.rules[], type: "together" | "apart"). Modelliert
-- als feste Paare (guest_a, guest_b) statt eines guestIds-Arrays beliebiger
-- Länge — der Regel-Editor im alten Tool erzeugte ohnehin immer nur Paare.
-- ---------------------------------------------------------------------

create table rules (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('together', 'apart')),
  guest_a    uuid not null references guests(id) on delete cascade,
  guest_b    uuid not null references guests(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (guest_a <> guest_b)
);

create index idx_rules_guest_a on rules(guest_a);
create index idx_rules_guest_b on rules(guest_b);

-- Verhindert exakte Dopplungen unabhängig von der Reihenfolge der beiden
-- Gäste (a,b) und (b,a) gelten als dieselbe Regel.
create unique index idx_rules_unique_pair
  on rules (type, least(guest_a, guest_b), greatest(guest_a, guest_b));

-- ---------------------------------------------------------------------
-- assignments — das eigentliche Sicherheitsnetz gegen Doppelbelegung.
-- seat_id als Primärschlüssel erzwingt UNIQUE(seat_id) implizit; der
-- zusätzliche UNIQUE-Index auf guest_id verhindert, dass ein Gast an
-- zwei Tischen gleichzeitig sitzt.
-- ---------------------------------------------------------------------

create table assignments (
  seat_id    uuid primary key references seats(id) on delete cascade,
  guest_id   uuid not null unique references guests(id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)     -- bleibt NULL bis Phase 8
);

create trigger trg_assignments_updated_at
  before update on assignments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- Für alle Tabellen aktiviert, aber in dieser Phase bewusst offen für
-- anon + authenticated (siehe Kommentar oben). Phase 8 schränkt Schreib-
-- zugriff auf authenticated ein.
-- ---------------------------------------------------------------------

alter table scenarios   enable row level security;
alter table groups      enable row level security;
alter table guests      enable row level security;
alter table tables      enable row level security;
alter table seats       enable row level security;
alter table rules       enable row level security;
alter table assignments enable row level security;

-- scenarios
create policy scenarios_select_all  on scenarios for select using (true);
create policy scenarios_insert_open on scenarios for insert to anon, authenticated with check (true);
create policy scenarios_update_open on scenarios for update to anon, authenticated using (true) with check (true);
create policy scenarios_delete_open on scenarios for delete to anon, authenticated using (true);

-- groups
create policy groups_select_all  on groups for select using (true);
create policy groups_insert_open on groups for insert to anon, authenticated with check (true);
create policy groups_update_open on groups for update to anon, authenticated using (true) with check (true);
create policy groups_delete_open on groups for delete to anon, authenticated using (true);

-- guests
create policy guests_select_all  on guests for select using (true);
create policy guests_insert_open on guests for insert to anon, authenticated with check (true);
create policy guests_update_open on guests for update to anon, authenticated using (true) with check (true);
create policy guests_delete_open on guests for delete to anon, authenticated using (true);

-- tables
create policy tables_select_all  on tables for select using (true);
create policy tables_insert_open on tables for insert to anon, authenticated with check (true);
create policy tables_update_open on tables for update to anon, authenticated using (true) with check (true);
create policy tables_delete_open on tables for delete to anon, authenticated using (true);

-- seats (in der Praxis nur per Trigger geschrieben, aber RLS gilt auch dafür)
create policy seats_select_all  on seats for select using (true);
create policy seats_insert_open on seats for insert to anon, authenticated with check (true);
create policy seats_update_open on seats for update to anon, authenticated using (true) with check (true);
create policy seats_delete_open on seats for delete to anon, authenticated using (true);

-- rules
create policy rules_select_all  on rules for select using (true);
create policy rules_insert_open on rules for insert to anon, authenticated with check (true);
create policy rules_update_open on rules for update to anon, authenticated using (true) with check (true);
create policy rules_delete_open on rules for delete to anon, authenticated using (true);

-- assignments — das sicherheitskritischste Objekt, siehe Phase 3/8
create policy assignments_select_all  on assignments for select using (true);
create policy assignments_insert_open on assignments for insert to anon, authenticated with check (true);
create policy assignments_update_open on assignments for update to anon, authenticated using (true) with check (true);
create policy assignments_delete_open on assignments for delete to anon, authenticated using (true);
