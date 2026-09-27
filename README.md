# Email Scheduler

A Docker-free  email scheduler for Windows. It uses PostgreSQL as the durable source of email state, Redis/BullMQ for delayed jobs and distributed rate limiting, Ethereal SMTP for safe test delivery, and Elasticsearch for search.

## Features

- Google OAuth with HTTP-only sessions
- Campaigns with CSV lead import, deduplication, validation, per-sender selection, start time, delay, and hourly limit
- Individual BullMQ delayed job per email, retry backoff, atomic `scheduled -> processing` claim, and idempotency keys
- Separate worker process with Redis-backed per-sender hourly limits
- Ethereal preview URLs, Elasticsearch indexing that cannot block SMTP delivery, Slack OAuth notifications, and protected Bull Board
- React dashboard with scheduled, sent, failed, search, compose, CSV validation, loading/empty states, and Slack controls
- Health endpoint and OpenAPI discovery at `/api-docs`

## Architecture

`frontend` calls the Express API. The API writes campaigns/emails to PostgreSQL and enqueues one delayed BullMQ job per email. `worker` claims each email atomically, checks a Redis sender/hour counter, sends through Nodemailer/Ethereal, updates PostgreSQL, and indexes asynchronously in Elasticsearch. Jobs and database records are not recreated on process restart.

The SMTP boundary cannot mathematically guarantee exactly-once delivery across an arbitrary network failure after SMTP accepts a message. Database idempotency prevents duplicate logical processing and duplicate attempts whenever the state transition is observable.

## Prerequisites (Windows)

Install Node.js, PostgreSQL, Redis-compatible server, and Elasticsearch directly on Windows. Docker is not used or required.

```powershell
node -v
npm -v
psql --version
redis-cli ping
Invoke-RestMethod http://localhost:9200
```

Redis options include Memurai or a current Redis-compatible Windows service. Start the installed service using its normal Windows service controls, then confirm `redis-cli ping` returns `PONG`. Start Elasticsearch from its local installation and confirm port `9200` responds.

Create a PostgreSQL database named `reachinbox`, then copy `.env.example` to `.env` and set the credentials and OAuth values. Never commit `.env`.

## Install and migrate

From the repository root:

```powershell
npm install
npx prisma generate --schema backend/prisma/schema.prisma
npx prisma migrate dev --schema backend/prisma/schema.prisma --name init
```

Google Cloud OAuth must allow `http://localhost:4000/api/auth/google/callback`. Slack must allow the configured `SLACK_REDIRECT_URI` and request `chat:write,channels:read`. Create an Ethereal account at https://ethereal.email and copy its SMTP settings.

## Run

Open three PowerShell windows:

```powershell
cd backend
npm run dev
```

```powershell
cd worker
npm run dev
```

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173. Google credentials are required for a real login. The API is at http://localhost:4000, Swagger-compatible JSON is at http://localhost:4000/api-docs, and Bull Board is at http://localhost:4000/admin/queues using `BULL_BOARD_USERNAME` and `BULL_BOARD_PASSWORD`.

## API

- `GET /health`
- `GET /api/auth/me`, `GET /api/auth/google`, `GET /api/auth/google/callback`, `POST /api/auth/logout`
- `POST /api/emails/schedule`
- `GET /api/emails/scheduled`, `/sent`, `/failed`, `/search?q=...`
- `GET /api/campaigns`
- `GET /api/senders`, `POST /api/senders`
- `GET /api/slack/connect`, `/callback`, `/status`, `POST /api/slack/disconnect`

All resource queries are scoped through the authenticated user. SMTP passwords and Slack tokens are never returned to the frontend.

## Reliability and rate limiting

BullMQ delayed jobs are persisted in Redis. PostgreSQL remains the durable email state. Restarting the backend or worker does not recreate jobs. Redis persistence depends on the local Redis-compatible server configuration; if Redis loses its queue data, PostgreSQL retains state but automatic queue reconstruction is intentionally not performed by this demo.

Hourly counters use atomic Redis `INCR` and sender/hour keys. When a limit is reached, the job is moved to the next hourly window rather than failed or dropped. Multiple workers can run concurrently. The minimum delay controls campaign scheduling; the hourly limiter is the distributed global guard.

## Tests and load scenario

```powershell
npm run build
npm test
npm run lint
npx tsx scripts/load-test.ts > load-test.json
.\scripts\health-check.ps1
```

The load script produces 1,000 test recipients without sending messages. To exercise restart recovery, schedule future jobs, stop and restart only `worker`, and inspect Bull Board and PostgreSQL statuses. Then repeat with the backend process.

## Troubleshooting

- `postgres down`: verify the PostgreSQL Windows service, database name, user, password, and `DATABASE_URL`.
- `redis down`: start Memurai/Redis and confirm `redis-cli ping`.
- `elasticsearch down`: start Elasticsearch; sending continues, while indexing/search remains temporarily unavailable.
- OAuth redirect errors: verify callback URLs exactly, including port and path.
- No sender available: create a sender record using `POST /api/senders` before composing.

Production deployments should use a persistent session store instead of the default development session store, TLS, a secrets manager, managed durable Redis, Elasticsearch retry queue, and a real transactional email provider after the Ethereal demo.
