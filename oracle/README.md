# NikCar Taxi — Oracle Cloud Always Free staging

This is a **copy** of the existing bot, not a production cutover.

## Provision
1. Create an Oracle Cloud Always Free Ubuntu VM (ARM Ampere A1 if available; x86 also works). Availability and quotas vary.
2. Install Docker Engine, Docker Compose plugin and Git on the VM.
3. Clone the repository and checkout `oracle-staging`.
4. Run `cd oracle && cp .env.example .env`; fill secrets **on the VM only**, never commit them.
5. Keep `ENABLE_TELEGRAM_WEBHOOK=0` and avoid setting the production bot token until ready to cut over. Start with `docker compose up -d --build`.
6. Check `docker compose ps` and `curl http://127.0.0.1:8000/health`.

The service binds only to localhost. To expose it publicly, configure HTTPS via Caddy or Nginx and Oracle security-list/NSG firewall rules; do not expose the internal port directly.

## Safety
- Render stays the live bot. Do **not** enable webhook registration in Oracle until the controlled cutover.
- A single Telegram bot token can have only one webhook URL at a time.
- SQLite registration persists in Docker volume `nikcar_registration`, but the in-memory order state does not survive restarts.
- For a production cutover, migrate the persistent database, use HTTPS, verify dispatch and routing, set `WEBHOOK_URL` to Oracle HTTPS endpoint and `ENABLE_TELEGRAM_WEBHOOK=1`, then switch Telegram webhook in a planned maintenance window.
- Protect secrets, set backups and monitoring, and verify actual Oracle free-tier resource eligibility before provisioning.
