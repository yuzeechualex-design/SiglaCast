-- Aggregated notifications (badge) + richer comment reactions
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS badge_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS source_key text NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind text NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS notifications_user_source_key_idx ON public.notifications(user_id, source_key);

CREATE TABLE IF NOT EXISTS public.comment_reactions (
  comment_id text NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS comment_reactions_comment_idx ON public.comment_reactions(comment_id);

-- Best-effort: copy legacy heart likes into comment_reactions as "love".
INSERT INTO public.comment_reactions (comment_id, user_id, reaction)
SELECT cl.comment_id, cl.user_id, 'love'::text
FROM public.comment_likes cl
ON CONFLICT (comment_id, user_id) DO NOTHING;
