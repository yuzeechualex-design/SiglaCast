-- Spotify link + “now playing” on profile; optional sound metadata on stories.

alter table public.users add column if not exists spotify_refresh_token text;
alter table public.users add column if not exists spotify_linked_at timestamptz;
alter table public.users add column if not exists music_share_now_playing boolean not null default false;
alter table public.users add column if not exists music_now_playing jsonb;

alter table public.user_stories add column if not exists spotify_track_id text;
alter table public.user_stories add column if not exists music_title text;
alter table public.user_stories add column if not exists music_artist text;
alter table public.user_stories add column if not exists music_image_url text;
alter table public.user_stories add column if not exists music_preview_url text;
alter table public.user_stories add column if not exists music_external_url text;

alter table public.user_stories drop constraint if exists user_stories_has_content;

alter table public.user_stories add constraint user_stories_has_content check (
  (length(trim(coalesce(body_text, ''))) > 0)
  or (media_url is not null and length(trim(coalesce(media_url, ''))) > 0)
  or (spotify_track_id is not null and length(trim(spotify_track_id)) > 0)
);
