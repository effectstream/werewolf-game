/**
 * Database pool accessor for the node server.
 *
 * This module provides access to the database connection pool.
 * The actual pool is managed by the runtime and passed to the apiRouter.
 */

import type { Pool } from "pg";

/**
 * Global reference to the database connection pool.
 * This is set by the apiRouter when it receives the pool from the runtime.
 */
let dbPool: Pool | null = null;

/**
 * Set the database connection pool.
 * This should be called by the apiRouter when it receives the pool from the runtime.
 */
export function setDbPool(pool: Pool): void {
  dbPool = pool;
}

/**
 * Get the database connection pool.
 */
export function getDbPool(): Pool {
  if (!dbPool) {
    throw new Error(
      "[db-pool] Database pool not initialized. Make sure setDbPool() was called.",
    );
  }
  return dbPool;
}
