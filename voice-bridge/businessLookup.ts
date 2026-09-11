import type { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Gelen aramanın Twilio'daki "To" numarasına (aranan numara) bakarak hangi
 * işletmeye ait olduğunu bulur — businesses.twilio_number her iki modda da
 * (existing_forwarded/twilio_new) gerçek Twilio numarasıdır, bkz.
 * src/lib/twilio/provision.ts. is_active=false (ödeme askıda/pasif) olan
 * işletmeler için de null döner — WhatsApp webhook'undaki aynı kill-switch
 * disiplini burada da uygulanıyor.
 */
export async function resolveBusinessIdForTwilioNumber(
  admin: AdminClient,
  toNumber: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("businesses")
    .select("id, is_active")
    .eq("twilio_number", toNumber)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return data.id;
}
