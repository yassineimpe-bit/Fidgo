-- Vérification d'adresse e-mail des comptes commerçants publics.
-- Les comptes existants sont rétroactivement considérés vérifiés.
-- Les comptes équipe créés par un OWNER restent vérifiés par défaut.
--
-- db:setup rejoue les migrations : le backfill legacy ne doit s'exécuter
-- qu'au moment où la colonne est créée pour la première fois.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_users'
      and column_name = 'email_verified_at'
  ) then
    alter table staff_users
      add column email_verified_at timestamptz;

    update staff_users
    set email_verified_at = created_at
    where email_verified_at is null;
  end if;
end
$$;

alter table staff_users
  alter column email_verified_at set default now();

create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_staff_idx
  on email_verification_tokens (staff_user_id, created_at desc);

create index if not exists email_verification_tokens_expiry_idx
  on email_verification_tokens (expires_at)
  where used_at is null;
