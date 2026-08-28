-- Unisce gli articoli duplicati a catalogo: import da fonti diverse (PDF,
-- Excel) hanno creato piu' righe per lo stesso prodotto quando differivano
-- per dettagli minimi — maiuscole/minuscole, uno zero iniziale sul codice
-- perso da Excel, un marcatore "(P)"/"(T)" presente in una fonte e assente
-- nell'altra. Per ogni gruppo di duplicati (stessa descrizione, ripulita di
-- questi dettagli) si tiene l'articolo con id piu' basso (il primo
-- importato) e si spostano su di lui gli assortimenti e le vendite degli
-- altri, che poi vengono eliminati dal catalogo.
--
-- Eseguire una sola volta nell'SQL Editor di Supabase, dopo aver importato
-- dati da più fonti nello stesso catalogo articoli.

create extension if not exists unaccent;

create temporary table _articoli_merge_map as
with normalizzato as (
  select id,
    regexp_replace(
      regexp_replace(lower(unaccent(descrizione)), '\(p\)|\(t\)', '', 'g'),
      '[^a-z0-9]', '', 'g'
    ) as chiave
  from public.articoli
),
gruppi_duplicati as (
  select chiave, min(id) as canonico_id, array_agg(id order by id) as tutti_ids
  from normalizzato
  where chiave <> ''
  group by chiave
  having count(*) > 1
)
select unnest(tutti_ids) as vecchio_id, canonico_id
from gruppi_duplicati;

delete from _articoli_merge_map where vecchio_id = canonico_id;

-- Righe di assortimento che andrebbero in conflitto (il gruppo ha già il
-- canonico in assortimento): si eliminano invece di spostarle, il vincolo
-- unique (gruppo_id, articolo_id) non lo permetterebbe comunque.
delete from public.assortimenti a
using _articoli_merge_map m
where a.articolo_id = m.vecchio_id
  and exists (
    select 1 from public.assortimenti a2
    where a2.gruppo_id = a.gruppo_id and a2.articolo_id = m.canonico_id
  );

update public.assortimenti a
set articolo_id = m.canonico_id
from _articoli_merge_map m
where a.articolo_id = m.vecchio_id;

update public.vendite v
set articolo_id = m.canonico_id
from _articoli_merge_map m
where v.articolo_id = m.vecchio_id;

delete from public.articoli a
using _articoli_merge_map m
where a.id = m.vecchio_id;

drop table _articoli_merge_map;
