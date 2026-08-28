-- Le vendite di COOP sugli articoli ora in COOP CEDI (68520028404,
-- 68536000123) erano registrate su un punto vendita che non conteneva
-- "magazzino" nel nome (a differenza di ACIL/DAO), quindi la migrazione 005
-- non le aveva spostate insieme all'assortimento. Le sposto ora, per codice
-- articolo, indipendentemente da quale punto vendita di COOP le avesse.
--
-- Eseguire una sola volta nell'SQL Editor di Supabase, dopo la 005.

update public.vendite v
set gruppo_id = (select id from public.gdo_groups where nome = 'COOP CEDI'),
    punto_vendita_id = null
from public.articoli a
where v.articolo_id = a.id
  and v.gruppo_id = (select id from public.gdo_groups where nome = 'COOP')
  and regexp_replace(a.codice, '^0+(?=.)', '') in ('68520028404', '68536000123');
