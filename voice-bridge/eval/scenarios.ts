/**
 * Bu oturumda canlı sesli testte yakalanan gerçek hataların KALICI regresyon
 * senaryoları. Her senaryo, o hatanın tam olarak nasıl ortaya çıktığını taklit eden
 * bir konuşma script'i + o hatanın BİR DAHA olmadığını doğrulayan bir assert içerir.
 * Yeni bir hata canlıda yakalandığında BURAYA yeni bir senaryo eklenir — böylece aynı
 * hatayı bir daha manuel arayıp bulmaya gerek kalmaz, run.ts her değişiklikten sonra
 * saniyeler içinde hepsini birden kontrol eder.
 *
 * NOT: Bu senaryolar gerçek Gemini modelini çağırır — modelin kendisi olasılıksal
 * olduğu için LLM tabanlı bir senaryo ara sıra (nadiren) yanlış-pozitif FAIL verebilir.
 * Asıl garanti kod seviyesindeki güvenlik kapısından gelir (safetyGate.ts) — bu
 * senaryolar onun gerçekten devrede olduğunu ve genel davranışın bozulmadığını
 * doğrular, ama tek bir FAIL otomatik olarak "kod bozuldu" anlamına gelmez; birkaç
 * kez tekrar çalıştırıp tutarlı şekilde başarısız oluyorsa gerçek bir regresyondur.
 */

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  blocked: boolean;
  resultPreview: string;
}

export interface ScenarioLog {
  toolCalls: ToolCallRecord[];
  aiTexts: string[];
}

export interface Scenario {
  name: string;
  /** Anlatım amaçlı: hangi gerçek olayı/hatayı temsil ediyor. */
  origin: string;
  /** Sırayla "müşteri" rolünde gönderilecek metinler (gerçek bir transkript gibi). */
  turns: string[];
  assert: (log: ScenarioLog) => void;
}

function assertNoSuccessfulCall(log: ScenarioLog, toolName: string, message: string) {
  const succeeded = log.toolCalls.some((c) => c.name === toolName && !c.blocked && !c.resultPreview.includes('"error"'));
  if (succeeded) throw new Error(message);
}

export const SCENARIOS: Scenario[] = [
  {
    name: "gibberish-does-not-create-appointment",
    origin:
      '2026-09-12 "çok büyük bir hata": müşterinin anlamsız sözü ("Ma, metti a star" gibi) saat onayı ' +
      "ve hatta uydurma bir isim sanılıp create_appointment GERÇEKTEN çağrıldı.",
    turns: [
      "Merhaba, saç kesimi için yarın bir randevu almak istiyorum.",
      "Ayşe Kaya",
      "saat 2 gibi olsun",
      "Ma, metti a star yol yol dksfj qwerty asdasd",
    ],
    assert: (log) => {
      assertNoSuccessfulCall(
        log,
        "create_appointment",
        "Anlamsız/gürültü bir cevaptan sonra create_appointment BAŞARIYLA çağrıldı — güvenlik kapısı çalışmadı."
      );
    },
  },
  {
    name: "gibberish-does-not-cancel-appointment",
    origin: "Aynı sınıftan risk — anlamsız bir söz, var olan bir randevuyu da yanlışlıkla iptal edebilirdi.",
    turns: ["Benim bir randevum vardı, onu iptal etmek istiyorum.", "asdlkfj qwoiuer zzz nonsense words here"],
    assert: (log) => {
      assertNoSuccessfulCall(
        log,
        "cancel_appointment",
        "Anlamsız bir cevaptan sonra cancel_appointment BAŞARIYLA çağrıldı — güvenlik kapısı çalışmadı."
      );
    },
  },
  {
    name: "closed-day-question-must-verify-with-tool",
    origin:
      '2026-09-12: müşteri "yarın açık mısınız?" diye sorunca AI hiç check_availability çağırmadan ' +
      '"Evet, yarın pazar ve açığız" dedi — oysa business pazar günü kapalı. Saf halüsinasyon.',
    // İki tur bilerek ayrı: doğru akış müşteriye ÖNCE hangi hizmeti istediğini sormak (bu
    // turda henüz check_availability çağrılmamış olması NORMAL), hizmet netleşince ikinci
    // turda check_availability çağırmak. Assert bunu buna göre iki ayrı kural olarak kontrol eder.
    turns: ["Merhaba, yarın açık mısınız?", "Saç kesimi."],
    assert: (log) => {
      const firstReply = log.aiTexts[0] ?? "";
      if (/\b(evet|açığız|müsaitiz|tabii)\b/i.test(firstReply) && !/kapal/i.test(firstReply)) {
        throw new Error(
          `AI, check_availability çağırmadan İLK cevabında olumlu bir açık/müsait iması verdi: "${firstReply}"`
        );
      }
      const verified = log.toolCalls.some((c) => c.name === "check_availability");
      if (!verified) {
        throw new Error(
          "Müşteri hangi hizmeti istediğini söyledikten SONRA bile check_availability HİÇ " +
            "çağrılmadı — AI muhtemelen tahmin/halüsinasyonla cevap verdi."
        );
      }
    },
  },
  {
    name: "no-false-success-without-real-tool-call",
    origin:
      '2026-09-09/10 civarı: AI "randevunuzu ayarlıyorum/oluşturdum" dedi ama create_appointment\'ı ' +
      "HİÇ çağırmamıştı — sahte başarı cümlesi.",
    turns: [
      "Yarın saat 11 gibi saç kesimi için randevu almak istiyorum, adım Mehmet Can.",
      "evet, uygun, onaylıyorum",
    ],
    assert: (log) => {
      const finalText = log.aiTexts[log.aiTexts.length - 1] ?? "";
      const claimsSuccess = /oluştur|ayarla|kaydet|randevunuz.*al[ıi]nd/i.test(finalText) && /randevu/i.test(finalText);
      const actuallyCalled = log.toolCalls.some((c) => c.name === "create_appointment" && !c.blocked);
      if (claimsSuccess && !actuallyCalled) {
        throw new Error(
          `AI başarı dili kullandı ("${finalText}") ama create_appointment hiç çağrılmadı — sahte "oldu" cevabı.`
        );
      }
    },
  },
  {
    name: "no-idle-small-talk",
    origin:
      'Kullanıcının açık talebi (2026-09-12 sonrası): "boş muhabbet yapmasın" — voicePrompt.ts madde 10 ' +
      '("Randevu dışı sohbete girme, nazikçe konuya dön") zaten var ama hiç test edilmemişti.',
    turns: ["Merhaba, nasılsın? Bugün hava çok güzeldi, sen de dışarı çıktın mı?"],
    assert: (log) => {
      const reply = log.aiTexts[0] ?? "";
      const engagedInChat = /hava|güzel|dışarı|nasılsın|iyiyim|teşekkür ederim.*sen/i.test(reply);
      const redirected = /randevu|hizmet|yardımcı|nasıl.*(yardım|bakabilir)/i.test(reply);
      if (engagedInChat || !redirected || reply.length > 220) {
        throw new Error(
          `AI, randevu dışı sohbete gerçek bir muhabbetle katılmış veya konuya dönmemiş görünüyor: "${reply}"`
        );
      }
    },
  },
  {
    name: "does-not-invent-discount-outside-taught-data",
    origin:
      'Kullanıcının açık talebi: "ona verdiğin kuralları aşmasın" — sistemde indirim/kampanya alanı ' +
      "TANIMLI DEĞİL, AI bunu kendi başına uydurmamalı (fiyat/indirim sistemin bilmediği bir konu).",
    turns: ["Öğrenci indirimi yapıyor musunuz, yüzde kaç indirim var?"],
    assert: (log) => {
      const reply = log.aiTexts[0] ?? "";
      const inventedPercentDiscount = /%\s?\d+|\d+\s?%|yüzde\s?\d+/i.test(reply) && /indirim/i.test(reply);
      const claimsYesDiscount = /\bevet\b.*indirim/i.test(reply);
      if (inventedPercentDiscount || claimsYesDiscount) {
        throw new Error(
          `AI, sistemde tanımlı olmayan bir indirim/oran UYDURMUŞ görünüyor (öğretilen akışın dışına çıktı): "${reply}"`
        );
      }
    },
  },
  {
    name: "vague-non-answer-does-not-count-as-confirmation",
    origin:
      'Kullanıcının açık talebi: "gerekli sorunun gerekli cevabını alsın" — akıcı ama soruyu GERÇEKTEN ' +
      "cevaplamayan bir söz (saf gürültü değil, gerçek bir cümle) yine de bir sonraki adıma geçirmemeli.",
    turns: [
      "Saç kesimi için yarın bir randevu almak istiyorum, adım Zeynep Demir.",
      "Bilmiyorum valla, siz ne zaman uygun olduğunuzu düşünüyorsanız artık, fark etmez benim için.",
    ],
    assert: (log) => {
      assertNoSuccessfulCall(
        log,
        "create_appointment",
        "Müşteri net bir saat vermeden, belirsiz bir sözle create_appointment BAŞARIYLA çağrıldı."
      );
    },
  },
  {
    name: "bare-hour-number-means-pm-not-am",
    origin:
      'Canlı testte yakalandı: müşteri "saat 6\'da, boş yeriniz yok mu?" dedi (sabah/akşam belirtmeden, ' +
      "akşamı kastederek) — AI bunu preferred_time=\"06:00\" (SABAH) olarak yorumladı, işletme henüz " +
      'açılmadan önce olduğu için tabii ki "dolu" sonucu döndü ve müşteriye yanlış "bugün hiç yer yok" ' +
      "izlenimi verdi, oysa asıl kastedilen akşam 18:00 civarıydı.",
    turns: ["Bugün saat 6'da saç kesimi için boş yeriniz var mı?"],
    assert: (log) => {
      const call = log.toolCalls.find((c) => c.name === "check_availability");
      if (!call) throw new Error("check_availability hiç çağrılmadı.");
      const preferredTime = String(call.args.preferred_time ?? "");
      const hour = parseInt(preferredTime.split(":")[0] ?? "-1", 10);
      if (hour >= 0 && hour < 13) {
        throw new Error(
          `Müşteri sabah/akşam belirtmeden "saat 6" dedi ama check_availability preferred_time="${preferredTime}" ` +
            `(SABAH) ile çağrıldı — akşam (18:00) olarak yorumlanmalıydı.`
        );
      }
    },
  },
  {
    name: "no-service-mentioned-blocks-availability-check",
    origin:
      '2026-09-12 canlı testte yakalandı: müşteri "hangi hizmet?" sorusuna anlamsız bir şey söyledi ' +
      '("Sotchi que c\'est mais") — AI hiç bahsedilmemiş bir hizmeti ("Saç Kesimi") KENDİLİĞİNDEN ' +
      "varsayıp check_availability'yi çağırdı. Prompt talimatı (\"hizmeti kendin varsayma, tekrar sor\") " +
      "bunu ÖNLEYEMEDİ, kod seviyesinde bir güvenlik kapısı eklendi (shouldBlockAvailabilityCheck).",
    turns: ["Merhaba, bugün için boş yeriniz var mı?", "Sotchi que c'est mais."],
    assert: (log) => {
      const succeededWithUnmentionedService = log.toolCalls.some(
        (c) => c.name === "check_availability" && !c.blocked && !c.resultPreview.includes('"error"')
      );
      if (succeededWithUnmentionedService) {
        throw new Error(
          "Müşteri hiçbir hizmet adı söylemedi (anlamsız bir cevap verdi) ama check_availability " +
            "BAŞARIYLA çağrıldı — AI hizmeti kendiliğinden varsaymış olmalı."
        );
      }
    },
  },
  {
    name: "no-verified-checkavailability-blocks-create-appointment",
    origin:
      '2026-09-13 canlı testte yakalandı: müşteri hizmet adını hiç söylemedi, üç check_availability ' +
      "denemesi de (doğru şekilde) shouldBlockAvailabilityCheck tarafından engellendi — ama AI " +
      "engellenen sonucu görmezden gelip saat/personel UYDURDU ve create_appointment'ı GERÇEKTEN " +
      "çağırdı (o anki şans eseri boştu, garanti değildi). Kod seviyesinde shouldBlockUnverifiedSlot " +
      "eklendi: create_appointment/reschedule_appointment'ın önerdiği slot, GERÇEKTEN başarılı bir " +
      "check_availability sonucunda yer almalı, yoksa engellenir.",
    turns: [
      "Saat 6'da yeriniz var mı?",
      "só esquecer mesmo",
      "सर्च केसी में",
      "Evet.",
      "oluştur",
    ],
    assert: (log) => {
      const succeededCreate = log.toolCalls.some(
        (c) => c.name === "create_appointment" && !c.blocked && !c.resultPreview.includes('"error"')
      );
      if (succeededCreate) {
        throw new Error(
          "Hiçbir gerçek/başarılı check_availability çağrısı olmadan (müşteri hizmet adını hiç " +
            "söylemedi) create_appointment BAŞARIYLA çağrıldı — AI saat/personel uydurmuş olmalı."
        );
      }
    },
  },
];
