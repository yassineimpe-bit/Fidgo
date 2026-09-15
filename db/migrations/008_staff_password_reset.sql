create table if not exists staff_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  staff_user_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_password_reset_tokens_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id)
    on delete cascade
);

create index if not exists staff_password_reset_tokens_staff_idx
  on staff_password_reset_tokens (staff_user_id, created_at desc);

create index if not exists staff_password_reset_tokens_expiry_idx
  on staff_password_reset_tokens (expires_at)
  where used_at is null;
