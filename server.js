import express from "express";
import multer from "multer";
import { neon } from "@neondatabase/serverless";
import { put, del } from "@vercel/blob";

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
      <p>Connect Neon to this Vercel project.</p>
      <pre>${error.message}</pre>
    `);
  }
});

function validateProduct(body) {
  const errors = [];

  const name = String(body.name ?? "").trim();                 // String
  const quantity = Number(body.quantity);                      // Integer
  const price = Number(body.price);                            // Decimal
  const available = body.available === "on" || body.available === true; // Boolean
  const restockDate = body.restock_date ? String(body.restock_date) : null; // Date

  if (name.length < 2 || name.length > 100) {
    errors.push("Name must be 2-100 characters.");
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    errors.push("Quantity must be a non-negative integer.");
  }

  if (!Number.isFinite(price) || price < 0) {
    errors.push("Price must be a non-negative number.");
  }

  if (restockDate && !/^\d{4}-\d{2}-\d{2}$/.test(restockDate)) {
    errors.push("Restock date must use YYYY-MM-DD.");
  }

  return {
    errors,
    data: { name, quantity, price, available, restockDate }
  };
}

function allowedImage(file) {
  return !file || ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimetype);
}

async function uploadImage(file) {
  if (!file) return null;
  if (!allowedImage(file)) {
    throw new Error("Only PNG, JPG, WEBP and GIF are allowed.");
  }

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");

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

async function runBackgroundTask() {
  const sql = db();

  const changed = await sql`
    UPDATE products
    SET available = false
    WHERE quantity = 0 AND available = true
    RETURNING id
  `;

  await sql`
    INSERT INTO background_runs (changed_count)
    VALUES (${changed.length})
  `;

  return changed.length;
}

// WEB APP
app.get("/", async (req, res) => {
  const sql = db();

  const products = await sql`
    SELECT * FROM products ORDER BY id DESC
  `;

  const runs = await sql`
    SELECT * FROM background_runs ORDER BY id DESC LIMIT 5
  `;

  let editProduct = null;

  if (req.query.edit) {
    const id = Number(req.query.edit);
    if (Number.isInteger(id)) {
      const rows = await sql`
        SELECT * FROM products WHERE id = ${id} LIMIT 1
      `;
      editProduct = rows[0] ?? null;
    }
  }

  res.render("index", {
    products,
    runs,
    editProduct,
    message: req.query.message ?? "",
    error: req.query.error ?? ""
  });
});

app.post("/create", upload.single("image"), async (req, res) => {
  try {
    const sql = db();
    const { errors, data } = validateProduct(req.body);

    if (errors.length) {
      return res.redirect(`/?error=${encodeURIComponent(errors.join(" "))}`);
    }

    const image = await uploadImage(req.file);

    await sql`
      INSERT INTO products
        (name, quantity, price, available, restock_date, image_url)
      VALUES
        (${data.name}, ${data.quantity}, ${data.price},
         ${data.available}, ${data.restockDate}, ${image?.url ?? null})
    `;

    res.redirect("/?message=Product created");
  } catch (error) {
    console.error(error);
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/update/:id", upload.single("image"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sql = db();
    const { errors, data } = validateProduct(req.body);

    if (!Number.isInteger(id)) {
      return res.redirect("/?error=Invalid product ID");
    }

    if (errors.length) {
      return res.redirect(`/?error=${encodeURIComponent(errors.join(" "))}&edit=${id}`);
    }

    const rows = await sql`
      SELECT * FROM products WHERE id = ${id} LIMIT 1
    `;
    const current = rows[0];

    if (!current) {
      return res.redirect("/?error=Product not found");
    }

    let imageUrl = current.image_url;

    if (req.file) {
      const image = await uploadImage(req.file);

      if (current.image_url) {
        try {
          await del(current.image_url);
        } catch (e) {
          console.warn("Old image delete warning:", e.message);
        }
      }

      imageUrl = image.url;
    }

    await sql`
      UPDATE products
      SET name = ${data.name},
          quantity = ${data.quantity},
          price = ${data.price},
          available = ${data.available},
          restock_date = ${data.restockDate},
          image_url = ${imageUrl}
      WHERE id = ${id}
    `;

    res.redirect("/?message=Product updated");
  } catch (error) {
    console.error(error);
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/delete/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sql = db();

    const rows = await sql`
      SELECT image_url FROM products WHERE id = ${id} LIMIT 1
    `;

    if (rows[0]?.image_url) {
      try {
        await del(rows[0].image_url);
      } catch (e) {
        console.warn("Image delete warning:", e.message);
      }
    }

    await sql`
      DELETE FROM products WHERE id = ${id}
    `;

    res.redirect("/?message=Product deleted");
  } catch (error) {
    console.error(error);
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/run-background", async (req, res) => {
  try {
    const count = await runBackgroundTask();
    res.redirect(`/?message=${encodeURIComponent(`Background task: changed ${count} product(s).`)}`);
  } catch (error) {
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

// PUBLIC API
app.get("/api/products", async (req, res) => {
  const sql = db();
  const products = await sql`
    SELECT id, name, quantity, price, available, restock_date, image_url, created_at
    FROM products
    ORDER BY id
  `;
  res.json(products);
});

// AUTOMATIC BACKGROUND TASK
app.get("/api/cron/stock-check", async (req, res) => {
  try {
    if (process.env.CRON_SECRET) {
      const expected = `Bearer ${process.env.CRON_SECRET}`;
      if (req.headers.authorization !== expected) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const count = await runBackgroundTask();

    res.json({
      ok: true,
      changedProducts: count,
      task: "quantity=0 products marked unavailable"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", platform: "Vercel", framework: "Express" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running on port ${port}`));
