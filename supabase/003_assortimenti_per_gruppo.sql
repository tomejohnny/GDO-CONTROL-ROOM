-- Semplifica gli assortimenti da "per punto vendita" a "per gruppo GDO":
-- un articolo è autorizzato per l'intero gruppo, non per il singolo punto
-- vendita — è la statistica di venduto (già per punto vendita) a dire poi
-- chi lo compra davvero e chi no.
--
-- Eseguire una sola volta nell'SQL Editor di Supabase, sul progetto già
-- esistente (chi installa lo schema da zero con schema.sql ha già la
-- versione aggiornata).

alter table public.assortimenti add column if not exists gruppo_id bigint references public.gdo_groups(id) on delete cascade;

update public.assortimenti a
set gruppo_id = pv.gruppo_id
from public.punti_vendita pv
where a.punto_vendita_id = pv.id and a.gruppo_id is null;

-- Righe che per qualche motivo non hanno risolto un gruppo (punto vendita
-- orfano) vengono rimosse: non c'e' modo sicuro di assegnarle altrove.
delete from public.assortimenti where gruppo_id is null;

alter table public.assortimenti alter column gruppo_id set not null;

alter table public.assortimenti drop constraint if exists assortimenti_punto_vendita_id_articolo_id_key;
drop index if exists idx_assortimenti_pdv;

alter table public.assortimenti drop column if exists punto_vendita_id;

alter table public.assortimenti add constraint assortimenti_gruppo_id_articolo_id_key unique (gruppo_id, articolo_id);
create index if not exists idx_assortimenti_gruppo on public.assortimenti(gruppo_id);
