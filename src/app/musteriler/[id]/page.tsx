import { notFound } from "next/navigation";
import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import MusteriDetayClient, {
  type AppointmentHistoryItem,
  type ActionHistoryItem,
} from "@/app/musteriler/[id]/MusteriDetayClient";
import type { Customer, Staff } from "@/types/database";

type OneOrMany<T> = T | T[] | null;
type ApptServiceRow = {
  planned_price: number;
  final_price: number | null;
  adjustment_note: string | null;
  service: OneOrMany<{ name: string }>;
  staff: OneOrMany<{ full_name: string }>;
};
type ApptRow = {
  id: string;
  starts_at: string;
  status: string;
  attendance: string | null;
  appointment_services: ApptServiceRow[];
};

function one<T>(value: OneOrMany<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function MusteriDetayPage(props: PageProps<"/musteriler/[id]">) {
  const { id } = await props.params;
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data: customerData } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", business.id)
    .eq("id", id)
    .maybeSingle();
  if (!customerData) notFound();
  const customer = customerData as Customer;

  const [{ data: staffData }, { data: apptData }, { data: actionData }] = await Promise.all([
    supabase.from("staff").select("*").eq("business_id", business.id).order("full_name", { ascending: true }),
    supabase
      .from("appointments")
      .select(
        "id, starts_at, status, attendance, appointment_services(planned_price, final_price, adjustment_note, service:services(name), staff:staff(full_name))"
      )
      .eq("business_id", business.id)
      .eq("customer_id", id)
      .order("starts_at", { ascending: false }),
    supabase
      .from("action_objects")
      .select("*")
      .eq("business_id", business.id)
      .eq("related_customer_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const staffList = (staffData ?? []) as Staff[];
  const appointments = (apptData ?? []) as unknown as ApptRow[];

  const appointmentHistory: AppointmentHistoryItem[] = appointments.map((a) => ({
    id: a.id,
    starts_at: a.starts_at,
    status: a.status,
    attendance: a.attendance,
    services: a.appointment_services.map((svc) => ({
      name: one(svc.service)?.name ?? "Hizmet",
      staffName: one(svc.staff)?.full_name ?? null,
      price: Number(svc.final_price ?? svc.planned_price),
      adjustmentNote: svc.adjustment_note,
    })),
  }));

  const cameVisits = appointments.filter((a) => a.attendance === "came");
  const totalSpent = cameVisits.reduce(
    (sum, a) => sum + a.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
    0
  );
  // appointments zaten starts_at'e göre azalan sıralı geldiği için ilk "came" kayıt son ziyarettir.
  const lastVisitAt = cameVisits[0]?.starts_at ?? null;

  const actionHistory: ActionHistoryItem[] = (actionData ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    suggestion: a.suggestion,
    reasoning: a.reasoning,
    status: a.status,
    outcome: a.outcome,
    created_at: a.created_at,
  }));

  const hasPendingRetentionRisk = actionHistory.some((a) => a.type === "retention_risk" && a.status === "pending");
  const hasPendingRhythmInvite = actionHistory.some((a) => a.type === "rhythm_invite" && a.status === "pending");

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-md mx-auto w-full">
        <MusteriDetayClient
          customer={customer}
          staffList={staffList.map((s) => ({ id: s.id, full_name: s.full_name }))}
          totalSpent={totalSpent}
          visitCount={cameVisits.length}
          lastVisitAt={lastVisitAt}
          badges={{
            retentionRisk: hasPendingRetentionRisk,
            rhythmInvite: hasPendingRhythmInvite,
            frequentNoShow: customer.no_show_count >= 2,
          }}
          appointments={appointmentHistory}
          actionHistory={actionHistory}
        />
      </div>
      <BottomNav />
    </div>
  );
}
