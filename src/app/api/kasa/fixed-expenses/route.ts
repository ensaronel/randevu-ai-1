import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { fixedExpenseCreateSchema } from "@/lib/validation";

export async function GET() {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();

    const { data, error } = await supabase
      .from("fixed_expenses")
      .select("*")
      .eq("business_id", owner.business_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = fixedExpenseCreateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("fixed_expenses")
      .insert({ ...body, business_id: owner.business_id })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  });
}
