// Tank Trouble Online v2 - client with prediction, interpolation, particles, audio
(() => {
const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const COLORS = { red: '#ff4d5e', green: '#3ddc84', blue: '#4d9fff', yellow: '#ffd24d', purple: '#b06dff', cyan: '#35e0d8' };
const DARK = { red: '#b02836', green: '#1f9457', blue: '#2c6cc4', yellow: '#bd9a2a', purple: '#7b41c4', cyan: '#1fa39d' };
const LIGHT = { red: '#ff8b96', green: '#8aeeb8', blue: '#93c4ff', yellow: '#ffe598', purple: '#d0a8ff', cyan: '#8cf0ea' };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

let ws = null, myColor = null, maze = null, roomCode = '';
let ping = 0, connected = false;

// snapshot interpolation buffer (render ~100ms in the past for smoothness)
const INTERP_DELAY = 100;
const snapBuf = [];
let latestSnap = null;

// local particles/effects
const particles = [];
const floaters = [];
let shake = 0, shakeX = 0, shakeY = 0;
const bulletTrails = new Map(); // bullet id -> [{x,y,t}]
const treadMarks = [];

// ---------- audio (procedural, no files) ----------
let AC = null, masterGain = null;
function audio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = AC.createGain(); masterGain.gain.value = 0.5; masterGain.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function sfx(type) {
  try {
    const ac = audio(); if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;
    const g = ac.createGain(); g.connect(masterGain);
    if (type === 'shot') {
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); o.start(t); o.stop(t + 0.11);
    } else if (type === 'gatling') {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
      g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(g); o.start(t); o.stop(t + 0.07);
    } else if (type === 'boom') {
      const len = 0.45, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + len);
      g.gain.setValueAtTime(0.8, t);
      src.connect(f); f.connect(g); src.start(t);
    } else if (type === 'laser') {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.3);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g); o.start(t); o.stop(t + 0.33);
    } else if (type === 'pickup') {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(500, t); o.frequency.setValueAtTime(750, t + 0.08); o.frequency.setValueAtTime(1000, t + 0.16);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g); o.start(t); o.stop(t + 0.26);
    } else if (type === 'bounce') {
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(300, t);
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); o.start(t); o.stop(t + 0.06);
    } else if (type === 'win') {
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = ac.createOscillator(); const gg = ac.createGain(); gg.connect(masterGain);
        o.type = 'triangle'; o.frequency.value = f;
        gg.gain.setValueAtTime(0.001, t + i * 0.12); gg.gain.linearRampToValueAtTime(0.2, t + i * 0.12 + 0.03); gg.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.3);
        o.connect(gg); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.31);
      });
    }
  } catch (e) { /* audio optional */ }
}

// ---------- garage / wallet (persistent via localStorage) ----------
const SKIN_DEFS = {
  default: { name: 'STANDARD', price: 0, body: null },
  gold: { name: 'GOLD', price: 30, body: '#d9a916' },
  camo: { name: 'CAMO', price: 20, body: '#5a6b3f' },
  neon: { name: 'NEON', price: 40, body: '#19d3c5' },
  dark: { name: 'SHADOW', price: 25, body: '#2c2f3c' },
  ice: { name: 'ICE', price: 35, body: '#9cc8e8' },
};
function wallet() { try { return JSON.parse(localStorage.getItem('tt_wallet') || '{"coins":0,"owned":["default"],"equipped":"default"}'); } catch { return { coins: 0, owned: ['default'], equipped: 'default' }; } }
function saveWallet(w) { try { localStorage.setItem('tt_wallet', JSON.stringify(w)); } catch {} }
function addCoins(n) { const w = wallet(); w.coins += n; saveWallet(w); refreshWalletUI(); }
function refreshWalletUI() {
  const w = wallet();
  $('walletTop').textContent = w.coins;
  $('walletBig').textContent = '\ud83e\ude99 ' + w.coins;
  $('coinHud').textContent = '\ud83e\ude99 ' + w.coins;
  const grid = $('skinGrid');
  grid.innerHTML = Object.entries(SKIN_DEFS).map(([id, s]) => {
    const owned = w.owned.includes(id), eq = w.equipped === id;
    return `<div class="skinCard ${owned ? 'owned' : ''} ${eq ? 'equipped' : ''}" data-skin="${id}">
      <div class="sw" style="background:${s.body || 'linear-gradient(135deg,#ff4d5e,#4d9fff)'}"></div>
      <div class="nm">${s.name}</div>
      <div class="pr">${eq ? 'EQUIPPED' : owned ? 'TAP TO EQUIP' : s.price + ' \ud83e\ude99'}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.skinCard').forEach(el => el.onclick = () => {
    const id = el.dataset.skin, w2 = wallet(), s = SKIN_DEFS[id];
    if (w2.owned.includes(id)) { w2.equipped = id; saveWallet(w2); toast(s.name + ' equipped!'); }
    else if (w2.coins >= s.price) { w2.coins -= s.price; w2.owned.push(id); w2.equipped = id; saveWallet(w2); toast('Bought ' + s.name + '! \ud83c\udf89'); sfx('win'); }
    else toast('Need ' + (s.price - w2.coins) + ' more coins. Collect \ud83e\ude99 in battle!');
    refreshWalletUI();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'setSkin', skin: wallet().equipped }));
  });
}
$('btnGarage').onclick = () => { $('garagePanel').style.display = 'flex'; $('garagePanel').previousElementSibling.style.display = 'none'; refreshWalletUI(); };
$('btnGarageBack').onclick = () => { $('garagePanel').style.display = 'none'; $('garagePanel').previousElementSibling.style.display = 'flex'; };
refreshWalletUI();

// ---------- connection ----------
function connect(msg) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { connected = true; ws.send(JSON.stringify(msg)); pingLoop(); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') {
      myColor = m.color; maze = m.maze; roomCode = m.room;
      $('menu').style.display = 'none';
      $('topbar').style.display = 'flex';
      $('roomTag').style.display = 'block';
      $('pingTag').style.display = 'block';
      $('roomTag').textContent = '⧉ ' + roomCode;
      $('btnExit').style.display = 'block';
      $('btnVoid').style.display = 'block';
      $('coinHud').style.display = 'block';
      refreshWalletUI();
      if (isTouch) $('touchUI').style.display = 'block';
      else $('helpKeys').style.display = 'block';
      resize();
    } else if (m.type === 'error') {
      $('menuMsg').textContent = m.msg;
      ws.close(); ws = null; connected = false;
    } else if (m.type === 'pong') {
      ping = Math.round(performance.now() - m.t);
      $('pingTag').textContent = `● ${ping}ms`;
      $('pingTag').style.color = ping < 80 ? '#56d98a' : ping < 180 ? '#ffd24d' : '#ff6b7a';
    } else if (m.type === 'round') {
      maze = m.maze; hideBanner();
      bulletTrails.clear(); treadMarks.length = 0;
    } else if (m.type === 'roundEnd') {
      if (m.winner) {
        showBanner(`${(m.winnerName || m.winner).toUpperCase()} WINS`, m.winner, 'next round starting…');
        if (m.winner === myColor) { sfx('win'); confetti(); }
      } else showBanner('DRAW', null, 'next round starting…');
    } else if (m.type === 'state') {
      m.rt = performance.now();
      snapBuf.push(m);
      while (snapBuf.length > 40) snapBuf.shift();
      latestSnap = m;
      updateHud(m);
      handleEvents(m.events || []);
      if (m.waiting) showBanner('WAITING FOR PLAYERS', null, 'share code ' + roomCode + ' or tap ⧉ to copy the link');
      else if ($('bannerText').dataset.waiting === '1') hideBanner();
    }
  };
  ws.onclose = () => { if (myColor) showBanner('DISCONNECTED', null, 'reload the page to rejoin'); };
}
function pingLoop() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
  setTimeout(pingLoop, 2000);
}
$('btnQuick').onclick = () => start({ type: 'quick' });
$('btnCreate').onclick = () => start({ type: 'create' });
$('btnJoin').onclick = () => {
  const code = $('roomInput').value.trim();
  if (!code) { $('menuMsg').textContent = 'Enter a room code'; return; }
  start({ type: 'join', room: code });
};
function start(msg) {
  if (ws) return;
  audio();
  msg.name = $('nameInput').value.trim() || 'Player';
  msg.skin = wallet().equipped;
  try { localStorage.setItem('tt_name', msg.name); } catch {}
  $('menuMsg').textContent = 'Connecting…';
  connect(msg);
}
try { $('nameInput').value = localStorage.getItem('tt_name') || ''; } catch {}
// auto-join via ?room=CODE link
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('roomInput').value = urlRoom.toUpperCase();
$('roomTag').onclick = () => {
  const link = location.origin + '/?room=' + roomCode;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
    () => toast('Invite link copied!'),
    () => toast('Room code: ' + roomCode));
};
$('btnExit').onclick = () => {
  if (ws) { try { ws.close(); } catch {} }
  location.href = location.origin;
};
$('btnVoid').onclick = () => {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: 'addBot' })); toast('VOID has entered the arena \ud83e\udd16'); $('btnVoid').style.display = 'none'; }
};
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- banner / hud / killfeed ----------
function showBanner(text, color, sub) {
  $('banner').style.display = 'flex';
  $('bannerText').textContent = text;
  $('bannerText').style.color = color ? COLORS[color] : '#fff';
  $('bannerSub').textContent = sub || '';
  $('bannerText').dataset.waiting = text.startsWith('WAITING') ? '1' : '0';
}
function hideBanner() { $('banner').style.display = 'none'; }
// weapon card
let cardWeapon = null;
function updateWeaponCard(me) {
  const w = me && me.al ? me.w : null;
  const card = $('weaponCard');
  const key = w ? w + ':' + (me.am || 0) : null;
  if (key === cardWeapon) return;
  cardWeapon = key;
  if (!w || !WEAPON_INFO[w]) { card.classList.remove('show'); return; }
  const info = WEAPON_INFO[w];
  card.querySelector('.wIcon').textContent = info.icon;
  card.querySelector('.wName').textContent = info.name;
  card.querySelector('.wDesc').textContent = info.desc;
  const ammoDiv = card.querySelector('.wAmmo');
  const maxAmmo = { mine: 3, triple: 3, shotgun: 2 }[w];
  ammoDiv.innerHTML = maxAmmo ? Array.from({ length: maxAmmo }, (_, i) => `<i class="${i < (me.am || 0) ? '' : 'off'}"></i>`).join('') : '';
  card.classList.add('show');
}

let lastScores = {};
function updateHud(m) {
  const bar = $('topbar');
  const html = m.tanks.map(t => {
    const bumped = lastScores[t.c] !== undefined && lastScores[t.c] !== t.s;
    lastScores[t.c] = t.s;
    return `<div class="scorecard ${t.c === myColor ? 'me' : ''} ${bumped ? 'bump' : ''}">
      <div class="dot" style="background:${COLORS[t.c]}">${t.al ? '' : '✕'}</div>
      ${esc(t.n)} <span class="pts">★${t.s}</span></div>`;
  }).join('');
  if (bar._last !== html) { bar.innerHTML = html; bar._last = html; }
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function killfeed(html) {
  const kf = document.createElement('div');
  kf.className = 'kf'; kf.innerHTML = html;
  $('killfeed').prepend(kf);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => { kf.classList.add('out'); setTimeout(() => kf.remove(), 400); }, 4200);
}

// ---------- server events -> local juice ----------
function handleEvents(events) {
  for (const ev of events) {
    if (ev.e === 'shot') {
      muzzleFlash(ev.x, ev.y, ev.a, ev.c);
      sfx(ev.w === 'gatling' ? 'gatling' : 'shot');
    } else if (ev.e === 'kill') {
      explode(ev.x, ev.y, COLORS[ev.vc] || '#fff', 42);
      shake = Math.max(shake, 14); sfx('boom');
      if (ev.killer) killfeed(`<span style="color:${COLORS[ev.kc]}">${esc(ev.killer)}</span> 💥 <span style="color:${COLORS[ev.vc]}">${esc(ev.victim)}</span>`);
      else killfeed(`<span style="color:${COLORS[ev.vc]}">${esc(ev.victim)}</span> 💀 self-destructed`);
    } else if (ev.e === 'boom') {
      explode(ev.x, ev.y, '#ffab40', 30); shake = Math.max(shake, 10); sfx('boom');
    } else if (ev.e === 'laser') { sfx('laser'); shake = Math.max(shake, 6); }
    else if (ev.e === 'pickup') {
      sfx('pickup'); ringBurst(ev.x, ev.y, COLORS[ev.c]);
      floaters.push({ x: ev.x, y: ev.y, text: ev.w.toUpperCase(), t: 1.2, color: COLORS[ev.c] });
    } else if (ev.e === 'coin') {
      sfx('pickup'); ringBurst(ev.x, ev.y, '#ffd24d');
      floaters.push({ x: ev.x, y: ev.y, text: '+5 \ud83e\ude99', t: 1.4, color: '#ffd24d' });
      if (ev.c === myColor) { addCoins(5); }
    } else if (ev.e === 'bounce') {
      sparks(ev.x, ev.y, 4); if (Math.random() < 0.4) sfx('bounce');
    } else if (ev.e === 'shieldPop') {
      ringBurst(ev.x, ev.y, '#7adcff'); sfx('bounce');
    } else if (ev.e === 'join') { killfeed(`<span style="color:${COLORS[ev.c]}">${esc(ev.n)}</span> joined ⚔`); }
    else if (ev.e === 'leave') { killfeed(`<span style="color:${COLORS[ev.c]}">${esc(ev.n)}</span> left`); }
    else if (ev.e === 'minePlace') { sfx('bounce'); }
  }
}

// ---------- particles ----------
function explode(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.6, maxLife: 1,
      size: 2 + Math.random() * 4, color: Math.random() < 0.5 ? color : (Math.random() < 0.5 ? '#ffab40' : '#ffe0a0'),
      drag: 0.92, glow: true,
    });
  }
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, sp = 15 + Math.random() * 50;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.9 + Math.random() * 0.7, maxLife: 1.6, size: 6 + Math.random() * 8, color: 'smoke', drag: 0.95 });
  }
}
function sparks(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 120;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.25, maxLife: 0.45, size: 1.5 + Math.random() * 1.5, color: '#ffd890', drag: 0.9, glow: true });
  }
}
function muzzleFlash(x, y, a, c) {
  const mx = x + Math.cos(a) * 22, my = y + Math.sin(a) * 22;
  for (let i = 0; i < 7; i++) {
    const da = a + (Math.random() - 0.5) * 0.7, sp = 60 + Math.random() * 160;
    particles.push({ x: mx, y: my, vx: Math.cos(da) * sp, vy: Math.sin(da) * sp, life: 0.12 + Math.random() * 0.12, maxLife: 0.24, size: 2 + Math.random() * 3, color: i < 3 ? '#fff3c0' : '#ffab40', drag: 0.85, glow: true });
  }
  particles.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.09, maxLife: 0.09, size: 13, color: '#fff8e0', drag: 1, glow: true });
}
function ringBurst(x, y, color) {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    particles.push({ x, y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 0.4, maxLife: 0.4, size: 3, color, drag: 0.88, glow: true });
  }
}
function confetti() {
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * (maze ? maze.W : 800), y: -10 - Math.random() * 60,
      vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 120,
      life: 1.8 + Math.random(), maxLife: 2.8, size: 3 + Math.random() * 3,
      color: Object.values(COLORS)[Math.floor(Math.random() * 6)], drag: 0.99,
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= p.drag; p.vy *= p.drag;
    if (p.color === 'smoke') p.vy -= 20 * dt;
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    floaters[i].t -= dt; floaters[i].y -= 28 * dt;
    if (floaters[i].t <= 0) floaters.splice(i, 1);
  }
  for (let i = treadMarks.length - 1; i >= 0; i--) {
    treadMarks[i].t -= dt * 0.25;
    if (treadMarks[i].t <= 0) treadMarks.splice(i, 1);
  }
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 40);
    shakeX = (Math.random() - 0.5) * shake; shakeY = (Math.random() - 0.5) * shake;
  } else { shakeX = shakeY = 0; }
}

// ---------- input ----------
const keys = {};
let touchState = { active: false, a: 0, t: 0 };
let firePressed = false, inputSeq = 0;
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ' || e.key.toLowerCase() === 'm') firePressed = true;
});
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === ' ' || e.key.toLowerCase() === 'm') firePressed = false;
});

// ---------- dynamic touch zones ----------
// Left half of screen: touch anywhere, joystick appears under the finger.
// Right half: touch anywhere to fire. No tiny buttons to miss.
const joyBase = $('joyBase'), fireHint = $('fireHint');
let joyTouchId = null, fireTouchId = null;
let joyOrigin = { x: 0, y: 0 };
const JOY_RADIUS = 60;
function updateJoy(tx, ty) {
  let dx = tx - joyOrigin.x, dy = ty - joyOrigin.y;
  const d = Math.hypot(dx, dy);
  // joystick follows finger if dragged beyond radius (feels natural while running)
  if (d > JOY_RADIUS) {
    joyOrigin.x = tx - dx / d * JOY_RADIUS;
    joyOrigin.y = ty - dy / d * JOY_RADIUS;
    joyBase.style.left = joyOrigin.x + 'px';
    joyBase.style.top = joyOrigin.y + 'px';
    dx = tx - joyOrigin.x; dy = ty - joyOrigin.y;
  }
  const kd = Math.min(Math.hypot(dx, dy), JOY_RADIUS);
  const ka = Math.atan2(dy, dx);
  $('joyKnob').style.transform = `translate(calc(-50% + ${Math.cos(ka) * kd}px), calc(-50% + ${Math.sin(ka) * kd}px))`;
  touchState.active = kd > JOY_RADIUS * 0.12;
  touchState.a = ka;
  touchState.t = Math.min(kd / (JOY_RADIUS * 0.85), 1);
}
function startJoy(t) {
  joyTouchId = t.identifier;
  joyOrigin = { x: t.clientX, y: t.clientY };
  joyBase.style.left = t.clientX + 'px';
  joyBase.style.top = t.clientY + 'px';
  joyBase.style.display = 'block';
  $('zoneL').style.display = 'none';
  updateJoy(t.clientX, t.clientY);
}
function resetJoy() {
  joyTouchId = null; touchState.active = false; touchState.t = 0;
  joyBase.style.display = 'none';
  $('joyKnob').style.transform = 'translate(-50%, -50%)';
}
document.addEventListener('touchstart', e => {
  audio();
  if ($('menu').style.display !== 'none') return;
  // let UI buttons (exit, room code) receive normal taps
  const el = e.target;
  if (el.closest && (el.closest('#btnExit') || el.closest('#roomTag'))) return;
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2) {
      if (joyTouchId === null) startJoy(t);
    } else {
      if (fireTouchId === null) {
        fireTouchId = t.identifier; firePressed = true;
        fireHint.classList.add('pressed');
        $('zoneR').style.display = 'none';
      }
    }
  }
  if (e.cancelable) e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => {
  if ($('menu').style.display !== 'none') return;
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === joyTouchId) updateJoy(t.clientX, t.clientY);
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) resetJoy();
    if (t.identifier === fireTouchId) { fireTouchId = null; firePressed = false; fireHint.classList.remove('pressed'); }
  }
  if (e.touches.length === 0) { resetJoy(); if (fireTouchId !== null) { fireTouchId = null; firePressed = false; fireHint.classList.remove('pressed'); } }
}
document.addEventListener('touchend', touchEnd);
document.addEventListener('touchcancel', touchEnd);

setInterval(() => {
  if (!ws || ws.readyState !== 1 || !myColor) return;
  inputSeq++;
  if (touchState.active) {
    ws.send(JSON.stringify({ type: 'input', seq: inputSeq, vec: true, a: +touchState.a.toFixed(3), t: +touchState.t.toFixed(2), fire: firePressed }));
  } else {
    const up = keys['w'] || keys['arrowup'], down = keys['s'] || keys['arrowdown'];
    const left = keys['a'] || keys['arrowleft'], right = keys['d'] || keys['arrowright'];
    ws.send(JSON.stringify({ type: 'input', seq: inputSeq, move: (up ? 1 : 0) - (down ? 1 : 0), turn: (right ? 1 : 0) - (left ? 1 : 0), fire: firePressed }));
  }
}, 25);

// ---------- interpolation ----------
function interpolatedState() {
  if (!snapBuf.length) return null;
  const renderTime = performance.now() - INTERP_DELAY;
  let a = null, b = null;
  for (let i = snapBuf.length - 1; i >= 0; i--) {
    if (snapBuf[i].rt <= renderTime) { a = snapBuf[i]; b = snapBuf[i + 1] || null; break; }
  }
  if (!a) return snapBuf[0];
  if (!b) return a;
  const f = Math.min(1, (renderTime - a.rt) / Math.max(1, b.rt - a.rt));
  const tanks = b.tanks.map(t => {
    const p = a.tanks.find(q => q.c === t.c);
    if (!p || !t.al || !p.al) return t;
    let da = t.a - p.a;
    if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    return { ...t, x: p.x + (t.x - p.x) * f, y: p.y + (t.y - p.y) * f, a: p.a + da * f };
  });
  // bullets: interpolate by id, extrapolate new ones by velocity
  const bullets = b.bullets.map(bl => {
    const p = a.bullets.find(q => q.id === bl.id);
    if (p) return { ...bl, x: p.x + (bl.x - p.x) * f, y: p.y + (bl.y - p.y) * f };
    return bl;
  });
  return { ...b, tanks, bullets };
}

// ---------- rendering ----------
let view = { scale: 1, ox: 0, oy: 0 };
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

function computeView() {
  if (!maze) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const pad = 14 * dpr;
  const topPad = 52 * dpr;
  const botPad = isTouch ? 150 * dpr : 20 * dpr;
  const availW = canvas.width - pad * 2;
  const availH = canvas.height - topPad - botPad;
  view.scale = Math.min(availW / maze.W, availH / maze.H);
  view.ox = (canvas.width - maze.W * view.scale) / 2 + shakeX * view.scale;
  view.oy = topPad + Math.max(0, (availH - maze.H * view.scale) / 2) + shakeY * view.scale;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const SKIN_BODY = { gold: ['#ffe9a0', '#d9a916', '#8f6d0a'], camo: ['#8fa86b', '#5a6b3f', '#39482a'], neon: ['#8ffff5', '#19d3c5', '#0d8a80'], dark: ['#585d72', '#2c2f3c', '#16181f'], ice: ['#e8f4fc', '#9cc8e8', '#5f8fb4'] };

function drawTank(t, dt) {
  let col = COLORS[t.c], dark = DARK[t.c], light = LIGHT[t.c];
  if (t.sk && SKIN_BODY[t.sk]) { [light, col, dark] = SKIN_BODY[t.sk]; }
  const recoil = t.rc || 0;
  // tread marks while moving
  const key = t.c;
  const prev = drawTank._prev = drawTank._prev || {};
  if (prev[key] && (Math.abs(prev[key].x - t.x) > 0.7 || Math.abs(prev[key].y - t.y) > 0.7)) {
    if (Math.random() < 0.5) {
      const px = Math.cos(t.a + Math.PI / 2) * 9, py = Math.sin(t.a + Math.PI / 2) * 9;
      treadMarks.push({ x: t.x + px, y: t.y + py, a: t.a, t: 0.5 });
      treadMarks.push({ x: t.x - px, y: t.y - py, a: t.a, t: 0.5 });
      if (treadMarks.length > 400) treadMarks.splice(0, 2);
    }
  }
  prev[key] = { x: t.x, y: t.y };

  ctx.save();
  ctx.translate(t.x, t.y);
  if (t.gh) ctx.globalAlpha = t.c === myColor ? 0.35 : 0;
  // shadow
  ctx.save();
  ctx.translate(2, 3);
  ctx.rotate(t.a);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(-13, -12, 26, 24, 4); ctx.fill();
  ctx.restore();
  ctx.rotate(t.a);
  // treads with animated links
  ctx.fillStyle = '#23262e';
  roundRect(-13, -13, 27, 6.5, 2.5); ctx.fill();
  roundRect(-13, 6.5, 27, 6.5, 2.5); ctx.fill();
  const moving = prev[key + '_m'] || 0;
  const off = (performance.now() / 40) % 6;
  ctx.fillStyle = '#3d4250';
  for (let i = 0; i < 5; i++) {
    const lx = -12 + i * 6 + (t.sp ? (off) : (off * 0.6));
    if (lx < 13) { ctx.fillRect(lx % 26 - 13 < -13 ? lx : lx, -12.4, 2.4, 5.2); ctx.fillRect(lx, 7.1, 2.4, 5.2); }
  }
  // hull with gradient
  const hg = ctx.createLinearGradient(0, -10, 0, 10);
  hg.addColorStop(0, light); hg.addColorStop(0.5, col); hg.addColorStop(1, dark);
  ctx.fillStyle = hg;
  roundRect(-11.5, -9.5, 23, 19, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  // hull details
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(-9, -7.5, 4, 15);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-11.5, -9.5, 23, 2.5);
  // barrel (recoils back on fire)
  const bx = -recoil * 4;
  const bg = ctx.createLinearGradient(0, -3, 0, 3);
  bg.addColorStop(0, '#4a4f5c'); bg.addColorStop(0.5, '#6a7080'); bg.addColorStop(1, '#3a3e48');
  ctx.fillStyle = bg;
  ctx.fillRect(bx + 4, -2.6, 19, 5.2);
  ctx.fillStyle = '#2e323c';
  ctx.fillRect(bx + 20, -3.2, 3.5, 6.4); // muzzle brake
  // turret
  const tg = ctx.createRadialGradient(-1.5, -2, 1, 0, 0, 9);
  tg.addColorStop(0, light); tg.addColorStop(0.7, col); tg.addColorStop(1, dark);
  ctx.beginPath(); ctx.arc(bx * 0.4, 0, 7.5, 0, Math.PI * 2); ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
  // hatch
  ctx.beginPath(); ctx.arc(bx * 0.4 - 1.5, 0, 3.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
  ctx.restore();

  // speed boost flames
  if (t.sp) {
    for (let i = 0; i < 2; i++) {
      const fa = t.a + Math.PI + (Math.random() - 0.5) * 0.5;
      particles.push({ x: t.x + Math.cos(t.a + Math.PI) * 14, y: t.y + Math.sin(t.a + Math.PI) * 14, vx: Math.cos(fa) * 70, vy: Math.sin(fa) * 70, life: 0.22, maxLife: 0.22, size: 2.5, color: i ? '#ffab40' : '#4d9fff', drag: 0.9, glow: true });
    }
  }
  // shield bubble
  if (t.sh) {
    const pulse = Math.sin(performance.now() / 160) * 2;
    const sg = ctx.createRadialGradient(t.x, t.y, 12, t.x, t.y, 22 + pulse);
    sg.addColorStop(0, 'rgba(120,220,255,0)'); sg.addColorStop(0.8, 'rgba(120,220,255,0.12)'); sg.addColorStop(1, 'rgba(140,230,255,0.55)');
    ctx.beginPath(); ctx.arc(t.x, t.y, 22 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = 'rgba(150,235,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // weapon badge
  if (t.w) {
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    const label = WEAPON_LABEL[t.w] || t.w.toUpperCase();
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(10,14,28,0.8)';
    roundRect(t.x - tw / 2, t.y - 33, tw, 14, 7); ctx.fill();
    ctx.fillStyle = '#ffd24d';
    ctx.fillText(label, t.x, t.y - 23);
  }
  // name (VOID gets a glitchy purple tag)
  ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
  if (t.bot) {
    ctx.fillStyle = '#b06dff';
    ctx.shadowColor = '#b06dff'; ctx.shadowBlur = 6;
    ctx.fillText('◆ VOID ◆', t.x, t.y + 31);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(t.n, t.x, t.y + 31);
  }
}
const WEAPON_LABEL = { laser: '⚡ LASER', missile: '🚀 MISSILE', gatling: '🔫 GATLING', frag: '💣 FRAG', mine: '☢ MINES', triple: '⋔ TRIPLE', shotgun: '💥 SHOTGUN', bigshot: '⬤ CANNON' };
const WEAPON_INFO = {
  laser: { icon: '⚡', name: 'LASER', desc: 'Instant beam that bounces off walls. Aim with the red preview line!' },
  missile: { icon: '🚀', name: 'HOMING MISSILE', desc: 'Flies straight, then hunts the NEAREST tank. Even you — run!' },
  gatling: { icon: '🔫', name: 'GATLING', desc: 'Hold fire to spray a stream of bullets.' },
  frag: { icon: '💣', name: 'FRAG BOMB', desc: 'Explodes into a deadly ring of shrapnel.' },
  mine: { icon: '☢', name: 'MINES ×3', desc: 'Drop hidden traps behind you. They arm after 1s.' },
  triple: { icon: '⋔', name: 'TRIPLE SHOT ×3', desc: 'Fires 3 bullets in a spread.' },
  shotgun: { icon: '💥', name: 'SHOTGUN ×2', desc: 'Devastating blast of 6 pellets. Short range.' },
  bigshot: { icon: '⬤', name: 'HEAVY CANNON', desc: 'Slow, huge shell that bounces forever.' },
};
const PU_ICON = { laser: '⚡', missile: '🚀', gatling: '🔫', frag: '💣', shield: '🛡', mine: '☢', triple: '⋔', speed: '»', ghost: '👻', shotgun: '💥', bigshot: '⬤' };
const PU_COLOR = { laser: '#ffd24d', missile: '#ff8a4d', gatling: '#b8c4e0', frag: '#ff6b6b', shield: '#7adcff', mine: '#ff4d5e', triple: '#3ddc84', speed: '#4d9fff', ghost: '#b06dff', shotgun: '#ff9d5c', bigshot: '#e0e6f5' };

// ---------- laser aim preview (client-side raycast) ----------
function rayRectHit(x, y, dx, dy, w, maxDist) {
  const x1 = w.x, x2 = w.x + w.w, y1 = w.y, y2 = w.y + w.h;
  let tmin = 0, tmax = maxDist, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-9) { if (x < x1 || x > x2) return null; }
  else {
    let t1 = (x1 - x) / dx, t2 = (x2 - x) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (y < y1 || y > y2) return null; }
  else {
    let t1 = (y1 - y) / dy, t2 = (y2 - y) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 1e-6) return null;
  return { t: tmin, nx, ny };
}
function laserPreviewPath(px, py, ang) {
  let x = px + Math.cos(ang) * 16, y = py + Math.sin(ang) * 16;
  let dx = Math.cos(ang), dy = Math.sin(ang);
  const pts = [{ x, y }];
  for (let bounce = 0; bounce < 7; bounce++) {
    let best = null;
    for (const w of maze.walls) {
      const h = rayRectHit(x, y, dx, dy, w, 4000);
      if (h && (!best || h.t < best.t)) best = h;
    }
    if (!best) { pts.push({ x: x + dx * 4000, y: y + dy * 4000 }); break; }
    x += dx * best.t; y += dy * best.t;
    pts.push({ x, y });
    if (best.nx !== 0) dx = -dx; else dy = -dy;
    x += dx * 0.5; y += dy * 0.5;
  }
  return pts;
}

let lastFrame = performance.now();
function draw() {
  requestAnimationFrame(draw);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  updateParticles(dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createRadialGradient(canvas.width / 2, canvas.height * 0.3, 100, canvas.width / 2, canvas.height / 2, canvas.width);
  bg.addColorStop(0, '#161c34'); bg.addColorStop(1, '#0b0e1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!maze || !latestSnap) return;
  computeView();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);

  // arena floor
  ctx.save();
  ctx.shadowColor = 'rgba(60,100,255,0.35)'; ctx.shadowBlur = 40;
  ctx.fillStyle = '#d9d4c5';
  ctx.fillRect(0, 0, maze.W, maze.H);
  ctx.restore();
  const fg = ctx.createLinearGradient(0, 0, maze.W, maze.H);
  fg.addColorStop(0, 'rgba(255,255,255,0.06)'); fg.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = fg; ctx.fillRect(0, 0, maze.W, maze.H);
  ctx.strokeStyle = 'rgba(0,0,0,0.045)'; ctx.lineWidth = 1;
  for (let c = 1; c < maze.cols; c++) { ctx.beginPath(); ctx.moveTo(c * 90, 0); ctx.lineTo(c * 90, maze.H); ctx.stroke(); }
  for (let r = 1; r < maze.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * 90); ctx.lineTo(maze.W, r * 90); ctx.stroke(); }

  // tread marks
  for (const tm of treadMarks) {
    ctx.save();
    ctx.translate(tm.x, tm.y); ctx.rotate(tm.a);
    ctx.fillStyle = `rgba(60,55,45,${tm.t * 0.25})`;
    ctx.fillRect(-2, -1, 4, 2);
    ctx.restore();
  }

  const s = interpolatedState();
  if (!s) return;

  // coins (rare golden pickups)
  for (const cd of s.coins || []) {
    const bob = Math.sin(performance.now() / 300 + cd.id) * 3;
    const spin = Math.abs(Math.sin(performance.now() / 350 + cd.id));
    ctx.save();
    ctx.translate(cd.x, cd.y + bob);
    const cg = ctx.createRadialGradient(0, 0, 2, 0, 0, 16);
    cg.addColorStop(0, 'rgba(255,215,80,0.8)'); cg.addColorStop(1, 'rgba(255,215,80,0)');
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fillStyle = cg; ctx.fill();
    ctx.scale(Math.max(0.25, spin), 1);
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24d'; ctx.fill();
    ctx.strokeStyle = '#b8871a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#b8871a'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 0.5);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';

  // mines
  for (const m of s.mines || []) {
    ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = m.armed ? '#3a2b2b' : '#555';
    ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke();
    if (m.armed && Math.sin(performance.now() / 200) > 0) {
      ctx.beginPath(); ctx.arc(m.x, m.y, 2.4, 0, Math.PI * 2); ctx.fillStyle = '#ff3040'; ctx.fill();
      ctx.shadowColor = '#ff3040'; ctx.shadowBlur = 8;
      ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  // powerups
  for (const pu of s.powerups) {
    const pulse = 1 + Math.sin(performance.now() / 230 + pu.id) * 0.1;
    const bob = Math.sin(performance.now() / 350 + pu.id) * 2.5;
    const pc = PU_COLOR[pu.type] || '#fff';
    ctx.save();
    ctx.translate(pu.x, pu.y + bob);
    ctx.scale(pulse, pulse);
    const gg = ctx.createRadialGradient(0, 0, 3, 0, 0, 18);
    gg.addColorStop(0, pc + 'cc'); gg.addColorStop(1, pc + '00');
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fillStyle = gg; ctx.fill();
    ctx.rotate(performance.now() / 900);
    roundRect(-11, -11, 22, 22, 6);
    ctx.fillStyle = 'rgba(14,18,36,0.9)'; ctx.fill();
    ctx.strokeStyle = pc; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.rotate(-performance.now() / 900);
    ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = pc;
    ctx.fillText(PU_ICON[pu.type] || '?', 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';

  // bullet trails
  for (const b of s.bullets) {
    let tr = bulletTrails.get(b.id);
    if (!tr) { tr = []; bulletTrails.set(b.id, tr); }
    tr.push({ x: b.x, y: b.y });
    if (tr.length > 8) tr.shift();
    if (tr.length > 1) {
      ctx.beginPath();
      ctx.moveTo(tr[0].x, tr[0].y);
      for (let i = 1; i < tr.length; i++) ctx.lineTo(tr[i].x, tr[i].y);
      ctx.strokeStyle = b.k === 'missile' ? 'rgba(255,150,60,0.5)' : 'rgba(40,40,50,0.28)';
      ctx.lineWidth = b.r * 1.1;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
  // prune dead trails
  if (Math.random() < 0.05) {
    const liveIds = new Set(s.bullets.map(b => b.id));
    for (const id of bulletTrails.keys()) if (!liveIds.has(id)) bulletTrails.delete(id);
  }

  // bullets
  for (const b of s.bullets) {
    ctx.save();
    if (b.k === 'missile') {
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = '#d8dce6';
      roundRect(-7, -3, 12, 6, 2); ctx.fill();
      ctx.fillStyle = '#ff5544';
      ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(9, 0); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a8f9c';
      ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-10, -5); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-7, 3); ctx.lineTo(-10, 5); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
      // exhaust
      particles.push({ x: b.x - Math.cos(Math.atan2(b.vy, b.vx)) * 9, y: b.y - Math.sin(Math.atan2(b.vy, b.vx)) * 9, vx: (Math.random() - .5) * 20, vy: (Math.random() - .5) * 20, life: 0.3, maxLife: 0.3, size: 3, color: 'smoke', drag: 0.94 });
    } else {
      const grad = ctx.createRadialGradient(b.x - 1, b.y - 1, 0.5, b.x, b.y, b.r + 1);
      if (b.k === 'frag') { grad.addColorStop(0, '#666'); grad.addColorStop(1, '#1a1a1a'); }
      else if (b.k === 'shard') { grad.addColorStop(0, LIGHT[b.c] || '#999'); grad.addColorStop(1, DARK[b.c] || '#333'); }
      else if (b.k === 'bigshot') { grad.addColorStop(0, '#8a92a8'); grad.addColorStop(0.6, '#3c4254'); grad.addColorStop(1, '#12141c'); }
      else { grad.addColorStop(0, '#555'); grad.addColorStop(1, '#111'); }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      if (b.k === 'bigshot') {
        ctx.strokeStyle = 'rgba(255,180,80,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2 + Math.sin(performance.now() / 90) * 1.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // tanks (ghost = invisible to everyone else)
  for (const t of s.tanks) {
    if (!t.al) continue;
    if (t.gh && t.c !== myColor) continue; // fully invisible to other players
    drawTank(t, dt);
  }

  // laser aim preview for me
  const meT = s.tanks.find(t => t.c === myColor);
  updateWeaponCard(meT);
  if (meT && meT.al && meT.w === 'laser') {
    const pts = laserPreviewPath(meT.x, meT.y, meT.a);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.setLineDash([6, 7]);
    ctx.lineDashOffset = -(performance.now() / 22) % 13;
    ctx.strokeStyle = 'rgba(255,80,90,0.65)';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(255,80,90,0.8)'; ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.setLineDash([]);
    // bounce markers
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,110,120,0.9)'; ctx.fill();
    }
    ctx.restore();
  }

  // server effects (laser beams etc)
  for (const e of s.effects) {
    if (e.kind === 'laser') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(e.pts[0].x, e.pts[0].y);
      for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i].x, e.pts[i].y);
      const alpha = Math.min(1, e.t / 0.25);
      ctx.strokeStyle = COLORS[e.color] || '#fff';
      ctx.lineWidth = 2.5 + Math.random() * 1.5;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = COLORS[e.color] || '#fff'; ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.lineWidth = 9; ctx.globalAlpha = alpha * 0.25; ctx.stroke();
      ctx.restore();
    } else if (e.kind === 'explosion') {
      const dur = e.big ? 0.9 : 0.5;
      const p = 1 - e.t / dur;
      const rad = (e.big ? 12 : 8) + p * (e.big ? 38 : 24);
      const eg = ctx.createRadialGradient(e.x, e.y, 1, e.x, e.y, rad);
      eg.addColorStop(0, `rgba(255,240,180,${(1 - p) * 0.9})`);
      eg.addColorStop(0.4, `rgba(255,${150 - p * 90},40,${(1 - p) * 0.7})`);
      eg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.beginPath(); ctx.arc(e.x, e.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = eg; ctx.fill();
    } else if (e.kind === 'shieldPop') {
      ctx.beginPath(); ctx.arc(e.x, e.y, 20 + (0.4 - e.t) * 50, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,220,255,${e.t / 0.4})`; ctx.lineWidth = 3; ctx.stroke();
    }
  }

  // local particles
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    if (p.color === 'smoke') {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,120,130,${a * 0.25})`; ctx.fill();
    } else {
      ctx.globalAlpha = a;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  // floaters
  for (const f of floaters) {
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, f.t);
    ctx.fillStyle = f.color;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    ctx.fillText(f.text, f.x, f.y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // walls on top with bevel
  for (const w of maze.walls) {
    ctx.fillStyle = '#2b3044';
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  for (const w of maze.walls) {
    ctx.fillStyle = '#454c66';
    ctx.fillRect(w.x, w.y, w.w, Math.min(2.5, w.h));
    ctx.fillRect(w.x, w.y, Math.min(2.5, w.w), w.h);
  }
}
requestAnimationFrame(draw);

// ---------- menu background animation ----------
const mc = $('menuCanvas'), mctx = mc.getContext('2d');
const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.4, v: Math.random() * 0.35 + 0.08 }));
function menuLoop() {
  if ($('menu').style.display === 'none') return;
  requestAnimationFrame(menuLoop);
  mc.width = innerWidth; mc.height = innerHeight;
  for (const st of stars) {
    st.y += st.v / 700;
    if (st.y > 1) { st.y = 0; st.x = Math.random(); }
    mctx.beginPath();
    mctx.arc(st.x * mc.width, st.y * mc.height, st.s, 0, Math.PI * 2);
    mctx.fillStyle = `rgba(150,175,255,${0.25 + st.s * 0.25})`;
    mctx.fill();
  }
}
menuLoop();
})();
