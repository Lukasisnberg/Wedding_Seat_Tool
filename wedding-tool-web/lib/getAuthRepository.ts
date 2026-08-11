import { hasSupabaseCredentials } from "./supabase";
import { createMockAuthRepository } from "./mockAuthRepository";
import { createSupabaseAuthRepository } from "./supabaseAuthRepository";
import type { AuthRepository } from "./authRepository";

let cached: AuthRepository | null = null;

export function getAuthRepository(): AuthRepository {
  if (!cached) {
    cached = hasSupabaseCredentials ? createSupabaseAuthRepository() : createMockAuthRepository();
  }
  return cached;
}
