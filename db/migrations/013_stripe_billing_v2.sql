-- Stripe v2 pour Retiko. Cette migration ne crée aucun paiement et ne stocke
-- aucune donnée de carte bancaire : uniquement l'état local et les identifiants
-- Stripe nécessaires à la synchronisation.

alter table subscriptions add column if not exists billing_interval text;
alter table subscriptions add column if not exists trial_ends_at timestamptz;
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table subscriptions add column if not exists stripe_last_event_created bigint;
alter table subscriptions add column if not exists stripe_last_event_id text;
alter table subscriptions add column if not exists legacy_plan text;
alter table subscriptions add column if not exists stripe_checkout_session_id text;
alter table subscriptions add column if not exists stripe_checkout_plan text;
alter table subscriptions add column if not exists stripe_checkout_pending_at timestamptz;
alter table subscriptions add column if not exists stripe_checkout_claim_token text;

alter table subscriptions drop constraint if exists subscriptions_plan_check;
update subscriptions
set legacy_plan = coalesce(legacy_plan, plan), plan = 'PILOT'
where plan not in ('PILOT', 'FLEX', 'RETIKO_12', 'ANNUAL');
alter table subscriptions alter column plan set default 'PILOT';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_plan_check' and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_plan_check
      check (plan in ('PILOT', 'FLEX', 'RETIKO_12', 'ANNUAL'));
  end if;
end $$;

alter table subscriptions drop constraint if exists subscriptions_status_check;
update subscriptions set status = 'canceled' where status = 'cancelled';
update subscriptions
set status = 'unpaid'
where status not in ('trial', 'active', 'past_due', 'canceled', 'unpaid');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check' and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_status_check
      check (status in ('trial', 'active', 'past_due', 'canceled', 'unpaid'));
  end if;
end $$;

alter table subscriptions drop constraint if exists subscriptions_billing_interval_check;
update subscriptions
set billing_interval = null
where billing_interval is not null and billing_interval not in ('monthly', 'annual');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_billing_interval_check' and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_billing_interval_check
      check (billing_interval is null or billing_interval in ('monthly', 'annual'));
  end if;
end $$;

alter table subscriptions drop constraint if exists subscriptions_stripe_checkout_plan_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_stripe_checkout_plan_check' and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_stripe_checkout_plan_check
      check (stripe_checkout_plan is null or stripe_checkout_plan in ('FLEX', 'RETIKO_12', 'ANNUAL'));
  end if;
end $$;

update subscriptions
set trial_ends_at = created_at + interval '30 days'
where status = 'trial' and trial_ends_at is null;

insert into subscriptions (establishment_id, plan, status, trial_ends_at)
select e.id, 'PILOT', 'trial', e.created_at + interval '30 days'
from establishments e
on conflict (establishment_id) do nothing;

create unique index if not exists subscriptions_external_customer_unique
  on subscriptions (external_customer_id)
  where external_customer_id is not null;
create unique index if not exists subscriptions_external_subscription_unique
  on subscriptions (external_subscription_id)
  where external_subscription_id is not null;
create unique index if not exists subscriptions_checkout_session_unique
  on subscriptions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists subscriptions_status_idx
  on subscriptions (status, trial_ends_at);

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created bigint not null,
  establishment_id uuid references establishments(id) on delete set null,
  external_subscription_id text,
  processed_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_retention_idx
  on stripe_webhook_events (processed_at);
