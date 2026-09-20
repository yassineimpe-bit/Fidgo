-- Un établissement Retiko possède exactement un compte propriétaire créé
-- par le parcours marchand. Les routes staff ne peuvent pas créer OWNER, et
-- cette contrainte protège aussi contre un writer alternatif ou une régression.

do $$
begin
  if exists (
    select establishment_id
    from staff_users
    where role = 'OWNER'
    group by establishment_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one OWNER per establishment: duplicate owners exist'
      using errcode = '23505';
  end if;
end
$$;

create unique index if not exists staff_users_one_owner_per_establishment
  on staff_users (establishment_id)
  where role = 'OWNER';
