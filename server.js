import express from "express";
import multer from "multer";
import { neon } from "@neondatabase/serverless";
import { put, del, list } from "@vercel/blob";

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

app.set("view engine", "ejs");
app.set("views", "./views");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let schemaReady = false;

function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing. Connect Neon in Vercel.");
  }
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema() {
  if (schemaReady) return;

  const sql = db();

  await sql`
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
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS background_runs (
      id SERIAL PRIMARY KEY,
      ran_at TIMESTAMP NOT NULL DEFAULT NOW(),
      changed_count INTEGER NOT NULL DEFAULT 0
    )
  `;

  // Small migration for projects that already had the old table.
  await sql`
    ALTER TABLE background_runs
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'unknown'
  `;

  schemaReady = true;
}

app.use(async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (error) {
    console.error(error);

    res.status(500).send(`
      <h2>Database not connected</h2>
      <p>Vercel project -> Storage -> Neon -> connect database.</p>
      <pre>${error.message}</pre>
    `);
  }
});

function validateProduct(body) {
  const errors = [];

  // 1. STRING
  const name = String(body.name ?? "").trim();

  // 2. INTEGER
  const quantity = Number(body.quantity);

  // 3. DECIMAL / NUMBER
  const price = Number(body.price);

  // 4. BOOLEAN
  const available =
    body.available === "on" ||
    body.available === true;

  // 5. DATE
  const restockDate =
    body.restock_date
      ? String(body.restock_date)
      : null;

  if (name.length < 2 || name.length > 100) {
    errors.push("Name must be 2-100 characters.");
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    errors.push("Quantity must be a non-negative integer.");
  }

  if (!Number.isFinite(price) || price < 0) {
    errors.push("Price must be a non-negative number.");
  }

  if (
    restockDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(restockDate)
  ) {
    errors.push("Restock date must use YYYY-MM-DD.");
  }

  return {
    errors,
    data: {
      name,
      quantity,
      price,
      available,
      restockDate
    }
  };
}

function validateApiProduct(body) {
  const errors = [];

  if (
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.trim().length > 100
  ) {
    errors.push("name must be a string with 2-100 characters.");
  }

  if (
    !Number.isInteger(body.quantity) ||
    body.quantity < 0
  ) {
    errors.push("quantity must be a non-negative integer.");
  }

  if (
    typeof body.price !== "number" ||
    !Number.isFinite(body.price) ||
    body.price < 0
  ) {
    errors.push("price must be a non-negative number.");
  }

  if (typeof body.available !== "boolean") {
    errors.push("available must be true or false.");
  }

  if (
    body.restock_date !== null &&
    body.restock_date !== undefined &&
    (
      typeof body.restock_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.restock_date)
    )
  ) {
    errors.push("restock_date must be YYYY-MM-DD or null.");
  }

  if (errors.length) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      name: body.name.trim(),
      quantity: body.quantity,
      price: body.price,
      available: body.available,
      restockDate: body.restock_date ?? null
    }
  };
}

function allowedImage(file) {
  return (
    !file ||
    [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif"
    ].includes(file.mimetype)
  );
}

async function uploadImage(file) {
  if (!file) return null;

  if (!allowedImage(file)) {
    throw new Error(
      "Only PNG, JPG, WEBP and GIF files are allowed."
    );
  }

  const safeName = file.originalname.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  return await put(
    `products/${Date.now()}-${safeName}`,
    file.buffer,
    {
      access: "public",
      addRandomSuffix: true,
      contentType: file.mimetype
    }
  );
}

async function getStorageInfo() {
  try {
    const result = await list({
      prefix: "products/",
      limit: 100
    });

    return {
      connected: true,
      blobs: result.blobs ?? [],
      error: null
    };
  } catch (error) {
    return {
      connected: false,
      blobs: [],
      error: error.message
    };
  }
}

async function runBackgroundTask(source) {
  const sql = db();

  const changed = await sql`
    UPDATE products
    SET available = false
    WHERE quantity = 0
      AND available = true
    RETURNING id
  `;

  await sql`
    INSERT INTO background_runs
      (changed_count, source)
    VALUES
      (${changed.length}, ${source})
  `;

  return changed.length;
}

// ------------------------------------------------------
// WEB APP
// ------------------------------------------------------

app.get("/", async (req, res) => {
  const sql = db();

  const products = await sql`
    SELECT *
    FROM products
    ORDER BY id DESC
  `;

  const runs = await sql`
    SELECT *
    FROM background_runs
    ORDER BY id DESC
    LIMIT 8
  `;

  const storage = await getStorageInfo();

  let editProduct = null;

  if (req.query.edit) {
    const id = Number(req.query.edit);

    if (Number.isInteger(id)) {
      const rows = await sql`
        SELECT *
        FROM products
        WHERE id = ${id}
        LIMIT 1
      `;

      editProduct = rows[0] ?? null;
    }
  }

  res.render("index", {
    products,
    runs,
    storage,
    editProduct,
    message: req.query.message ?? "",
    error: req.query.error ?? ""
  });
});

app.post(
  "/create",
  upload.single("image"),
  async (req, res) => {
    try {
      const sql = db();
      const { errors, data } =
        validateProduct(req.body);

      if (errors.length) {
        return res.redirect(
          `/?error=${encodeURIComponent(
            errors.join(" ")
          )}`
        );
      }

      const image = await uploadImage(req.file);

      await sql`
        INSERT INTO products
          (
            name,
            quantity,
            price,
            available,
            restock_date,
            image_url
          )
        VALUES
          (
            ${data.name},
            ${data.quantity},
            ${data.price},
            ${data.available},
            ${data.restockDate},
            ${image?.url ?? null}
          )
      `;

      res.redirect(
        "/?message=Product created"
      );
    } catch (error) {
      console.error(error);

      res.redirect(
        `/?error=${encodeURIComponent(
          error.message
        )}`
      );
    }
  }
);

app.post(
  "/update/:id",
  upload.single("image"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const sql = db();

      const { errors, data } =
        validateProduct(req.body);

      if (!Number.isInteger(id)) {
        return res.redirect(
          "/?error=Invalid product ID"
        );
      }

      if (errors.length) {
        return res.redirect(
          `/?error=${encodeURIComponent(
            errors.join(" ")
          )}&edit=${id}`
        );
      }

      const rows = await sql`
        SELECT *
        FROM products
        WHERE id = ${id}
        LIMIT 1
      `;

      const current = rows[0];

      if (!current) {
        return res.redirect(
          "/?error=Product not found"
        );
      }

      let imageUrl = current.image_url;

      if (req.file) {
        const image =
          await uploadImage(req.file);

        if (current.image_url) {
          try {
            await del(current.image_url);
          } catch (error) {
            console.warn(
              "Old image delete warning:",
              error.message
            );
          }
        }

        imageUrl = image.url;
      }

      await sql`
        UPDATE products
        SET
          name = ${data.name},
          quantity = ${data.quantity},
          price = ${data.price},
          available = ${data.available},
          restock_date = ${data.restockDate},
          image_url = ${imageUrl}
        WHERE id = ${id}
      `;

      res.redirect(
        "/?message=Product updated"
      );
    } catch (error) {
      console.error(error);

      res.redirect(
        `/?error=${encodeURIComponent(
          error.message
        )}`
      );
    }
  }
);

app.post("/delete/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sql = db();

    const rows = await sql`
      SELECT image_url
      FROM products
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows[0]?.image_url) {
      try {
        await del(rows[0].image_url);
      } catch (error) {
        console.warn(
          "Image delete warning:",
          error.message
        );
      }
    }

    await sql`
      DELETE FROM products
      WHERE id = ${id}
    `;

    res.redirect(
      "/?message=Product deleted"
    );
  } catch (error) {
    console.error(error);

    res.redirect(
      `/?error=${encodeURIComponent(
        error.message
      )}`
    );
  }
});

app.post(
  "/run-background",
  async (req, res) => {
    try {
      const count =
        await runBackgroundTask(
          "manual-demo"
        );

      res.redirect(
        `/?message=${encodeURIComponent(
          `Background task: changed ${count} product(s).`
        )}`
      );
    } catch (error) {
      res.redirect(
        `/?error=${encodeURIComponent(
          error.message
        )}`
      );
    }
  }
);

// ------------------------------------------------------
// PUBLIC PRODUCT API
// ------------------------------------------------------

app.get("/api/products", async (req, res) => {
  const sql = db();

  const products = await sql`
    SELECT
      id,
      name,
      quantity,
      price,
      available,
      restock_date,
      image_url,
      created_at
    FROM products
    ORDER BY id
  `;

  res.json(products);
});

app.get(
  "/api/products/:id",
  async (req, res) => {
    const id = Number(req.params.id);
    const sql = db();

    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ error: "Invalid product ID" });
    }

    const rows = await sql`
      SELECT *
      FROM products
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!rows[0]) {
      return res
        .status(404)
        .json({ error: "Product not found" });
    }

    res.json(rows[0]);
  }
);

app.post(
  "/api/products",
  async (req, res) => {
    const sql = db();

    const { errors, data } =
      validateApiProduct(req.body);

    if (errors.length) {
      return res
        .status(400)
        .json({ errors });
    }

    const rows = await sql`
      INSERT INTO products
        (
          name,
          quantity,
          price,
          available,
          restock_date
        )
      VALUES
        (
          ${data.name},
          ${data.quantity},
          ${data.price},
          ${data.available},
          ${data.restockDate}
        )
      RETURNING *
    `;

    res.status(201).json(rows[0]);
  }
);

app.put(
  "/api/products/:id",
  async (req, res) => {
    const id = Number(req.params.id);
    const sql = db();

    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ error: "Invalid product ID" });
    }

    const { errors, data } =
      validateApiProduct(req.body);

    if (errors.length) {
      return res
        .status(400)
        .json({ errors });
    }

    const rows = await sql`
      UPDATE products
      SET
        name = ${data.name},
        quantity = ${data.quantity},
        price = ${data.price},
        available = ${data.available},
        restock_date = ${data.restockDate}
      WHERE id = ${id}
      RETURNING *
    `;

    if (!rows[0]) {
      return res
        .status(404)
        .json({ error: "Product not found" });
    }

    res.json(rows[0]);
  }
);

app.patch(
  "/api/products/:id",
  async (req, res) => {
    const id = Number(req.params.id);
    const sql = db();

    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ error: "Invalid product ID" });
    }

    const currentRows = await sql`
      SELECT *
      FROM products
      WHERE id = ${id}
      LIMIT 1
    `;

    const current = currentRows[0];

    if (!current) {
      return res
        .status(404)
        .json({ error: "Product not found" });
    }

    const merged = {
      name:
        req.body.name ??
        current.name,
      quantity:
        req.body.quantity ??
        current.quantity,
      price:
        req.body.price ??
        Number(current.price),
      available:
        req.body.available ??
        current.available,
      restock_date:
        req.body.restock_date ??
        (
          current.restock_date
            ? new Date(
                current.restock_date
              )
                .toISOString()
                .slice(0, 10)
            : null
        )
    };

    const { errors, data } =
      validateApiProduct(merged);

    if (errors.length) {
      return res
        .status(400)
        .json({ errors });
    }

    const rows = await sql`
      UPDATE products
      SET
        name = ${data.name},
        quantity = ${data.quantity},
        price = ${data.price},
        available = ${data.available},
        restock_date = ${data.restockDate}
      WHERE id = ${id}
      RETURNING *
    `;

    res.json(rows[0]);
  }
);

app.delete(
  "/api/products/:id",
  async (req, res) => {
    const id = Number(req.params.id);
    const sql = db();

    if (!Number.isInteger(id)) {
      return res
        .status(400)
        .json({ error: "Invalid product ID" });
    }

    const rows = await sql`
      DELETE FROM products
      WHERE id = ${id}
      RETURNING image_url
    `;

    if (!rows[0]) {
      return res
        .status(404)
        .json({ error: "Product not found" });
    }

    if (rows[0].image_url) {
      try {
        await del(rows[0].image_url);
      } catch (error) {
        console.warn(
          "Blob delete warning:",
          error.message
        );
      }
    }

    res.json({
      deleted: true,
      id
    });
  }
);

// ------------------------------------------------------
// STORAGE API
// ------------------------------------------------------

app.get("/api/storage", async (req, res) => {
  const storage =
    await getStorageInfo();

  if (!storage.connected) {
    return res.status(503).json({
      connected: false,
      provider: "Vercel Blob",
      error: storage.error,
      setup:
        "Vercel project -> Storage -> Create Database -> Blob -> Public"
    });
  }

  res.json({
    connected: true,
    provider: "Vercel Blob",
    fileCount: storage.blobs.length,
    files: storage.blobs.map(
      blob => ({
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
        uploadedAt: blob.uploadedAt
      })
    )
  });
});

// ------------------------------------------------------
// BACKGROUND TASK API
// ------------------------------------------------------

app.get(
  "/api/background-runs",
  async (req, res) => {
    const sql = db();

    const runs = await sql`
      SELECT *
      FROM background_runs
      ORDER BY id DESC
      LIMIT 20
    `;

    res.json(runs);
  }
);

app.post(
  "/api/background/run",
  async (req, res) => {
    try {
      const count =
        await runBackgroundTask(
          "manual-api"
        );

      res.json({
        ok: true,
        changedProducts: count
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error.message
        });
    }
  }
);

// THIS IS THE AUTOMATIC TASK.
// Vercel Cron calls this automatically.
// vercel.json schedule: 0 6 * * * = daily at 06:00 UTC.
app.get(
  "/api/cron/stock-check",
  async (req, res) => {
    try {
      if (process.env.CRON_SECRET) {
        const expected =
          `Bearer ${process.env.CRON_SECRET}`;

        if (
          req.headers.authorization !==
          expected
        ) {
          return res
            .status(401)
            .json({
              error: "Unauthorized"
            });
        }
      }

      const count =
        await runBackgroundTask(
          "vercel-cron"
        );

      res.json({
        ok: true,
        automatic: true,
        source: "Vercel Cron",
        changedProducts: count,
        task:
          "quantity=0 products marked unavailable"
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error: error.message
        });
    }
  }
);

// ------------------------------------------------------
// STATUS API
// ------------------------------------------------------

app.get("/api/status", async (req, res) => {
  const storage =
    await getStorageInfo();

  res.json({
    app: "Product Manager",
    platform: "Vercel",
    framework: "Node.js + Express",
    database: {
      provider: "Neon PostgreSQL",
      connected: true
    },
    fileStorage: {
      provider: "Vercel Blob",
      connected: storage.connected,
      fileCount: storage.blobs.length
    },
    backgroundTask: {
      provider: "Vercel Cron",
      automatic: true,
      schedule: "0 6 * * *",
      meaning: "Every day at 06:00 UTC"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    platform: "Vercel",
    framework: "Express"
  });
});

const port =
  process.env.PORT || 3000;

app.listen(
  port,
  () =>
    console.log(
      `Running on port ${port}`
    )
);
