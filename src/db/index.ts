import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    return null;
  }
  if (!dbInstance) {
    const pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: 3000,
    });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export { schema };
