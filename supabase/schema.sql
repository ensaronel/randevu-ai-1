-- Randevu AI — Hafta 1 veri modeli
-- Bu dosya Supabase projesi oluşturulduktan sonra SQL Editor'de çalıştırılır.
-- Tasarım ilkeleri: soft-delete (durum alanı ile), migration disiplini,
-- çoklu işletme (multi-tenant) destekleyen ama MVP'de tek pilot işletmeyle kullanılan yapı.

create extension if not exists "pgcrypto";

-- ============================================================
-- İşletme
-- ============================================================
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Istanbul',
  whatsapp_phone_number_id text,          -- Meta WhatsApp Cloud API phone number id
  working_hours jsonb not null default '{}'::jsonb, -- { "mon": ["09:00","19:00"], ... }
  closed_dates date[] not null default '{}',        -- tatil / kapanış günleri
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- İşletme sahibi girişi (auth) — Supabase auth.users ile eşleşir
-- ============================================================
create table business_owners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  auth_user_id uuid not null unique,      -- supabase auth.users.id
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Personel
-- ============================================================
create table staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null,
  working_hours jsonb not null default '{}'::jsonb,  -- haftalık çalışma saatleri
  leave_dates date[] not null default '{}',          -- izin/tatil günleri
  commission_rate numeric(5,2) not null default 0,   -- % prim oranı (Hafta 10'da UI gelecek, şimdilik varsayılan)
  status text not null default 'active' check (status in ('active','inactive')), -- soft-delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Hizmet
-- ============================================================
create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price numeric(10,2) not null check (price >= 0),
  category text,                                     -- örn. "Kesim", "Boya", "Manikür", "Sakal"
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Personelin hangi hizmette uzman olduğu (AtlasPlan'daki "doğru uzmana atama" mantığı)
create table staff_service_expertise (
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ============================================================
-- Müşteri
-- ============================================================
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null,
  phone text not null,
  notes text,                                        -- tercih/alerji notu
  preferred_staff_id uuid references staff(id),
  kvkk_consent_at timestamptz,                        -- KVKK onay tarihi/saati (Hafta 4)
  no_show_count int not null default 0,               -- haber vermeden gelmeme sayacı
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone)
);

-- ============================================================
-- Randevu
-- ============================================================
create table appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','cancelled','completed')),
  attendance text
    check (attendance in ('came','no_show_notified','no_show_silent') or attendance is null),
  -- gün sonu mutabakatında doldurulur: geldi / haber verdi / haber vermeden gelmedi
  source text not null default 'whatsapp_ai' check (source in ('whatsapp_ai','manual','phone_ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bir randevu birden fazla hizmet içerebilir (örn. saç kesimi + manikür, farklı personel)
create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  service_id uuid not null references services(id),
  staff_id uuid not null references staff(id),
  planned_price numeric(10,2) not null,               -- randevu anındaki fiyat
  final_price numeric(10,2),                           -- gün sonu mutabakatında +ekle/-indirim sonrası kesin tutar
  adjustment_note text,                                 -- "50 TL oje eklendi" / "30 TL indirim"
  created_at timestamptz not null default now()
);

create index idx_appointments_business_time on appointments(business_id, starts_at);
create index idx_appointment_services_staff on appointment_services(staff_id);

-- ============================================================
-- Günlük finansal özet (gün sonu mutabakatı kapandığında hesaplanıp yazılır)
-- ============================================================
create table daily_financial_summaries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  summary_date date not null,
  actual_revenue numeric(12,2) not null default 0,     -- mutabakattan gelen gerçekleşen ciro
  expenses numeric(12,2) not null default 0,
  reconciled_at timestamptz,                            -- "Günü Kapat" ne zaman basıldı
  created_at timestamptz not null default now(),
  unique (business_id, summary_date)
);

-- ============================================================
-- AI aksiyon nesnesi — öneri/gerekçe/onay/sonuç döngüsü (güven eğrisi altyapısı)
-- ============================================================
create table action_objects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null,           -- 'fill_gap' | 'retention_risk' | 'rhythm_invite' | 'finance_note' | ...
  related_customer_id uuid references customers(id),
  related_appointment_id uuid references appointments(id),
  suggestion text not null,      -- öneri metni
  reasoning text not null,       -- gerekçe
  expected_impact text,          -- "tahmini 850 TL geri kazanım" gibi
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','auto_sent')),
  outcome text,                  -- sonuç (ör. "müşteri onayladı, randevu oluştu")
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index idx_action_objects_business_status on action_objects(business_id, status);

-- ============================================================
-- Bekleme listesi (boşluk doldurma için)
-- ============================================================
create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  desired_service_id uuid references services(id),
  desired_time_range jsonb,      -- { "from": "14:00", "to": "18:00", "days": ["tue","wed"] }
  status text not null default 'open' check (status in ('open','fulfilled','expired')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- WhatsApp mesaj günlüğü (hata bildirimi + izlenebilirlik için)
-- ============================================================
create table whatsapp_message_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'freeform' check (message_type in ('freeform','template')),
  template_name text,
  body text,
  ai_confidence numeric(3,2),     -- düşükse eskalasyon tetiklenir (Hafta 5)
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_whatsapp_log_business_time on whatsapp_message_log(business_id, created_at);

-- ============================================================
-- Row Level Security — bir işletme başka bir işletmenin verisini
-- ASLA görmemeli/değiştirmemeli. RLS olmadan Supabase varsayılan
-- olarak public tabloları API üzerinden herkese açık bırakır.
-- ============================================================

create or replace function current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id from business_owners where auth_user_id = auth.uid()
$$;

alter table businesses enable row level security;
alter table business_owners enable row level security;
alter table staff enable row level security;
alter table services enable row level security;
alter table staff_service_expertise enable row level security;
alter table customers enable row level security;
alter table appointments enable row level security;
alter table appointment_services enable row level security;
alter table daily_financial_summaries enable row level security;
alter table action_objects enable row level security;
alter table waitlist_entries enable row level security;
alter table whatsapp_message_log enable row level security;

-- business_owners: bir kullanıcı sadece kendi kaydını görebilir (current_business_id()
-- bu tabloyu SECURITY DEFINER ile okuduğu için burada döngü oluşmaz).
create policy "own owner row" on business_owners
  for select using (auth_user_id = auth.uid());

create policy "own business" on businesses
  for all using (id = current_business_id())
  with check (id = current_business_id());

create policy "own staff" on staff
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own services" on services
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own staff_service_expertise" on staff_service_expertise
  for all using (
    exists (select 1 from staff where staff.id = staff_service_expertise.staff_id and staff.business_id = current_business_id())
  )
  with check (
    exists (select 1 from staff where staff.id = staff_service_expertise.staff_id and staff.business_id = current_business_id())
  );

create policy "own customers" on customers
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own appointments" on appointments
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own appointment_services" on appointment_services
  for all using (
    exists (select 1 from appointments where appointments.id = appointment_services.appointment_id and appointments.business_id = current_business_id())
  )
  with check (
    exists (select 1 from appointments where appointments.id = appointment_services.appointment_id and appointments.business_id = current_business_id())
  );

create policy "own daily_financial_summaries" on daily_financial_summaries
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own action_objects" on action_objects
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own waitlist_entries" on waitlist_entries
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "own whatsapp_message_log" on whatsapp_message_log
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- NOT: whatsapp_message_log ve action_objects gibi tablolara AI backend'i
-- (webhook handler) admin/service-role client ile de yazacak (Hafta 4-5) —
-- service role RLS'yi zaten atlar, bu politikalar sadece owner'ın kendi
-- dashboard oturumundan yaptığı sorguları kapsar.

-- ============================================================
-- Randevu oluşturma — çakışma kontrolü + randevu + hizmet satırlarını
-- tek bir atomik işlemde yapar (yarım kalmış/çakışan randevu riski olmasın diye).
-- ============================================================
create or replace function create_appointment_with_services(
  p_customer_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_source text,
  p_services jsonb, -- [{ "service_id": "...", "staff_id": "...", "planned_price": 100 }, ...]
  p_business_id uuid default null -- sadece service-role (AI/webhook) çağrılarında geçilir
)
returns uuid
language plpgsql
security invoker
as $$
declare
  -- p_business_id verilmişse onu kullanır (service role RLS'yi zaten atlar,
  -- gerçek işletme sahibi oturumu için ise aşağıdaki insert'teki RLS "with
  -- check" politikası current_business_id()'e göre kontrol ettiği için
  -- yanlış bir p_business_id gönderilse bile reddedilir — bkz. schema
  -- yorumu). Owner oturumu p_business_id göndermez, current_business_id()'e düşer.
  v_business_id uuid := coalesce(p_business_id, current_business_id());
  v_appointment_id uuid;
  v_conflict_count int;
  v_service jsonb;
begin
  if v_business_id is null then
    raise exception 'unauthorized';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  -- Aynı personelin bu zaman aralığında (iptal edilmemiş) başka randevusu var mı?
  select count(*) into v_conflict_count
  from appointment_services asvc
  join appointments a on a.id = asvc.appointment_id
  where a.business_id = v_business_id
    and a.status != 'cancelled'
    and asvc.staff_id in (select (s->>'staff_id')::uuid from jsonb_array_elements(p_services) s)
    and a.starts_at < p_ends_at
    and a.ends_at > p_starts_at;

  if v_conflict_count > 0 then
    raise exception 'staff_conflict';
  end if;

  insert into appointments (business_id, customer_id, starts_at, ends_at, source)
  values (v_business_id, p_customer_id, p_starts_at, p_ends_at, coalesce(p_source, 'manual'))
  returning id into v_appointment_id;

  for v_service in select * from jsonb_array_elements(p_services)
  loop
    insert into appointment_services (appointment_id, service_id, staff_id, planned_price)
    values (
      v_appointment_id,
      (v_service->>'service_id')::uuid,
      (v_service->>'staff_id')::uuid,
      (v_service->>'planned_price')::numeric
    );
  end loop;

  return v_appointment_id;
end;
$$;

-- ============================================================
-- Gün Sonu Mutabakat — no_show_count'u atomik artır/azalt (Hafta 7).
-- security invoker: çağıran kullanıcının RLS'i geçerli, sadece kendi
-- işletmesinin müşterisini güncelleyebilir (customers RLS politikası zaten var).
-- ============================================================
create or replace function increment_no_show_count(p_customer_id uuid)
returns void
language sql
security invoker
as $$
  update customers set no_show_count = no_show_count + 1 where id = p_customer_id;
$$;

create or replace function decrement_no_show_count(p_customer_id uuid)
returns void
language sql
security invoker
as $$
  update customers set no_show_count = greatest(0, no_show_count - 1) where id = p_customer_id;
$$;

-- ============================================================
-- Tablo seviyesi izinler — RLS satır erişimini kısıtlar ama önce
-- rolün tabloya GRANT ile erişimi olması gerekir. service_role RLS'yi
-- atlar (admin client, ör. onboarding); authenticated RLS politikalarıyla
-- kendi işletmesine kısıtlanır. anon'a hiç izin verilmiyor, tüm sayfalar
-- login gerektiriyor.
-- ============================================================
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
