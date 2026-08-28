import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { businessUpdateSchema } from "@/lib/validation";

export async function PATCH(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = businessUpdateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("businesses")
      .update(body)
      .eq("id", owner.business_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}
