alter table loyalty_programs add column if not exists points_rule text not null default 'PER_PURCHASE';
do $$ begin alter table loyalty_programs add constraint loyalty_programs_points_rule_check check (points_rule in ('PER_PURCHASE','PER_EURO')); exception when duplicate_object then null; end $$;
alter table staff_users add column if not exists active boolean not null default true;
create table if not exists rate_limits (key_hash text primary key,hits int not null default 0,window_started_at timestamptz not null default now());
