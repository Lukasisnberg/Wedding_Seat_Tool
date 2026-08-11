import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Kein Docker in der Entwicklungsumgebung verfügbar, also kein lokaler
// Supabase-Stack zum Testen. Ohne Env-Vars läuft die App im Mock-Datenmodus
// (siehe lib/mockRepository.ts) statt hier hart zu failen — sobald echte
// Projekt-Credentials in .env.local stehen, übernimmt automatisch der
// echte Client.
export const hasSupabaseCredentials = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = hasSupabaseCredentials
  ? createClient(url as string, anonKey as string)
  : null;
