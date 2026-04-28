insert into storage.buckets (id, name, public) values ('public-docs', 'public-docs', true) on conflict (id) do nothing;

create policy "Public read public-docs"
on storage.objects for select
using (bucket_id = 'public-docs');