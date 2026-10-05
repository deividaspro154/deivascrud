# Product Manager — simple Vercel version

## Stack

- Vercel — PaaS
- Node.js + Express — web app
- Neon PostgreSQL — persistent database
- Vercel Blob — persistent PNG/JPG file storage
- Vercel Cron — automatic background task
- EJS — one simple HTML template

## Requirements covered

| Requirement | Solution |
|---|---|
| PaaS | Vercel |
| CRUD + list | Create, list/read, edit, delete |
| 4+ data types | String, Integer, Decimal, Boolean, Date |
| Web app | Express + EJS |
| Public API | `GET /api/products` |
| Background task | Vercel Cron |
| DB persistence | Neon PostgreSQL |
| File persistence | Vercel Blob |
| Architecture drawing | `docs/architecture.svg` |

## Files

- `server.js` — almost all application logic.
- `views/index.ejs` — the only HTML page + minimal CSS.
- `package.json` — Node dependencies.
- `vercel.json` — automatic Cron schedule.
- `docs/architecture.svg` — architecture drawing.
- `.gitignore` — files Git should ignore.
- `.env.example` — example environment variables.

## 5 different data types

- `name` → String
- `quantity` → Integer
- `price` → Decimal / Number
- `available` → Boolean
- `restock_date` → Date

Create and Update both use the same `validateProduct()` function.

## Background task

Vercel automatically calls:

`GET /api/cron/stock-check`

The task changes products with `quantity = 0` to `available = false`.

On Vercel Hobby it is scheduled once per day. The page also has **Run now for demo** so you can demonstrate the exact same operation immediately.

# Deploy

## 1. GitHub

Open the project folder in VS Code terminal:

```powershell
git init
git add .
git commit -m "Create Vercel CRUD app"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

If origin already exists:

```powershell
git remote set-url origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 2. Vercel

1. Vercel → **Add New → Project**.
2. Import the GitHub repository.
3. Click **Deploy**.
4. Express is detected automatically.

At first the site may show `Database not connected`. That is expected until Neon is added.

## 3. Add database

1. Open your Vercel project.
2. Open **Storage / Marketplace**.
3. Add **Neon**.
4. Choose the free plan and connect it to this project.
5. Make sure `DATABASE_URL` is added to the project.
6. Redeploy.

No manual SQL setup is required. `server.js` creates the tables automatically.

## 4. Add file storage

1. Open the Vercel project → **Storage**.
2. Create/connect **Vercel Blob**.
3. Use public access for product images.
4. Connect it to this project.
5. Redeploy.

Now uploaded PNG/JPG files are stored in Vercel Blob.

## 5. Test

Create:

- Name: Keyboard
- Quantity: 5
- Price: 49.99
- Available: Yes
- Restock date: 2026-10-20
- Image: any PNG/JPG

Then test Edit and Delete.

## 6. Public API

Open:

`https://YOUR-PROJECT.vercel.app/api/products`

or:

```powershell
curl https://YOUR-PROJECT.vercel.app/api/products
```

## 7. Background task demo

Create a product with:

- Quantity = 0
- Available = Yes

Press **Run now for demo**.

It becomes unavailable.

## Short defence text

> The application is written in Node.js with Express and deployed on Vercel. Neon PostgreSQL stores product data persistently, and Vercel Blob stores uploaded image files. The application supports Create, Read/List, Update and Delete. Create and Update validate five different data types: string, integer, decimal, boolean and date. A public API is available at `/api/products`. Vercel Cron automatically runs a background task that marks zero-stock products unavailable.
