import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Business, BusinessOwner } from "@/types/database";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}

/** businesses.is_active manuel bir kapatma anahtarı olarak kullanıldığında (ödeme sistemi yok, elle kapatma) fırlatılır. */
export class AccountInactiveError extends Error {
  constructor() {
    super("account_inactive");
  }
}

/**
 * Route handler'larda çağrılır. Giriş yapmış kullanıcının business_owners
 * kaydını (dolayısıyla business_id'sini) döner — tüm CRUD sorguları buna
 * göre kısıtlanır, böylece bir işletme başka bir işletmenin verisini asla göremez.
 */
export async function requireBusinessOwner(): Promise<{
  owner: BusinessOwner;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedError();
  }

  const { data: owner, error } = await supabase
    .from("business_owners")
    .select("*, business:businesses(is_active)")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !owner) {
    throw new UnauthorizedError();
  }

  const { business, ...ownerRest } = owner as BusinessOwner & { business: { is_active: boolean } | null };
  if (business?.is_active === false) {
    throw new AccountInactiveError();
  }

  return { owner: ownerRest as BusinessOwner, supabase };
}

/**
 * Server component sayfalarında (Dashboard, Takvim, ...) kullanılır.
 * requireBusinessOwner'dan farkı: hata fırlatmak yerine /login'e yönlendirir,
 * çünkü sayfalarda JSON hata gövdesi değil bir yönlendirme uygundur.
 */
export async function getBusinessOwnerForPage(): Promise<{
  owner: BusinessOwner;
  business: Business;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: owner } = await supabase
    .from("business_owners")
    .select("*, business:businesses(*)")
    .eq("auth_user_id", user.id)
    .single();

  if (!owner || !owner.business) redirect("/login");

  const { business, ...ownerRest } = owner as BusinessOwner & { business: Business };

  if (!business.is_active) redirect("/hesap-pasif");

  return { owner: ownerRest as BusinessOwner, business, supabase };
}
