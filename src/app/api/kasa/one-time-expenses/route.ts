import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { oneTimeExpenseCreateSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = oneTimeExpenseCreateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("one_time_expenses")
      .insert({ ...body, business_id: owner.business_id })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  });
}
