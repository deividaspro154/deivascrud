# Task 4 — migrate Task 3 from Vercel to Railway

This is the migrated version of the same keyboard store.

## Before

- Vercel — web app
- Neon PostgreSQL — database
- Vercel Blob — image files
- Vercel Cron — background task

## After

- Railway — web app
- Railway PostgreSQL — database
- Railway Volume — image files
- Railway Cron — background task

The migration script copies the existing product rows, IDs, values, background logs and image bytes.

# Step by step

## 1. Keep old Vercel app

Do not delete `https://deivascrud.vercel.app/`. You need it to prove that the old and new apps contain the same data.

## 2. Create a NEW GitHub repository

Extract this ZIP and open the folder in VS Code.

```powershell
git init
git add .
git commit -m "Migrate keyboard store to Railway"
git branch -M main
git remote add origin YOUR_NEW_GITHUB_REPO
git push -u origin main
```

## 3. Create Railway project

Railway → New Project → Deploy from GitHub repo → choose the new repository.

The first deployment can fail because the database is not connected yet.

## 4. Add Railway PostgreSQL

In the same project:

`+ New → Database → PostgreSQL`

Open the Postgres service → Variables. Railway provides `PGDATABASE`, `PGUSER`, `PGHOST`, `PGPORT` and `DATABASE_URL`.

The **real database name** is the value of `PGDATABASE`.

## 5. Connect the web service to Postgres

Web service → Variables → add:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

If your DB service has another name, replace `Postgres` with that exact Railway service name.

In code this becomes:

```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
```

Every `pool.query(...)` then runs on that exact Railway PostgreSQL database.

## 6. Attach persistent file storage

Attach a Railway Volume to the **web service**.

Mount path:

```text
/app/uploads
```

Railway automatically provides `RAILWAY_VOLUME_MOUNT_PATH` and `RAILWAY_VOLUME_NAME`.

The application writes files with:

```js
await fs.writeFile(
  path.join(uploadDir, filename),
  file.buffer
);
```

So this time you can show a real filesystem path:

```text
/app/uploads/keyboard.png
```

## 7. Add old Neon DB temporarily

You need the old Task 3 Neon connection string.

Do NOT commit it to GitHub.

Railway web service → Variables → add:

```text
SOURCE_DATABASE_URL=YOUR_OLD_NEON_CONNECTION_STRING
```

Keep the Railway target DB variable too:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

## 8. Redeploy

The web service starts with:

```text
node migrate.js && node server.js
```

On the first successful startup, `migrate.js`:

1. reads all old Neon `products` rows;
2. copies them into Railway PostgreSQL preserving IDs;
3. copies `background_runs`;
4. downloads every old public Vercel Blob image;
5. saves the same image bytes into `/app/uploads`;
6. changes `image_url` in the Railway copy to `/uploads/...`;
7. creates `/app/uploads/.migration-complete` so migration is not repeated.

In Railway deployment logs you should see:

```text
Found X old product(s).
Copied image for product ...
MIGRATION COMPLETE
```

## 9. Remove the old DB secret

After migration succeeds, remove:

```text
SOURCE_DATABASE_URL
```

The new application should only need its Railway `DATABASE_URL`.

## 10. Generate Railway public URL

Web service → Settings → Networking → Generate Domain.

Open the generated Railway URL.

Check:

```text
/
/admin
/system
/api/products
/api/storage
/api/status
```

The old and new sites should show the same product data.

## 11. Create automatic Railway Cron

Create another Railway service in the SAME project using the SAME GitHub repository.

Name it, for example:

```text
keyboard-background
```

Set Start Command:

```text
npm run background
```

Set variable:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Do not attach the Volume to the cron service.

Cron service → Settings → Cron Schedule:

```text
0 6 * * *
```

`background.js` does:

```sql
UPDATE products
SET available = false
WHERE quantity = 0
  AND available = true;
```

and inserts:

```text
source = railway-cron
```

Then the script closes the DB connection and exits, which is what Railway Cron expects.

# How to prove migration during defence

## A. Show the old version

Open:

```text
https://deivascrud.vercel.app/
```

Choose one product and note:

- ID
- name
- quantity
- price
- availability
- image

## B. Show the new Railway version

Open the Railway URL and show the same product with the same values.

Say:

> I did not recreate the data manually. `migrate.js` copied the existing PostgreSQL rows and image files to the new Railway persistence services.

## C. Show Railway DB

Railway project → Postgres → Variables.

Show `PGDATABASE` but do not expose passwords.

Then open `/system`. The application executes:

```sql
SELECT current_database();
```

and displays the actual database name used by the running application.

## D. Show file storage

Railway web service → attached Volume → mount path `/app/uploads`.

Then `/system` and `/api/storage` list the files from that exact volume.

## E. Show automatic background task

Show the `keyboard-background` Railway service and its Cron Schedule.

After an automatic run, `/system` shows:

```text
source = railway-cron
```

The **Run same task now for demo** button uses the same operation but records `manual-demo`.

## F. Show public API

```powershell
curl https://YOUR-RAILWAY-DOMAIN/api/products
```

POST example:

```powershell
curl.exe -X POST https://YOUR-RAILWAY-DOMAIN/api/products `
-H "Content-Type: application/json" `
-d "{\"name\":\"Railway Keyboard\",\"quantity\":5,\"price\":99.99,\"available\":true,\"restock_date\":\"2026-10-26\"}"
```

# Short defence text

> In Task 3 my application was deployed on Vercel. For Task 4 I migrated the same Node.js Express application to Railway. The existing Neon PostgreSQL rows were copied to Railway PostgreSQL while preserving the product IDs and values. The existing Vercel Blob images were downloaded and stored in a persistent Railway Volume mounted at `/app/uploads`. The automatic background operation was moved from Vercel Cron to a separate Railway Cron service. The web CRUD and REST API functionality remained the same.
