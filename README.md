<p align="center">
  <img src="docs/logo.png" alt="K-Patrol" width="140" />
</p>

<h1 align="center">K-Patrol — Backend API</h1>

<p align="center">
  <em>NestJS API + Socket.io gateway + MQTT ingest for the K-Patrol indoor patrol robot platform.</em><br/>
  <em>API + WebSocket gateway + MQTT ingest phục vụ hệ sinh thái robot K-Patrol.</em>
</p>

<p align="center">
  <a href="https://nestjs.com"><img alt="NestJS" src="https://img.shields.io/badge/NestJS-10.3-e0234e?logo=nestjs" /></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" /></a>
  <a href="https://www.prisma.io"><img alt="Prisma" src="https://img.shields.io/badge/Prisma-5.10-2d3748?logo=prisma" /></a>
  <a href="https://www.postgresql.org"><img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql" /></a>
  <a href="https://redis.io"><img alt="Redis" src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis" /></a>
  <a href="https://www.emqx.io"><img alt="EMQX" src="https://img.shields.io/badge/MQTT-EMQX5-660066?logo=mqtt" /></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="CHANGELOG.md"><img alt="Release" src="https://img.shields.io/badge/release-v1.0.0-blue" /></a>
  <a href="https://github.com/KPatrol/KPatrol_Backend"><img alt="Repo" src="https://img.shields.io/badge/repo-KPatrol_Backend-181717?logo=github" /></a>
</p>

<p align="center">
  <a href="#overview--tổng-quan">Overview</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#modules">Modules</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="#license">License</a>
</p>

---

## Overview / Tổng quan

The backend is the source-of-truth API for the K-Patrol platform. Built on NestJS 10, it provides:

- **REST endpoints** for auth, robots, patrol sessions, telemetry events, alarm rules, security, and maintenance.
- **A Socket.io gateway** for low-latency telemetry + command bridging between the mobile-app and robots.
- **An MQTT ingest worker** that subscribes to EMQX, persists telemetry/heartbeat/safety/detection events in Postgres, and fans them out over Socket.io and the per-rule notification engine (email + Zalo).
- **A Prisma 5 data layer** over PostgreSQL with first-class migration tooling.
- **Modular notification, throttling, and scheduled-task primitives.**

It is consumed by [`mobile-app`](../mobile-app) (operator console), [`web-commerce`](../web-commerce) (storefront), and the [`robots`](../robots) Pi controller (over MQTT and via REST).

> 🎓 **Academic context:** Source-of-truth API of the graduation thesis *"Phát triển hệ sinh thái tuần tra và giám sát thông minh tích hợp AIoT — K-Patrol"* by Vũ Đăng Khoa, Phenikaa University.

---

## Architecture

```
┌─────────────┐      ┌───────────────────────────────────────────────┐
│  Robot Pi   │◀────▶│  EMQX broker (MQTT 5)                         │
└─────────────┘      └───────┬───────────────────────────────────────┘
                             │ subscribe: /telemetry/+ /event/+ /alarm/+
                             ▼
              ┌─────────────────────────────────────────────────────┐
              │  NestJS 10 backend                                  │
              │                                                     │
              │  • MqttIngestService   (persists + fans out)        │
              │  • AlarmRuleService    (CRUD + push to robot)       │
              │  • NotificationService (Email / Zalo per-rule)      │
              │  • Socket.io gateway   (user-scoped rooms)          │
              │  • REST controllers    (Auth, Robot, Patrol, …)     │
              │  • Prisma 5            (Postgres)                   │
              │  • @nestjs/throttler   (per-route rate limits)      │
              │  • Redis               (refresh tokens · queue)     │
              └──┬───────────────────────────────────┬──────────────┘
                 │ REST + WS                         │ SMTP
                 ▼                                   ▼
           ┌──────────────┐                  ┌──────────────┐
           │ Mobile-app   │                  │ Gmail SMTP   │
           │ (PWA)        │                  │ + Zalo OA    │
           └──────────────┘                  └──────────────┘
```

---

## Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| `auth` | [src/modules/auth](src/modules/auth) | JWT login/register/refresh, password hashing, rate-limited routes |
| `robot` | [src/modules/robot](src/modules/robot) | Robot CRUD, fleet roster, settings, lifecycle hooks |
| `alarm-rule` | [src/modules/alarm-rule](src/modules/alarm-rule) | Per-rule alarm engine + notify-channel persistence |
| `mqtt-ingest` | [src/modules/mqtt-ingest](src/modules/mqtt-ingest) | EMQX subscriber → DB + Socket.io + Notification fan-out |
| `socket` | [src/modules/socket](src/modules/socket) | Socket.io gateway with user-scoped + per-robot rooms |
| `notification` | [src/modules/notification](src/modules/notification) | Email (HTML CID logo) + Zalo OA channels |
| `security` | [src/modules/security](src/modules/security) | CORS, helmet, audit log, defence-in-depth headers |
| `maintenance` | [src/modules/maintenance](src/modules/maintenance) | Scheduled jobs, health, retention |
| `prisma` | [src/modules/prisma](src/modules/prisma) | Prisma client provider (global) |

Health probe: `GET /health` ([src/health.controller.ts](src/health.controller.ts)).

---

## Tech Stack

| Layer | Library / Tool |
|-------|---------------|
| Framework | NestJS 10.3 |
| Language | TypeScript 5.3 |
| ORM | Prisma 5.10 |
| Database | PostgreSQL 15+ |
| Cache / queue | Redis 7 |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcryptjs` |
| Realtime | `@nestjs/platform-socket.io`, Socket.io 4.7 |
| MQTT | `mqtt` 5 (Node client) — EMQX 5 broker |
| Email | Nodemailer (Gmail SMTP) with HTML CID logo template |
| Validation | `class-validator`, `class-transformer` |
| Throttling | `@nestjs/throttler` 6 |
| Scheduling | `@nestjs/schedule` 6 |
| Reactive | RxJS 7 |

---

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma                # User, Robot, AlarmRule, PatrolSession, Waypoint,
│                                    # TelemetryEvent, Notification, AuthSession
├── assets/
│   └── logo.png                     # K-Patrol logo (inlined via CID into emails)
├── src/
│   ├── main.ts                      # Bootstrap (helmet + CORS + global pipes)
│   ├── app.module.ts                # Root module wiring
│   ├── health.controller.ts
│   └── modules/
│       ├── alarm-rule/              # CRUD + notify channel resolver
│       ├── auth/                    # JWT login/register/refresh + throttle
│       ├── maintenance/             # Scheduled tasks + health
│       ├── mqtt-ingest/             # EMQX subscriber + fan-out (DB + WS + email)
│       ├── notification/
│       │   ├── channels/
│       │   │   ├── email.channel.ts   # HTML CID logo + dark cyan theme + CTA
│       │   │   └── zalo.channel.ts    # Zalo OA API
│       │   └── notification.service.ts
│       ├── prisma/
│       ├── robot/
│       ├── security/
│       └── socket/                  # Per-user + per-robot rooms
├── Dockerfile                       # Multi-stage build, copies assets/
├── nest-cli.json
├── tsconfig.json
└── package.json
```

---

## Quick Start

```bash
# Install
pnpm install

# Configure env
cp .env.example .env
#   DATABASE_URL=postgresql://kpatrol:kpatrol@localhost:5432/kpatrol
#   REDIS_URL=redis://localhost:6379
#   MQTT_URL=mqtt://localhost:1883
#   MQTT_USERNAME=<MQTT_USERNAME>
#   MQTT_PASSWORD=...
#   JWT_SECRET=change-me
#   JWT_EXPIRES_IN=15m
#   REFRESH_EXPIRES_IN=7d
#   PORT=4000
#   SMTP_HOST=smtp.gmail.com
#   SMTP_PORT=465
#   SMTP_USER=your.account@gmail.com
#   SMTP_PASS=<gmail-app-password>
#   SMTP_FROM="K-Patrol <noreply@kpatrol.online>"
#   NOTIFY_OWNER_EMAIL_OVERRIDE=khoa.vu@alphaasimov.com
#   PUBLIC_COCKPIT_URL=https://monitor.khoavd.online

# Generate Prisma client + run migrations
pnpm prisma:generate
pnpm prisma:migrate

# Develop on http://localhost:4000
pnpm dev

# Production
pnpm build && pnpm start:prod
```

## Testing

Bộ kiểm thử theo mô hình kim tự tháp (xem Báo cáo, Mục 6.2.6 và Bảng 6.6):

```bash
# Kiểm thử đơn vị (Jest + ts-jest) — services, controllers, guards, middleware
npm test                 # ~185 ca
npm run test:cov         # kèm báo cáo độ phủ

# Kiểm thử tích hợp đầu cuối API (Jest + Supertest)
# Yêu cầu ngăn xếp thật: docker compose up -d  (PostgreSQL, Redis, EMQX)
npm run test:e2e         # ~36 ca (auth, robots/RBAC, health, notifications)
```

| Lớp | Công cụ | Phạm vi | Số ca |
|---|---|---|---|
| Đơn vị | Jest + ts-jest | auth, robot, alarm-rule, robot-event, notification, maintenance, guard CSRF/throttler, middleware bảo mật, token-bucket rate-limiter | 185 |
| Tích hợp đầu cuối | Jest + Supertest | luồng đăng nhập/làm mới, CRUD robot + kiểm soát sở hữu (RBAC), probe sức khoẻ, hộp thư thông báo | 36 |
| Phân tích tĩnh | ESLint + TypeScript strict | toàn bộ `src/` | — |

### Environment variables

| Key | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | optional | Refresh-token store + throttle backend |
| `MQTT_URL` | yes | EMQX broker URL (mqtt:// or mqtts://) |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | yes | Broker auth |
| `JWT_SECRET` | yes | HS256 signing secret |
| `JWT_EXPIRES_IN` | optional | Access token TTL (default `15m`) |
| `REFRESH_EXPIRES_IN` | optional | Refresh token TTL (default `7d`) |
| `PORT` | optional | HTTP port (default `4000`) |
| `CORS_ORIGINS` | optional | Comma-separated allow-list |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` | optional | Email notifications (omit for dev-only) |
| `NOTIFY_OWNER_EMAIL_OVERRIDE` | optional | Override owner address (e.g. kpatrol.online has no MX) |
| `PUBLIC_COCKPIT_URL` | optional | CTA "Mở Cockpit" link in alert emails |

---

## Database

Schema lives in [prisma/schema.prisma](prisma/schema.prisma). Key entities:

| Model | Purpose |
|-------|---------|
| `User` | Operator/admin account, role-based access |
| `AuthSession` | Refresh-token rotation log |
| `Robot` | Robot metadata + capability flags + current status |
| `AlarmRule` | Per-robot configurable alarm: event type, light/buzzer pattern, time window, notify channels (notifyOwner / notifyAdmins / notifyEmail / notifyZaloIds) |
| `PatrolSession` | Patrol run with state machine (IDLE → PENDING → RUNNING → BLOCKED → COMPLETED/ABORTED) |
| `Waypoint` | Map waypoints linked to patrol routes |
| `TelemetryEvent` | Persistent log of robot events (heartbeat/safety/detection) |
| `Notification` | Outbox + delivery log for email + Zalo |

```bash
pnpm prisma:generate       # Regenerate client after schema changes
pnpm prisma:migrate        # Create + apply a new migration in dev
pnpm prisma:studio         # Visual database explorer
pnpm prisma migrate deploy # CI / production migration apply
```

---

## Realtime / Socket.io + MQTT

The Socket.io gateway in `src/modules/socket` listens on the same HTTP port (`PORT`). Mobile-app clients authenticate with their JWT and join two kinds of rooms:

- `dashboard:<userId>` — telemetry + alerts scoped to a single tenant
- `robot:<robotId>` — per-robot command channel

MQTT topics handled by `mqtt-ingest`:

| Topic pattern | Direction | Handler |
|---------------|-----------|---------|
| `robot/+/heartbeat` | Pi → BE | persist + WS broadcast (throttled) |
| `robot/+/status` | Pi → BE | persist + WS broadcast |
| `robot/+/safety` | Pi → BE | persist + WS broadcast |
| `robot/+/detection` | Pi → BE | persist + WS broadcast + alarm rule eval |
| `robot/+/alarm/triggered` | Pi → BE | persist + Notification fan-out (email + Zalo) |
| `robot/+/alarm/rules` | BE → Pi | publish on rule update for hot-reload |

---

## Deployment

### Docker

```bash
docker build -t kpatrol-backend .
docker run -p 4000:4000 --env-file .env kpatrol-backend
```

The image runs `node dist/main` after a multi-stage build that compiles TypeScript, prunes dev dependencies, and copies `assets/` (logo) into the runtime image.

### Compose (recommended)

The repository root [docker-compose.yml](../docker-compose.yml) wires the backend together with PostgreSQL, Redis, EMQX, mobile-app, and web-commerce. From the repo root:

```bash
make up           # Start the full stack (6 services)
make migrate      # Apply migrations
make seed         # Seed demo accounts + robot
make logs         # Tail logs
make down         # Tear down
```

Local Mac endpoints: backend at `localhost:4001`, mobile-app at `localhost:8001`, web-commerce at `localhost:8002`.

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

## Roadmap

### v1.1 (next minor)
- [ ] WebRTC video relay (replace MJPEG over HTTP for lower latency)
- [ ] Patrol session analytics dashboard (heatmaps, coverage %, dwell time)
- [ ] Webhook subscriptions for third-party integrations (Slack, Teams)
- [ ] Audit log export (CSV + PDF, GDPR-style data request)
- [ ] OpenAPI 3 spec + autogenerated TypeScript SDK

### v1.2
- [ ] Multi-tenant org model (currently single-tenant via owner override)
- [ ] Quota + billing module
- [ ] Postgres row-level security (RLS) policies
- [ ] gRPC inter-service for the Pi controller (replacing some MQTT for command/ack)
- [ ] Distributed tracing (OpenTelemetry → Jaeger)

### Long term
- [ ] Mobile push (FCM + APNs) replacing/supplementing email for alerts
- [ ] LLM-powered ops summariser (digest of last-24h events + anomalies)
- [ ] Edge cache (Cloudflare Workers) for public stream tokens
- [ ] Postgres logical replication into a data warehouse for analytics

---

## Related repositories

| Component | Repo |
|-----------|------|
| Robot firmware + Pi controller | [Robot_WS](https://github.com/KPatrol/Robot_WS) |
| Operator PWA | [KPatrol_MobileApp](https://github.com/KPatrol/KPatrol_MobileApp) |
| Marketing site | [KPatrol_WebCommerce](https://github.com/KPatrol/KPatrol_WebCommerce) |

---

## Author

**Vũ Đăng Khoa** · MSSV 22010357 · K16, Lớp CNTT4
Khoa Hệ thống Thông tin · Trường Công nghệ Thông tin · Phenikaa University
✉️ khoa.vu@alphaasimov.com

---

## License

MIT License — © K-Patrol / Vu Dang Khoa, 2026.
