# CrestWard Admin

Product owner and platform admin portal.

## Setup

```bash
cd apps/admin
cp .env.example .env
# Edit .env — Supabase keys and cross-app URLs

npm install
npm run dev
```

Runs at **http://localhost:3002**.

## Build

```bash
npm run build
```

Deploy this folder as the Vercel project root (`vercel.json` included).
