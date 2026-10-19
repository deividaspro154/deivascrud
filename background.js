import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS background_runs (
      id SERIAL PRIMARY KEY,
      ran_at TIMESTAMP NOT NULL DEFAULT NOW(),
      changed_count INTEGER NOT NULL DEFAULT 0,
      source VARCHAR(30) NOT NULL DEFAULT 'unknown'
    )
  `);

  const changed = await pool.query(`
    UPDATE products
    SET available = false
    WHERE quantity = 0 AND available = true
    RETURNING id
  `);

  await pool.query(
    `INSERT INTO background_runs (changed_count, source) VALUES ($1, $2)`,
    [changed.rowCount, "railway-cron"]
  );

  console.log(`Railway Cron finished. Changed ${changed.rowCount} product(s).`);
} finally {
  await pool.end();
}
