// supabase/schema.sql ile birebir eşleşir. Şema değişince burası da güncellenmeli.

export type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed";
export type Attendance = "came" | "no_show_notified" | "no_show_silent" | null;
export type ActiveStatus = "active" | "inactive";
export type ActionObjectStatus = "pending" | "approved" | "rejected" | "auto_sent";
export type WaitlistStatus = "open" | "fulfilled" | "expired";

export interface Business {
  id: string;
  name: string;
  timezone: string;
  whatsapp_phone_number_id: string | null;
  working_hours: Record<string, [string, string]>;
  closed_dates: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessOwner {
  id: string;
  business_id: string;
  auth_user_id: string;
  full_name: string;
  phone: string | null;
  created_at: string;
}

export interface Staff {
  id: string;
  business_id: string;
  full_name: string;
  working_hours: Record<string, [string, string]>;
  leave_dates: string[];
  commission_rate: number;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  category: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  full_name: string;
  phone: string;
  notes: string | null;
  preferred_staff_id: string | null;
  kvkk_consent_at: string | null;
  no_show_count: number;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  customer_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  attendance: Attendance;
  source: "whatsapp_ai" | "manual" | "phone_ai";
  reminder_24h_sent_at: string | null;
  reminder_1h_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentService {
  id: string;
  appointment_id: string;
  service_id: string;
  staff_id: string;
  planned_price: number;
  final_price: number | null;
  adjustment_note: string | null;
  created_at: string;
}

export interface DailyFinancialSummary {
  id: string;
  business_id: string;
  summary_date: string;
  actual_revenue: number;
  expenses: number;
  reconciled_at: string | null;
  created_at: string;
}

export interface ActionObject {
  id: string;
  business_id: string;
  type: string;
  related_customer_id: string | null;
  related_appointment_id: string | null;
  suggestion: string;
  reasoning: string;
  expected_impact: string | null;
  status: ActionObjectStatus;
  outcome: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface WaitlistEntry {
  id: string;
  business_id: string;
  customer_id: string;
  desired_service_id: string | null;
  desired_time_range: { from: string; to: string; days: string[] } | null;
  status: WaitlistStatus;
  created_at: string;
}

export interface WhatsappMessageLog {
  id: string;
  business_id: string;
  customer_id: string | null;
  direction: "inbound" | "outbound";
  message_type: "freeform" | "template";
  template_name: string | null;
  body: string | null;
  ai_confidence: number | null;
  escalated: boolean;
  created_at: string;
}
