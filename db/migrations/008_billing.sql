-- Fidgo est facturé sur une offre commerciale unique (mensuel sans engagement
-- ou annuel), et non plus sur des paliers fonctionnels STARTER/PRO/PREMIUM.
alter table subscriptions drop constraint if exists subscriptions_plan_check;
update subscriptions set plan = 'FIDGO' where plan <> 'FIDGO';
alter table subscriptions alter column plan set default 'FIDGO';
alter table subscriptions add constraint subscriptions_plan_check check (plan in ('FIDGO'));

alter table subscriptions add column if not exists billing_interval text not null default 'monthly';
alter table subscriptions drop constraint if exists subscriptions_billing_interval_check;
alter table subscriptions add constraint subscriptions_billing_interval_check check (billing_interval in ('monthly','annual'));

alter table subscriptions add column if not exists trial_ends_at timestamptz;
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;

create index if not exists subscriptions_status_idx on subscriptions (status, trial_ends_at);
