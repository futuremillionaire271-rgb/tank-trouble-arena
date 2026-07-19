// Tank Trouble Online v2 - authoritative server with delta-friendly snapshots
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const TICK = 1000 / 60;        // physics 60 Hz
const SNAP = 1000 / 30;        // snapshots 30 Hz

// ---------- static file server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  // if REDIRECT_URL is set (cloud instance), send everyone to the main server
  // so all players land in the SAME world and room codes always work
  if (process.env.REDIRECT_URL && req.url.split('?')[0] !== '/health') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { Location: process.env.REDIRECT_URL.replace(/\/$/, '') + '/' + q });
    res.end();
    return;
  }
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, region: process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || 'local' })); return; }
  const file = path.join(__dirname, 'public', path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server, perMessageDeflate: false });

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const angNorm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ---------- maze generation ----------
const CELL = 90, WALL_T = 8;
function generateMaze(playerCount = 3) {
  const base = Math.min(playerCount, 6);
  const cols = randInt(7 + base, 9 + base), rows = randInt(5 + Math.floor(base / 2), 7 + Math.floor(base / 2));
  const cells = [];
  for (let r = 0; r < rows; r++) { cells.push([]); for (let c = 0; c < cols; c++) cells[r].push([true, true, true, true]); }
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[randInt(0, cols - 1), randInt(0, rows - 1)]];
  visited[stack[0][1]][stack[0][0]] = true;
  const DIRS = [[0, -1, 0, 2], [1, 0, 1, 3], [0, 1, 2, 0], [-1, 0, 3, 1]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = DIRS.filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny][nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy, w1, w2] = options[randInt(0, options.length - 1)];
    const nx = cx + dx, ny = cy + dy;
    cells[cy][cx][w1] = false; cells[ny][nx][w2] = false;
    visited[ny][nx] = true;
    stack.push([nx, ny]);
  }
  const extra = Math.floor(cols * rows * 0.18);
  for (let i = 0; i < extra; i++) {
    const c = randInt(0, cols - 1), r = randInt(0, rows - 1);
    const opts = [];
    if (r > 0 && cells[r][c][0]) opts.push([0, c, r - 1, 2]);
    if (c < cols - 1 && cells[r][c][1]) opts.push([1, c + 1, r, 3]);
    if (r < rows - 1 && cells[r][c][2]) opts.push([2, c, r + 1, 0]);
    if (c > 0 && cells[r][c][3]) opts.push([3, c - 1, r, 1]);
    if (opts.length) {
      const [w, nc, nr, ow] = opts[randInt(0, opts.length - 1)];
      cells[r][c][w] = false; cells[nr][nc][ow] = false;
    }
  }
  const walls = [];
  const W = cols * CELL, H = rows * CELL;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * CELL, y = r * CELL;
    if (cells[r][c][0]) walls.push({ x: x - WALL_T / 2, y: y - WALL_T / 2, w: CELL + WALL_T, h: WALL_T });
    if (cells[r][c][3]) walls.push({ x: x - WALL_T / 2, y: y - WALL_T / 2, w: WALL_T, h: CELL + WALL_T });
  }
  for (let c = 0; c < cols; c++) walls.push({ x: c * CELL - WALL_T / 2, y: H - WALL_T / 2, w: CELL + WALL_T, h: WALL_T });
  for (let r = 0; r < rows; r++) walls.push({ x: W - WALL_T / 2, y: r * CELL - WALL_T / 2, w: WALL_T, h: CELL + WALL_T });
  // open adjacency per cell [up,right,down,left] for pathfinding
  const open = cells.map(row => row.map(w => [!w[0], !w[1], !w[2], !w[3]]));
  return { cols, rows, walls, W, H, open };
}

// grid helpers for AI + missile routing
function cellIndex(maze, x, y) {
  return { c: clamp(Math.floor(x / CELL), 0, maze.cols - 1), r: clamp(Math.floor(y / CELL), 0, maze.rows - 1) };
}
function bfsNext(maze, from, to) {
  if (from.c === to.c && from.r === to.r) return null;
  const key = (c, r) => r * maze.cols + c;
  const prev = new Int32Array(maze.cols * maze.rows).fill(-1);
  const seen = new Uint8Array(maze.cols * maze.rows);
  const q = [[from.c, from.r]];
  seen[key(from.c, from.r)] = 1;
  const D = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
  while (q.length) {
    const [c, r] = q.shift();
    if (c === to.c && r === to.r) break;
    const op = maze.open[r][c];
    for (const [dc, dr, di] of D) {
      if (!op[di]) continue;
      const nc = c + dc, nr = r + dr, k = key(nc, nr);
      if (seen[k]) continue;
      seen[k] = 1; prev[k] = key(c, r); q.push([nc, nr]);
    }
  }
  let cur = key(to.c, to.r);
  if (!seen[cur]) return null;
  const fromK = key(from.c, from.r);
  let steps = 0;
  while (prev[cur] !== fromK && prev[cur] !== -1 && steps < 2000) { cur = prev[cur]; steps++; }
  if (prev[cur] === -1 && cur !== fromK) return null;
  return { c: cur % maze.cols, r: Math.floor(cur / maze.cols) };
}

// ---------- collision ----------
function circleRectHit(cx, cy, cr, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  return dist2(cx, cy, nx, ny) < cr * cr;
}
function pushCircleOut(obj, r, rect) {
  const nx = clamp(obj.x, rect.x, rect.x + rect.w);
  const ny = clamp(obj.y, rect.y, rect.y + rect.h);
  let dx = obj.x - nx, dy = obj.y - ny;
  let d = Math.hypot(dx, dy);
  if (d === 0) {
    const l = obj.x - rect.x, rr = rect.x + rect.w - obj.x, t = obj.y - rect.y, b = rect.y + rect.h - obj.y;
    const m = Math.min(l, rr, t, b);
    if (m === l) obj.x = rect.x - r; else if (m === rr) obj.x = rect.x + rect.w + r;
    else if (m === t) obj.y = rect.y - r; else obj.y = rect.y + rect.h + r;
    return true;
  }
  if (d < r) { obj.x = nx + dx / d * r; obj.y = ny + dy / d * r; return true; }
  return false;
}
function bounceOffRect(b, r, rect) {
  if (!circleRectHit(b.x, b.y, r, rect)) return false;
  const nx = clamp(b.x, rect.x, rect.x + rect.w);
  const ny = clamp(b.y, rect.y, rect.y + rect.h);
  let dx = b.x - nx, dy = b.y - ny;
  if (dx === 0 && dy === 0) { b.vx = -b.vx; b.vy = -b.vy; return true; }
  if (Math.abs(dx) > Math.abs(dy)) {
    b.vx = Math.abs(b.vx) * Math.sign(dx) || -b.vx;
    b.x = nx + Math.sign(dx) * r;
  } else {
    b.vy = Math.abs(b.vy) * Math.sign(dy) || -b.vy;
    b.y = ny + Math.sign(dy) * r;
  }
  return true;
}
function raycast(x, y, dx, dy, walls, maxDist) {
  let best = null;
  for (const w of walls) {
    const x1 = w.x, x2 = w.x + w.w, y1 = w.y, y2 = w.y + w.h;
    let tmin = 0, tmax = maxDist, nx = 0, ny = 0, ok = true;
    if (Math.abs(dx) < 1e-9) { if (x < x1 || x > x2) ok = false; }
    else {
      let t1 = (x1 - x) / dx, t2 = (x2 - x) / dx, n = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
      if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) ok = false;
    }
    if (ok) {
      if (Math.abs(dy) < 1e-9) { if (y < y1 || y > y2) ok = false; }
      else {
        let t1 = (y1 - y) / dy, t2 = (y2 - y) / dy, n = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
        if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
    }
    if (ok && tmin > 1e-6 && (!best || tmin < best.t)) best = { t: tmin, nx, ny };
  }
  return best;
}

// ---------- game constants ----------
const TANK_R = 13, TANK_SPEED = 118, TANK_TURN = 3.8;
const BULLET_R = 4, BULLET_SPEED = 200, BULLET_LIFE = 9, MAX_BULLETS = 5;
const COLORS = ['red', 'green', 'blue', 'yellow', 'purple', 'cyan'];
const MAX_PLAYERS = 6;
const POWERUP_TYPES = ['laser', 'missile', 'gatling', 'frag', 'shield', 'mine', 'triple', 'speed', 'ghost', 'shotgun', 'bigshot'];
const ROUND_RESET_DELAY = 3500;

const SKINS = ['default', 'gold', 'camo', 'neon', 'dark', 'ice'];

// ---------- room ----------
const rooms = new Map();
function roomCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randInt(0, 31)]).join(''); } while (rooms.has(c));
  return c;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.bullets = [];
    this.mines = [];
    this.powerups = [];
    this.coinDrops = [];
    this.coinTimer = 10;
    this.bot = null;
    this.botState = null;
    this.effects = [];
    this.events = [];   // one-shot events for clients: shots, kills, pickups
    this.maze = generateMaze(3);
    this.roundActive = false;
    this.resetTimer = null;
    this.powerupTimer = 0;
    this.nextId = 1;
    this.lastTick = Date.now();
    this.roundNum = 0;
  }
  freeColor() { return COLORS.find(c => ![...this.players.values()].some(p => p.color === c)); }

  addPlayer(ws, name, skin) {
    const color = this.freeColor();
    if (!color || this.players.size >= MAX_PLAYERS) return null;
    const p = {
      ws, name: (name || 'Player').slice(0, 12), color, score: 0, kills: 0, coins: 0,
      skin: SKINS.includes(skin) ? skin : 'default', isBot: false,
      x: 0, y: 0, angle: 0, alive: false,
      input: { turn: 0, move: 0, fire: false, vecAngle: null, vecThrottle: 0, seq: 0 },
      weapon: null, ammoSpecial: 0, gatlingCd: 0, fireHeld: false, shield: 0, speedBoost: 0, ghost: 0,
      recoil: 0,
    };
    this.players.set(ws, p);
    this.spawnTank(p);
    this.pushEvent({ e: 'join', c: p.color, n: p.name });
    if (this.players.size >= 2 && !this.roundActive && !this.resetTimer) this.startRound();
    return p;
  }
  removePlayer(ws) {
    const p = this.players.get(ws);
    if (p) this.pushEvent({ e: 'leave', c: p.color, n: p.name });
    this.players.delete(ws);
    const humansLeft = [...this.players.values()].some(pl => !pl.isBot);
    if (this.players.size === 0 || !humansLeft) {
      if (this.resetTimer) clearTimeout(this.resetTimer);
      rooms.delete(this.code);
    } else this.endRoundCheck();
  }

  addBot() {
    const key = { readyState: 3, send() {}, isBotKey: true };
    const p = this.addPlayer(key, 'VOID');
    if (p) {
      p.isBot = true;
      this.bot = p;
      this.botState = { cd: 1, aimErr: 0.10, wp: null, pathT: 0, mem: new Map() };
    }
    return p;
  }
  pushEvent(ev) { this.events.push(ev); }

  spawnTank(p) {
    let best = null;
    for (let i = 0; i < 24; i++) {
      const c = randInt(0, this.maze.cols - 1), r = randInt(0, this.maze.rows - 1);
      const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
      let minD = Infinity;
      for (const o of this.players.values()) if (o !== p && o.alive) minD = Math.min(minD, dist2(x, y, o.x, o.y));
      if (!best || minD > best.d) best = { x, y, d: minD };
    }
    p.x = best.x; p.y = best.y; p.angle = rand(-Math.PI, Math.PI);
    p.alive = true; p.weapon = null; p.shield = 0; p.speedBoost = 0; p.ghost = 0;
  }
  startRound() {
    this.roundActive = true;
    this.roundNum++;
    this.maze = generateMaze(this.players.size);
    this.bullets = []; this.mines = []; this.powerups = []; this.effects = [];
    this.coinDrops = [];
    this.coinTimer = rand(6, 12);
    if (this.botState) { this.botState.wp = null; this.botState.cd = 1.2; }
    this.powerupTimer = rand(2.5, 4.5);
    for (const p of this.players.values()) this.spawnTank(p);
    this.broadcast({ type: 'round', maze: this.maze, num: this.roundNum });
  }
  endRoundCheck() {
    if (!this.roundActive || this.players.size < 2) return;
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1) {
      this.roundActive = false;
      if (alive.length === 1) { alive[0].score++; this.broadcast({ type: 'roundEnd', winner: alive[0].color, winnerName: alive[0].name }); }
      else this.broadcast({ type: 'roundEnd', winner: null });
      this.resetTimer = setTimeout(() => { this.resetTimer = null; if (this.players.size >= 1) this.startRound(); }, ROUND_RESET_DELAY);
    }
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
  }

  killTank(p, killer) {
    if (!p.alive) return;
    if (p.shield > 0) { p.shield = 0; this.effects.push({ kind: 'shieldPop', x: p.x, y: p.y, t: 0.4 }); this.pushEvent({ e: 'shieldPop', x: p.x, y: p.y }); return; }
    p.alive = false;
    // VOID learns: hitting players sharpens aim, dying loosens it (stays beatable)
    if (this.botState) {
      if (killer === this.bot && p !== this.bot) this.botState.aimErr = Math.max(0.025, this.botState.aimErr * 0.9);
      if (p === this.bot) this.botState.aimErr = Math.min(0.14, this.botState.aimErr * 1.12);
    }
    this.effects.push({ kind: 'explosion', x: p.x, y: p.y, t: 0.9, color: p.color, big: true });
    const kn = killer && killer !== p ? killer.name : null;
    if (killer && killer !== p) killer.kills++;
    this.pushEvent({ e: 'kill', victim: p.name, vc: p.color, killer: kn, kc: killer ? killer.color : null, x: p.x, y: p.y });
    this.endRoundCheck();
  }

  fireBullet(p, opts = {}) {
    const mine = this.bullets.filter(b => b.owner === p && b.kind === 'normal');
    if (!opts.kind && mine.length >= MAX_BULLETS) return false;
    const kind = opts.kind || 'normal';
    const speed = opts.speed || BULLET_SPEED;
    const ang = opts.angle !== undefined ? opts.angle : p.angle;
    const mx = p.x + Math.cos(ang) * (TANK_R + 6), my = p.y + Math.sin(ang) * (TANK_R + 6);
    this.bullets.push({
      id: this.nextId++, owner: p, ownerColor: p.color, kind,
      x: mx, y: my, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: opts.life || BULLET_LIFE, r: opts.r || BULLET_R, grace: 0.14, fuse: opts.fuse,
    });
    return true;
  }

  fireLaser(p) {
    let x = p.x + Math.cos(p.angle) * (TANK_R + 2), y = p.y + Math.sin(p.angle) * (TANK_R + 2);
    let dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    const pts = [{ x, y }];
    const victims = new Set();
    for (let bounce = 0; bounce < 7; bounce++) {
      const hit = raycast(x, y, dx, dy, this.maze.walls, 4000);
      const t = hit ? hit.t : 4000;
      for (const o of this.players.values()) {
        if (!o.alive || o.ghost > 0) continue;
        if (o === p && bounce === 0) continue;
        const px = o.x - x, py = o.y - y;
        const proj = clamp(px * dx + py * dy, 0, t);
        const ex = x + dx * proj, ey = y + dy * proj;
        if (dist2(o.x, o.y, ex, ey) < (TANK_R + 2) ** 2) victims.add(o);
      }
      if (!hit) { pts.push({ x: x + dx * 4000, y: y + dy * 4000 }); break; }
      x += dx * hit.t; y += dy * hit.t;
      pts.push({ x, y });
      if (hit.nx !== 0) dx = -dx; else dy = -dy;
      x += dx * 0.5; y += dy * 0.5;
    }
    this.effects.push({ kind: 'laser', pts, color: p.color, t: 0.4 });
    this.pushEvent({ e: 'laser', x: p.x, y: p.y });
    for (const v of victims) this.killTank(v, p);
  }

  explodeFrag(b) {
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand(-0.1, 0.1);
      this.bullets.push({
        id: this.nextId++, owner: b.owner, ownerColor: b.ownerColor, kind: 'shard',
        x: b.x, y: b.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170,
        life: 1.1, r: 3, grace: 0.05,
      });
    }
    this.effects.push({ kind: 'explosion', x: b.x, y: b.y, t: 0.7, color: 'orange', big: true });
    this.pushEvent({ e: 'boom', x: b.x, y: b.y });
  }
  explodeMine(m) {
    this.effects.push({ kind: 'explosion', x: m.x, y: m.y, t: 0.8, color: 'orange', big: true });
    this.pushEvent({ e: 'boom', x: m.x, y: m.y });
    for (const o of this.players.values()) {
      if (o.alive && dist2(o.x, o.y, m.x, m.y) < 55 ** 2) this.killTank(o, m.owner);
    }
  }

  handleFire(p) {
    if (!p.alive || !this.roundActive) return;
    let shot = false;
    if (p.weapon === 'laser') { this.fireLaser(p); p.weapon = null; shot = true; }
    else if (p.weapon === 'missile') { shot = this.fireBullet(p, { kind: 'missile', speed: 150, life: 6, r: 6 }); p.weapon = null; }
    else if (p.weapon === 'frag') { shot = this.fireBullet(p, { kind: 'frag', speed: 155, life: 5, r: 6, fuse: 1.4 }); p.weapon = null; }
    else if (p.weapon === 'triple') {
      for (const off of [-0.2, 0, 0.2]) this.fireBullet(p, { kind: 'shard', speed: BULLET_SPEED, life: 6, r: 4, angle: p.angle + off });
      p.ammoSpecial--; shot = true;
      if (p.ammoSpecial <= 0) p.weapon = null;
    }
    else if (p.weapon === 'mine') {
      this.mines.push({ id: this.nextId++, owner: p, x: p.x - Math.cos(p.angle) * (TANK_R + 8), y: p.y - Math.sin(p.angle) * (TANK_R + 8), arm: 1.2 });
      p.ammoSpecial--; shot = true;
      if (p.ammoSpecial <= 0) p.weapon = null;
      this.pushEvent({ e: 'minePlace', x: p.x, y: p.y });
    }
    else if (p.weapon === 'shotgun') {
      for (let i = 0; i < 6; i++) this.fireBullet(p, { kind: 'shard', speed: 220 + rand(-30, 30), life: 0.9, r: 3, angle: p.angle + rand(-0.3, 0.3) });
      p.ammoSpecial--; shot = true;
      if (p.ammoSpecial <= 0) p.weapon = null;
    }
    else if (p.weapon === 'bigshot') {
      shot = this.fireBullet(p, { kind: 'bigshot', speed: 130, life: 12, r: 10 });
      p.weapon = null;
    }
    else if (p.weapon === 'gatling') { /* continuous */ }
    else shot = this.fireBullet(p);
    if (shot) { p.recoil = 1; this.pushEvent({ e: 'shot', x: p.x, y: p.y, a: p.angle, c: p.color, w: p.weapon || 'normal' }); }
  }

  update(dt) {
    const { walls } = this.maze;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const inp = p.input;
      const spdMul = p.speedBoost > 0 ? 1.45 : 1;
      if (inp.vecAngle !== null && inp.vecThrottle > 0.1) {
        // twin-stick style: turn toward stick, drive in reverse if target is behind
        let diff = angNorm(inp.vecAngle - p.angle);
        let dir = 1;
        if (Math.abs(diff) > Math.PI * 0.58) { diff = angNorm(diff + Math.PI); dir = -1; }
        const maxTurn = TANK_TURN * 2.3 * dt;
        p.angle += clamp(diff, -maxTurn, maxTurn);
        const align = Math.max(0.35, Math.cos(diff));
        const sp = TANK_SPEED * spdMul * clamp(inp.vecThrottle, 0, 1) * align * dir * (dir < 0 ? 0.8 : 1);
        p.x += Math.cos(p.angle) * sp * dt;
        p.y += Math.sin(p.angle) * sp * dt;
      } else {
        p.angle += inp.turn * TANK_TURN * dt;
        const sp = inp.move * TANK_SPEED * spdMul * (inp.move < 0 ? 0.62 : 1);
        p.x += Math.cos(p.angle) * sp * dt;
        p.y += Math.sin(p.angle) * sp * dt;
      }
      p.angle = angNorm(p.angle);
      for (const w of walls) pushCircleOut(p, TANK_R, w);
      p.x = clamp(p.x, TANK_R, this.maze.W - TANK_R);
      p.y = clamp(p.y, TANK_R, this.maze.H - TANK_R);
      if (p.weapon === 'gatling' && p.fireHeld) {
        p.gatlingCd -= dt;
        if (p.gatlingCd <= 0) {
          p.gatlingCd = 0.085;
          this.fireBullet(p, { kind: 'shard', speed: 240, life: 1.6, r: 3, angle: p.angle + rand(-0.09, 0.09) });
          p.recoil = 0.6;
          this.pushEvent({ e: 'shot', x: p.x, y: p.y, a: p.angle, c: p.color, w: 'gatling' });
          p.ammoSpecial--;
          if (p.ammoSpecial <= 0) p.weapon = null;
        }
      }
      if (p.shield > 0) p.shield -= dt;
      if (p.speedBoost > 0) p.speedBoost -= dt;
      if (p.ghost > 0) p.ghost -= dt;
      if (p.recoil > 0) p.recoil -= dt * 5;
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pu = this.powerups[i];
        if (dist2(p.x, p.y, pu.x, pu.y) < (TANK_R + 12) ** 2) {
          this.powerups.splice(i, 1);
          this.pushEvent({ e: 'pickup', x: pu.x, y: pu.y, c: p.color, w: pu.type });
          if (pu.type === 'shield') p.shield = 8;
          else if (pu.type === 'speed') p.speedBoost = 6;
          else if (pu.type === 'ghost') p.ghost = 6;
          else {
            p.weapon = pu.type;
            if (pu.type === 'gatling') { p.ammoSpecial = 28; p.gatlingCd = 0; }
            if (pu.type === 'triple') p.ammoSpecial = 3;
            if (pu.type === 'mine') p.ammoSpecial = 3;
            if (pu.type === 'shotgun') p.ammoSpecial = 2;
          }
        }
      }
    }
    // mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.arm > 0) { m.arm -= dt; continue; }
      for (const o of this.players.values()) {
        if (o.alive && (o !== m.owner) && o.ghost <= 0 && dist2(o.x, o.y, m.x, m.y) < (TANK_R + 9) ** 2) {
          this.explodeMine(m); this.mines.splice(i, 1); break;
        }
      }
    }
    // bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.grace > 0) b.grace -= dt;
      if (b.fuse !== undefined) { b.fuse -= dt; if (b.fuse <= 0) { this.explodeFrag(b); this.bullets.splice(i, 1); continue; } }
      if (b.life <= 0) { this.bullets.splice(i, 1); continue; }
      if (b.kind === 'missile') {
        // route-following missile: after short arming, it navigates the maze
        // using corridor waypoints toward the nearest tank (even its owner).
        if (b.life < 5.2) {
          let target = null, bd = Infinity;
          for (const o of this.players.values()) {
            if (!o.alive || o.ghost > 0) continue;
            const d = dist2(b.x, b.y, o.x, o.y);
            if (d < bd) { bd = d; target = o; }
          }
          if (target) {
            // direct line if clear, otherwise steer along maze route (no wall hugging)
            let gx = target.x, gy = target.y;
            const dxT = target.x - b.x, dyT = target.y - b.y;
            const dLen = Math.hypot(dxT, dyT) || 1;
            const losHit = raycast(b.x, b.y, dxT / dLen, dyT / dLen, this.maze.walls, dLen);
            if (losHit) {
              const next = bfsNext(this.maze, cellIndex(this.maze, b.x, b.y), cellIndex(this.maze, target.x, target.y));
              if (next) { gx = next.c * CELL + CELL / 2; gy = next.r * CELL + CELL / 2; }
            }
            const want = Math.atan2(gy - b.y, gx - b.x);
            const cur = Math.atan2(b.vy, b.vx);
            const diff = angNorm(want - cur);
            const na = cur + clamp(diff, -4.2 * dt, 4.2 * dt);
            const sp = Math.hypot(b.vx, b.vy);
            b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          }
        }
      }
      const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 4);
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        for (const w of walls) {
          if (bounceOffRect(b, b.r, w)) {
            this.pushEvent({ e: 'bounce', x: b.x, y: b.y });
            // missiles only explode on tanks - walls just bounce them
            if (b.kind === 'frag') { this.explodeFrag(b); dead = true; }
            break;
          }
        }
        if (dead) break;
        for (const o of this.players.values()) {
          if (!o.alive || o.ghost > 0) continue;
          if (o === b.owner && b.grace > 0) continue;
          if (dist2(b.x, b.y, o.x, o.y) < (TANK_R + b.r) ** 2) {
            if (b.kind === 'frag') this.explodeFrag(b);
            if (b.kind === 'missile') { this.effects.push({ kind: 'explosion', x: b.x, y: b.y, t: 0.5, color: 'orange' }); this.pushEvent({ e: 'boom', x: b.x, y: b.y }); }
            this.killTank(o, b.owner);
            dead = true; break;
          }
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }
    // coins: rare pickups worth 5, spawn like powerups but scarce
    if (this.roundActive) {
      this.coinTimer -= dt;
      if (this.coinTimer <= 0 && this.coinDrops.length < 1) {
        this.coinTimer = rand(14, 26);
        const c = randInt(0, this.maze.cols - 1), r = randInt(0, this.maze.rows - 1);
        this.coinDrops.push({ id: this.nextId++, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        for (let i = this.coinDrops.length - 1; i >= 0; i--) {
          const cd = this.coinDrops[i];
          if (dist2(p.x, p.y, cd.x, cd.y) < (TANK_R + 11) ** 2) {
            this.coinDrops.splice(i, 1);
            p.coins += 5;
            this.pushEvent({ e: 'coin', x: cd.x, y: cd.y, c: p.color, total: p.coins });
          }
        }
      }
    }
    // VOID bot brain
    if (this.bot && this.bot.alive && this.roundActive) this.updateBot(dt);
    // powerups spawn
    if (this.roundActive) {
      this.powerupTimer -= dt;
      const maxPu = 2 + Math.floor(this.players.size / 2);
      if (this.powerupTimer <= 0 && this.powerups.length < maxPu) {
        this.powerupTimer = rand(3.5, 7);
        const c = randInt(0, this.maze.cols - 1), r = randInt(0, this.maze.rows - 1);
        this.powerups.push({
          id: this.nextId++, type: POWERUP_TYPES[randInt(0, POWERUP_TYPES.length - 1)],
          x: c * CELL + CELL / 2, y: r * CELL + CELL / 2,
        });
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].t -= dt;
      if (this.effects[i].t <= 0) this.effects.splice(i, 1);
    }
  }

  updateBot(dt) {
    const bot = this.bot, st = this.botState;
    st.cd -= dt;
    // target: nearest living human
    let target = null, bd = Infinity;
    for (const o of this.players.values()) {
      if (o === bot || !o.alive) continue;
      const d = dist2(bot.x, bot.y, o.x, o.y);
      if (d < bd) { bd = d; target = o; }
    }
    // detour to nearby powerup when unarmed
    let goal = target;
    if (!bot.weapon) {
      for (const pu of this.powerups) {
        if (dist2(bot.x, bot.y, pu.x, pu.y) < 220 ** 2) { goal = pu; break; }
      }
    }
    if (!goal) { bot.input.move = 0; bot.input.turn = 0; return; }
    // learn per-player habits: remember victim's average speed to lead shots
    if (target) {
      const mem = st.mem.get(target.color) || { vx: 0, vy: 0, px: target.x, py: target.y };
      mem.vx = mem.vx * 0.9 + (target.x - mem.px) / Math.max(dt, 0.001) * 0.1;
      mem.vy = mem.vy * 0.9 + (target.y - mem.py) / Math.max(dt, 0.001) * 0.1;
      mem.px = target.x; mem.py = target.y;
      st.mem.set(target.color, mem);
    }
    // navigate: direct if line of sight, else BFS waypoint
    let gx = goal.x, gy = goal.y;
    const ddx = goal.x - bot.x, ddy = goal.y - bot.y;
    const dLen = Math.hypot(ddx, ddy) || 1;
    const losHit = raycast(bot.x, bot.y, ddx / dLen, ddy / dLen, this.maze.walls, dLen);
    if (losHit) {
      st.pathT -= dt;
      if (st.pathT <= 0 || !st.wp) {
        st.pathT = 0.25;
        st.wp = bfsNext(this.maze, cellIndex(this.maze, bot.x, bot.y), cellIndex(this.maze, goal.x, goal.y));
      }
      if (st.wp) { gx = st.wp.c * CELL + CELL / 2; gy = st.wp.r * CELL + CELL / 2; }
    } else st.wp = null;
    // dodge incoming bullets: sidestep if a bullet will pass close soon
    let dodge = 0;
    for (const b of this.bullets) {
      if (b.owner === bot && b.grace > 0) continue;
      const relX = bot.x - b.x, relY = bot.y - b.y;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const tClose = (relX * b.vx + relY * b.vy) / (sp * sp);
      if (tClose > 0 && tClose < 0.6) {
        const cx = b.x + b.vx * tClose, cy = b.y + b.vy * tClose;
        if (dist2(bot.x, bot.y, cx, cy) < 42 ** 2) { dodge = Math.sign((relX * b.vy - relY * b.vx)) || 1; break; }
      }
    }
    // steer
    const wantA = Math.atan2(gy - bot.y, gx - bot.x) + dodge * 0.9;
    bot.input.vecAngle = wantA;
    bot.input.vecThrottle = 0.95;
    // fire: direct LOS to target with predictive lead + adaptive aim error
    if (target && st.cd <= 0) {
      const mem = st.mem.get(target.color) || { vx: 0, vy: 0 };
      const lead = Math.min(Math.hypot(target.x - bot.x, target.y - bot.y) / BULLET_SPEED, 0.8);
      const px = target.x + mem.vx * lead, py = target.y + mem.vy * lead;
      const pdx = px - bot.x, pdy = py - bot.y;
      const pLen = Math.hypot(pdx, pdy) || 1;
      const clear = !raycast(bot.x, bot.y, pdx / pLen, pdy / pLen, this.maze.walls, pLen);
      const aimA = Math.atan2(pdy, pdx) + rand(-st.aimErr, st.aimErr);
      const facing = Math.abs(angNorm(aimA - bot.angle)) < 0.24;
      if (clear && pLen < 480) {
        bot.input.vecAngle = aimA; // snap aim toward target
        if (facing) {
          this.handleFire(bot);
          bot.fireHeld = bot.weapon === 'gatling';
          st.cd = bot.weapon ? 0.3 : rand(0.7, 1.3);
        }
      } else if (bot.fireHeld) bot.fireHeld = false;
    }
  }

  snapshot() {
    const snap = {
      type: 'state',
      t: Date.now(),
      tanks: [...this.players.values()].map(p => ({
        c: p.color, n: p.name, s: p.score, k: p.kills, cn: p.coins, sk: p.skin, bot: p.isBot || undefined,
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        a: Math.round(p.angle * 1000) / 1000, al: p.alive, w: p.weapon,
        sh: p.shield > 0, sp: p.speedBoost > 0, gh: p.ghost > 0, rc: Math.max(0, Math.round(p.recoil * 100) / 100),
        am: p.weapon ? p.ammoSpecial : 0,
        seq: p.input.seq,
      })),
      bullets: this.bullets.map(b => ({
        id: b.id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
        vx: Math.round(b.vx), vy: Math.round(b.vy), k: b.kind, c: b.ownerColor, r: b.r,
      })),
      mines: this.mines.map(m => ({ id: m.id, x: m.x, y: m.y, armed: m.arm <= 0 })),
      coins: this.coinDrops,
      powerups: this.powerups,
      effects: this.effects,
      events: this.events,
      waiting: [...this.players.values()].filter(p => !p.isBot).length < 1 || this.players.size < 2,
    };
    this.events = [];
    return snap;
  }
}

// ---------- websocket ----------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', (msg) => {
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', t: m.t })); return; }
    if (m.type === 'create' || m.type === 'join' || m.type === 'quick') {
      if (ws.room) return;
      let room;
      if (m.type === 'create') { room = new Room(roomCode()); rooms.set(room.code, room); }
      else if (m.type === 'join') {
        room = rooms.get((m.room || '').toUpperCase().trim());
        if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); return; }
        if (room.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ type: 'error', msg: `Room is full (${MAX_PLAYERS} players max)` })); return; }
      } else {
        room = [...rooms.values()].find(r => r.players.size > 0 && r.players.size < MAX_PLAYERS);
        if (!room) { room = new Room(roomCode()); rooms.set(room.code, room); }
      }
      const p = room.addPlayer(ws, m.name, m.skin);
      if (!p) { ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' })); return; }
      ws.room = room; ws.player = p;
      ws.send(JSON.stringify({ type: 'joined', room: room.code, color: p.color, maze: room.maze, maxPlayers: MAX_PLAYERS }));
      if (m.bot && !room.bot) room.addBot();
    } else if (m.type === 'addBot' && ws.room) {
      if (!ws.room.bot && ws.room.players.size < MAX_PLAYERS) {
        ws.room.addBot();
        if (!ws.room.roundActive && !ws.room.resetTimer && ws.room.players.size >= 2) ws.room.startRound();
      }
    } else if (m.type === 'setSkin' && ws.player) {
      if (SKINS.includes(m.skin)) ws.player.skin = m.skin;
    } else if (m.type === 'input' && ws.player) {
      const p = ws.player, inp = p.input;
      if (typeof m.seq === 'number') inp.seq = m.seq;
      if (m.vec) { inp.vecAngle = m.a; inp.vecThrottle = m.t; inp.turn = 0; inp.move = 0; }
      else { inp.turn = clamp(m.turn || 0, -1, 1); inp.move = clamp(m.move || 0, -1, 1); inp.vecAngle = null; }
      const fireNow = !!m.fire;
      if (fireNow && !p.fireHeld) ws.room.handleFire(p);
      p.fireHeld = fireNow;
    }
  });
  ws.on('close', () => { if (ws.room) { ws.room.removePlayer(ws); ws.room = null; } });
});

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 30000);

setInterval(() => {
  for (const room of rooms.values()) {
    const now = Date.now();
    const dt = Math.min((now - room.lastTick) / 1000, 0.1);
    room.lastTick = now;
    room.update(dt);
  }
}, TICK);
setInterval(() => {
  for (const room of rooms.values()) room.broadcast(room.snapshot());
}, SNAP);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Tank Trouble v2 server on http://localhost:${PORT}`));
} else {
  module.exports = { Room, generateMaze, CELL, TANK_R, rooms, bfsNext, cellIndex };
}
