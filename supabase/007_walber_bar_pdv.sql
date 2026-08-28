-- I punti vendita Walber il cui nome finisce per "BAR" (canale bar, non
-- quello diretto) erano stati importati sotto il gruppo WALBER DIRETTO
-- invece che sotto Walber Bar — probabilmente il file di importazione del
-- venduto aveva un'unica colonna "gruppo" valorizzata per tutte le righe
-- Walber. Li sposto sul gruppo giusto, insieme alle vendite già registrate.
--
-- Eseguire una sola volta nell'SQL Editor di Supabase.

create temporary table _walber_bar_pdv as
select p.id as pdv_id
from public.punti_vendita p
join public.gdo_groups gd on gd.id = p.gruppo_id
where gd.nome = 'WALBER DIRETTO'
  and upper(p.nome_insegna) like '% BAR';

update public.vendite v
set gruppo_id = (select id from public.gdo_groups where nome = 'Walber Bar')
from _walber_bar_pdv wb
where v.punto_vendita_id = wb.pdv_id;

update public.punti_vendita p
set gruppo_id = (select id from public.gdo_groups where nome = 'Walber Bar')
from _walber_bar_pdv wb
where p.id = wb.pdv_id;

drop table _walber_bar_pdv;
