# Hosting TraceLens on a Real Server

This is the companion to [`running-guide.md`](./running-guide.md), which covers running
the stack locally. This guide covers what changes when you move it onto a server
that's reachable from the internet — a VPS, a cloud VM, or a homelab box exposed
through a router.

**There is no hosted/live instance of this project.** It has no SaaS component and
isn't deployed anywhere by its authors — every deployment is one you run yourself,
following this guide.

---

## 1. Should you expose this to the internet at all?

Be deliberate about this. As shipped, TraceLens has:
- A permissive JWT middleware in `api-gateway` that falls back to a mock user if no
  `Authorization` header is present, using a hardcoded secret.
- No auth at all on `query-api`, the dashboard, or ClickHouse's HTTP interface.
- No rate limiting anywhere.

If you just want to **look at the dashboard from your own laptop while it runs on a
home server**, put it behind a VPN (Tailscale/WireGuard) or SSH tunnel instead of
exposing any port publicly — that's the lowest-effort, highest-security option, and
it's the one to reach for by default.

If you genuinely need public internet access (e.g. sharing a demo link), follow the
reverse-proxy setup in §4 and treat §7 (hardening) as mandatory, not optional.

---

## 2. Choosing and sizing a server

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB SSD | 40 GB+ SSD (ClickHouse/Kafka data grows quickly under real traffic) |
| OS | Any Linux with Docker support (Ubuntu 22.04+ recommended) | Same |

Any mainstream VPS provider works — this stack has no cloud-specific dependencies.
Pick based on your own cost/region preferences, not anything specific to this project.

---

## 3. Server setup

```bash
# On the server, as a non-root user with sudo:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect

git clone https://github.com/sanjaysaini383/observability-platform.git
cd observability-platform/infra
cp .env.example .env
# edit .env with your GROQ_API_KEY etc. — see running-guide.md §2 for details

docker compose up -d --build
```

Same commands as local, running-guide.md applies unchanged from here for seeding data,
generating traffic, and using the dashboard.

---

## 4. Putting a reverse proxy in front (recommended for any public exposure)

Don't expose container ports directly (`3000`, `4000`, `8080`, `8123`, etc.) to the
internet. Put a reverse proxy in front that terminates TLS and only forwards the one
port you actually want reachable — normally just the dashboard.

### Option A — Caddy (simplest, automatic HTTPS)

Install Caddy on the host (outside Docker, or as its own container) and point it at
the dashboard container's port:

```caddyfile
# /etc/caddy/Caddyfile
tracelens.yourdomain.com {
    reverse_proxy localhost:8080
}
```

Caddy handles the Let's Encrypt certificate automatically on first request — no
separate certbot setup needed.

### Option B — nginx + certbot

```nginx
server {
    listen 443 ssl;
    server_name tracelens.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/tracelens.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracelens.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Either way: **only the dashboard's port (`8080`) should be reachable from outside the
server.** Everything else — `query-api` (`4000`), `api-gateway` (`3000`), ClickHouse
(`8123`), Kafka (`9092`), Postgres (`5432`), Redis (`6379`) — should only be reachable
from `localhost` or the Docker network, never from the public internet.

### Making the dashboard talk to query-api through the same domain

The dashboard is a static SPA that calls `query-api` directly at build time via
`VITE_API_URL` (see [`dashboard/src/lib/api.ts`](./dashboard/src/lib/api.ts), defaults
to `http://localhost:4000`). For a real deployment, either:

- Add a second proxy path (`tracelens.yourdomain.com/api/` → `localhost:4000`) and
  rebuild the dashboard with `VITE_API_URL=https://tracelens.yourdomain.com/api`, or
- Keep `query-api` on an internal-only port and proxy `/api/*` requests from the same
  reverse-proxy host, rewriting the path.

Either approach avoids ever exposing `query-api` on its own public port.

---

## 5. Firewall

Whatever proxy approach you use, lock down the host firewall to match:

```bash
# ufw example — adjust for your provider's firewall if it manages this instead
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 443/tcp    # HTTPS (reverse proxy)
sudo ufw allow 80/tcp     # HTTP (for Let's Encrypt challenge / redirect to HTTPS)
sudo ufw enable
```

Do **not** open `3000`, `4000`, `8080` (direct), `8123`, `9092`, `5432`, or `6379` in
the firewall — Docker Compose's default bridge network already lets containers reach
each other without those ports being exposed to the host's public interface at all;
the port mappings in `docker-compose.yml` exist for local development convenience, not
because a hosted deployment needs them open externally.

---

## 6. Keeping it running

### Restart policy
`docker compose up -d` containers restart automatically on host reboot only if you add
a restart policy. Add `restart: unless-stopped` to each service in
`infra/docker-compose.yml` if you want that (it's not set by default, since local
development usually doesn't want background containers surviving a laptop reboot).

### Updating to a new version
```bash
cd observability-platform
git pull
cd infra
docker compose up -d --build
```
This rebuilds and restarts only the services whose images changed.

### Logs
```bash
docker compose logs -f --tail=100 <service-name>
```

### Backups
The only stateful data worth backing up regularly is:
- **ClickHouse** (`infra_clickhouse_data` volume) — trace/metric/log history and AI
  insights.
- **Postgres** (the `postgres` volume) — order/inventory data.

```bash
docker run --rm -v infra_clickhouse_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/clickhouse-backup-$(date +%F).tar.gz -C /data .
```
Kafka/Zookeeper/Redis state is disposable — the pipeline replays cleanly from the
application services if those are wiped.

---

## 7. Hardening checklist for any public deployment

- [ ] Reverse proxy in front with TLS (§4) — never expose raw container ports
- [ ] Firewall only allows 22/80/443 (§5)
- [ ] Replace `api-gateway`'s hardcoded JWT secret (`'secret_key'` in
      [`services/api-gateway/app.js`](./services/api-gateway/app.js)) with a real
      secret from an environment variable, and remove or gate the mock-user fallback
- [ ] Add real authentication in front of the dashboard and `query-api` if this will
      ever be reachable by anyone other than you — there is currently none
- [ ] Rotate `infra/.env` secrets (Groq/Razorpay/SMTP) — don't reuse local-dev keys on
      a public server
- [ ] Set resource limits on containers (`deploy.resources.limits` in Compose, or
      systemd cgroup limits) so one runaway container can't take down the host
- [ ] Set up basic uptime monitoring for the dashboard endpoint itself (ironic, but a
      dead observability platform should still page someone)

None of these are implemented by default — this project optimizes for "easy to run
locally," not "safe to expose publicly out of the box." Treat this checklist as the
gap between the two.
