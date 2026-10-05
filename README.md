# Modern Keyboard Store — changed files

Replace only these files in your current project:

```text
server.js
public/style.css
views/store.ejs
views/product.ejs
views/admin.ejs
views/system.ejs
README.md
```

Keep your existing:

```text
package.json
vercel.json
.gitignore
```

## Pages

- `/` — keyboard store
- `/product/:id` — one keyboard
- `/admin` — CRUD
- `/system` — Vercel Blob, Cron, DB and API

## Storage

The application stores uploaded PNG/JPG files in **Vercel Blob**.

The code is:

```js
const blob = await put(
  `keyboards/${Date.now()}-${safeName}`,
  file.buffer,
  {
    access: "public",
    addRandomSuffix: true,
    contentType: file.mimetype
  }
);
```

The Blob URL is stored in Neon PostgreSQL.

Check storage from the app:

```text
/system
/api/storage
```

## Automatic background task

Keep your existing `vercel.json`:

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

Vercel automatically calls the route.

The route:

```text
/api/cron/stock-check
```

does:

```text
quantity = 0
      ↓
available = false
```

Automatic runs are saved as:

```text
source = vercel-cron
```

Manual classroom demonstration uses:

```text
source = manual-demo
```

## Full API

```text
GET     /api/products
GET     /api/products/:id
POST    /api/products
PUT     /api/products/:id
PATCH   /api/products/:id
DELETE  /api/products/:id

GET     /api/storage
GET     /api/status
GET     /api/background-runs
```

## Deploy changes

Copy these files into the existing project.

Then:

```powershell
git add .
git commit -m "Add modern keyboard store pages"
git push
```

Vercel will redeploy automatically.

## Blob setup

If `/system` says Blob is not connected:

1. Open Vercel project.
2. Open Storage.
3. Create/connect Vercel Blob.
4. Connect it to this project.
5. Redeploy.

Then upload a keyboard PNG/JPG from `/admin`.

## Defence navigation

1. `/` — show web application/store.
2. `/product/1` — show Read.
3. `/admin` — Create, Update, Delete and list.
4. Explain 5 data types:
   - String
   - Integer
   - Decimal
   - Boolean
   - Date
5. `/system` — show DB, file storage, background task and API.
6. `/api/products` — show public JSON API.
