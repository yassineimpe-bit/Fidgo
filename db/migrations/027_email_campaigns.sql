-- Campagnes e-mail du commerce (promotion, relance des clients inactifs).
-- Complète les tables `campaigns` / `campaign_recipients` du schéma initial,
-- jamais utilisées jusqu'ici. Additive et rejouable ; le code détecte
-- l'absence de ces colonnes et répond « pas encore disponible ».

alter table campaigns add column if not exists kind text;
alter table campaigns add column if not exists segment text;
alter table campaigns add column if not exists inactive_days int;
alter table campaigns add column if not exists recipient_count int not null default 0;
alter table campaigns add column if not exists sent_count int not null default 0;
alter table campaigns add column if not exists failed_count int not null default 0;
alter table campaigns add column if not exists skipped_count int not null default 0;
alter table campaigns add column if not exists completed_at timestamptz;
alter table campaigns add column if not exists idempotency_key text;

alter table campaign_recipients add column if not exists claimed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_email_shape_check') then
    alter table campaigns add constraint campaigns_email_shape_check check (
      channel <> 'email' or (
        kind in ('promotion', 'inactive_reminder')
        and segment in ('all', 'active', 'inactive', 'reward_available')
        and (kind <> 'inactive_reminder' or segment = 'inactive')
        and ((segment = 'inactive') = (inactive_days is not null))
        and (inactive_days is null or inactive_days in (30, 60, 90))
        and char_length(title) between 1 and 120
        and char_length(body) between 1 and 2000
        and recipient_count >= 0 and sent_count >= 0 and failed_count >= 0 and skipped_count >= 0
        and sent_count + failed_count + skipped_count <= recipient_count
      )
    );
  end if;
end
$$;

create unique index if not exists campaigns_idempotency_key
  on campaigns (establishment_id, idempotency_key) where idempotency_key is not null;
create index if not exists campaigns_establishment_created_idx
  on campaigns (establishment_id, created_at desc);
create index if not exists campaign_recipients_pending_idx
  on campaign_recipients (campaign_id) where status = 'pending';
create index if not exists campaign_recipients_customer_sent_idx
  on campaign_recipients (customer_id, sent_at desc) where status = 'sent';

-- Un destinataire appartient toujours au commerce de la campagne.
create or replace function campaign_recipient_same_tenant()
returns trigger language plpgsql as $tenant$
begin
  if not exists (
    select 1 from campaigns ca join customers cu on cu.establishment_id = ca.establishment_id
    where ca.id = new.campaign_id and cu.id = new.customer_id
  ) then
    raise exception 'Campaign recipient must belong to the campaign establishment.'
      using errcode = '23514';
  end if;
  return new;
end;
$tenant$;

drop trigger if exists campaign_recipients_same_tenant on campaign_recipients;
create trigger campaign_recipients_same_tenant
before insert or update of campaign_id, customer_id on campaign_recipients
for each row execute function campaign_recipient_same_tenant();
