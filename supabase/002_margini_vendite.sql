-- Aggiunge i campi di marginalità alla tabella vendite (costo, margine, ricarico,
-- prezzo medio, quantità omaggio), per sfruttare gli export di venduto completi
-- di marginalità (es. gestionale con colonne Mar%, Ric%, UtileL, PMV, Omaggio).
--
-- Eseguire una sola volta nell'SQL Editor di Supabase, sul progetto già esistente
-- (chi installa lo schema da zero con schema.sql li ha già inclusi).

alter table public.vendite
  add column if not exists costo_acquisto numeric,
  add column if not exists margine_percentuale numeric,
  add column if not exists margine_valore numeric,
  add column if not exists ricarico_percentuale numeric,
  add column if not exists prezzo_medio_vendita numeric,
  add column if not exists quantita_omaggio numeric;
