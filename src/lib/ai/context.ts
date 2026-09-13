import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Business, Service, Staff } from "@/types/database";

export interface AiBusinessContext {
  business: Business;
  services: Service[];
  staff: Staff[];
  expertise: { staff_id: string; service_id: string }[];
  ownerPhone: string | null;
}

async function loadBusinessContextOnce(businessId: string): Promise<AiBusinessContext> {
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

  // ÇOK ÖNEMLİ — business/services/staff sorgularından biri başarısız olursa (network/DB
  // geçici hatası, JWT saat kayması vb.) burada ASLA sessizce boş diziye düşülmez ve
  // devam edilmez: bu, AI'ya "hiç hizmet/personel yok" gibi YANLIŞ ama görünüşte geçerli
  // bir tablo verip "bugün hiç boş yer yok" gibi hatalı ama kendi içinde tutarlı bir
  // cevaba yol açar — müşteri gerçek bir hatayı "sistem meşgul" sanır. Bunun yerine hata
  // fırlatılır, çağıran taraf (loadBusinessContext) bunu retry'lar, hâlâ başarısızsa
  // üst katman (WhatsApp webhook / sesli köprü) zaten var olan genel hata yoluna düşer
  // (bkz. respond.ts çağrısını saran try/catch, geminiBridge.ts'teki setup hata yönetimi)
  // — böylece müşteriye "boş yer yok" yerine "teknik bir sorun oldu" mesajı gider.
  // (2026-09-12'de canlı testte yakalandı: "staff sorgusu hata: JWT issued at future" —
  // test makinesinin saati ileri alınmış olduğundan Supabase'in gerçek sunucu saatiyle
  // uyuşmuyor, bu da ara sıra kısa süreli auth hatasına yol açıyor.)
  if (businessError || servicesError || staffError) {
    const detail = [
      businessError && `business: ${businessError.message}`,
      servicesError && `services: ${servicesError.message}`,
      staffError && `staff: ${staffError.message}`,
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(`[ai-context] kritik sorgu hatası, boş/yanlış veriyle devam edilmiyor: ${detail}`);
  }
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

/**
 * AI'ın karar vermesi için gereken tüm işletme bağlamını tek seferde toplar.
 * Kritik sorgulardan biri hata verirse (network/DB geçici hatası, JWT saat kayması vb.)
 * bir kez daha dener — çoğu gerçek dünya kesintisi birkaç yüz ms içinde kendini
 * düzeltir. İkinci deneme de başarısız olursa hatayı olduğu gibi yukarı fırlatır,
 * çağıran katman kendi hata yolunu (WhatsApp: sistem hatası mesajı, sesli: görüşmeyi
 * nazikçe sonlandırma) devreye sokar — asla boş/yanlış context ile sessizce devam etmez.
 */
export async function loadBusinessContext(businessId: string): Promise<AiBusinessContext> {
  try {
    return await loadBusinessContextOnce(businessId);
  } catch (err) {
    console.error("[ai-context] ilk deneme başarısız, 400ms sonra tekrar deneniyor:", (err as Error).message);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return await loadBusinessContextOnce(businessId);
  }
}
