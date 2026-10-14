# Finance OS

Your money. Your businesses. One system.

Personal + business financial operating system: accounts, transactions, budgets, debts, goals, businesses, reports, and a data-driven financial coach.

## Run

```bash
npm install
npm run dev
```

Opens on port 5173.

Default currency is MZN. After signup the product name becomes `[First Name]'s Finance OS`.

## Production (Vercel)

Set these project environment variables, then redeploy. Do not put real values in the repo.

```bash
JWT_SECRET
DATABASE_URL
```

`JWT_SECRET` must be at least 16 characters. `DATABASE_URL` should be the Supabase session pooler or direct Postgres URI (port 5432). Leave `DATABASE_URL` unset only for local SQLite.
