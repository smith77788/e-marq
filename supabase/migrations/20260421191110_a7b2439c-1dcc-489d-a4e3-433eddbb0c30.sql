-- Явна deny-all policy: ніхто з API не читає/пише цю таблицю напряму.
CREATE POLICY "anon_rl_no_direct_access"
  ON public.anon_event_rate_limit
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);