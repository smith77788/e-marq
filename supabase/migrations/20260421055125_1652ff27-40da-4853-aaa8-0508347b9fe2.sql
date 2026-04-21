DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower('confide77778888@gmail.com') LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email confide77778888@gmail.com not found in auth.users';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;