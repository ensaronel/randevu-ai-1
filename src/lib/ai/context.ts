import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Business, Service, Staff } from "@/types/database";

export interface AiBusinessContext {
  business: Business;
  services: Service[];
  staff: Staff[];
  expertise: { staff_id: string; service_id: string }[];
  ownerPhone: string | null;
}

/** AI'ın karar vermesi için gereken tüm işletme bağlamını tek seferde toplar. */
export async function loadBusinessContext(businessId: string): Promise<AiBusinessContext> {
  const admin = createAdminSupabaseClient();

  const [
    { data: business, error: businessError },
    { data: services, error: servicesError },
    { data: staff, error: staffError },
    { data: owner, error: ownerError },
  ] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).single(),
    admin.from("services").select("*").eq("business_id", businessId).eq("status", "active"),
    admin.from("staff").select("*").eq("business_id", businessId).eq("status", "active"),
    admin.from("business_owners").select("phone").eq("business_id", businessId).maybeSingle(),
  ]);

  // Önceden bu hatalar hiç kontrol edilmiyordu — bir sorgu başarısız olduğunda
  // (network/DB geçici hatası, rate limit vb.) data sessizce null dönüyor ve
  // "?? []" ile boş diziye düşülüyordu, yani AI'ya "hiç hizmet/personel yok" gibi
  // yanlış bir tablo gidiyordu, hiçbir iz bırakmadan (2026-09-09'da sesli arama
  // testinde yakalandı: bir oturumda context doğru geldi, hemen ardından başka bir
  // oturumda services tamamen boş geldi — sessiz bir sorgu hatası olmalı).
  if (businessError) console.error("[ai-context] business sorgusu hata:", businessError.message);
  if (servicesError) console.error("[ai-context] services sorgusu hata:", servicesError.message);
  if (staffError) console.error("[ai-context] staff sorgusu hata:", staffError.message);
  if (ownerError) console.error("[ai-context] owner sorgusu hata:", ownerError.message);

  const staffIds = (staff ?? []).map((s) => s.id);
  const { data: expertise, error: expertiseError } =
    staffIds.length > 0
      ? await admin.from("staff_service_expertise").select("staff_id, service_id").in("staff_id", staffIds)
      : { data: [], error: null };
  if (expertiseError) console.error("[ai-context] expertise sorgusu hata:", expertiseError.message);

  return {
    business: business as Business,
    services: (services ?? []) as Service[],
    staff: (staff ?? []) as Staff[],
    expertise: expertise ?? [],
    ownerPhone: owner?.phone ?? null,
  };
}
