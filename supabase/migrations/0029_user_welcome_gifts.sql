-- Migration: user_welcome_gifts
-- Tracks which users have already claimed their one-time new-user welcome gift (300 coins).

CREATE TABLE IF NOT EXISTS user_welcome_gifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coins      integer NOT NULL DEFAULT 300,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Only the owner and service roles can read/write
ALTER TABLE user_welcome_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_only" ON user_welcome_gifts
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
