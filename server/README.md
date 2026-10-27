# cod-mp-server

Node 22 WebSocket room server for Claude of Duty (free-for-all, server-authoritative hits). Single dependency: `ws`. Protocol: [PROTOCOL.md](PROTOCOL.md).

## Run / test
```
cd server
npm install
npm start          # binds PORT (default 8080), GET /health
npm test           # real server + real clients
```

## Deploy on Railway (zero config)
1. New Project, Deploy from GitHub repo, set **Root Directory** to `server`.
2. Railway detects Node and runs `npm start`; `PORT` is injected. Healthcheck path: `/health`.
3. Generate a public domain; clients connect to `wss://<domain>/`.
4. Optional env vars:
   - `ALLOWED_ORIGINS` comma list, e.g. `https://oliver.github.io` (empty = allow all; set it in production).
   - `MAX_ROOMS` (200), `MAX_ROOMS_PER_IP` (3), `MAX_CONN_PER_IP` (16).
   - `TRUST_PROXY=1|0` (defaults on when `RAILWAY_ENVIRONMENT` is set): use the rightmost `X-Forwarded-For` entry as the client IP.

State is in memory: a restart drops all rooms. Run a single instance (rooms are not shared across replicas).
No secrets are needed or used.
