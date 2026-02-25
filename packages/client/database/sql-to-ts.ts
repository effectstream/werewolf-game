import { getConnection } from "@paimaexample/db";
// TODO Update this to use the @paimaexample/db-emulator package
// import { standAloneApplyMigrations } from "@paimaexample/db-emulator";
import { standAloneApplyMigrations } from "./src/patch-emulator.ts";
import { migrationTable } from "./src/migration-order.ts";
import { config as localhostConfig } from "@werewolf-game/data-types/config";

// This helper applies Paima Engine Migrations to the database, so you can use it to generate the pgtyped files.
const db = await getConnection();
await standAloneApplyMigrations(db, migrationTable, localhostConfig as any);
console.log("✅ System & User migrations applied");

Deno.exit(0);
