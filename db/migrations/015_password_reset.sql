-- Récupération de mot de passe pour l'espace commerçant. Le token brut n'est
-- jamais stocké : seul son SHA-256 vit en base, comme card_recovery_tokens.

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_staff_idx
  on password_reset_tokens (staff_user_id, created_at desc);

create index if not exists password_reset_tokens_expiry_idx
  on password_reset_tokens (expires_at)
  where used_at is null;
