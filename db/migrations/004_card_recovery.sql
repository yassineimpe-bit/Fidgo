create table if not exists card_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint card_recovery_tokens_card_same_tenant_fk
    foreign key (card_id, establishment_id)
    references cards(id, establishment_id)
    on delete cascade
);

create index if not exists card_recovery_tokens_card_idx
  on card_recovery_tokens (card_id, created_at desc);

create index if not exists card_recovery_tokens_expiry_idx
  on card_recovery_tokens (expires_at)
  where used_at is null;
