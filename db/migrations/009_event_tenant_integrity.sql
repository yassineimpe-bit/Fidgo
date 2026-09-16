-- Defense in depth for pilot telemetry and audit rows.
--
-- product_events was introduced after 003_tenant_integrity.sql, so its card
-- and staff references only prove that a referenced UUID exists. They do not
-- prove that it belongs to the event's establishment. The API already derives
-- these identifiers from the authenticated session; PostgreSQL now enforces
-- the same invariant for every writer.

do $$ begin
  alter table product_events add constraint product_events_card_same_tenant_fk
    foreign key (card_id, establishment_id)
    references cards(id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table product_events add constraint product_events_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id);
exception when duplicate_object then null; end $$;

-- System audit rows may omit both tenant and actor. As soon as an actor is
-- present, its tenant is mandatory and must match the row's establishment.
do $$ begin
  alter table audit_logs add constraint audit_logs_staff_requires_tenant_check
    check (staff_user_id is null or establishment_id is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table audit_logs add constraint audit_logs_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id);
exception when duplicate_object then null; end $$;
