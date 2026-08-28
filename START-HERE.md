# Start here

Five commands. Run them in order from this folder.

```bash
npm install
npm run build:shared
npm run build --workspace client
npm run build --workspace server
cd server && SERVE_CLIENT=true node dist/server.js
```

Then open **http://localhost:4000**

Sign in: `admin@policyprism.demo` / `PolicyPrism!2026`
Then press **Run analysis** in the top right.

---

## Before step 1

You need PostgreSQL running and a `server/.env` file:

```bash
cp .env.example server/.env
```

Edit `server/.env` and set `DATABASE_URL` to your database, then set
`JWT_SECRET` to a random string:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the tables and demo data (once):

```bash
npm run db:migrate
npm run db:seed
```

## Notes

- Everything runs on **port 4000**. There is no 5173 in this mode.
- Leave the server terminal open. It only serves while running.
- To restart later: `cd server && SERVE_CLIENT=true node dist/server.js`
- `npm run build --workspace server` prints TypeScript errors from an
  `@types/express` version clash. They are harmless - the JavaScript is still
  written and the server runs correctly.
