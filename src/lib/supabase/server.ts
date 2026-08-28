import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server component / route handler / server action tarafında kullanılır.
 * Oturum çerezlerini (auth) okur — RLS ile korunur.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component içinden çağrılırsa çerez yazılamaz —
            // proxy.ts oturum yenilemeyi zaten hallediyor, güvenle yok sayılır.
          }
        },
      },
    }
  );
}
