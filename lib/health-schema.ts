export type HealthSchemaFlags = Record<string, unknown> | null | undefined;

export function healthSchemaIsReady(schema: HealthSchemaFlags, billingRequired: boolean) {
  const billingReady = Boolean(schema?.stripe_webhook_events_table && schema?.billing_trial_end);
  return Boolean(
    schema?.recovery_table
    && schema?.password_reset_table
    && schema?.product_events_table
    && schema?.token_version
    && schema?.last_earn_at
    && schema?.cooldown_seconds
    && schema?.tenant_integrity
    && schema?.reversal_once
    && schema?.lifecycle_guards
    && schema?.erased_pii_check
    && (!billingRequired || billingReady)
  );
}
