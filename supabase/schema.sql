-- À exécuter dans Supabase → SQL Editor → New query → Run

-- Table des clés d'accès joueurs
create table if not exists public.keys (
  id           text primary key,
  key_code     text not null unique,
  player_name  text not null,
  expires_at   bigint, -- null ou 0 pour durée infinie
  created_at   bigint not null
);

-- Sécurité : RLS activé et AUCUNE policy => la clé publishable (publique) ne peut ni lire ni écrire.
-- Seul le serveur, avec la SECRET KEY, accède à cette table.
alter table public.keys enable row level security;
revoke all on public.keys from anon, authenticated;
