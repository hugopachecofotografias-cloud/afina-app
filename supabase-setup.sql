create table if not exists kv_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

alter table kv_store enable row level security;

create policy "kv_store_select" on kv_store for select using (true);
create policy "kv_store_insert" on kv_store for insert with check (true);
create policy "kv_store_update" on kv_store for update using (true);
create policy "kv_store_delete" on kv_store for delete using (true);
