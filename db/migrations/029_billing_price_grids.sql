-- Grille tarifaire standard (25 € HT/mois, 250 € HT/an) en plus de la grille
-- pilote. Chaque offre a sa clé : un abonné garde l'offre souscrite quand la
-- grille proposée change. Idempotente : les contraintes ne sont remplacées
-- que si elles ne connaissent pas encore les nouvelles offres.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'subscriptions'::regclass and conname = 'subscriptions_plan_check'
      and pg_get_constraintdef(oid) like '%STANDARD_MONTHLY%'
  ) then
    alter table subscriptions drop constraint if exists subscriptions_plan_check;
    alter table subscriptions add constraint subscriptions_plan_check
      check (plan in ('PILOT', 'FLEX', 'RETIKO_12', 'ANNUAL', 'STANDARD_MONTHLY', 'STANDARD_ANNUAL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'subscriptions'::regclass and conname = 'subscriptions_stripe_checkout_plan_check'
      and pg_get_constraintdef(oid) like '%STANDARD_MONTHLY%'
  ) then
    alter table subscriptions drop constraint if exists subscriptions_stripe_checkout_plan_check;
    alter table subscriptions add constraint subscriptions_stripe_checkout_plan_check
      check (stripe_checkout_plan is null or stripe_checkout_plan in ('FLEX', 'RETIKO_12', 'ANNUAL', 'STANDARD_MONTHLY', 'STANDARD_ANNUAL'));
  end if;
end
$$;
