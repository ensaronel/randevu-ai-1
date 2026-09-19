import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, formatDateTR, formatTL } from "@/lib/date";
import { sendPushToBusiness } from "@/lib/push";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Genel güzellik/bakım ipuçları — belirli bir işletmenin verisine dayanmıyor,
 * bu yüzden "uydurma veri" riski yok (bkz. proje genelindeki no-hallucination
 * ilkesi — bu sadece herkese uygulanabilir genel bir bakım tavsiyesi metni).
 * Servis/personel havuzu küçük olan (2-3 hizmet, birkaç personel) bir işletmede
 * HER GÜN farklı bir şey paylaşabilmek için asıl çeşitlilik buradan geliyor.
 */
const BEAUTY_TIPS: { title: string; body: string }[] = [
  { title: "Saç Ucu Bakımı", body: "Saç ucu kırıklarını önlemek için 6-8 haftada bir kesim şart." },
  { title: "Renk Kalıcılığı", body: "Boyalı saçlar için sülfatsız şampuan renk solmasını geciktirir." },
  { title: "Fön Öncesi", body: "Fön çekmeden önce ısı koruyucu sprey kullanmak saçınızı yıpranmadan korur." },
  { title: "Cilt Bakımı Sonrası", body: "İlk 24 saat doğrudan güneşe çıkmaktan kaçının." },
  { title: "Haftalık Bakım", body: "Haftada 1 kez saç maskesi, kuruluğu belirgin şekilde azaltır." },
  { title: "Manikür İpucu", body: "Manikürden sonra tırnak yağı kullanmak ojenin kalıcılığını artırır." },
  { title: "Sakal Bakımı", body: "Düzenli yağ kullanımı sakal altında cilt tahrişini azaltır." },
  { title: "Doğru Kurulama", body: "Yıkama sonrası saçı ovmak yerine hafifçe bastırarak kurulamak dökülmeyi azaltır." },
  { title: "Cilt Tipi", body: "Cilt tipine uygun ürün seçimi, en pahalı ürün kadar önemlidir." },
  { title: "Renkli Saçlar", body: "Sıcak su yerine ılık su kullanmak boyalı saçın rengini korur." },
  { title: "Kaş Bakımı", body: "Düzenli kaş bakımı yüz hatlarını belirgin şekilde toparlar." },
  { title: "Makyaj Temizliği", body: "Cilt bakımından önce makyaj temizliği mutlaka yapılmalı." },
  { title: "Saç Derisi", body: "Düzenli masaj hem rahatlatır hem kan dolaşımını destekler." },
  { title: "Yaz Bakımı", body: "SPF içeren saç ürünleri yaz aylarında renk açılmasını önler." },
  { title: "Tırnak Molası", body: "Tırnaklarınıza nefes aldırmak için ara ara oje molası verin." },
  { title: "Nemlendirme", body: "Nemlendiriciyi cilt hâlâ nemliyken uygulamak emilimi artırır." },
];

async function getBusinessName(admin: AdminClient, businessId: string): Promise<string> {
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).single();
  return data?.name ?? "İşletmeniz";
}

// Epoch gün sayısı — ay/yıl sınırlarında sıfırlanmayan, hep ileri giden kararlı bir
// döngü indeksi (modulo ile hem ipucu havuzunu hem hizmet/personel rotasyonunu seçmek için).
function epochDayIndex(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

async function buildTipContent(businessName: string): Promise<{ suggestion: string; shareImage: ShareImagePayload }> {
  const tip = BEAUTY_TIPS[epochDayIndex() % BEAUTY_TIPS.length];
  return {
    suggestion: `Bugünün bakım ipucu hazır: "${tip.title}"`,
    shareImage: {
      accent: "sage",
      businessName,
      eyebrow: "Günün Bakım İpucu",
      big: tip.title,
      subtitle: `${tip.body} ✨`,
      contextLine: formatDateTR(`${dateKeyTR(0)}T12:00:00+03:00`),
    },
  };
}

async function buildServiceSpotlightContent(
  admin: AdminClient,
  businessId: string,
  businessName: string
): Promise<{ suggestion: string; shareImage: ShareImagePayload } | null> {
  const { data: services } = await admin
    .from("services")
    .select("name, duration_minutes, price")
    .eq("business_id", businessId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (!services || services.length === 0) return null;

  const service = services[epochDayIndex() % services.length];
  return {
    suggestion: `Bugünün öne çıkan hizmeti: ${service.name}`,
    shareImage: {
      accent: "sage",
      businessName,
      eyebrow: "Günün Hizmeti",
      big: service.name,
      bigSub: `${service.duration_minutes} dk · ${formatTL(Number(service.price))}`,
      subtitle: "Hemen randevunuzu ayırtın! ✨",
      contextLine: formatDateTR(`${dateKeyTR(0)}T12:00:00+03:00`),
    },
  };
}

async function buildStaffSpotlightContent(
  admin: AdminClient,
  businessId: string,
  businessName: string
): Promise<{ suggestion: string; shareImage: ShareImagePayload } | null> {
  const { data: staff } = await admin
    .from("staff")
    .select("full_name")
    .eq("business_id", businessId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (!staff || staff.length === 0) return null;

  const member = staff[epochDayIndex() % staff.length];
  return {
    suggestion: `Bugün ekibimizden ${member.full_name}'i tanıtıyoruz`,
    shareImage: {
      accent: "sage",
      businessName,
      eyebrow: "Uzmanlarımızı Tanıyın",
      big: member.full_name,
      subtitle: "Randevu almak için hemen yazın! ✨",
      contextLine: formatDateTR(`${dateKeyTR(0)}T12:00:00+03:00`),
    },
  };
}

// 5 günlük döngü, ipucu havuzu daha büyük olduğu için ağırlıklı çoğunlukta —
// 2-3 hizmet/personelli küçük bir işletmede service/staff her gün tekrar etmesin diye.
const ROTATION: ("tip" | "service" | "staff")[] = ["tip", "tip", "service", "tip", "staff"];

/**
 * Her gece (nightly cron ile birlikte) her işletme için TAM OLARAK bir günlük
 * içerik üretir — milestone/kampanya gibi olay bazlı değil, garanti günlük
 * ritim: owner'ın elinde hiçbir "büyük an" olmasa bile HER GÜN paylaşacak bir
 * şey olsun diye.
 */
export async function runDailyContentForBusiness(businessId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const todayKey = dateKeyTR(0);

  const { data: existing } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "daily_content")
    .ilike("reasoning", `dedupe:daily:${todayKey}%`)
    .limit(1);
  if (existing && existing.length > 0) return;

  const businessName = await getBusinessName(admin, businessId);
  const kind = ROTATION[epochDayIndex() % ROTATION.length];

  let content: { suggestion: string; shareImage: ShareImagePayload } | null = null;
  if (kind === "service") content = await buildServiceSpotlightContent(admin, businessId, businessName);
  else if (kind === "staff") content = await buildStaffSpotlightContent(admin, businessId, businessName);
  if (!content) content = await buildTipContent(businessName); // hizmet/personel yoksa ipucuna düş

  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "daily_content",
    suggestion: content.suggestion,
    reasoning: `dedupe:daily:${todayKey} — otomatik günlük marka içeriği (${kind}).`,
    status: "auto_sent",
    share_image: content.shareImage,
  });
  if (error) throw error;

  await sendPushToBusiness(businessId, {
    title: "Bugünün içeriği hazır 📣",
    body: content.suggestion,
    url: "/reklam",
  }).catch((err) => console.error("günlük içerik push bildirimi gönderilemedi", err));
}

export async function runDailyContentForAllBusinesses(): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  for (const b of businesses ?? []) {
    try {
      await runDailyContentForBusiness(b.id);
    } catch (err) {
      console.error("günlük içerik üretimi başarısız", b.id, err);
    }
  }
}
