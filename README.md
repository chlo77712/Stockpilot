# StockPilot — Single-Business Inventory Management

**By Wepoghe Labs** · Node.js + Express + SQLite · Responsive dark navy/blue UI

StockPilot is a single-business inventory system with a server-side SQLite database, owner login, product and supplier management, stock movement history, dashboard, reports, CSV exports, JSON backup/restore, and business settings.

> **Production note:** This is a runnable full-stack starter and demonstration build, not a claim of audited production readiness. Before handling a paying client's live records, deploy over HTTPS, set strong secrets, configure automated encrypted off-site backups, test restore/recovery, and review security and business workflows. The first owner is created from environment variables only when the database has no matching email. There is no self-service registration or multi-business tenancy.

## Requirements

- Node.js 20 or later (Node 22 recommended)
- npm

## Run locally

1. Extract the ZIP and open a terminal in the `stockpilot-pro` folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and edit it. Use a unique random `SESSION_SECRET` of at least 32 characters, a business owner's email, and a strong initial password. Do not commit `.env` to Git.
4. Start the server:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.
6. Change the initial password under **Business settings** after the first login.

The database is created automatically at `./data/stockpilot.sqlite` by default. Session storage is also persisted under `./data/`.

## Main features

- Owner login, hashed passwords, login rate limiting, session cookie protections, security headers, same-origin write checks
- Dashboard with product count, units, inventory cost and low-stock alerts
- Product CRUD with unique SKU, category, supplier, unit, quantity, reorder level, cost and selling price
- Stock-in, stock-out and counted-balance adjustment with transaction history; stock-out cannot make inventory negative
- Supplier CRUD
- Category and low/out-of-stock filters, product and movement search
- Inventory category reports, potential stock sales and gross margin estimates
- CSV export for products/reports and movement history
- JSON backup and restore; restore replaces inventory data, so back up before restoring
- Business profile, currency selection, default reorder level and password change
- Responsive layout for phones and desktop

## Important business rules

- Product quantity is changed through recorded movements after initial product creation. This preserves a traceable movement history.
- An adjustment sets the counted balance; its history records the old and new balances.
- The “potential sales” and “potential gross margin” figures are estimates based on current recorded quantity and prices. They are not actual sales, cash received, or accounting profit.
- Products are archived rather than hard-deleted, preserving historical movement references.
- This version is a single-business deployment. It does not include online billing, payment processing, tax accounting, purchase orders, barcode scanning, multi-branch stock, or multiple-business SaaS tenancy.

## Deployment checklist

1. Choose a Node.js host that supports persistent disk storage. SQLite files must not live on an ephemeral filesystem.
2. Configure environment variables in the host dashboard. Set `NODE_ENV=production`, a strong random `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, and an absolute persistent `DATABASE_PATH` such as `/var/lib/stockpilot/stockpilot.sqlite`.
3. Set `TRUST_PROXY=true` only if the application is behind a trusted HTTPS reverse proxy. Ensure HTTPS is enabled so secure session cookies work.
4. Create a persistent writable directory for the database and SQLite session store. Restrict filesystem access.
5. Deploy the repository, install dependencies, and run `npm start`.
6. Confirm `/api/health` responds, log in, create a test product, test stock-in/out/adjustment, export a backup, restore it in a test environment, then verify mobile layout.
7. Configure automated encrypted off-site backups and monitor failures. A downloaded JSON backup contains business information and must be protected.
8. Use a separate staging database for testing. Never test restore against the live business database.

## Data and security notes

- All application API endpoints except health and authentication are session-protected.
- Passwords are hashed with bcrypt. Sessions are stored in SQLite instead of Express's in-memory development store.
- Production uses secure, HTTP-only, same-site session cookies and Helmet security headers.
- This is not a substitute for a professional security audit. Add monitoring, automated backups, recovery drills, dependency updates, and access-control review before commercial deployment.
