<p align="center">
  <img src="docs/logo.png" alt="K-Patrol" width="140" />
</p>

<h1 align="center">K-Patrol — Backend API</h1>

<p align="center">
  <em>NestJS API + Socket.io gateway for the K-Patrol indoor patrol robot platform.</em><br/>
  <em>API + WebSocket gateway phục vụ hệ sinh thái robot K-Patrol.</em>
</p>

<p align="center">
  <a href="https://nestjs.com"><img alt="NestJS" src="https://img.shields.io/badge/NestJS-10.3-e0234e?logo=nestjs" /></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" /></a>
  <a href="https://www.prisma.io"><img alt="Prisma" src="https://img.shields.io/badge/Prisma-5.10-2d3748?logo=prisma" /></a>
  <a href="https://www.postgresql.org"><img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql" /></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="https://github.com/KPatrol/KPatrol_Backend"><img alt="Repo" src="https://img.shields.io/badge/repo-KPatrol_Backend-181717?logo=github" /></a>
</p>

<p align="center">
  <a href="#overview--tổng-quan">Overview</a> ·
  <a href="#modules">Modules</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#license">License</a>
</p>

---

## Overview / Tổng quan

The backend is the source-of-truth API for the K-Patrol platform. Built on NestJS 10, it provides:

- REST endpoints for auth, robot management, events, security, and maintenance.
- A Socket.io gateway for low-latency telemetry and command bridging between the mobile-app and robots.
- A Prisma 5 data layer over PostgreSQL with migration tooling.
- Modular notification, throttling, and scheduled-task primitives.

It is consumed by both [`mobile-app`](../mobile-app) (operator console) and [`web-commerce`](../web-commerce) (storefront/admin).

---

## Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| `auth` | [src/modules/auth](src/modules/auth) | JWT login/register, password hashing, Passport strategies |
| `robot` | [src/modules/robot](src/modules/robot) | Robot CRUD, fleet roster, capability metadata |
| `robot-event` | [src/modules/robot-event](src/modules/robot-event) | Event log ingestion, query, filters |
| `socket` | [src/modules/socket](src/modules/socket) | Socket.io gateway: telemetry, commands, room routing |
| `notification` | [src/modules/notification](src/modules/notification) | Push / in-app notifications |
| `security` | [src/modules/security](src/modules/security) | Throttling, headers, audit log |
| `maintenance` | [src/modules/maintenance](src/modules/maintenance) | Scheduled jobs, health, retention |
| `prisma` | [src/modules/prisma](src/modules/prisma) | Prisma client provider |

Health probe: `GET /health` (see [src/health.controller.ts](src/health.controller.ts)).

---

## Tech Stack

| Layer | Library / Tool |
|-------|---------------|
| Framework | NestJS 10.3 |
| Language | TypeScript 5.3 |
| ORM | Prisma 5.10 |
| Database | PostgreSQL 15+ |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcryptjs` |
| Realtime | `@nestjs/platform-socket.io`, Socket.io 4.7 |
| Validation | `class-validator`, `class-transformer` |
| Throttling | `@nestjs/throttler` 6 |
| Scheduling | `@nestjs/schedule` 6 |
| Reactive | RxJS 7 |

---

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma                # Models: User, Robot, Event, Notification, …
├── src/
│   ├── main.ts                      # Bootstrap
│   ├── app.module.ts                # Root module wiring
│   ├── health.controller.ts
│   └── modules/
│       ├── auth/
│       ├── maintenance/
│       ├── notification/
│       ├── prisma/
│       ├── robot/
│       ├── robot-event/
│       ├── security/
│       └── socket/
├── Dockerfile
├── nest-cli.json
├── tsconfig.json
└── package.json
```

---

## Quick Start

```bash
# Install
pnpm install      # or npm install

# Configure env
cp .env.example .env
#   DATABASE_URL=postgresql://kpatrol:kpatrol@localhost:5432/kpatrol
#   JWT_SECRET=change-me
#   JWT_EXPIRES_IN=7d
#   PORT=4000

# Generate Prisma client + run migrations
pnpm prisma:generate
pnpm prisma:migrate

# Develop on http://localhost:4000
pnpm dev

# Production
pnpm build && pnpm start:prod
```

### Environment variables

| Key | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | HS256 signing secret |
| `JWT_EXPIRES_IN` | optional | Token lifetime (default `7d`) |
| `PORT` | optional | HTTP port (default `4000`) |
| `CORS_ORIGINS` | optional | Comma-separated allow-list |

---

## Database

Schema lives in [prisma/schema.prisma](prisma/schema.prisma). Common workflows:

```bash
pnpm prisma:generate       # Regenerate client after schema changes
pnpm prisma:migrate        # Create + apply a new migration in dev
pnpm prisma:studio         # Visual database explorer

# CI / production migration apply
pnpm prisma migrate deploy
```

---

## Realtime / Socket.io

The gateway in `src/modules/socket` listens on the same HTTP port (`PORT`). Operators (mobile-app) authenticate via the JWT and join a per-robot room. Robots publish telemetry which the gateway fans out; commands flow the other direction.

Default namespace: `/`. Default rooms: `robot:<robotId>`, `user:<userId>`.

---

## Deployment

### Docker

```bash
docker build -t kpatrol-backend .
docker run -p 4000:4000 --env-file .env kpatrol-backend
```

The image runs `node dist/main` after a multi-stage build that compiles TypeScript and prunes dev dependencies.

### Compose (recommended)

The repository root [docker-compose.yml](../docker-compose.yml) wires the backend together with PostgreSQL, Redis, and the two Next.js apps. From the repo root:

```bash
make up           # Start the full stack
make migrate      # Apply migrations
make logs         # Tail logs
```

---

## Scripts

| Script | Action |
|--------|--------|
| `pnpm dev` | NestJS watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start` | Run compiled bundle |
| `pnpm start:prod` | Production entrypoint |
| `pnpm lint` | ESLint with `--fix` |
| `pnpm prisma:generate` | Regenerate Prisma client |
| `pnpm prisma:migrate` | Run dev migrations |
| `pnpm prisma:studio` | Open Prisma Studio |
| `pnpm clean` | Remove `dist/`, `node_modules` |

---

## License

MIT License — © K-Patrol / Vu Dang Khoa, 2026.
