# CHANGES — Product Manager Vercel

Only these files were changed:

- `server.js`
- `views/index.ejs`
- `package.json`
- `README.md`

`vercel.json` stays unchanged and already contains the automatic Cron:

```json
{
  "crons": [
    {
      "path": "/api/cron/stock-check",
      "schedule": "0 6 * * *"
    }
  ]
}
```

That means Vercel automatically calls the stock-check route every day at 06:00 UTC.

## New API endpoints

```text
GET     /api/products
GET     /api/products/:id
POST    /api/products
PUT     /api/products/:id
PATCH   /api/products/:id
DELETE  /api/products/:id

GET     /api/storage
GET     /api/background-runs
POST    /api/background/run
GET     /api/status
```

## Where is file storage?

Uploaded PNG/JPG files are NOT stored in Neon.

They are stored in **Vercel Blob**.

Create it in:

```text
Vercel
→ your project
→ Storage
→ Create Database
→ Blob
→ Continue
→ Access = Public
→ Create
```

Use **Public** because the web page displays the uploaded images directly.

After the Blob store is connected, redeploy the project.

Then open:

```text
https://deivascrud.vercel.app/api/storage
```

It will show JSON with all uploaded files.

The main page also now has a **Vercel Blob storage** section listing the files.

## Important

The package was updated to:

```text
@vercel/blob 2.8.x
```

so the current Vercel Blob authentication/setup is supported.

## Deploy these changes

Replace the four files in your existing project.

Then in VS Code terminal:

```powershell
npm install
git add server.js views/index.ejs package.json README.md package-lock.json
git commit -m "Add full API storage status and background logs"
git push
```

If `package-lock.json` does not exist yet, run `npm install` first.

Vercel should automatically redeploy after the GitHub push.

## Check after deploy

Open:

```text
https://deivascrud.vercel.app/api/status
```

You should get something like:

```json
{
  "platform": "Vercel",
  "database": {
    "provider": "Neon PostgreSQL",
    "connected": true
  },
  "fileStorage": {
    "provider": "Vercel Blob",
    "connected": true
  },
  "backgroundTask": {
    "provider": "Vercel Cron",
    "automatic": true
  }
}
```

Then check:

```text
https://deivascrud.vercel.app/api/storage
```

If it says `connected: false`, Blob is not connected yet.

## Background proof

Create a product:

```text
Name: Test
Quantity: 0
Available: Yes
```

The automatic Cron will eventually change it to:

```text
Available: No
```

Background runs are saved in Neon.

Open:

```text
/api/background-runs
```

Automatic runs have:

```text
source = vercel-cron
```

For the classroom demo you can click **Run now for demo**; that uses the same background function, but the log source is `manual-demo`.
