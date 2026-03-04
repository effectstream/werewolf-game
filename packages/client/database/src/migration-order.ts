import type { DBMigrations } from "@paimaexample/runtime";
import databaseSql from "./migrations/database.sql" with { type: "text" };
import werewolfGameSql from "./migrations/werewolf_game.sql" with { type: "text" };
import werewolfLobbySql from "./migrations/werewolf_lobby.sql" with { type: "text" };
import werewolfGameViewSql from "./migrations/werewolf_game_view.sql" with { type: "text" };

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
    name: "werewolf_lobby.sql",
    sql: werewolfLobbySql,
  },
  {
    name: "werewolf_game_view.sql",
    sql: werewolfGameViewSql,
  },
];
