import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { config } from './lib/config';

export const pool = new pg.Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: config.server.nodeEnv === 'production' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

export const db = drizzle(pool, { schema });
