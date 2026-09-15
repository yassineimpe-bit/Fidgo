create extension if not exists pgcrypto;

create table if not exists establishments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  primary_color text not null default '#111111',
  address text,
  phone text,
  instagram text,
  website text,
  opening_hours jsonb,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references establishments(id) on delete cascade,
  program_name text not null default 'Carte fidélité',
  mode text not null default 'STAMPS' check (mode in ('STAMPS','POINTS')),
  reward_threshold int not null default 10 check (reward_threshold > 0),
  reward_label text not null default 'Récompense offerte',
  reward_value_cents int,
  stamps_per_visit int not null default 1 check (stamps_per_visit > 0),
  points_rule text not null default 'PER_PURCHASE' check (points_rule in ('PER_PURCHASE','PER_EURO')),
  points_per_euro numeric(10,2) not null default 0 check (points_per_euro >= 0),
  points_per_purchase int not null default 10 check (points_per_purchase >= 0),
  daily_earn_limit int not null default 0 check (daily_earn_limit >= 0),
  cooldown_seconds int not null default 60 check (cooldown_seconds >= 0),
  expires_after_days int,
  card_message text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_users (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  email text not null,
  password_hash text not null,
  role text not null default 'EMPLOYEE' check (role in ('OWNER','MANAGER','EMPLOYEE','VIEWER')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_users_email_key on staff_users (lower(email));

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  email text,
  phone text,
  first_name text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists customers_estab_email_key on customers (establishment_id, lower(email)) where email is not null and deleted_at is null;
create unique index if not exists customers_estab_phone_key on customers (establishment_id, phone) where phone is not null and deleted_at is null;

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  token text not null unique,
  short_code text not null,
  balance int not null default 0 check (balance >= 0),
  last_earn_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cards_customer_key on cards (customer_id);
create unique index if not exists cards_estab_short_code on cards (establishment_id, short_code);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  staff_user_id uuid references staff_users(id),
  type text not null check (type in ('earn','redeem','adjust','reversal')),
  delta int not null,
  balance_after int not null check (balance_after >= 0),
  unit text not null check (unit in ('STAMP','POINT')),
  idempotency_key text not null,
  reversed_transaction_id uuid references transactions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists transactions_idem_key on transactions (establishment_id, idempotency_key);
create index if not exists transactions_card_idx on transactions (card_id, created_at desc);
create index if not exists transactions_estab_idx on transactions (establishment_id, created_at desc);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  title text not null,
  body text not null,
  channel text not null default 'web_push' check (channel in ('web_push','wallet','email','sms')),
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid references staff_users(id),
  created_at timestamptz not null default now()
);

create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  sent_at timestamptz,
  error text,
  unique(campaign_id, customer_id)
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists wallet_passes (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  provider text not null check (provider in ('APPLE','GOOGLE')),
  external_id text,
  serial_number text,
  authentication_token_hash text,
  status text not null default 'active' check (status in ('active','revoked','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(card_id, provider)
);

create table if not exists apple_wallet_registrations (
  id uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references wallet_passes(id) on delete cascade,
  device_library_identifier text not null,
  push_token text not null,
  created_at timestamptz not null default now(),
  unique(wallet_pass_id, device_library_identifier)
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references establishments(id) on delete cascade,
  provider text not null default 'stripe',
  external_customer_id text,
  external_subscription_id text,
  plan text not null default 'STARTER' check (plan in ('STARTER','PRO','PREMIUM')),
  status text not null default 'trial' check (status in ('trial','active','past_due','cancelled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid references establishments(id) on delete cascade,
  staff_user_id uuid references staff_users(id),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_estab_idx on audit_logs (establishment_id, created_at desc);

create table if not exists rate_limits (
  key_hash text primary key,
  hits int not null default 0,
  window_started_at timestamptz not null default now()
);
