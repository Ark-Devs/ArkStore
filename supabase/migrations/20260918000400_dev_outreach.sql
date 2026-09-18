-- ArkStore: remember which developers were told their app is listed, so nobody is emailed
-- twice, and so an opt-out sticks. Private: not reachable through the public API.
create table if not exists arkstore_private.dev_outreach (
  developer_login text primary key,
  email text,
  repos text[] not null default '{}',
  status text not null default 'sent' check (status in ('sent', 'opted_out', 'no_public_email')),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table arkstore_private.dev_outreach enable row level security;
revoke all on arkstore_private.dev_outreach from anon, authenticated;
