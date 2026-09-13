import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { actionObjectUpdateSchema } from "@/lib/validation";
import { sendWhatsappTextMessage, sendWhatsappTemplateMessage } from "@/lib/whatsapp/client";
import { dayRangeUtcISO } from "@/lib/date";
import { DAILY_SURVEY_SENT_LOG_BODY } from "@/lib/dailySurvey";

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
      const { startUtc, endUtc } = dayRangeUtcISO(0);
      const { data: todaysAppts } = await supabase
        .from("appointments")
        .select("customer_id, customer:customers(phone, full_name)")
        .eq("business_id", owner.business_id)
        .neq("status", "cancelled")
        .gte("starts_at", startUtc)
        .lt("starts_at", endUtc)
        .lt("starts_at", new Date().toISOString());

      const seen = new Set<string>();
      let sent = 0;
      let failed = 0;
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
        }
      }
      outcome = `${sent} müşteriye anket mesajı gönderildi${failed > 0 ? `, ${failed} başarısız` : ""}`;

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
