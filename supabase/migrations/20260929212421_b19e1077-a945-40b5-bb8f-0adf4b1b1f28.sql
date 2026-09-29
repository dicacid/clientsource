create or replace function public.workspace_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organizations)
$$;
revoke execute on function public.workspace_exists() from public, anon;
grant execute on function public.workspace_exists() to authenticated;