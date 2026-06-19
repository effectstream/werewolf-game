import type { DBMigrations } from "@effectstream/runtime";
import databaseSql from "./migrations/database.sql" with { type: "text" };
import werewolfGameSql from "./migrations/werewolf_game.sql" with { type: "text" };
import werewolfRoundTimedOutSql from "./migrations/werewolf_round_timed_out.sql" with { type: "text" };
import werewolfLobbySql from "./migrations/werewolf_lobby.sql" with { type: "text" };
import werewolfGameViewSql from "./migrations/werewolf_game_view.sql" with { type: "text" };
import werewolfLeaderboardSql from "./migrations/werewolf_leaderboard.sql" with { type: "text" };
import werewolfWalletMappingSql from "./migrations/werewolf_wallet_mapping.sql" with { type: "text" };
import werewolfRoundStateUnresolvedIdxSql from "./migrations/werewolf_round_state_unresolved_idx.sql" with { type: "text" };

export const migrationTable: DBMigrations[] = [
  {
    name: "database.sql",
    sql: databaseSql,
  },
  {
    name: "werewolf_game.sql",
    sql: werewolfGameSql,
  },
  {
    name: "werewolf_round_timed_out.sql",
    sql: werewolfRoundTimedOutSql,
  },
  {
    name: "werewolf_lobby.sql",
    sql: werewolfLobbySql,
  },
  {
    name: "werewolf_game_view.sql",
    sql: werewolfGameViewSql,
  },
  {
    name: "werewolf_leaderboard.sql",
    sql: werewolfLeaderboardSql,
  },
  {
    name: "werewolf_wallet_mapping.sql",
    sql: werewolfWalletMappingSql,
  },
  {
    name: "werewolf_round_state_unresolved_idx.sql",
    sql: werewolfRoundStateUnresolvedIdxSql,
  },
];
