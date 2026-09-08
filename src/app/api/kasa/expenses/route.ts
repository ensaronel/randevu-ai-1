import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { expenseItemCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const date = request.nextUrl.searchParams.get("date");

    let query = supabase
      .from("expense_items")
      .select("*")
      .eq("business_id", owner.business_id)
      .order("created_at", { ascending: true });

    if (date) {
      query = query.eq("expense_date", date);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = expenseItemCreateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("expense_items")
      .insert({ ...body, business_id: owner.business_id })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  });
}
