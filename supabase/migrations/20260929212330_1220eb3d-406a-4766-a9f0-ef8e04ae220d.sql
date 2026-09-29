create extension if not exists citext;
create extension if not exists pg_trgm;

-- ============ website normalizer (shared rule with TS) ============
create or replace function public.normalize_website(raw text)
returns text language plpgsql immutable set search_path = public as $$
declare h text;
begin
  if raw is null then return null; end if;
  h := lower(btrim(raw));
  if h = '' then return null; end if;
  h := regexp_replace(h, '^https?://', '');
  h := regexp_replace(h, '^www\.', '');
  h := split_part(split_part(split_part(h, '/', 1), '?', 1), '#', 1);
  h := regexp_replace(h, '\.$', '');
  if h = '' or position('.' in h) = 0 then return null; end if;
  return 'https://' || h;
end $$;

-- ============ tables ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
create unique index one_org_only on public.organizations ((true));

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz default now(),
  primary key (organization_id, user_id)
);

create table public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin','member')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz default now(),
  unique (email)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  website text check (website is null or website = public.normalize_website(website)),
  industry text,
  country text,
  employee_range text check (employee_range in ('1-10','11-50','51-200','201-1000','1000+')),
  status text not null default 'new' check (status in ('new','researching','contacted','engaged','qualified','customer','lost')),
  notes text,
  created_at timestamptz default now(),
  unique (organization_id, id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null,
  full_name text not null check (btrim(full_name) <> ''),
  job_title text,
  email text,
  phone text,
  linkedin_url text,
  status text not null default 'new' check (status in ('new','contacted','meeting','customer','lost')),
  last_contacted_at timestamptz,
  next_follow_up date,
  notes text,
  created_at timestamptz default now(),
  unique (organization_id, id),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete restrict
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null,
  contact_id uuid null,
  type text not null check (type in ('note','call','meeting','follow_up')),
  body text not null check (btrim(body) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);

-- ============ indexes ============
create index on public.companies (organization_id);
create index on public.contacts (organization_id);
create index on public.activities (organization_id);
create index on public.pending_invites (organization_id);
create index on public.organization_members (organization_id);
create index on public.organization_members (user_id);
create index on public.companies (organization_id, industry);
create index on public.companies (organization_id, country);
create index on public.companies (organization_id, employee_range);
create index on public.companies (organization_id, status);
create index companies_name_trgm on public.companies using gin (name gin_trgm_ops);
create index contacts_name_trgm on public.contacts using gin (full_name gin_trgm_ops);
create index on public.contacts (company_id);
create index on public.contacts (organization_id, next_follow_up);
create index on public.contacts (organization_id, status);
create index on public.activities (company_id, created_at desc);
create index on public.activities (contact_id);

-- ============ grants ============
grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, delete on public.organization_members to authenticated;
grant select, insert, delete on public.pending_invites to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
grant all on public.profiles, public.organizations, public.organization_members, public.pending_invites, public.companies, public.contacts, public.activities to service_role;
revoke all on public.profiles, public.organizations, public.organization_members, public.pending_invites, public.companies, public.contacts, public.activities from anon;
revoke insert, delete on public.organizations from authenticated, anon;
revoke insert, update on public.organization_members from authenticated, anon;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.pending_invites enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;

-- ============ helpers ============
create or replace function public.is_org_member(org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where organization_id = org_id and user_id = auth.uid())
$$;
create or replace function public.is_org_admin(org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where organization_id = org_id and user_id = auth.uid() and role in ('owner','admin'))
$$;
create or replace function public.is_org_owner(org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where organization_id = org_id and user_id = auth.uid() and role = 'owner')
$$;
create or replace function public.shares_org(profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members a join organization_members b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = profile_id)
$$;

revoke execute on function public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_owner(uuid), public.shares_org(uuid) from public, anon;
grant execute on function public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_owner(uuid), public.shares_org(uuid) to authenticated;

-- ============ policies ============
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy orgs_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy orgs_update on public.organizations for update to authenticated
  using (public.is_org_owner(id)) with check (public.is_org_owner(id));

create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy members_delete on public.organization_members for delete to authenticated
  using ((role = 'member' and public.is_org_admin(organization_id))
      or (role in ('admin','owner') and public.is_org_owner(organization_id)));

create policy invites_select on public.pending_invites for select to authenticated
  using (public.is_org_member(organization_id));
create policy invites_insert on public.pending_invites for insert to authenticated
  with check (invited_by = auth.uid() and (
    (role = 'member' and public.is_org_admin(organization_id))
    or (role = 'admin' and public.is_org_owner(organization_id))));
create policy invites_delete on public.pending_invites for delete to authenticated
  using ((role = 'member' and public.is_org_admin(organization_id))
      or (role = 'admin' and public.is_org_owner(organization_id)));

create policy companies_select on public.companies for select to authenticated using (public.is_org_member(organization_id));
create policy companies_insert on public.companies for insert to authenticated with check (public.is_org_member(organization_id));
create policy companies_update on public.companies for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy companies_delete on public.companies for delete to authenticated using (public.is_org_member(organization_id));

create policy contacts_select on public.contacts for select to authenticated using (public.is_org_member(organization_id));
create policy contacts_insert on public.contacts for insert to authenticated with check (public.is_org_member(organization_id));
create policy contacts_update on public.contacts for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy contacts_delete on public.contacts for delete to authenticated using (public.is_org_member(organization_id));

create policy activities_select on public.activities for select to authenticated using (public.is_org_member(organization_id));
create policy activities_insert on public.activities for insert to authenticated with check (created_by = auth.uid() and public.is_org_member(organization_id));
create policy activities_update on public.activities for update to authenticated using (public.is_org_member(organization_id)) with check (created_by = auth.uid() and public.is_org_member(organization_id));
create policy activities_delete on public.activities for delete to authenticated using (public.is_org_member(organization_id));

-- ============ last-owner protection ============
create or replace function public.guard_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner'
       and exists (select 1 from organizations where id = old.organization_id)
       and not exists (select 1 from organization_members where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'LAST_OWNER: cannot remove the last owner' using errcode = 'P0001';
    end if;
    return old;
  else
    if old.role = 'owner' and new.role <> 'owner'
       and not exists (select 1 from organization_members where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'LAST_OWNER: cannot demote the last owner' using errcode = 'P0001';
    end if;
    return new;
  end if;
end $$;
create trigger organization_members_last_owner before delete or update on public.organization_members
  for each row execute function public.guard_last_owner();

-- ============ new user → profile only ============
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RPCs ============
create or replace function public.create_workspace(org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from auth.users where id = uid and email_confirmed_at is not null) then
    raise exception 'EMAIL_NOT_CONFIRMED';
  end if;
  if org_name is null or btrim(org_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  lock table organizations in exclusive mode;
  if exists (select 1 from organization_members where user_id = uid) then raise exception 'ALREADY_MEMBER'; end if;
  if exists (select 1 from organizations) then raise exception 'WORKSPACE_EXISTS'; end if;
  insert into organizations (name) values (btrim(org_name)) returning id into new_id;
  insert into organization_members (organization_id, user_id, role) values (new_id, uid, 'owner');
  return new_id;
end $$;

create or replace function public.claim_invite() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); em text; inv record;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select email into em from auth.users where id = uid and email_confirmed_at is not null;
  if em is null then raise exception 'EMAIL_NOT_CONFIRMED'; end if;
  if exists (select 1 from organization_members where user_id = uid) then return; end if;
  select * into inv from pending_invites where email = em::citext for update;
  if not found then return; end if;
  insert into organization_members (organization_id, user_id, role) values (inv.organization_id, uid, inv.role)
    on conflict do nothing;
  delete from pending_invites where id = inv.id;
end $$;

create or replace function public.set_member_role(target_user_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; cur text;
begin
  if new_role not in ('owner','admin','member') then raise exception 'INVALID_ROLE'; end if;
  select id into org from organizations limit 1;
  if org is null or not exists (select 1 from organization_members where organization_id = org and user_id = auth.uid() and role = 'owner') then
    raise exception 'NOT_OWNER';
  end if;
  select role into cur from organization_members where organization_id = org and user_id = target_user_id;
  if cur is null then raise exception 'NOT_A_MEMBER'; end if;
  if cur = 'owner' and new_role <> 'owner'
     and not exists (select 1 from organization_members where organization_id = org and role = 'owner' and user_id <> target_user_id) then
    raise exception 'LAST_OWNER: cannot demote the last owner';
  end if;
  update organization_members set role = new_role where organization_id = org and user_id = target_user_id;
end $$;

create or replace function public.seed_sample_data() returns void
language plpgsql security definer set search_path = public as $$
declare
  org uuid; cid uuid; i int; j int; n int := 0;
  names text[] := array['Acme Widgets','Globex Analytics','Initech Systems','Umbrella Logistics','Hooli Cloud','Vandelay Imports','Stark Fabrication','Wayne Botanics','Soylent Foods','Tyrell Robotics'];
  hosts text[] := array['acme-widgets.example.com','globex-analytics.example.com','initech.example.com','umbrella-logistics.example.com','hooli-cloud.example.com','vandelay.example.com','stark-fab.example.com','wayne-botanics.example.com','soylent-foods.example.com','tyrell-robotics.example.com'];
  inds text[] := array['Manufacturing','Software','Software','Logistics','Cloud','Retail','Manufacturing','Agriculture','Food & Beverage','Robotics'];
  ctrs text[] := array['United States','Germany','United Kingdom','Netherlands','United States','Spain','France','Canada','Sweden','Japan'];
  rngs text[] := array['11-50','51-200','201-1000','1000+','1-10','11-50','201-1000','51-200','1000+','51-200'];
  sts text[] := array['new','researching','contacted','engaged','qualified','customer','lost','new','contacted','engaged'];
  first text[] := array['Alex','Sam','Jordan','Taylor','Casey','Riley','Morgan','Jamie','Avery','Quinn'];
  last text[] := array['Sample','Example','Demo','Placeholder','Testman','Fictional'];
  titles text[] := array['Head of Sales','CTO','Operations Manager','VP Marketing','Procurement Lead'];
  csts text[] := array['new','contacted','meeting','customer','lost'];
begin
  select organization_id into org from organization_members where user_id = auth.uid() and role in ('owner','admin') limit 1;
  if org is null then raise exception 'NOT_ADMIN'; end if;
  if exists (select 1 from companies where organization_id = org) then raise exception 'ORG_NOT_EMPTY'; end if;
  for i in 1..10 loop
    insert into companies (organization_id, name, website, industry, country, employee_range, status, notes)
    values (org, names[i], 'https://' || hosts[i], inds[i], ctrs[i], rngs[i], sts[i], 'Fictional sample company.')
    returning id into cid;
    for j in 1..(2 + (i % 2)) loop
      n := n + 1;
      insert into contacts (organization_id, company_id, full_name, job_title, email, linkedin_url, status, next_follow_up)
      values (org, cid, first[1 + (n % 10)] || ' ' || last[1 + (n % 6)], titles[1 + (n % 5)],
              'fake' || n || '@example.com', 'https://example.com/in/fake-' || n, csts[1 + (n % 5)],
              current_date + ((n % 12) - 3));
    end loop;
  end loop;
end $$;

revoke execute on function public.create_workspace(text), public.claim_invite(), public.set_member_role(uuid, text), public.seed_sample_data() from public, anon;
grant execute on function public.create_workspace(text), public.claim_invite(), public.set_member_role(uuid, text), public.seed_sample_data() to authenticated;
revoke execute on function public.handle_new_user(), public.guard_last_owner() from public, anon, authenticated;