-- ---------------------------------------------------------------------------
-- Introduce un ruolo "lettore" a sola lettura, oltre all'admin con accesso
-- completo. Il ruolo è salvato in app_metadata (auth.users), un campo che
-- l'utente stesso NON può modificare via client — solo un admin via SQL o
-- Supabase Dashboard può cambiarlo. Le policy RLS sono l'unica vera barriera:
-- anche bypassando l'interfaccia, il database rifiuta comunque le scritture.
-- ---------------------------------------------------------------------------

-- 1) Imposta il tuo account esistente come admin (accesso completo).
--    Sostituisci l'email se necessario.
update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'admin')
where email = 'tome.johnny@gmail.com';

-- 2) Sostituisce la policy unica "authenticated_full_access" con due policy
--    per tabella: lettura aperta a chiunque sia autenticato, scrittura
--    riservata a chi ha role = 'admin' in app_metadata.
do $$
declare
  t text;
begin
  foreach t in array array['agenti','gdo_groups','punti_vendita','articoli','assortimenti','import_batches','vendite','attivita','audit_log']
  loop
    execute format('drop policy if exists "authenticated_full_access" on public.%I;', t);

    execute format(
      'create policy "authenticated_read" on public.%I for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "admin_write" on public.%I for all to authenticated using (auth.jwt() -> ''app_metadata'' ->> ''role'' = ''admin'') with check (auth.jwt() -> ''app_metadata'' ->> ''role'' = ''admin'');',
      t
    );
  end loop;
end $$;
