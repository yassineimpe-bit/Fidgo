-- Réaffirme la garantie introduite par 012 sur les bases existantes : un seul
-- lien de récupération utilisable par carte, y compris après données héritées.
with ranked_active_tokens as (
  select
    id,
    row_number() over (
      partition by card_id
      order by created_at desc, id desc
    ) as position
  from card_recovery_tokens
  where used_at is null
)
update card_recovery_tokens as token
set used_at = now()
from ranked_active_tokens as ranked
where token.id = ranked.id
  and ranked.position > 1;

create unique index if not exists card_recovery_tokens_one_active_per_card
  on card_recovery_tokens (card_id)
  where used_at is null;

-- Toute écriture SQL qui rectifie l'e-mail révoque les liens déjà actifs dans
-- la transaction de l'UPDATE, même si elle ne passe pas par l'API Retiko.
create or replace function revoke_card_recovery_on_customer_email_change()
returns trigger language plpgsql as $$
begin
  if old.email is distinct from new.email then
    update card_recovery_tokens
    set used_at = coalesce(used_at, now())
    where card_id in (
      select id
      from cards
      where customer_id = new.id
        and establishment_id = new.establishment_id
    ) and used_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists customer_card_recovery_revoke_on_email_change on customers;
create trigger customer_card_recovery_revoke_on_email_change
after update of email on customers
for each row execute function revoke_card_recovery_on_customer_email_change();
