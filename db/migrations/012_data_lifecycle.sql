-- Data lifecycle hardening for the pilot.
-- No financial transaction is deleted or rewritten by this migration.

-- Bring previously soft-deleted customers to the same minimisation invariant
-- as the application route, then enforce it for every future writer.
update customers set
  email=null,
  phone=null,
  first_name=null,
  marketing_consent=false,
  marketing_consent_at=null,
  updated_at=greatest(updated_at,coalesce(deleted_at,updated_at))
where deleted_at is not null
  and (email is not null or phone is not null or first_name is not null
    or marketing_consent or marketing_consent_at is not null);

do $$ begin
  alter table customers add constraint customers_erased_pii_check check (
    deleted_at is null or (
      email is null and phone is null and first_name is null
      and marketing_consent = false and marketing_consent_at is null
    )
  );
exception when duplicate_object then null; end $$;

-- Repair legacy soft deletions without touching balances or ledger rows.
update cards c set
  active=false,
  token='ERASED_' || encode(gen_random_bytes(32),'hex'),
  short_code='ERASED-' || c.id::text,
  updated_at=now()
from customers u
where u.id=c.customer_id and u.deleted_at is not null
  and (c.active or c.token not like 'ERASED_%');

update card_recovery_tokens r set used_at=coalesce(r.used_at,now())
from cards c join customers u on u.id=c.customer_id
where r.card_id=c.id and (not c.active or u.deleted_at is not null) and r.used_at is null;

update wallet_passes wp set status='revoked',last_error=null,updated_at=now()
from cards c join customers u on u.id=c.customer_id
where wp.card_id=c.id and (not c.active or u.deleted_at is not null) and wp.status <> 'revoked';

-- Older provider errors and free-text reasons predate the redaction performed
-- by the application. Their exact content cannot be proven safe, so retain
-- structured facts while dropping only these legacy free-text fields.
update wallet_passes set last_error=null where last_error is not null;

update transactions set metadata=metadata - 'reason' - 'overrideReason'
where metadata ? 'reason' or metadata ? 'overrideReason';

update audit_logs set metadata=metadata - 'reason' - 'overrideReason'
where metadata ? 'reason' or metadata ? 'overrideReason';

update product_events pe set card_id=null
from cards c join customers u on u.id=c.customer_id
where pe.card_id=c.id and u.deleted_at is not null;

delete from push_subscriptions ps
using customers u
where ps.customer_id=u.id and u.deleted_at is not null;

delete from campaign_recipients cr
using customers u
where cr.customer_id=u.id and u.deleted_at is not null;

-- One card can expose at most one usable recovery link.
with duplicate_links as (
  select id,row_number() over (partition by card_id order by created_at desc,id desc) as position
  from card_recovery_tokens
  where used_at is null
)
update card_recovery_tokens r set used_at=now()
from duplicate_links d
where r.id=d.id and d.position > 1;

create unique index if not exists card_recovery_tokens_one_active_per_card
  on card_recovery_tokens (card_id) where used_at is null;

-- Global retention jobs need time-only indexes; tenant-prefixed analytics
-- indexes cannot efficiently serve these bounded maintenance deletes.
create index if not exists product_events_retention_idx on product_events (created_at);
create index if not exists audit_logs_retention_idx on audit_logs (created_at);
create index if not exists rate_limits_retention_idx on rate_limits (window_started_at);
create index if not exists wallet_passes_revoked_retention_idx
  on wallet_passes (updated_at) where status='revoked';

-- Defense in depth: hard deletes would follow historical ON DELETE CASCADE
-- paths and erase the ledger. Lifecycle operations must use soft deletion or
-- establishment suspension instead.
create or replace function prevent_retiko_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Hard delete forbidden on %. Use lifecycle anonymization/suspension.', tg_table_name
    using errcode = '55000';
end;
$$;

do $$ begin
  create trigger establishments_no_hard_delete before delete on establishments
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger customers_no_hard_delete before delete on customers
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger cards_no_hard_delete before delete on cards
    for each row execute function prevent_retiko_hard_delete();
exception when duplicate_object then null; end $$;
