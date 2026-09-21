import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { oneTimeSaleCreateSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = oneTimeSaleCreateSchema.parse(await request.json());

    let commissionRateSnapshot: number | null = null;
    if (body.staff_id) {
      const { data: staff, error: staffError } = await supabase
        .from("staff")
        .select("commission_rate")
        .eq("business_id", owner.business_id)
        .eq("id", body.staff_id)
        .single();
      if (staffError) throw staffError;
      commissionRateSnapshot = staff.commission_rate;
    }

    const { data, error } = await supabase
      .from("one_time_sales")
      .insert({ ...body, commission_rate_snapshot: commissionRateSnapshot, business_id: owner.business_id })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  });
}
