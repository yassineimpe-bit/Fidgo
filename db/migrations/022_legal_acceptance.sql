-- Preuve d'acceptation des CGU/CGV au signup et consentement marketing
-- commerçant, distinct de l'acceptation contractuelle.
--
-- Idempotente : rejouée par db:setup à chaque exécution. Purement additive :
-- l'ancien code continue de fonctionner si elle est appliquée avant son
-- déploiement (ordre recommandé en production).

alter table staff_users
  add column if not exists marketing_consent boolean not null default false;

alter table staff_users
  add column if not exists marketing_consent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_users_marketing_consent_date_check') then
    alter table staff_users add constraint staff_users_marketing_consent_date_check
      check (marketing_consent = (marketing_consent_at is not null));
  end if;
end
$$;

create table if not exists legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null,
  staff_user_id uuid not null,
  document_type text not null check (document_type in ('CGU', 'CGV')),
  document_version text not null check (document_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  source text not null check (source in ('signup')),
  accepted_at timestamptz not null default now()
);

-- Même garantie tenant que les autres tables : une acceptation ne peut pas
-- désigner le compte d'un autre commerce. Pas de cascade : une preuve
-- contractuelle ne disparaît pas avec une ligne staff.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'legal_acceptances_staff_same_tenant_fk') then
    alter table legal_acceptances add constraint legal_acceptances_staff_same_tenant_fk
      foreign key (staff_user_id, establishment_id)
      references staff_users (id, establishment_id);
  end if;
end
$$;

create index if not exists legal_acceptances_staff_idx
  on legal_acceptances (staff_user_id, accepted_at desc);
