import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, formatDateTR, formatTL } from "@/lib/date";
import { getBusinessName } from "@/lib/businessName";
import { dedupeReasoning, hasDedupeFired } from "@/lib/dedupe";
import { generateSpotlightCaption } from "@/lib/ai/spotlightCaption";
import { generateTipFraming } from "@/lib/ai/tipCaption";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

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

// Epoch gün sayısı — ay/yıl sınırlarında sıfırlanmayan, hep ileri giden kararlı bir
// döngü indeksi (modulo ile hem ipucu havuzunu hem hizmet/personel rotasyonunu seçmek için).
function epochDayIndex(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

/**
 * Aktif hizmet/personel listesinden gün bazlı stabil bir rotasyonla biri seçilip
 * (hizmet veya personel yoksa diğerine düşülür) Gemini ile klişesiz bir vitrin
 * metni üretilir. `big`/`bigSub` her zaman GERÇEK veri (isim, süre, fiyat);
 * sadece `subtitle` Gemini'nin çerçeveleme metni.
 */
export async function runSpotlightContentForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const todayKey = dateKeyTR(0);
  if (await hasDedupeFired(admin, businessId, "daily_spotlight", `daily_spotlight:${todayKey}`)) return false;

  const [{ data: services }, { data: staff }] = await Promise.all([
    admin.from("services").select("name, duration_minutes, price").eq("business_id", businessId).eq("status", "active").order("created_at", { ascending: true }),
    admin.from("staff").select("full_name").eq("business_id", businessId).eq("status", "active").order("created_at", { ascending: true }),
  ]);

  const hasServices = services && services.length > 0;
  const hasStaff = staff && staff.length > 0;
  if (!hasServices && !hasStaff) return false;

  const preferService = epochDayIndex() % 2 === 0;
  const kind: "service" | "staff" = preferService && hasServices ? "service" : hasStaff ? "staff" : "service";

  const businessName = await getBusinessName(admin, businessId);
  let payload: ShareImagePayload;
  let suggestion: string;

  if (kind === "service") {
    const service = services![epochDayIndex() % services!.length];
    const meta = `${service.duration_minutes} dk · ${formatTL(Number(service.price))}`;
    const caption = await generateSpotlightCaption({ businessName, kind: "service", subjectName: service.name, meta });
    suggestion = caption;
    payload = {
      accent: "sage",
      businessName,
      eyebrow: "Günün Hizmeti",
      big: service.name,
      bigSub: meta,
      subtitle: caption,
      contextLine: formatDateTR(`${todayKey}T12:00:00+03:00`),
    };
  } else {
    const member = staff![epochDayIndex() % staff!.length];
    const caption = await generateSpotlightCaption({ businessName, kind: "staff", subjectName: member.full_name });
    suggestion = caption;
    payload = {
      accent: "sage",
      businessName,
      eyebrow: "Uzmanlarımızı Tanıyın",
      big: member.full_name,
      subtitle: caption,
      contextLine: formatDateTR(`${todayKey}T12:00:00+03:00`),
    };
  }

  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "daily_spotlight",
    suggestion,
    reasoning: dedupeReasoning(`daily_spotlight:${todayKey}`, `otomatik günlük vitrin içeriği (${kind}).`),
    status: "auto_sent",
    share_image: payload,
  });
  if (error) throw error;
  return true;
}

/** Sabit BEAUTY_TIPS havuzundan gün bazlı stabil rotasyonla bir ipucu seçilip Gemini
 * ile her seferinde farklı/eğlenceli bir çerçeveleme yazılır. Havuz sabit olduğu için
 * her zaman üretilebilir. */
export async function runTipContentForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const todayKey = dateKeyTR(0);
  if (await hasDedupeFired(admin, businessId, "daily_tip", `daily_tip:${todayKey}`)) return false;

  const businessName = await getBusinessName(admin, businessId);
  const tip = BEAUTY_TIPS[epochDayIndex() % BEAUTY_TIPS.length];
  const caption = await generateTipFraming({ businessName, tipTitle: tip.title, tipBody: tip.body });

  const shareImage: ShareImagePayload = {
    accent: "sage",
    businessName,
    eyebrow: "Günün Bakım İpucu",
    big: tip.title,
    subtitle: caption,
    contextLine: formatDateTR(`${todayKey}T12:00:00+03:00`),
  };

  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "daily_tip",
    suggestion: caption,
    reasoning: dedupeReasoning(`daily_tip:${todayKey}`, `otomatik günlük bakım ipucu: "${tip.title}".`),
    status: "auto_sent",
    share_image: shareImage,
  });
  if (error) throw error;
  return true;
}
