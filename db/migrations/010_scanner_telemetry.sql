alter table product_events
  drop constraint if exists product_events_event_type_check;

alter table product_events
  add constraint product_events_event_type_check
  check (event_type in (
    'JOIN_PAGE_VIEW',
    'JOIN_SUBMIT',
    'CAMERA_START',
    'CAMERA_READY',
    'CAMERA_FAILED',
    'QR_DETECTED',
    'SCAN_SENT',
    'SCAN_SUCCESS',
    'SCAN_FAILED',
    'CREDIT_SUCCESS',
    'REWARD_REDEEMED'
  ));
