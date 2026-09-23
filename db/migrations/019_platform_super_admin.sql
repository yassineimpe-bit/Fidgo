-- Super-admin Retiko (opérateur de la plateforme, distinct des rôles commerce).
--
-- Accès : uniquement les comptes staff présents dans platform_admins. Aucun
-- parcours applicatif ne permet de s'y ajouter ; l'attribution passe par
-- `npm run admin:platform -- grant <email>` avec un accès direct à la base.

create table if not exists platform_admins (
  staff_user_id uuid primary key references staff_users(id),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

-- Journal append-only des actions et consultations super-admin. Pas de clé
-- étrangère : l'identité de l'admin est figée au moment de l'action et doit
-- survivre à toute évolution ultérieure du compte.
create table if not exists platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_staff_user_id uuid,
  admin_email text,
  action text not null check (char_length(action) between 1 and 64),
  target_type text check (target_type is null or char_length(target_type) <= 32),
  target_id text check (target_id is null or char_length(target_id) <= 64),
  reason text check (reason is null or char_length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_admin_audit_created_idx on platform_admin_audit (created_at desc);
create index if not exists platform_admin_audit_target_idx on platform_admin_audit (target_type, target_id, created_at desc);

create or replace function protect_platform_admin_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'platform_admin_audit is append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists platform_admin_audit_append_only on platform_admin_audit;
create trigger platform_admin_audit_append_only
before update or delete on platform_admin_audit
for each row execute function protect_platform_admin_audit();

-- Suspension plateforme : réversible, sans toucher aux cartes, passes Wallet
-- ni comptes staff. Elle se distingue de la fermeture demandée par le
-- commerçant (status='suspended' sans platform_suspended_at), qui reste
-- irréversible depuis l'application.
alter table establishments add column if not exists platform_suspended_at timestamptz;
alter table establishments add column if not exists platform_suspension_reason text;

do $$ begin
  alter table establishments add constraint establishments_platform_suspension_check check (
    (platform_suspended_at is null and platform_suspension_reason is null)
    or (
      platform_suspended_at is not null
      and status = 'suspended'
      and char_length(platform_suspension_reason) between 10 and 500
    )
  );
exception when duplicate_object then null; end $$;

create index if not exists establishments_created_idx on establishments (created_at desc);
create index if not exists transactions_created_type_idx on transactions (created_at desc) where type = 'earn';
