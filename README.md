# One-Time Link Converter

A production-ready SaaS web application for creating secure, single-use redirect links. Each generated link redirects to a destination URL exactly once — after the first successful human consumption, the link becomes permanently invalid.

## Architecture

```
├── src/
│   ├── config/          # Environment, database, logger configuration
│   ├── middleware/       # Auth, CSRF, rate limiting
│   ├── routes/           # Express route handlers (public, consume, admin)
│   ├── services/         # Business logic (link, admin services)
│   ├── utils/            # Bot detection, slug generation, URL validation
│   ├── views/            # EJS templates with layouts
│   │   ├── layouts/      # Main and admin layouts
│   │   ├── partials/     # Header, footer, sidebar components
│   │   └── pages/        # Public, admin, and status pages
│   ├── public/           # Static assets (Tailwind CSS)
│   ├── app.ts            # Express app setup
│   └── index.ts          # Server entry point
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/       # Migration files
│   └── seed.ts           # Admin seeding script
├── tests/                # Vitest test suite
├── render.yaml           # Render deployment blueprint
└── .env.example          # Environment variable template
```

**Tech Stack:**
- **Runtime:** Node.js 20+ / TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with Prisma ORM
- **Templates:** EJS with custom layout system
- **Styling:** Tailwind CSS (dark mode)
- **Auth:** Session-based with bcrypt, CSRF protection
- **Security:** Helmet, rate limiting, bot detection, input validation (Zod)
- **Logging:** Pino (structured JSON logs)
- **Testing:** Vitest

## Features

### Core
- **Single-use links** with atomic consumption via database transactions
- **Bot/crawler detection** — prevents accidental consumption by preview agents
- **Interstitial page** for suspicious user agents
- **Password-protected links** (bcrypt hashed)
- **Custom slugs** or auto-generated 8-character IDs
- **Expiration dates** with automatic status updates
- **Configurable max views** (default: 1)

### Admin Dashboard
- Overview cards with real-time statistics
- Link management (search, filter, paginate, disable, delete, extend expiry)
- Audit logs for all admin actions
- Settings page for branding, security toggles, and defaults
- Seeded admin account from environment variables

### Security
- CSRF protection on all forms
- Helmet security headers
- Rate limiting on login, link creation, and consumption
- Honeypot field for spam prevention
- IP address hashing (never stores raw IPs)
- Soft delete for link management
- Account lockout after 5 failed login attempts (15-minute cooldown)
- URL validation (HTTP/HTTPS only)
- Session-based auth with secure cookies

## Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 14+

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bytepassperks/onetime-link.git
   cd onetime-link
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database URL and admin credentials
   ```

4. **Set up the database:**
   ```bash
   npx prisma migrate deploy
   ```

5. **Seed admin user:**
   ```bash
   npx ts-node prisma/seed.ts
   ```

6. **Build and start:**
   ```bash
   npm run build
   npm start
   ```

   Or for development with hot-reload:
   ```bash
   npm run dev
   ```

7. **Open** http://localhost:3000

### Running Tests

```bash
npm test
```

## Render Deployment

### Quick Deploy

1. **Create a new Web Service** on [Render](https://render.com)
2. **Connect your GitHub repository**
3. **Create a PostgreSQL database** (Basic-256MB plan)

### Configuration

**Build Command:**
```
npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```

**Start Command:**
```
npm run start
```

**Health Check Path:** `/health`

### Environment Variables

Set these in your Render dashboard:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `production` | Set to `production` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (auto-set if using Render DB) |
| `APP_BASE_URL` | Yes | — | Your app's public URL (e.g., `https://yourdomain.onrender.com`) |
| `SESSION_SECRET` | Yes | — | Random 32+ char string for session encryption |
| `ADMIN_EMAIL` | Yes | — | Admin account email |
| `ADMIN_PASSWORD` | Yes | — | Admin account password (min 8 chars) |
| `ADMIN_NAME` | No | `Admin` | Admin display name |
| `DEFAULT_LINK_EXPIRY_HOURS` | No | `24` | Default link expiry in hours |
| `LINK_CREATION_RATE_LIMIT_WINDOW_MIN` | No | `15` | Rate limit window for link creation (minutes) |
| `LINK_CREATION_RATE_LIMIT_MAX` | No | `10` | Max link creation requests per window |
| `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MIN` | No | `15` | Rate limit window for admin login (minutes) |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` | No | `5` | Max login attempts per window |
| `ALLOW_PUBLIC_LINK_CREATION` | No | `true` | Allow non-admin users to create links |
| `REQUIRE_INTERSTITIAL_FOR_SUSPECT_UA` | No | `true` | Show confirmation page for suspicious user agents |

### Admin Seeding on First Deploy

The admin account is seeded automatically when the seed script runs. After deploy, run the seed command from Render's Shell tab:

```bash
npx ts-node prisma/seed.ts
```

Or add it to your build command:
```
npm install && npx prisma generate && npx prisma migrate deploy && npm run build && npx ts-node prisma/seed.ts
```

### Render Blueprint (render.yaml)

A `render.yaml` file is included for Infrastructure as Code deployment. It defines:
- Web Service (Starter plan)
- PostgreSQL Database (Basic-256MB plan)
- All required environment variables

## API Routes

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Landing page |
| GET | `/create` | Create link form |
| POST | `/create` | Submit new link |
| GET | `/r/:slug` | Consume/redirect link |
| POST | `/r/:slug` | Password submit / interstitial continue |
| GET | `/privacy` | Privacy policy |
| GET | `/terms` | Terms of service |
| GET | `/health` | Health check endpoint |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/login` | Login page |
| POST | `/admin/login` | Submit login |
| GET | `/admin/logout` | Logout |
| GET | `/admin` | Dashboard |
| GET | `/admin/links` | Link management |
| GET | `/admin/links/create` | Create link (admin) |
| POST | `/admin/links/create` | Submit link (admin) |
| GET | `/admin/links/:id` | Link details |
| POST | `/admin/links/:id/toggle` | Enable/disable link |
| POST | `/admin/links/:id/delete` | Soft delete link |
| POST | `/admin/links/:id/extend-expiry` | Extend expiry |
| POST | `/admin/links/:id/regenerate-slug` | Regenerate slug |
| GET | `/admin/audit` | Audit logs |
| GET | `/admin/settings` | Settings page |
| POST | `/admin/settings` | Update settings |

## Database Schema

### Tables
- **admins** — Admin users with hashed passwords, lockout tracking
- **links** — One-time links with status, view counts, expiry
- **link_access_events** — Access logs with hashed IPs, user agents
- **audit_logs** — Admin action audit trail
- **app_settings** — Key-value application settings

### Link Statuses
- `active` — Available for consumption
- `consumed` — Used up (max views reached)
- `expired` — Past expiration date
- `disabled` — Manually disabled by admin
- `deleted` — Soft deleted

## Atomic Consumption

Link redemption uses PostgreSQL transactions with optimistic concurrency:

1. Find link by slug within a transaction
2. Verify status is `active`, not expired, under max views
3. Increment `view_count` with a WHERE clause on the current `viewCount` (prevents race conditions)
4. Update status to `consumed` if max views reached
5. Commit transaction
6. Redirect to destination

This ensures concurrent requests cannot consume the same link beyond its max view count.

## Known Tradeoffs (Bare-Minimum Cost)

- **No Redis** — Rate limiting uses in-memory store (resets on deploy). Acceptable for single-instance Render Starter.
- **No CDN** — Static assets served directly from Express. Add Cloudflare or a CDN for high traffic.
- **Single instance** — No horizontal scaling. Sufficient for moderate traffic on Render Starter.
- **In-memory sessions** — Sessions reset on deploy. Use `connect-pg-simple` for persistent sessions if needed.
- **No email** — No password reset or notification emails. Add SendGrid/Resend for v2.
- **No 2FA** — Code structure supports it, but UI not implemented yet.

## v2 Upgrade Path

- **Persistent sessions:** Add `connect-pg-simple` for PostgreSQL session store
- **Redis rate limiting:** Switch to `rate-limit-redis` for distributed rate limiting
- **Email notifications:** Integrate SendGrid/Resend for link consumption alerts
- **2FA:** Add TOTP-based two-factor auth for admin login
- **API keys:** Add REST API with API key authentication for programmatic link creation
- **Custom domains:** Allow users to use their own domains
- **Turnstile/CAPTCHA:** Add Cloudflare Turnstile integration for bot protection
- **Geo-IP:** Add country-level analytics using MaxMind GeoLite2
- **Webhooks:** Notify external services when links are consumed
- **Multi-tenant:** Support multiple organizations with isolated data

## Production Readiness Checklist

- [x] TypeScript strict mode
- [x] Environment variable validation at boot (Zod)
- [x] Database migrations with Prisma
- [x] Admin seeding from environment variables
- [x] Atomic link consumption (transaction-based)
- [x] Bot/crawler detection and blocking
- [x] CSRF protection on all forms
- [x] Helmet security headers
- [x] Rate limiting (login, creation, consumption)
- [x] Password hashing (bcrypt, 12 rounds)
- [x] IP address hashing (SHA-256, truncated)
- [x] Input validation (Zod schemas)
- [x] URL validation (HTTP/HTTPS only)
- [x] Soft delete for links
- [x] Account lockout on failed logins
- [x] Structured logging (Pino)
- [x] Health check endpoint
- [x] Responsive dark-mode UI
- [x] Privacy policy and terms pages
- [x] Render deployment configuration
- [x] Comprehensive test suite (22 tests)
- [x] No secrets in source code

## License

MIT
