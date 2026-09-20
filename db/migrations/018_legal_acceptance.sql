-- Preuve contractuelle de l'acceptation des documents Retiko
-- et consentement marketing B2B distinct de l'acceptation contractuelle.

alter table staff_users
  add column if not exists marketing_consent boolean not null default false;

alter table staff_users
  add column if not exists marketing_consent_at timestamptz;

create table if not exists legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  document_type text not null check (document_type in ('CGU','CGV')),
  document_version text not null,
  source text not null default 'signup' check (source in ('signup','reauth','admin')),
  accepted_at timestamptz not null default now(),
  unique(staff_user_id, document_type, document_version)
);

create index if not exists legal_acceptances_staff_idx
  on legal_acceptances (staff_user_id, accepted_at desc);
