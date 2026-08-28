import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { z } from "zod";

const expertiseSchema = z.object({
  service_ids: z.array(z.uuid()),
});

// Bir personelin uzman olduğu hizmet listesini komple değiştirir
// (AtlasPlan'daki "doğru uzmana atama" mantığı — AI bu tabloya bakarak eşleştirme yapar).
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/staff/[id]/expertise">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id: staffId } = await ctx.params;
    const { service_ids } = expertiseSchema.parse(await request.json());

    // Personelin gerçekten bu işletmeye ait olduğunu doğrula.
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id")
      .eq("business_id", owner.business_id)
      .eq("id", staffId)
      .single();

    if (staffError || !staff) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from("staff_service_expertise")
      .delete()
      .eq("staff_id", staffId);
    if (deleteError) throw deleteError;

    if (service_ids.length > 0) {
      const { error: insertError } = await supabase
        .from("staff_service_expertise")
        .insert(service_ids.map((service_id) => ({ staff_id: staffId, service_id })));
      if (insertError) throw insertError;
    }

    return NextResponse.json({ data: { staff_id: staffId, service_ids } });
  });
}
