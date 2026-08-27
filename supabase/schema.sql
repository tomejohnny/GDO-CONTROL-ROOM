-- GDO Control Room — Tessaro S.p.A.
-- Schema completo. Eseguire una sola volta nell'SQL Editor di Supabase
-- (Project -> SQL Editor -> New query -> incolla ed esegui).
--
-- Modello: gruppi GDO (es. "Conad Dao Trento") -> punti vendita -> assortimenti
-- (articolo attivo/proposto per PdV) + agenti assegnati ai PdV + vendite (import)
-- + attivita di follow-up per gruppo + audit di ogni import massivo.

-- ---------------------------------------------------------------------------
-- AGENTI
-- ---------------------------------------------------------------------------
create table if not exists public.agenti (
  id bigint generated always as identity primary key,
  nome text not null,
  cognome text not null,
  zona text,
  telefono text,
  email text,
  attivo boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GRUPPI GDO (es. Conad Dao Trento, Coop Alleanza, Crai...)
-- ---------------------------------------------------------------------------
create table if not exists public.gdo_groups (
  id bigint generated always as identity primary key,
  nome text not null,
  area_geografica text,
  stato text not null default 'attivo' check (stato in ('attivo', 'target', 'sospeso')),
  referente_buyer text,
  contatto_buyer text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PUNTI VENDITA — appartengono a un gruppo, eventualmente assegnati a un agente
-- ---------------------------------------------------------------------------
create table if not exists public.punti_vendita (
  id bigint generated always as identity primary key,
  gruppo_id bigint not null references public.gdo_groups(id) on delete cascade,
  nome_insegna text not null,
  indirizzo text,
  comune text,
  provincia text,
  cap text,
  stato text not null default 'non_servito' check (stato in ('servito', 'non_servito', 'target', 'sospeso')),
  agente_id bigint references public.agenti(id) on delete set null,
  data_attivazione date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_punti_vendita_gruppo on public.punti_vendita(gruppo_id);
create index if not exists idx_punti_vendita_agente on public.punti_vendita(agente_id);

-- ---------------------------------------------------------------------------
-- ARTICOLI — catalogo prodotti Tessaro
-- ---------------------------------------------------------------------------
create table if not exists public.articoli (
  id bigint generated always as identity primary key,
  codice text,
  descrizione text not null,
  categoria text not null default 'scaffale' check (categoria in ('formaggi', 'salumi', 'congelato', 'carne_pesce', 'scaffale')),
  unita_misura text,
  attivo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ASSORTIMENTI — articolo attivo/proposto per punto vendita
-- ---------------------------------------------------------------------------
create table if not exists public.assortimenti (
  id bigint generated always as identity primary key,
  punto_vendita_id bigint not null references public.punti_vendita(id) on delete cascade,
  articolo_id bigint not null references public.articoli(id) on delete cascade,
  stato text not null default 'proposto' check (stato in ('attivo', 'proposto', 'in_trattativa', 'rifiutato', 'sospeso')),
  data_inizio date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (punto_vendita_id, articolo_id)
);

create index if not exists idx_assortimenti_pdv on public.assortimenti(punto_vendita_id);
create index if not exists idx_assortimenti_articolo on public.assortimenti(articolo_id);

-- ---------------------------------------------------------------------------
-- IMPORT BATCHES — audit di ogni import massivo (deve esistere prima di vendite)
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id bigint generated always as identity primary key,
  tabella_target text not null,
  filename text,
  righe_totali integer not null default 0,
  righe_ok integer not null default 0,
  righe_errore integer not null default 0,
  dettagli_errori jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- ---------------------------------------------------------------------------
-- VENDITE — statistiche di venduto (da import), per PdV e/o gruppo, per articolo
-- ---------------------------------------------------------------------------
create table if not exists public.vendite (
  id bigint generated always as identity primary key,
  punto_vendita_id bigint references public.punti_vendita(id) on delete cascade,
  gruppo_id bigint not null references public.gdo_groups(id) on delete cascade,
  articolo_id bigint references public.articoli(id) on delete set null,
  periodo date not null,
  quantita numeric,
  valore_euro numeric,
  costo_acquisto numeric,
  margine_percentuale numeric,
  margine_valore numeric,
  ricarico_percentuale numeric,
  prezzo_medio_vendita numeric,
  quantita_omaggio numeric,
  import_batch_id bigint references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_vendite_gruppo on public.vendite(gruppo_id);
create index if not exists idx_vendite_pdv on public.vendite(punto_vendita_id);
create index if not exists idx_vendite_periodo on public.vendite(periodo);

-- ---------------------------------------------------------------------------
-- ATTIVITA — follow-up / CRM per gruppo (note, chiamate, visite, task)
-- ---------------------------------------------------------------------------
create table if not exists public.attivita (
  id bigint generated always as identity primary key,
  gruppo_id bigint not null references public.gdo_groups(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('nota', 'chiamata', 'visita', 'task')),
  descrizione text not null,
  responsabile text,
  scadenza date,
  completato boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_attivita_gruppo on public.attivita(gruppo_id);

-- ---------------------------------------------------------------------------
-- AUDIT LOG — traccia ogni insert/update/delete manuale (come nella family control room)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_agenti_updated_at on public.agenti;
create trigger trg_agenti_updated_at before update on public.agenti
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gdo_groups_updated_at on public.gdo_groups;
create trigger trg_gdo_groups_updated_at before update on public.gdo_groups
  for each row execute function public.set_updated_at();

drop trigger if exists trg_punti_vendita_updated_at on public.punti_vendita;
create trigger trg_punti_vendita_updated_at before update on public.punti_vendita
  for each row execute function public.set_updated_at();

drop trigger if exists trg_assortimenti_updated_at on public.assortimenti;
create trigger trg_assortimenti_updated_at before update on public.assortimenti
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — un solo utente autenticato (te), stessa policy per tutte le tabelle:
-- chiunque abbia una sessione valida puo' leggere/scrivere tutto.
-- ---------------------------------------------------------------------------
alter table public.agenti enable row level security;
alter table public.gdo_groups enable row level security;
alter table public.punti_vendita enable row level security;
alter table public.articoli enable row level security;
alter table public.assortimenti enable row level security;
alter table public.import_batches enable row level security;
alter table public.vendite enable row level security;
alter table public.attivita enable row level security;
alter table public.audit_log enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['agenti','gdo_groups','punti_vendita','articoli','assortimenti','import_batches','vendite','attivita','audit_log']
  loop
    execute format('drop policy if exists "authenticated_full_access" on public.%I;', t);
    execute format(
      'create policy "authenticated_full_access" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
