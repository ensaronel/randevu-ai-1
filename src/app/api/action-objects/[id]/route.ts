import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { actionObjectUpdateSchema } from "@/lib/validation";
import { sendWhatsappTextMessage, sendWhatsappTemplateMessage } from "@/lib/whatsapp/client";
import { dateKeyFromIso, dateKeyRangeUtcISO, dateKeyTR } from "@/lib/date";
import { DAILY_SURVEY_SENT_LOG_BODY } from "@/lib/dailySurvey";

/** Meta gönderim hatasını owner'ın anlayacağı kısa bir sebebe çevirir. */
function describeSendFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/131047|re-engagement|24 hour|24-hour/i.test(message)) {
    return "müşteri son 24 saatte yazmadığı için serbest mesaj gönderilemedi, onaylı şablon gerekir";
  }
  if (/131030|not in allowed list|allowed list/i.test(message)) {
    return "test numarası yalnızca izinli alıcılara gönderebilir";
  }
  if (/access token|OAuthException|190/i.test(message)) return "WhatsApp erişim anahtarı geçersiz veya süresi dolmuş";
  return message.slice(0, 120);
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/action-objects/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const body = actionObjectUpdateSchema.parse(await request.json());

    const { data: actionObject, error: loadError } = await supabase
      .from("action_objects")
      .select("*, customer:customers(phone, full_name)")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();
    if (loadError) throw loadError;

    let outcome = body.status === "rejected" ? "reddedildi" : "onaylandı";

    // daily_survey tek bir musteriye degil, o gun ugrayan TUM musterilere gider -
    // related_customer_id burada null (bkz. dailySurvey.ts), bu yuzden asagidaki
    // tekli-musteri gonderim mantigindan tamamen ayri, kendi fan-out'una sahip.
    if (body.status === "approved" && actionObject.type === "daily_survey") {
      // Anket kartı akşam (20:00) üretilir ama owner çoğu zaman ertesi gün onaylar. Önceden burada
      // "BUGÜN" (onay günü) randevularına bakılıyordu: ertesi gün onaylanınca hiç randevu bulunamayıp
      // "0 müşteriye gönderildi" oluyordu (22-23 Eylül kayıtlarında görüldü). Artık anketin KENDİ günü
      // (kartın üretildiği gün) esas alınır.
      const surveyDayKey = dateKeyFromIso(actionObject.created_at);

      // Anket sadece üretildiği gün (gece 12'ye kadar) gönderilebilir; sonrasında 24 saatlik WhatsApp
      // penceresi dolduğu için mesajlar gitmez. Eski bir kart yine de onaylanırsa gönderilmeden kapatılır.
      if (surveyDayKey !== dateKeyTR(0)) {
        const { data: expired, error: expireError } = await supabase
          .from("action_objects")
          .update({ status: "rejected", outcome: "süresi doldu — anket gece 12'ye kadar gönderilmedi", resolved_at: new Date().toISOString() })
          .eq("business_id", owner.business_id)
          .eq("id", id)
          .select()
          .single();
        if (expireError) throw expireError;
        return NextResponse.json({ data: expired });
      }

      const { startUtc, endUtc } = dateKeyRangeUtcISO(surveyDayKey, surveyDayKey);
      const { data: todaysAppts } = await supabase
        .from("appointments")
        .select("customer_id, customer:customers(phone, full_name)")
        .eq("business_id", owner.business_id)
        .neq("status", "cancelled")
        // Gelmeyen (no-show) müşteriye "ziyaretiniz nasıldı" denmez; attendance boşsa (işaretlenmemiş) gelmiş sayılır.
        .or("attendance.is.null,attendance.eq.came")
        .gte("starts_at", startUtc)
        .lte("starts_at", endUtc)
        .lt("starts_at", new Date().toISOString());

      const seen = new Set<string>();
      let sent = 0;
      let failed = 0;
      let firstFailureReason: string | null = null;
      for (const row of todaysAppts ?? []) {
        if (seen.has(row.customer_id)) continue;
        seen.add(row.customer_id);
        const customer = (row as unknown as { customer: { phone: string; full_name: string } | null }).customer;
        if (!customer?.phone) continue;
        try {
          await sendWhatsappTextMessage(
            customer.phone,
            `Merhaba ${customer.full_name}, bugünkü ziyaretiniz nasıldı? Bizi daha iyi hale getirmemiz için bir öneriniz varsa duymak isteriz 🙂`
          );
          await supabase.from("whatsapp_message_log").insert({
            business_id: owner.business_id,
            customer_id: row.customer_id,
            direction: "outbound",
            message_type: "system_notice",
            body: DAILY_SURVEY_SENT_LOG_BODY,
          });
          sent++;
        } catch (err) {
          failed++;
          console.error("anket mesajı gönderilemedi", customer.phone, err);
          firstFailureReason ??= describeSendFailure(err);
        }
      }
      outcome =
        seen.size === 0
          ? "Bu anketin gününde gelen müşteri bulunamadı, mesaj gönderilmedi"
          : `${sent} müşteriye anket mesajı gönderildi${failed > 0 ? `, ${failed} başarısız${firstFailureReason ? ` (${firstFailureReason})` : ""}` : ""}`;

      const { data, error } = await supabase
        .from("action_objects")
        .update({ status: body.status, outcome, resolved_at: new Date().toISOString() })
        .eq("business_id", owner.business_id)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ data });
    }

    if (body.status === "approved") {
      const customer = (actionObject as unknown as { customer: { phone: string; full_name: string } | null }).customer;
      // suggestion sahibe gösterilen öneri metni — müşteriye AYNEN customer_message gider,
      // ikisi farklı olabilir (ör. retention_risk/rhythm_invite'ta suggestion sahibe tavsiye).
      if (!actionObject.customer_message) {
        outcome = "gönderilecek müşteri mesajı tanımlı değil";
      } else if (customer?.phone) {
        try {
          // fill_gap/retention_risk/rhythm_invite musterileri cogunlukla Meta'nin
          // 24 saatlik serbest-metin penceresi disinda (ozelligin amaci zaten
          // uzun suredir yazmamis musteriyi bulmak) - whatsapp_template_name
          // doluysa onayli sablon kullanilir, yoksa (ör. eski/sablonsuz kayitlar
          // veya musteri zaten 24 saat icinde yazdiysa gecerli olan) serbest
          // metne dusulur. Bkz. supabase/schema.sql'deki not.
          if (actionObject.whatsapp_template_name) {
            await sendWhatsappTemplateMessage(
              customer.phone,
              actionObject.whatsapp_template_name,
              "tr",
              (actionObject.whatsapp_template_params as string[] | null) ?? []
            );
          } else {
            await sendWhatsappTextMessage(customer.phone, actionObject.customer_message);
          }
          await supabase.from("whatsapp_message_log").insert({
            business_id: owner.business_id,
            customer_id: actionObject.related_customer_id,
            direction: "outbound",
            message_type: "system_notice",
            body: actionObject.customer_message,
            template_name: actionObject.whatsapp_template_name,
          });
          outcome = "mesaj gönderildi";
        } catch (err) {
          outcome = `mesaj gönderilemedi: ${err instanceof Error ? err.message : "bilinmeyen hata"}`;
        }
      } else {
        outcome = "müşteri telefon numarası bulunamadı";
      }
    }

    const { data, error } = await supabase
      .from("action_objects")
      .update({ status: body.status, outcome, resolved_at: new Date().toISOString() })
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ data });
  });
}
