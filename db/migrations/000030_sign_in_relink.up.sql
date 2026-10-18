-- Sign-in claims the account with the token's e-mail address even when it is linked to
-- another identity-provider subject (an account created with the development sign-in, or a
-- Keycloak account that was deleted and registered again). The API only accepts tokens with
-- a verified e-mail address, so controlling the address is what proves ownership.
CREATE OR REPLACE FUNCTION app.sign_in(p_subject text, p_email text, p_display_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM users WHERE auth_subject = p_subject;
  IF v_id IS NULL THEN
    UPDATE users SET auth_subject = p_subject
      WHERE email = p_email::citext
      RETURNING id INTO v_id;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO users (auth_subject, email, display_name)
      VALUES (p_subject, p_email, p_display_name)
      RETURNING id INTO v_id;
  END IF;
  UPDATE users SET last_login_at = now() WHERE id = v_id;
  -- Pending invitations become active once the invitee signs in.
  UPDATE memberships SET status = 'active' WHERE user_id = v_id AND status = 'invited';
  RETURN v_id;
END
$$;
