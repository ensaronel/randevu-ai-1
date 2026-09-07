import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { pushSubscribeSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { endpoint, keys } = pushSubscribeSchema.parse(await request.json());

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        business_id: owner.business_id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) throw error;

    return NextResponse.json({ success: true });
  });
}

export async function DELETE(request: NextRequest) {
  return handleRoute(async () => {
    const { supabase } = await requireBusinessOwner();
    const { endpoint } = (await request.json()) as { endpoint?: string };
    if (!endpoint) return NextResponse.json({ error: "endpoint gerekli" }, { status: 400 });

    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;

    return NextResponse.json({ success: true });
  });
}
