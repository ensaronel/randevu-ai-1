import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser/client-component tarafında kullanılır (RLS ile korunur).
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
