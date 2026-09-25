-- Garantit qu'un compte ne possède jamais plusieurs liens de vérification
-- actifs, même lorsque deux renvois terminent au même instant.
with ranked_active_tokens as (
  select
    id,
    row_number() over (
      partition by staff_user_id
      order by created_at desc, id desc
    ) as position
  from email_verification_tokens
  where used_at is null
)
update email_verification_tokens as token
set used_at = now()
from ranked_active_tokens as ranked
where token.id = ranked.id
  and ranked.position > 1;

create unique index if not exists email_verification_tokens_one_active_per_staff
  on email_verification_tokens (staff_user_id)
  where used_at is null;

create or replace function revoke_email_verification_on_staff_state_change()
returns trigger language plpgsql as $$
begin
  if (old.active and not new.active)
    or (old.email_verified_at is null and new.email_verified_at is not null)
  then
    update email_verification_tokens
    set used_at = coalesce(used_at, now())
    where staff_user_id = new.id and used_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists staff_email_verification_revoke_on_state_change on staff_users;
create trigger staff_email_verification_revoke_on_state_change
after update of active, email_verified_at on staff_users
for each row execute function revoke_email_verification_on_staff_state_change();

create or replace function revoke_email_verification_on_establishment_suspend()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status and new.status <> 'active' then
    update email_verification_tokens
    set used_at = coalesce(used_at, now())
    where staff_user_id in (
      select id from staff_users where establishment_id = new.id
    ) and used_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists establishment_email_verification_revoke_on_suspend on establishments;
create trigger establishment_email_verification_revoke_on_suspend
after update of status on establishments
for each row execute function revoke_email_verification_on_establishment_suspend();

-- Répare les états hérités avant d'activer les gardes ci-dessus.
update email_verification_tokens as verification_token
set used_at = coalesce(verification_token.used_at, now())
from staff_users as staff
join establishments as establishment on establishment.id = staff.establishment_id
where verification_token.staff_user_id = staff.id
  and verification_token.used_at is null
  and (
    staff.email_verified_at is not null
    or not staff.active
    or establishment.status <> 'active'
  );
