-- Double authentification commerçant par application TOTP.
--
-- Idempotente et purement additive : sans ces tables, la connexion reste en
-- un facteur et l'activation répond 503. À appliquer en production avant
-- d'ouvrir la fonction aux commerçants.

create table if not exists staff_two_factor (
  staff_user_id uuid primary key,
  establishment_id uuid not null,
  -- Secret chiffré (AES-256-GCM, clé dérivée d'AUTH_SECRET), jamais en clair.
  secret_encrypted text not null check (secret_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- NULL tant que le premier code n'a pas été confirmé.
  enabled_at timestamptz,
  -- Dernier pas TOTP accepté : un code ne peut pas être rejoué.
  last_used_step bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_two_factor_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  establishment_id uuid not null,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (staff_user_id, code_hash)
);

-- Même garantie tenant que legal_acceptances : un facteur ne peut pas
-- désigner le compte d'un autre commerce.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_two_factor_staff_same_tenant_fk') then
    alter table staff_two_factor add constraint staff_two_factor_staff_same_tenant_fk
      foreign key (staff_user_id, establishment_id)
      references staff_users (id, establishment_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_two_factor_recovery_staff_same_tenant_fk') then
    alter table staff_two_factor_recovery_codes add constraint staff_two_factor_recovery_staff_same_tenant_fk
      foreign key (staff_user_id, establishment_id)
      references staff_users (id, establishment_id);
  end if;
end
$$;

create index if not exists staff_two_factor_recovery_staff_idx
  on staff_two_factor_recovery_codes (staff_user_id) where used_at is null;
