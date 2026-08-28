import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { actionObjectUpdateSchema } from "@/lib/validation";
import { sendWhatsappTextMessage } from "@/lib/whatsapp/client";

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

    if (body.status === "approved") {
      const customer = (actionObject as unknown as { customer: { phone: string; full_name: string } | null }).customer;
      if (customer?.phone) {
        try {
          await sendWhatsappTextMessage(customer.phone, actionObject.suggestion);
          await supabase.from("whatsapp_message_log").insert({
            business_id: owner.business_id,
            customer_id: actionObject.related_customer_id,
            direction: "outbound",
            message_type: "freeform",
            body: actionObject.suggestion,
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
