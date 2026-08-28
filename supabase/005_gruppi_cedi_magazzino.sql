-- Separa il magazzino centrale (CEDI) di ACIL, DAO e COOP dal gruppo
-- "diretto": crea tre nuovi gruppi *_CEDI, sposta su ognuno (non duplica)
-- l'assortimento che veniva dal listino centralizzato, e rimuove il
-- magazzino centrale dai punti vendita del gruppo diretto — spostando prima
-- su *_CEDI le eventuali vendite già importate per lui, altrimenti
-- verrebbero cancellate a cascata insieme al punto vendita.
--
-- Eseguire una sola volta nell'SQL Editor di Supabase.

-- 1) crea i tre nuovi gruppi, se non esistono già
insert into public.gdo_groups (nome, stato)
select v.nome, 'attivo'
from (values ('ACIL CEDI'), ('DAO CEDI'), ('COOP CEDI')) as v(nome)
where not exists (select 1 from public.gdo_groups g where g.nome = v.nome);

-- 2) sposta gli articoli del listino magazzino centrale dal gruppo diretto
--    al nuovo gruppo CEDI corrispondente, per codice articolo (ignorando
--    zeri iniziali persi da Excel)
create temporary table _cedi_map (gruppo_da text, gruppo_a text, codice text);
insert into _cedi_map (gruppo_da, gruppo_a, codice) values
  ('ACIL', 'ACIL CEDI', '5048091901'),
  ('ACIL', 'ACIL CEDI', '5060099081'),
  ('ACIL', 'ACIL CEDI', '68524000835'),
  ('ACIL', 'ACIL CEDI', '68532012401'),
  ('ACIL', 'ACIL CEDI', '68532000156'),
  ('ACIL', 'ACIL CEDI', '68536000124'),
  ('ACIL', 'ACIL CEDI', '68540000080'),
  ('ACIL', 'ACIL CEDI', '68544003802'),
  ('ACIL', 'ACIL CEDI', '907741705'),
  ('DAO', 'DAO CEDI', '685325175T'),
  ('DAO', 'DAO CEDI', '685325174'),
  ('DAO', 'DAO CEDI', '685325614T'),
  ('DAO', 'DAO CEDI', '685365612'),
  ('DAO', 'DAO CEDI', '685365613T'),
  ('DAO', 'DAO CEDI', '68536000124'),
  ('DAO', 'DAO CEDI', '685365173'),
  ('COOP', 'COOP CEDI', '68520028404'),
  ('COOP', 'COOP CEDI', '68536000123');

create temporary table _cedi_resolved as
select
  gd.id as gruppo_da_id,
  ga.id as gruppo_a_id,
  a.id as articolo_id
from _cedi_map m
join public.gdo_groups gd on gd.nome = m.gruppo_da
join public.gdo_groups ga on ga.nome = m.gruppo_a
join public.articoli a on regexp_replace(a.codice, '^0+(?=.)', '') = regexp_replace(m.codice, '^0+(?=.)', '');

insert into public.assortimenti (gruppo_id, articolo_id, stato, data_inizio, note)
select r.gruppo_a_id, r.articolo_id, a.stato, a.data_inizio, a.note
from _cedi_resolved r
join public.assortimenti a on a.gruppo_id = r.gruppo_da_id and a.articolo_id = r.articolo_id
on conflict (gruppo_id, articolo_id) do nothing;

delete from public.assortimenti a
using _cedi_resolved r
where a.gruppo_id = r.gruppo_da_id and a.articolo_id = r.articolo_id;

drop table _cedi_map;
drop table _cedi_resolved;

-- 3) il magazzino centrale non deve contare come punto vendita: eventuali
--    vendite già importate per lui vengono spostate sul nuovo gruppo CEDI
--    (senza punto vendita, dato che il CEDI non ne ha), poi il punto vendita
--    "magazzino" viene eliminato dal gruppo diretto. Match per nome ilike
--    '%magazzino%' (più robusto di un nome esatto) scoped ai soli tre gruppi.
create temporary table _cedi_pdv as
select p.id as pdv_id, g.id as gruppo_a_id
from public.punti_vendita p
join public.gdo_groups g_diretto on g_diretto.id = p.gruppo_id
join public.gdo_groups g on g.nome = g_diretto.nome || ' CEDI'
where g_diretto.nome in ('ACIL', 'DAO', 'COOP')
  and p.nome_insegna ilike '%magazzino%';

update public.vendite v
set gruppo_id = cp.gruppo_a_id, punto_vendita_id = null
from _cedi_pdv cp
where v.punto_vendita_id = cp.pdv_id;

delete from public.punti_vendita p
using _cedi_pdv cp
where p.id = cp.pdv_id;

drop table _cedi_pdv;
