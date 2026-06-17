-- career-ops Supabase schema. Run this in the Supabase SQL editor.
-- The Node server connects with the service_role key (trusted, bypasses RLS),
-- so RLS below is a safety net (deny-by-default for anon/auth clients).

create table if not exists profiles (
  uid text primary key,
  full_name text, email text, phone text, location text,
  linkedin text, github text, portfolio_url text, work_authorization text,
  updated_at timestamptz default now()
);

create table if not exists jobs (
  uid text not null,
  url text not null,
  first_seen date,
  source text, title text, company text, location text,
  posted timestamptz,
  created_at timestamptz default now(),
  primary key (uid, url)
);
create index if not exists jobs_uid_idx on jobs (uid);
-- If the jobs table already existed, add the column:
alter table jobs add column if not exists posted timestamptz;

create table if not exists applications (
  uid text not null,
  url text not null,
  company text, title text,
  tailored_resume text, tailored_at timestamptz,
  applied boolean default false, applied_at timestamptz, resume_used text,
  primary key (uid, url)
);

-- RLS on (server uses service_role which bypasses it; no public policies = locked down)
alter table profiles     enable row level security;
alter table jobs         enable row level security;
alter table applications enable row level security;

-- Optional: a Storage bucket for résumés / tailored PDFs
-- (create in dashboard: Storage → New bucket → name "resumes", private)
