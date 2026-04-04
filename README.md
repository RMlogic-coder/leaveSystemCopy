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

3. If Firebase is enabled, set:
- `FIREBASE_DB_URL=https://<project-id>-default-rtdb.firebaseio.com`
- One credential method:
	- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
	- or `FIREBASE_SERVICE_ACCOUNT_JSON={...}`

4. Restart the server after editing `.env`.

## Firebase Import

To import local JSON data into Firebase:

```bash
npm run firebase:import
```

This requires `FIREBASE_ENABLED=true` and valid Firebase credentials in `.env`.
