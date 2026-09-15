-- Default required by the V0 pilot. Existing merchant choices stay untouched.
alter table loyalty_programs alter column cooldown_seconds set default 120;
