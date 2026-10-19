import express from "express";
import multer from "multer";
import pg from "pg";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
const uploadDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/uploads";
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static(uploadDir));

await pool.query(`CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  restock_date DATE,
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS background_runs (
  id SERIAL PRIMARY KEY,
  ran_at TIMESTAMP NOT NULL DEFAULT NOW(),
  changed_count INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(30) NOT NULL DEFAULT 'unknown'
)`);

function validate(body) {
  const errors = [];
  const data = {
    name: String(body.name ?? "").trim(),
    quantity: Number(body.quantity),
    price: Number(body.price),
    available: body.available === "on" || body.available === true,
    restockDate: body.restock_date ? String(body.restock_date) : null
  };
  if (data.name.length < 2 || data.name.length > 100) errors.push("Name must be 2-100 characters.");
  if (!Number.isInteger(data.quantity) || data.quantity < 0) errors.push("Quantity must be a non-negative integer.");
  if (!Number.isFinite(data.price) || data.price < 0) errors.push("Price must be a non-negative number.");
  if (data.restockDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.restockDate)) errors.push("Date must be YYYY-MM-DD.");
  return { errors, data };
}

function validateApi(body) {
  const { errors, data } = validate({
    name: body.name,
    quantity: body.quantity,
    price: body.price,
    available: body.available,
    restock_date: body.restock_date
  });
  if (typeof body.available !== "boolean") errors.push("available must be boolean.");
  return { errors, data };
}

async function saveImage(file) {
  if (!file) return null;
  if (!["image/png","image/jpeg","image/webp","image/gif"].includes(file.mimetype)) throw new Error("Only PNG/JPG/WEBP/GIF allowed.");
  const ext = path.extname(file.originalname) || ".bin";
  const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return `/uploads/${filename}`;
}

async function deleteImage(url) {
  if (!url || !url.startsWith("/uploads/")) return;
  try { await fs.unlink(path.join(uploadDir, path.basename(url))); } catch (e) { if (e.code !== "ENOENT") console.warn(e.message); }
}

async function filesInVolume() {
  const names = await fs.readdir(uploadDir).catch(() => []);
  const result = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const stat = await fs.stat(path.join(uploadDir, name));
    if (stat.isFile()) result.push({ name, size: stat.size, url: `/uploads/${name}` });
  }
  return result;
}

async function runBackground(source) {
  const changed = await pool.query(`UPDATE products SET available=false WHERE quantity=0 AND available=true RETURNING id`);
  await pool.query(`INSERT INTO background_runs (changed_count,source) VALUES ($1,$2)`, [changed.rowCount, source]);
  return changed.rowCount;
}

app.get("/", async (_req,res) => {
  const { rows } = await pool.query(`SELECT * FROM products ORDER BY id DESC`);
  res.render("store", { products: rows });
});

app.get("/product/:id", async (req,res) => {
  const { rows } = await pool.query(`SELECT * FROM products WHERE id=$1`, [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).send("Not found");
  res.render("product", { product: rows[0] });
});

app.get("/admin", async (req,res) => {
  const products = (await pool.query(`SELECT * FROM products ORDER BY id DESC`)).rows;
  let editProduct = null;
  if (req.query.edit) editProduct = (await pool.query(`SELECT * FROM products WHERE id=$1`, [Number(req.query.edit)])).rows[0] || null;
  res.render("admin", { products, editProduct, message:req.query.message||"", error:req.query.error||"" });
});

app.post("/create", upload.single("image"), async (req,res) => {
  try {
    const { errors, data } = validate(req.body);
    if (errors.length) return res.redirect(`/admin?error=${encodeURIComponent(errors.join(" "))}`);
    const image = await saveImage(req.file);
    await pool.query(`INSERT INTO products (name,quantity,price,available,restock_date,image_url) VALUES ($1,$2,$3,$4,$5,$6)`, [data.name,data.quantity,data.price,data.available,data.restockDate,image]);
    res.redirect("/admin?message=Created");
  } catch(e) { res.redirect(`/admin?error=${encodeURIComponent(e.message)}`); }
});

app.post("/update/:id", upload.single("image"), async (req,res) => {
  try {
    const id = Number(req.params.id);
    const { errors, data } = validate(req.body);
    if (errors.length) return res.redirect(`/admin?edit=${id}&error=${encodeURIComponent(errors.join(" "))}`);
    const old = (await pool.query(`SELECT * FROM products WHERE id=$1`, [id])).rows[0];
    if (!old) return res.redirect("/admin?error=Not found");
    let image = old.image_url;
    if (req.file) { image = await saveImage(req.file); await deleteImage(old.image_url); }
    await pool.query(`UPDATE products SET name=$1,quantity=$2,price=$3,available=$4,restock_date=$5,image_url=$6 WHERE id=$7`, [data.name,data.quantity,data.price,data.available,data.restockDate,image,id]);
    res.redirect("/admin?message=Updated");
  } catch(e) { res.redirect(`/admin?error=${encodeURIComponent(e.message)}`); }
});

app.post("/delete/:id", async (req,res) => {
  const id = Number(req.params.id);
  const old = (await pool.query(`SELECT image_url FROM products WHERE id=$1`, [id])).rows[0];
  if (old) await deleteImage(old.image_url);
  await pool.query(`DELETE FROM products WHERE id=$1`, [id]);
  res.redirect("/admin?message=Deleted");
});

app.get("/system", async (req,res) => {
  const dbInfo = (await pool.query(`SELECT current_database() database_name,current_user database_user,current_schema() schema_name`)).rows[0];
  const runs = (await pool.query(`SELECT * FROM background_runs ORDER BY id DESC LIMIT 10`)).rows;
  const files = await filesInVolume();
  const productCount = (await pool.query(`SELECT COUNT(*)::int count FROM products`)).rows[0].count;
  res.render("system", { dbInfo,runs,files,productCount,uploadDir,volumeName:process.env.RAILWAY_VOLUME_NAME||"not detected",message:req.query.message||"",error:req.query.error||"" });
});

app.post("/run-background", async (_req,res) => {
  const n = await runBackground("manual-demo");
  res.redirect(`/system?message=${encodeURIComponent(`Changed ${n} product(s)`)}`);
});

app.get("/api/products", async (_req,res) => res.json((await pool.query(`SELECT * FROM products ORDER BY id`)).rows));
app.get("/api/products/:id", async (req,res) => {
  const row = (await pool.query(`SELECT * FROM products WHERE id=$1`, [Number(req.params.id)])).rows[0];
  row ? res.json(row) : res.status(404).json({error:"Not found"});
});
app.post("/api/products", async (req,res) => {
  const {errors,data} = validateApi(req.body); if (errors.length) return res.status(400).json({errors});
  const row = (await pool.query(`INSERT INTO products (name,quantity,price,available,restock_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [data.name,data.quantity,data.price,data.available,data.restockDate])).rows[0];
  res.status(201).json(row);
});
app.put("/api/products/:id", async (req,res) => {
  const {errors,data} = validateApi(req.body); if (errors.length) return res.status(400).json({errors});
  const row = (await pool.query(`UPDATE products SET name=$1,quantity=$2,price=$3,available=$4,restock_date=$5 WHERE id=$6 RETURNING *`, [data.name,data.quantity,data.price,data.available,data.restockDate,Number(req.params.id)])).rows[0];
  row ? res.json(row) : res.status(404).json({error:"Not found"});
});
app.patch("/api/products/:id", async (req,res) => {
  const id = Number(req.params.id); const old = (await pool.query(`SELECT * FROM products WHERE id=$1`, [id])).rows[0];
  if (!old) return res.status(404).json({error:"Not found"});
  const merged = {name:req.body.name??old.name,quantity:req.body.quantity??old.quantity,price:req.body.price??Number(old.price),available:req.body.available??old.available,restock_date:req.body.restock_date??(old.restock_date?new Date(old.restock_date).toISOString().slice(0,10):null)};
  const {errors,data}=validateApi(merged); if(errors.length) return res.status(400).json({errors});
  const row=(await pool.query(`UPDATE products SET name=$1,quantity=$2,price=$3,available=$4,restock_date=$5 WHERE id=$6 RETURNING *`,[data.name,data.quantity,data.price,data.available,data.restockDate,id])).rows[0]; res.json(row);
});
app.delete("/api/products/:id", async (req,res) => {
  const id=Number(req.params.id); const old=(await pool.query(`SELECT image_url FROM products WHERE id=$1`,[id])).rows[0]; if(!old) return res.status(404).json({error:"Not found"}); await deleteImage(old.image_url); await pool.query(`DELETE FROM products WHERE id=$1`,[id]); res.json({deleted:true,id});
});
app.get("/api/storage", async (_req,res) => res.json({provider:"Railway Volume",mountPath:uploadDir,volumeName:process.env.RAILWAY_VOLUME_NAME||null,files:await filesInVolume()}));
app.get("/api/background-runs", async (_req,res) => res.json((await pool.query(`SELECT * FROM background_runs ORDER BY id DESC LIMIT 20`)).rows));
app.get("/api/status", async (_req,res) => {
  const info=(await pool.query(`SELECT current_database() database_name,current_schema() schema_name`)).rows[0];
  res.json({platform:"Railway",database:{provider:"Railway PostgreSQL",name:info.database_name,schema:info.schema_name},fileStorage:{provider:"Railway Volume",mountPath:uploadDir},background:{provider:"Railway Cron",command:"npm run background"}});
});
app.get("/health", (_req,res) => res.json({status:"ok",platform:"Railway"}));

const port = process.env.PORT || 3000;
app.listen(port,"0.0.0.0",() => console.log(`Running on ${port}; volume=${uploadDir}`));
