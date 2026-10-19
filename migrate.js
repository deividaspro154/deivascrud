import pg from "pg";
import fs from "fs/promises";
import path from "path";

const { Pool } = pg;
const targetUrl = process.env.DATABASE_URL;
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const uploadDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/uploads";
const marker = path.join(uploadDir, ".migration-complete");

if (!targetUrl) throw new Error("DATABASE_URL missing");
const target = new Pool({ connectionString: targetUrl });
await fs.mkdir(uploadDir, { recursive: true });

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function ensureSchema() {
  await target.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      available BOOLEAN NOT NULL DEFAULT true,
      restock_date DATE,
      image_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await target.query(`
    CREATE TABLE IF NOT EXISTS background_runs (
      id SERIAL PRIMARY KEY,
      ran_at TIMESTAMP NOT NULL DEFAULT NOW(),
      changed_count INTEGER NOT NULL DEFAULT 0,
      source VARCHAR(30) NOT NULL DEFAULT 'unknown'
    )
  `);
}

try {
  await ensureSchema();
  if (await exists(marker)) {
    console.log("Migration already completed. Skipping.");
  } else if (!sourceUrl) {
    console.log("SOURCE_DATABASE_URL not set. No old data copied.");
  } else {
    const source = new Pool({ connectionString: sourceUrl });
    try {
      const products = await source.query(`SELECT * FROM products ORDER BY id`);
      console.log(`Found ${products.rows.length} old product(s).`);

      for (const p of products.rows) {
        let imageUrl = p.image_url;
        if (imageUrl && /^https?:\/\//.test(imageUrl)) {
          try {
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            let ext = path.extname(new URL(imageUrl).pathname);
            if (!ext || ext.length > 6) ext = ".jpg";
            const filename = `migrated-${p.id}${ext}`;
            await fs.writeFile(path.join(uploadDir, filename), bytes);
            imageUrl = `/uploads/${filename}`;
            console.log(`Copied image for product ${p.id}`);
          } catch (e) {
            console.warn(`Image ${p.id} not copied: ${e.message}`);
          }
        }

        await target.query(`
          INSERT INTO products
            (id,name,quantity,price,available,restock_date,image_url,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name,
            quantity=EXCLUDED.quantity,
            price=EXCLUDED.price,
            available=EXCLUDED.available,
            restock_date=EXCLUDED.restock_date,
            image_url=EXCLUDED.image_url,
            created_at=EXCLUDED.created_at
        `, [p.id,p.name,p.quantity,p.price,p.available,p.restock_date,imageUrl,p.created_at]);
      }

      try {
        const runs = await source.query(`SELECT * FROM background_runs ORDER BY id`);
        for (const r of runs.rows) {
          await target.query(`
            INSERT INTO background_runs (id,ran_at,changed_count,source)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (id) DO UPDATE SET
              ran_at=EXCLUDED.ran_at,
              changed_count=EXCLUDED.changed_count,
              source=EXCLUDED.source
          `, [r.id,r.ran_at,r.changed_count,r.source || "old-vercel"]);
        }
        console.log(`Copied ${runs.rows.length} background run(s).`);
      } catch (e) {
        console.warn("background_runs not copied:", e.message);
      }

      await target.query(`SELECT setval(pg_get_serial_sequence('products','id'), COALESCE((SELECT MAX(id) FROM products),1), true)`);
      await target.query(`SELECT setval(pg_get_serial_sequence('background_runs','id'), COALESCE((SELECT MAX(id) FROM background_runs),1), true)`);
      await fs.writeFile(marker, new Date().toISOString());
      console.log("MIGRATION COMPLETE: Neon -> Railway PostgreSQL, Blob -> Railway Volume");
    } finally {
      await source.end();
    }
  }
} finally {
  await target.end();
}
