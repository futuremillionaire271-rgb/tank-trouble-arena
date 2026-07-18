# Tank Trouble Arena

Online multiplayer Tank Trouble: up to 6 players, random mazes every round, 9 power-ups, particles, sounds, mobile controls.

## Run locally
```
npm install
npm start        # server on http://localhost:3000
```

## Play over the internet from this PC
Double-click `start-game.bat`. It starts the server plus a free Cloudflare tunnel and prints a public URL to share.

## Host 24/7 in the cloud (no laptop needed)
This repo is ready for any Node.js host (Render, Railway, Fly.io, Koyeb...).

Render example (free tier):
1. Push this folder to a GitHub repo
2. On render.com: New > Web Service > connect the repo
3. Build command: `npm install`  Start command: `npm start`
4. Done. Your permanent URL works even when your PC is off.

The server binds `process.env.PORT` automatically and serves everything (static files + WebSocket) from one port. A `/health` endpoint is included for uptime checks.

## Tests
```
npm test             # unit tests (weapons, powerups, rooms)
node test.js         # end-to-end: 6 players over websockets
node tunnel-test.js <host>   # verify a public deployment
```
