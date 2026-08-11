# Wedding Seating Tool

Kollaboratives Sitzplan-Tool für die Hochzeit — Next.js (App Router) + Supabase (Postgres, Realtime, Auth).

## Struktur

- `wedding-tool-web/` — die Next.js-App (Drag-and-Drop-Sitzplan, Historie, Snapshots, Login)
- `supabase/migrations/` — das komplette DB-Schema als SQL-Migrationen, der Reihe nach anzuwenden

## Lokale Entwicklung

```bash
cd wedding-tool-web
npm install
npm run dev
```

Ohne `.env.local` läuft die App automatisch im Mock-Datenmodus (In-Memory-Daten, keine echte Supabase-Verbindung nötig) — siehe `wedding-tool-web/.env.example` für die benötigten Variablen, sobald ein echtes Supabase-Projekt angebunden werden soll.

## Deployment

Produktionstaugliches `Dockerfile` liegt in `wedding-tool-web/`. Details zur Coolify-Einrichtung siehe Commit-Historie / Projektdokumentation.

## Migrationen anwenden

Die Dateien in `supabase/migrations/` der Reihe nach (0001 → 0005) gegen das Supabase-Projekt ausführen, z. B. über die Supabase-SQL-Konsole oder die Supabase CLI (`supabase db push`).
