# StockPilot deployment checklist

This app requires a Node.js host with a **persistent writable disk**. A static-only host such as GitHub Pages cannot run the API or store the SQLite database, so do not upload only `public/` and expect the full system to work.

## Environment variables

- `NODE_ENV=production`
- `PORT` (provided by most hosts)
- `SESSION_SECRET` — unique random string, 32+ characters
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` — strong initial password; change after first sign-in
- `DATABASE_PATH` — absolute path on persistent disk
- `TRUST_PROXY=true` only if the deployment platform uses a trusted reverse proxy and HTTPS

## Before inviting a customer

- [ ] Use a separate test database to validate every workflow.
- [ ] Confirm HTTPS and secure cookies work in production.
- [ ] Confirm database and session directory permissions are restricted.
- [ ] Configure encrypted off-site backups and test restoring a backup.
- [ ] Change the initial owner password.
- [ ] Check current dependency vulnerabilities and update packages.
- [ ] Confirm business data export, restore and deletion expectations with the customer.
- [ ] Document who is responsible for server, database, backup and recovery maintenance.
- [ ] Review any applicable Kenyan data-protection obligations with a qualified professional before storing personal/customer data.
