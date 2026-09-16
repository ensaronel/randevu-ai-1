import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UnauthorizedError } from "@/lib/auth";

/**
 * İşletme bazlı değil, PLATFORM seviyesinde tek admin (Ensar) — yeni müşteri
 * ekleme, ödeme onaylama, numara sağlama gibi işlemler business_owners'a değil
 * buna bağlı. Basit bir e-posta allowlist'i: PLATFORM_ADMIN_EMAILS env
 * değişkeni, virgülle ayrılmış. requireBusinessOwner'dan tamamen ayrı bir
 * yetki sistemi — bir kullanıcı aynı anda hem bir işletmenin sahibi hem
 * platform admini olabilir (Ensar zaten "kuaför" pilot işletmesinin sahibi).
 */
function adminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function getPlatformAdminForPage(): Promise<{
  email: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user?.email || !adminEmails().includes(user.email.toLowerCase())) {
    // ÖNEMLİ: login sayfası girişten sonra HER ZAMAN /dashboard'a atıyordu (bkz.
    // login/page.tsx), bu yüzden /admin'e giren ama henüz oturumu olmayan platform
    // admini, giriş yaptıktan sonra kendi işletme panosuna düşüp "admin ekranı yok"
    // sanıyordu (2026-09-15'te bildirildi). redirect query parametresiyle login'e
    // nereden geldiğini söylüyoruz, login de girişten sonra oraya geri dönüyor.
    redirect("/login?redirect=/admin");
  }

  return { email: user.email, supabase };
}

export async function requirePlatformAdmin(): Promise<{
  email: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user?.email || !adminEmails().includes(user.email.toLowerCase())) {
    throw new UnauthorizedError();
  }

  return { email: user.email, supabase };
}
