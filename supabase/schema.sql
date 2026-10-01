-- À exécuter UNE SEULE FOIS : Supabase → SQL Editor → New query → Run
create table if not exists public.users (
  id            text primary key,
  username      text   not null,
  username_key  text   not null unique,
  password_hash text   not null,
  created_at    bigint not null
);

-- Sécurité : RLS activé et AUCUNE policy => la clé publishable (publique) ne peut ni lire ni écrire.
-- Seul le serveur, avec la SECRET KEY, accède à cette table.
alter table public.users enable row level security;
revoke all on public.users from anon, authenticated;
