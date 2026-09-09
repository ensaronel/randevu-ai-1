import type { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Twilio'nun `From` alanı "+905xxxxxxxxx" (E.164) formatında gelir, ama mevcut
 * customers.phone deposu (WhatsApp webhook'undan beri) baştaki "+" olmadan
 * "905xxxxxxxxx" formatında tutuluyor — aynı numaradan hem WhatsApp'tan yazan hem
 * telefonla arayan biri AYNI müşteri kaydına düşsün diye burada da aynı formata
 * normalize ediliyor (bkz. src/app/api/whatsapp/webhook/route.ts).
 */
export function normalizePhone(twilioFrom: string): string {
  return twilioFrom.replace(/^\+/, "");
}

/** src/app/api/whatsapp/webhook/route.ts'teki bul/oluştur deseninin sesli arama karşılığı. */
export async function findOrCreateCustomerByPhone(
  admin: AdminClient,
  businessId: string,
  twilioFrom: string
): Promise<{ id: string; full_name: string; phone: string }> {
  const phone = normalizePhone(twilioFrom);

  const { data: existing } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) return existing as { id: string; full_name: string; phone: string };

  const { data: created, error } = await admin
    .from("customers")
    .insert({ business_id: businessId, full_name: phone, phone })
    .select("id, full_name, phone")
    .single();

  if (error?.code === "23505") {
    // Eşzamanlı ikinci arama/mesaj yarışıp müşteriyi az önce oluşturmuş olabilir.
    const { data: raceCustomer } = await admin
      .from("customers")
      .select("id, full_name, phone")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .single();
    if (raceCustomer) return raceCustomer as { id: string; full_name: string; phone: string };
  }
  if (error || !created) throw error ?? new Error("Müşteri oluşturulamadı");

  return created as { id: string; full_name: string; phone: string };
}
