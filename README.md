# iiitr-leave-system

## Environment Setup

1. Create a local environment file:

```bash
cp .env.example .env
```

2. Update values in `.env`:
- `AUTH_ENABLED=true`
- `API_ACCESS_KEY=<your-secret-key>`
- `FIREBASE_ENABLED=true` only when Firebase is configured
- `DB_MODE=firebase|postgres|postgres_firebase_mirror`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iiitr_leave_system` when using Postgres modes

3. If Firebase is enabled, set:
- `FIREBASE_DB_URL=https://<project-id>-default-rtdb.firebaseio.com`
- One credential method:
	- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
	- or `FIREBASE_SERVICE_ACCOUNT_JSON={...}`

4. Restart the server after editing `.env`.

## PostgreSQL Store Migration

Install dependencies and migrate all JSON stores into PostgreSQL:

```bash
npm install
npm run db:migrate-store
```

After migration, set:

```bash
DB_MODE=postgres_firebase_mirror
```

to use PostgreSQL as primary storage while mirroring writes to Firebase.

## Firebase Import

To import local JSON data into Firebase:

```bash
npm run firebase:import
```

This requires `FIREBASE_ENABLED=true` and valid Firebase credentials in `.env`.
