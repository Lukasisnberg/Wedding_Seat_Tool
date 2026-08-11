import { hasSupabaseCredentials } from "./supabase";
import { createMockRepository } from "./mockRepository";
import { createSupabaseRepository } from "./supabaseRepository";
import type { SeatingRepository } from "./repository";

let cached: SeatingRepository | null = null;

export function getRepository(): SeatingRepository {
  if (!cached) {
    cached = hasSupabaseCredentials ? createSupabaseRepository() : createMockRepository();
  }
  return cached;
}

export const isMockMode = !hasSupabaseCredentials;
