-- Add bundle storage to lobby players so the API can return the assigned
-- bundle on re-join (e.g. after a page refresh) or when the state machine
-- pre-registers the player before the /api/join_game HTTP call arrives.
ALTER TABLE werewolf_lobby_players ADD COLUMN IF NOT EXISTS bundle TEXT;
