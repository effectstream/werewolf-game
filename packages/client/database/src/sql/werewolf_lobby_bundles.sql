/* @name insertBundle */
INSERT INTO werewolf_lobby_bundles (game_id, bundle)
VALUES (:game_id!, :bundle!);

/* @name countBundles */
SELECT COUNT(*) AS remaining FROM werewolf_lobby_bundles WHERE game_id = :game_id!;

/* @name popBundle */
DELETE FROM werewolf_lobby_bundles
WHERE id = (
  SELECT id FROM werewolf_lobby_bundles
  WHERE game_id = :game_id!
  ORDER BY id DESC
  LIMIT 1
)
RETURNING bundle;
