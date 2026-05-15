# Swiftm — إعداد الخادم المعزول

تطبيق **Swiftm** محمي من الربط العرضي بمشروع Supabase قديم.

## 1) Create isolated Supabase project

- Go to [Supabase Dashboard](https://app.supabase.com/)
- Create a **new project** dedicated to this isolated app
- Open **Settings -> API**
- Copy:
  - `Project URL`
  - `anon public key`

## 2) Update local `.env`

Replace values in `.env`:

- `VITE_SUPABASE_URL=https://<your-new-project-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<your-new-anon-key>`
- Keep `VITE_ALLOW_LEGACY_SUPABASE=0`

## 3) Restart dev server

Stop current server and run:

```bash
npm run dev
```

## 4) Verify isolation

- The URL/project ref in `.env` must be different from the old ref.
- `VITE_ALLOW_LEGACY_SUPABASE` must stay `0`.
- Data changes in this app should appear only in the new Supabase project.
