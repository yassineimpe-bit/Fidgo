-- NULL keeps existing merchants out of the new signup flow.
-- 1: identity, 2: program, 3: team, 4: enrollment QR, 5: complete.
alter table establishments add column if not exists onboarding_step smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'establishments_onboarding_step_check') then
    alter table establishments add constraint establishments_onboarding_step_check
      check (onboarding_step between 1 and 5);
  end if;
end $$;
