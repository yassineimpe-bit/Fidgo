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
  cooldown_seconds int not null default 120 check (cooldown_seconds >= 0),
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
  email_verified_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_users_email_key on staff_users (lower(email));
create unique index if not exists staff_users_one_owner_per_establishment on staff_users (establishment_id) where role = 'OWNER';

create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_tokens_staff_idx on email_verification_tokens (staff_user_id, created_at desc);
create index if not exists email_verification_tokens_expiry_idx on email_verification_tokens (expires_at) where used_at is null;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  email text,
  phone text,
  first_name text,
  internal_note text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint customers_erased_pii_check check (
    deleted_at is null or (
      email is null and phone is null and first_name is null
      and marketing_consent = false and marketing_consent_at is null
    )
  ),
  constraint customers_internal_note_check check (
    (internal_note is null or (char_length(internal_note) <= 500 and internal_note !~ '[<>]'))
    and (deleted_at is null or internal_note is null)
  )
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

create or replace function protect_retiko_transaction_ledger()
returns trigger language plpgsql as $ledger$
begin
  if tg_op = 'DELETE' then
    raise exception 'Transactions are append-only; use a compensating transaction.'
      using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.establishment_id is distinct from old.establishment_id
    or new.card_id is distinct from old.card_id
    or new.staff_user_id is distinct from old.staff_user_id
    or new.type is distinct from old.type
    or new.delta is distinct from old.delta
    or new.balance_after is distinct from old.balance_after
    or new.unit is distinct from old.unit
    or new.idempotency_key is distinct from old.idempotency_key
    or new.reversed_transaction_id is distinct from old.reversed_transaction_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Transaction financial fields are immutable.'
      using errcode = '55000';
  end if;
  if new.metadata is distinct from old.metadata
    and new.metadata is distinct from (old.metadata - 'reason' - 'overrideReason')
  then
    raise exception 'Transaction metadata may only be privacy-redacted.'
      using errcode = '55000';
  end if;
  return new;
end;
$ledger$;

drop trigger if exists transactions_ledger_immutable on transactions;
create trigger transactions_ledger_immutable
before update or delete on transactions
for each row execute function protect_retiko_transaction_ledger();

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
  plan text not null default 'PILOT' check (plan in ('PILOT','FLEX','RETIKO_12','ANNUAL')),
  billing_interval text check (billing_interval is null or billing_interval in ('monthly','annual')),
  status text not null default 'trial' check (status in ('trial','active','past_due','canceled','unpaid')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_last_event_created bigint,
  stripe_last_event_id text,
  legacy_plan text,
  stripe_checkout_session_id text,
  stripe_checkout_plan text check (stripe_checkout_plan is null or stripe_checkout_plan in ('FLEX','RETIKO_12','ANNUAL')),
  stripe_checkout_pending_at timestamptz,
  stripe_checkout_claim_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_external_customer_unique on subscriptions (external_customer_id) where external_customer_id is not null;
create unique index if not exists subscriptions_external_subscription_unique on subscriptions (external_subscription_id) where external_subscription_id is not null;
create unique index if not exists subscriptions_checkout_session_unique on subscriptions (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists subscriptions_status_idx on subscriptions (status, trial_ends_at);

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created bigint not null,
  establishment_id uuid references establishments(id) on delete set null,
  external_subscription_id text,
  processed_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_retention_idx on stripe_webhook_events (processed_at);

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
create index if not exists audit_logs_retention_idx on audit_logs (created_at);

create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid references cards(id) on delete set null,
  staff_user_id uuid references staff_users(id) on delete set null,
  event_type text not null check (event_type in ('JOIN_PAGE_VIEW','JOIN_SUBMIT','CAMERA_START','CAMERA_READY','CAMERA_FAILED','QR_DETECTED','SCAN_SENT','SCAN_SUCCESS','SCAN_FAILED','CREDIT_SUCCESS','REWARD_REDEEMED')),
  duration_ms int check (duration_ms is null or duration_ms between 0 and 60000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists product_events_estab_type_idx on product_events (establishment_id, event_type, created_at desc);
create index if not exists product_events_card_idx on product_events (card_id, created_at desc) where card_id is not null;
create index if not exists product_events_retention_idx on product_events (created_at);

create table if not exists rate_limits (
  key_hash text primary key,
  hits int not null default 0,
  window_started_at timestamptz not null default now()
);
create index if not exists rate_limits_retention_idx on rate_limits (window_started_at);
create index if not exists wallet_passes_revoked_retention_idx on wallet_passes (updated_at) where status = 'revoked';

-- Le produit expose uniquement des effacements/anonymisations et une
-- suspension. Une suppression SQL directe détruirait le ledger via les
-- anciennes cascades ; ces gardes l'interdisent explicitement.
create or replace function prevent_retiko_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Hard delete forbidden on %. Use lifecycle anonymization/suspension.', tg_table_name
    using errcode = '55000';
end;
$$;

do $$ begin
  create trigger establishments_no_hard_delete before delete on establishments
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger customers_no_hard_delete before delete on customers
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger cards_no_hard_delete before delete on cards
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;
