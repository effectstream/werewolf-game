import type { DBMigrations } from "@paimaexample/runtime";
import databaseSql from "./migrations/database.sql" with { type: "text" };
import werewolfGameSql from "./migrations/werewolf_game.sql" with { type: "text" };

export const migrationTable: DBMigrations[] = [
  {
    name: "database.sql",
    sql: databaseSql,
  },
  {
    name: "werewolf_game.sql",
    sql: werewolfGameSql,
  },
];
