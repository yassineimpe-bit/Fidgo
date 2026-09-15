create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid references cards(id) on delete set null,
  staff_user_id uuid references staff_users(id) on delete set null,
  event_type text not null check (event_type in ('JOIN_PAGE_VIEW','JOIN_SUBMIT','SCAN_SUCCESS','SCAN_FAILED','CREDIT_SUCCESS','REWARD_REDEEMED')),
  duration_ms int check (duration_ms is null or duration_ms between 0 and 60000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_events_estab_type_idx
  on product_events (establishment_id, event_type, created_at desc);

create index if not exists product_events_card_idx
  on product_events (card_id, created_at desc)
  where card_id is not null;
