import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Sadece sunucu tarafında (API route / server action / webhook handler) kullanılır.
 * RLS'yi atlar — asla client tarafına, tarayıcıya sızdırılmaz.
 */
export function createAdminSupabaseClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
