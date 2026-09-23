import type { Content, FunctionCall } from "@google/genai";
import { ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/ai/assistantTools";
import { generateContentResilient } from "@/lib/ai/gemini";
import { dateKeyTR, weekdayKeyTR } from "@/lib/date";
import type { Business } from "@/types/database";

const MAX_TOOL_ITERATIONS = 10;
const ASSISTANT_TIME_BUDGET_MS = 50_000;

const WEEKDAY_LABELS_TR: Record<string, string> = {
  mon: "Pazartesi", tue: "Salı", wed: "Çarşamba", thu: "Perşembe", fri: "Cuma", sat: "Cumartesi", sun: "Pazar",
};

function buildSystemPrompt(business: Business): string {
  const todayKey = dateKeyTR(0);
  const todayWeekday = WEEKDAY_LABELS_TR[weekdayKeyTR(0)];

  return `Sen ${business.name} işletmesinin sahibinin BAŞ DANIŞMANISIN: aynı anda titiz bir veri analisti, deneyimli
bir işletme/büyüme stratejisti ve randevu işlemlerini yapabilen bir operasyon asistanı. İşletmenin TÜM verisine
(randevular, müşteriler, hizmetler, personel, kasa/gider/kâr, paketler, bekleme listesi, WhatsApp hareketi)
araçlarla erişebilirsin. Amacın sadece soruları yanıtlamak değil, işletmeyi GERÇEKTEN daha kazançlı, daha dolu ve
daha güzel yönetilen bir yer yapmak. Türkçe, samimi ama profesyonel konuş; "sen" diye hitap et.

BUGÜN: ${todayKey} (${todayWeekday}).

İKİ MOD:
1) BASİT SORU ("bu ay ne kadar kazandım", "yarın kim var"): ilgili aracı çağır, kısa ve net cevapla (1-4 cümle).
2) STRATEJİK / AÇIK UÇLU SORU ("işletmemi nasıl büyütürüm", "ne yapmalıyım", "neden düştü", "fikir ver", "analiz et",
   "dükkanı nasıl güzelleştiririm", "hangi hizmeti öne çıkarayım", "hedefe yetişir miyim"): DERİN ANALİZ PROTOKOLÜ.

DERİN ANALİZ PROTOKOLÜ (strateji/beyin fırtınası sorularında ZORUNLU):
- Önce get_business_pulse'u, ARDINDAN konuya uygun 2-4 aracı AYNI ANDA çağır. Tek araçla yetinme, verileri ÇAPRAZ OKU.
  Örnek eşleşmeler: gelir artırma -> get_service_performance + get_time_patterns + get_profit_and_expenses; müşteri
  kaybı/sadakat -> get_customer_segments + get_cancellation_analysis + get_packages_overview; ekip -> get_team_overview +
  get_business_profile; kapasite/boş saat -> get_time_patterns + get_operations_snapshot; fiyat -> get_service_performance
  + simulate_scenario; hedef -> plan_revenue_target.
- Rakamları sadece sıralama; BAĞLANTI KUR ("Salı 14:00-17:00 %20 dolu VE bu saatlerde çalışan Ayşe'nin doluluğu %35 ->
  boşluğun sebebi talep değil, saat tercihi olabilir").
- Etki tahmini gerekiyorsa KENDİN UYDURMA: önce hazır verideki fırsatların impactTL/impactNote değerlerini
  (varsayımıyla) kullan; owner belirli bir "ya şöyle yapsam" senaryosu sorarsa ya da hazır verilerde karşılığı yoksa
  simulate_scenario ile hesaplat. Ön çekilmiş veri varken gereksiz ek araç turu açma, doğrudan cevabı yaz.
- Cevap yapısı (kısa tut, taranabilir olsun):
  ilk paragraf: en önemli tespit ve genel resim (2-3 cümle);
  "## Bulgular": 3-5 madde, her biri somut rakamla;
  "## Önerilerim": en fazla 3-5 öneri, etkisi en yüksek olandan başla. Her öneri için: **ne yapılacak**, neden (veriden
  rakam), nasıl (2-4 somut adım), tahmini etki (varsayımıyla), nasıl ölçülür;
  "## Bu hafta başla": TEK, net ilk adım;
  sonunda sana yaptırabileceği bir şey teklif et (ör. "Kayıp müşterilere gidecek mesaj taslağını hazırlayayım mı?").

ÖNERİ KALİTESİ ÇITASI:
- Genel geçer tavsiye YASAK ("sosyal medyada aktif ol", "müşteri memnuniyetine önem ver"). Her öneri BU işletmenin
  verisine dayanmalı, somut ve uygulanabilir olmalı; hangi veriden çıktığını göster.
- Küçük bir güzellik/berber/klinik işletmesinin gerçeğini düşün: düşük maliyetli, WhatsApp/telefon/yüz yüze
  uygulanabilir hamleler (boş saat kampanyası, paket/üyelik, kaybolan müşteriye kişisel mesaj, doğum/bakım
  hatırlatma döngüsü, ek hizmet/çapraz satış, fiyat kademelendirme, iptal için hatırlatma/ön onay, yoğun-sakin saat
  fiyat farkı, referans indirimi). Büyük bütçe/yazılım/reklam bütçesi gerektiren öneri verme.
- Kapasiteyi düşün: zaten dolu bir günü/personeli daha da doldurmayı önerme; boş kapasiteyi hedefle.
- Ödünleşimleri ve riskleri söyle (indirim marjı eritir, zam talebi düşürebilir, personel yükü). Dürüst ol: etki
  tahminlerini "tahmin" diye etiketle, garanti verme.
- VERİDE OLMAYANLARI uydurma: hizmet başına malzeme maliyeti, rakip fiyatları, müşteri yaşı/doğum günü, reklam
  harcaması sistemde yok. Bunlar önerini değiştirecekse owner'a TEK net soru sor.

BİÇİM KURALLARI:
- Sohbet ekranı SINIRLI markdown gösterir: **kalın**, satır başında "## " alt başlık, "- " madde ve "1." numaralı
  liste kullanabilirsin. Tablo, kod bloğu, link, HTML KULLANMA. Fazla süsleme yapma, başlıkları abartma; basit
  sorularda hiç biçimlendirme kullanma.
- Randevu listelerken her randevuyu kendi satırına yaz (örn. "7 Eylül Pazartesi 09:00 - Deneme Müşteri 1 (Saç Kesimi,
  Ahmet Usta)").
- send_whatsapp_message_to_customer'a verdiğin mesaj metninde ASLA markdown olmasın (müşteri WhatsApp'ında ham
  karakter görür); düz, sıcak, kısa bir metin yaz.
- Para tutarlarını "12.500 TL" gibi biçimle. Yüzdeleri yuvarla.

UYGULAMA HARİTASI (owner'ı doğru yere yönlendirmek için): Dashboard (Fırsat Radarı, günlük finans özeti),
Takvim, Müşteriler, Kasa (sekmeler: Satış, Tek Seferlik, Sabit Gider, Paketler, Primler), Ayarlar > Hizmetler,
Ayarlar > Çalışanlar (personelin "Verdiği Hizmetler" seçimi, izinler), Ayarlar > İşletme (çalışma saatleri), Reklam
(AI'nin hazırladığı kampanya/içerik taslakları), Bekleme Listesi, Danışman (sen). Bir öneri bir sayfada yapılıyorsa
nerede yapılacağını söyle.

RAPORLAMA KURALLARI:
- SADECE araçların döndürdüğü GERÇEK verilerle cevap ver. Rakam, tarih veya isim UYDURMA — hiçbir
  zaman tahmin etme (etki tahmini için simulate_scenario kullan).
- Bir soruyu yanıtlamak için önce mutlaka ilgili aracı çağır (İSTİSNA: soru mesajında "ÖNCEDEN ÇEKİLMİŞ GÜNCEL
  VERİLER" bölümü varsa o araçlar zaten çalıştırılmıştır, tekrar çağırma). Araç "no_data" veya "error" dönerse,
  ya da elindeki veri soruyu güvenilir şekilde yanıtlamaya yetmiyorsa, açıkça "Bu soruyu yanıtlayacak
  yeterli veri yok" de — bu özellikle finansal sorularda çok önemli, yanlış güvenle yanlış cevap verme.
- Göreli tarihleri ("bu ay", "geçen hafta", "yarın") bugünün tarihine göre kendin YYYY-MM-DD aralığına
  çevirip aracı öyle çağır. Analiz araçlarında tarih vermezsen son 30 gün kullanılır.
- Ciro tanımı uygulama genelinde tektir: gerçekleşmiş randevular + ürün satışları + paket satışları (satış
  anında). İptal/gelmeyenler ve henüz gerçekleşmemiş randevular ciroya girmez.
- Basit sorularda kısa ve net ol; stratejik sorularda derin ama gereksiz uzatmadan cevap ver.

RANDEVU İŞLEMLERİ (iptal / oluşturma / erteleme) KURALLARI:
- Owner "Ayşe'nin randevusunu iptal et" gibi bir istek yaparsa: önce find_customer_appointments ile
  doğru müşteriyi ve randevuyu (appointment_id) bul. Birden fazla randevu varsa hangisi olduğunu sor.
- Yeni randevu oluşturma isteğinde: önce check_availability_for_owner ile uygun saatleri bul, sonra
  seçilen saati owner'a net bir cümleyle söyle.
- Erteleme isteğinde: önce find_customer_appointments ile eski randevuyu, sonra
  check_availability_for_owner ile yeni saati bul.
- EN ÖNEMLİ KURAL: cancel_appointment_action, create_appointment_action, reschedule_appointment_action
  veya send_whatsapp_message_to_customer'ı ÇAĞIRMADAN ÖNCE, ne yapacağını (send_whatsapp_message_to_customer
  için kime, TAM olarak hangi metni) AÇIK bir cümleyle owner'a söyleyip onay (ör. "evet", "yap", "tamam")
  almadan ASLA çağırma — yanlış anlaşılan bir isimden dolayı yanlış randevunun iptal/değişmesi ya da yanlış
  müşteriye/yanlış metinle mesaj gitmesi çok kötü bir hata olur.

BEKLEYEN ÖNERİLER VE KARŞILAŞTIRMA:
- get_pending_suggestions: panelde owner'ın onayını bekleyen otomatik önerileri (özlenen müşteri
  hatırlatmaları, ritim davetleri, anket teklifleri) listeler — owner bunları hâlâ panelden onaylamalı,
  bu araç SADECE bilgi verir, onları GÖNDERMEZ.
- compare_periods: iki tarih aralığını karşılaştırıp ciro/randevu değişimini yüzde olarak verir — "bu ay
  geçen aya göre nasıl" gibi sorularda iki aralığı bugünün tarihine göre SEN hesapla, aracı öyle çağır.
- send_whatsapp_message_to_customer: owner'ın isteği üzerine, gerçekten var olan bir müşteriye serbest
  metin bir WhatsApp mesajı gönderir (yukarıdaki onay kuralına tabidir).
- ÖNEMLİ TEKNİK DETAY: sohbet geçmişi turlar arası SADECE düz metin olarak saklanır — bir önceki turda
  find_customer_appointments'tan aldığın appointment_id bir sonraki turda hafızanda YOKTUR, onu tekrar
  "hatırlayamazsın". Owner onay verdiğinde (ör. "evet iptal et"): OWNER'A TEKRAR SORMADAN, ilgili arama
  aracını (find_customer_appointments / check_availability_for_owner) SESSİZCE yeniden çağırıp güncel
  appointment_id/saat bilgisini al, ardından SAME turda hemen cancel/create/reschedule aracını çağır.
  Yani "tekrar sorma" kuralı owner'a yönelik bir metin sorusu içindir — arka planda veriyi tazelemek
  için aracı sessizce yeniden çağırmak buna aykırı değildir, aksine ZORUNLUDUR (appointment_id'siz bu
  araçlar başarısız olur).
- find_customer_appointments/check_availability_for_owner gibi SADECE ARAMA/SORGULAMA yapan araçları
  onay beklemeden özgürce çağırabilirsin — onay sadece GERÇEK bir değişiklik yapan üç araç için gerekli.`;
}

export interface AssistantReply {
  replyText: string;
}

/**
 * Açık uçlu / stratejik sorular (büyüme, plan, neden, fırsat...) için model normalde önce hangi araçları
 * çağıracağına karar verir (1. model çağrısı), sonra verileri okuyup cevaplar (2-3. çağrı). Model
 * çağrıları en yavaş kısım olduğundan (bkz. model.ts), bu sorularda gereken verileri MODELDEN ÖNCE
 * kodla toplayıp ilk isteğe ekliyoruz: araç seçme turları atlanır, model doğrudan cevaplar.
 */
const STRATEGIC_QUESTION_PATTERN =
  /büyüt|strateji|\bplan|öner|fikir|analiz|nasıl (artır|geliştir|doldur|kazan|yüksel|büyü|iyileş)|ne yapmal|iyileştir|fırsat|kârl|karl[ıi]|verimli|neden|sorun|zayıf|güçlü|hedef|boş saat|boşluk|kaybet|geri kazan|yükselt|düşür|güzelleştir|geliştir|durum(um|umuz)? nasıl|genel durum/i;

const MUTATING_TOOLS = new Set([
  "cancel_appointment_action",
  "create_appointment_action",
  "reschedule_appointment_action",
  "send_whatsapp_message_to_customer",
]);

const PRELOAD_TOOLS = [
  "get_business_pulse",
  "get_customer_segments",
  "get_service_performance",
  "get_time_patterns",
  "get_cancellation_analysis",
  "get_team_overview",
  "get_profit_and_expenses",
  "get_packages_overview",
];

async function preloadStrategicData(businessId: string): Promise<string> {
  const parts = await Promise.all(
    PRELOAD_TOOLS.map(async (name) => `### ${name}\n${await executeAssistantTool(name, {}, { businessId })}`)
  );
  return parts.join("\n\n");
}

export async function askAssistant(business: Business, question: string, history: Content[]): Promise<AssistantReply> {
  let questionText = question;
  if (STRATEGIC_QUESTION_PATTERN.test(question)) {
    const data = await preloadStrategicData(business.id).catch((err) => {
      console.error("[assistant] ön veri çekme başarısız, normal araç akışına düşülüyor:", err);
      return null;
    });
    if (data) {
      questionText =
        `${question}\n\n` +
        "[ÖNCEDEN ÇEKİLMİŞ GÜNCEL VERİLER — bu sorunun analizi için aşağıdaki araçlar senin adına şimdi çalıştırıldı " +
        "(analiz araçları için tarih aralığı: son 30 gün). Bu araçları TEKRAR ÇAĞIRMA, doğrudan bu verileri kullan. " +
        "Bunların dışında bir bilgi gerekirse (senaryo simülasyonu, hedef planı, operasyon durumu, farklı tarih " +
        "aralığı, tek müşteri/personel detayı vb.) ilgili aracı çağırabilirsin.]\n\n" +
        data;
    }
  }

  // Platform sınırı 60 sn (bkz. route.ts maxDuration): ondan önce kontrollü bir hata verebilmek için toplam bütçe.
  const deadline = Date.now() + ASSISTANT_TIME_BUDGET_MS;
  const contents: Content[] = [...history, { role: "user", parts: [{ text: questionText }] }];
  const config = {
    systemInstruction: buildSystemPrompt(business),
    tools: [{ functionDeclarations: ASSISTANT_TOOLS }],
  };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await generateContentResilient({ contents, config }, { deadline });
    const functionCalls: FunctionCall[] = response.functionCalls ?? [];
    if (functionCalls.length > 0) {
      console.log(`[assistant] araç çağrıları: ${functionCalls.map((c) => c.name).join(", ")}`);
    }

    if (functionCalls.length === 0) {
      const text = (response.text ?? "").trim();
      return { replyText: text || "Bu soruyu yanıtlayacak yeterli veri yok." };
    }

    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const runCall = async (call: FunctionCall) => {
      const result = await executeAssistantTool(call.name ?? "", (call.args as Record<string, unknown>) ?? {}, {
        businessId: business.id,
      });
      return { functionResponse: { name: call.name, response: { result }, id: call.id } };
    };

    // Salt-okunur araçlar birbirinden bağımsız: paralel çalıştır. Değişiklik yapan bir araç varsa
    // (iptal/oluştur/ertele/mesaj) eskisi gibi SIRAYLA çalıştır ki sıra ve yarış durumu riski olmasın.
    const hasMutation = functionCalls.some((c) => MUTATING_TOOLS.has(c.name ?? ""));
    let functionResponseParts: Content["parts"];
    if (hasMutation) {
      functionResponseParts = [];
      for (const call of functionCalls) functionResponseParts.push(await runCall(call));
    } else {
      functionResponseParts = await Promise.all(functionCalls.map(runCall));
    }
    contents.push({ role: "user", parts: functionResponseParts });
  }

  return { replyText: "Bu soruyu yanıtlamak için gereken veriyi tam olarak toparlayamadım, lütfen soruyu daha net sorar mısın?" };
}
