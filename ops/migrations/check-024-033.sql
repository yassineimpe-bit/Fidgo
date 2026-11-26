-- Constat, en lecture seule, de l'état des migrations 024 à 033 et des
-- préconditions de leur application. Aucune écriture : la session est
-- forcée en lecture seule avant toute requête.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/migrations/check-024-033.sql
--
-- Sortie : une ligne par objet attendu (present = true/false), puis les
-- préconditions (doit_etre_zero = 0 partout pour appliquer sans surprise).

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';

with col(t, c) as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
),
con(n, def) as (
  select conname, pg_get_constraintdef(oid) from pg_constraint
),
trg(n) as (
  select tgname from pg_trigger where not tgisinternal
)
select migration, objet, present from (values
  ('024', 'table establishment_logos',                    to_regclass('public.establishment_logos') is not null),
  ('024', 'check logo_url accepte /api/logos/',           exists (select 1 from con where n = 'establishments_logo_url_https_check' and def like '%/api/logos/%')),
  ('025', 'table staff_two_factor',                       to_regclass('public.staff_two_factor') is not null),
  ('025', 'table staff_two_factor_recovery_codes',        to_regclass('public.staff_two_factor_recovery_codes') is not null),
  ('026', 'colonne loyalty_programs.unit_label',          exists (select 1 from col where t = 'loyalty_programs' and c = 'unit_label')),
  ('026', 'check loyalty_programs_unit_label_check',      exists (select 1 from con where n = 'loyalty_programs_unit_label_check')),
  ('027', 'colonne campaigns.recipient_count',            exists (select 1 from col where t = 'campaigns' and c = 'recipient_count')),
  ('027', 'trigger campaign_recipients_same_tenant',      exists (select 1 from trg where n = 'campaign_recipients_same_tenant')),
  ('028', 'colonne loyalty_programs.reward_email_enabled', exists (select 1 from col where t = 'loyalty_programs' and c = 'reward_email_enabled')),
  ('028', 'table reward_notifications',                   to_regclass('public.reward_notifications') is not null),
  ('029', 'check subscriptions_plan_check STANDARD_*',    exists (select 1 from con where n = 'subscriptions_plan_check' and def like '%STANDARD_MONTHLY%')),
  ('030', 'colonne establishments.secondary_color',       exists (select 1 from col where t = 'establishments' and c = 'secondary_color')),
  ('030', 'colonne establishments.card_background',       exists (select 1 from col where t = 'establishments' and c = 'card_background')),
  ('031', 'table establishment_card_images',              to_regclass('public.establishment_card_images') is not null),
  ('031', 'colonne establishments.card_image_id',         exists (select 1 from col where t = 'establishments' and c = 'card_image_id')),
  ('032', 'trigger customer_card_recovery_revoke_on_email_change', exists (select 1 from trg where n = 'customer_card_recovery_revoke_on_email_change')),
  ('032', 'index card_recovery_tokens_one_active_per_card', to_regclass('public.card_recovery_tokens_one_active_per_card') is not null),
  ('033', 'colonne establishments.card_image_overlay',    exists (select 1 from col where t = 'establishments' and c = 'card_image_overlay'))
) as expected(migration, objet, present)
order by migration, objet;

-- Préconditions : chaque valeur doit être 0.
select precondition, doit_etre_zero from (values
  -- 032 : l'UPDATE ne révoque que des liens actifs en double (garantis
  -- impossibles si l'index unique partiel existe déjà).
  ('032 liens recovery actifs en double', (
    select count(*) from (
      select card_id from card_recovery_tokens where used_at is null group by card_id having count(*) > 1
    ) d)),
  -- 024 : la nouvelle contrainte doit accepter tous les logo_url existants.
  ('024 logo_url hors https:// et /api/logos/<uuid>', (
    select count(*) from establishments
    where logo_url is not null and logo_url !~* '^https://'
      and logo_url !~ '^/api/logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  -- 029 : la nouvelle contrainte doit accepter toutes les offres existantes.
  ('029 offres hors liste', (
    select count(*) from subscriptions
    where plan not in ('PILOT', 'FLEX', 'RETIKO_12', 'ANNUAL', 'STANDARD_MONTHLY', 'STANDARD_ANNUAL'))),
  -- Verrous : aucune autre session ne doit tenir de verrou sur les tables modifiées.
  ('sessions concurrentes tenant un verrou sur les tables modifiées', (
    select count(distinct l.pid) from pg_locks l join pg_class c on c.oid = l.relation
    where l.pid <> pg_backend_pid()
      and c.relname in ('establishments', 'loyalty_programs', 'campaigns', 'campaign_recipients',
                        'subscriptions', 'card_recovery_tokens', 'customers', 'staff_users', 'cards', 'transactions')))
) as checks(precondition, doit_etre_zero);

-- Volumétrie des tables modifiées (verrous ACCESS EXCLUSIVE brefs, validation
-- des contraintes CHECK par balayage complet).
select relname as table_modifiee, n_live_tup as lignes_estimees
from pg_stat_user_tables
where relname in ('establishments', 'loyalty_programs', 'campaigns', 'campaign_recipients',
                  'subscriptions', 'card_recovery_tokens', 'customers', 'staff_users')
order by relname;

rollback;
