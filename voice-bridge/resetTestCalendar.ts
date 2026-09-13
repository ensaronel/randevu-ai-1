/**
 * Test işletmesinin (VOICE_TEST_BUSINESS_ID) takvimini sıfırlar — bu oturumdaki onlarca
 * manuel/otomatik test araması, gerçek randevu satırları biriktirdi ve bu da yeni bir
 * testte "boş yer yok" gibi YANLIŞ ALARM vermeye başladı (aslında kod değil, eski test
 * çöplüğü suçluydu). Çalıştırma: cd voice-bridge && npm run reset-test-calendar
 *
 * SADECE VOICE_TEST_BUSINESS_ID'ye ait appointments (ve bağlı appointment_services)
 * satırlarını siler — başka hiçbir işletmeye ya da tabloya dokunmaz.
 */
import { createClient } from "@supabase/supabase-js";

const BUSINESS_ID = process.env.VOICE_TEST_BUSINESS_ID ?? "";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  if (!BUSINESS_ID) {
    console.error("VOICE_TEST_BUSINESS_ID ayarlı değil (.env) — iptal edildi.");
    process.exit(1);
  }

  const { data: appts, error: fetchErr } = await admin
    .from("appointments")
    .select("id")
    .eq("business_id", BUSINESS_ID);
  if (fetchErr) {
    console.error("Randevular okunamadı:", fetchErr.message);
    process.exit(1);
  }

  const ids = (appts ?? []).map((a) => a.id);
  console.log(`${ids.length} test randevusu bulundu, siliniyor...`);
  if (ids.length === 0) {
    console.log("Zaten temiz.");
    return;
  }

  // appointment_services, appointments'a FK ile bağlı — önce onları, sonra ana kaydı sil.
  const { error: svcErr } = await admin.from("appointment_services").delete().in("appointment_id", ids);
  if (svcErr) {
    console.error("appointment_services silinemedi:", svcErr.message);
    process.exit(1);
  }

  const { error: apptErr } = await admin.from("appointments").delete().eq("business_id", BUSINESS_ID);
  if (apptErr) {
    console.error("appointments silinemedi:", apptErr.message);
    process.exit(1);
  }

  console.log(`✅ ${ids.length} test randevusu silindi — takvim temiz.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
