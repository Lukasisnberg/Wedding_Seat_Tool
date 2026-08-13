-- Sitzplan: assignments.guest_id-Unique-Constraint deferrable machen
--
-- swap_guests() (Migration 0002/0003) tauscht zwei Gäste bewusst über EIN
-- einzelnes UPDATE-Statement, nicht über zwei getrennte, gerade um
-- Zeitfenster für Kollisionen zu vermeiden (siehe Kommentar dort). Die
-- Annahme war, Postgres prüfe UNIQUE-Constraints bei einem
-- Mehrzeilen-UPDATE erst, nachdem ALLE betroffenen Zeilen ihren neuen Wert
-- haben. Das stimmt so nicht für einen NOT DEFERRABLE-Constraint (der
-- Standard): der wird pro Zeile sofort geprüft, während sie geschrieben
-- wird — bei einem Tausch hätte an diesem Punkt eine der beiden Zeilen
-- noch ihren ALTEN guest_id-Wert, die andere schon ihren NEUEN, und für
-- einen kurzen Moment würde derselbe guest_id-Wert doppelt auftauchen ->
-- "duplicate key value violates unique constraint
-- assignments_guest_id_key", live reproduziert beim Tauschen zweier Gäste.
--
-- Fix: den Constraint DEFERRABLE INITIALLY DEFERRED machen. Damit prüft
-- Postgres ihn erst am Ende der Transaktion (hier: am Ende der RPC-Funktion),
-- wenn beide Zeilen bereits ihren finalen, wieder eindeutigen Wert haben —
-- exakt der Zeitpunkt, an dem die Prüfung tatsächlich etwas aussagt.
-- Ändert nichts an move_guest(): dort wird die alte Zuweisung des Gasts
-- immer VOR dem Insert der neuen gelöscht, es gibt also nie einen
-- Zwischenzustand, der die Prüfung überhaupt berühren würde.

alter table assignments
  drop constraint assignments_guest_id_key,
  add constraint assignments_guest_id_key unique (guest_id) deferrable initially deferred;
