// Tank Trouble Online - client
(() => {
const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const COLORS = { red: '#ff5555', green: '#55dd55', blue: '#5599ff' };
const DARK = { red: '#aa2222', green: '#228822', blue: '#2255bb' };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

let ws = null, myColor = null, maze = null, state = null, roomCode = '';
let lastState = null, lastStateTime = 0, prevState = null, prevStateTime = 0;

// ---------- connection ----------
function connect(msg) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify(msg));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') {
      myColor = m.color; maze = m.maze; roomCode = m.room;
      $('menu').style.display = 'none';
      $('hud').style.display = 'flex';
      $('roomTag').style.display = 'block';
      $('roomTag').textContent = 'Room: ' + roomCode;
      if (isTouch) $('touchUI').style.display = 'block';
      else $('helpKeys').style.display = 'block';
      resize();
    } else if (m.type === 'error') {
      $('menuMsg').textContent = m.msg;
      ws.close(); ws = null;
    } else if (m.type === 'round') {
      maze = m.maze; hideBanner();
    } else if (m.type === 'roundEnd') {
      showBanner(m.winner ? `${m.winner.toUpperCase()} wins the round!` : 'Draw!', m.winner);
    } else if (m.type === 'state') {
      prevState = lastState; prevStateTime = lastStateTime;
      lastState = m; lastStateTime = performance.now();
      state = m;
      updateHud(m);
      if (m.waiting) showBanner('Waiting for players…\nShare room code: ' + roomCode, null);
      else if ($('banner').dataset.waiting === '1') hideBanner();
    }
  };
  ws.onclose = () => {
    if (myColor) { showBanner('Disconnected. Reload to rejoin.', null); }
  };
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
  msg.name = $('nameInput').value.trim() || 'Player';
  $('menuMsg').textContent = 'Connecting…';
  connect(msg);
}

// ---------- banner / hud ----------
function showBanner(text, color) {
  const b = $('banner');
  b.style.display = 'block';
  b.style.color = color ? COLORS[color] : '#fff';
  b.textContent = text;
  b.dataset.waiting = text.startsWith('Waiting') ? '1' : '0';
}
function hideBanner() { $('banner').style.display = 'none'; }
function updateHud(m) {
  $('hud').innerHTML = m.tanks.map(t =>
    `<div class="score" style="color:${COLORS[t.c]}">${t.c === myColor ? '▶ ' : ''}${esc(t.n)}: ${t.s}</div>`).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- input ----------
const keys = {};
let touchState = { active: false, a: 0, t: 0 };
let firePressed = false;
window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ' || e.key.toLowerCase() === 'm') firePressed = true;
});
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === ' ' || e.key.toLowerCase() === 'm') firePressed = false;
});

// joystick
const joyBase = $('joyBase'), joyKnob = $('joyKnob');
let joyTouchId = null;
function joyCenter() { const r = joyBase.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width / 2 }; }
function handleJoy(tx, ty) {
  const c = joyCenter();
  let dx = tx - c.x, dy = ty - c.y;
  const d = Math.hypot(dx, dy), max = c.rad;
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  joyKnob.style.left = (65 - 25 + dx) + 'px';
  joyKnob.style.top = (65 - 25 + dy) + 'px';
  touchState.active = d > max * 0.18;
  touchState.a = Math.atan2(dy, dx);
  touchState.t = Math.min(d / max, 1);
}
function resetJoy() {
  joyTouchId = null; touchState.active = false; touchState.t = 0;
  joyKnob.style.left = '40px'; joyKnob.style.top = '40px';
}
document.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if ((el === joyBase || el === joyKnob) && joyTouchId === null) { joyTouchId = t.identifier; handleJoy(t.clientX, t.clientY); }
    else if (el === $('btnFire')) firePressed = true;
  }
}, { passive: false });
document.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === joyTouchId) handleJoy(t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) resetJoy();
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el === $('btnFire')) firePressed = false;
  }
  // safety: if no touches on fire button remain
  if (e.touches.length === 0) firePressed = keys[' '] || keys['m'] || false;
});

// send input 30 Hz
setInterval(() => {
  if (!ws || ws.readyState !== 1 || !myColor) return;
  if (touchState.active) {
    ws.send(JSON.stringify({ type: 'input', vec: true, a: touchState.a, t: touchState.t, fire: firePressed }));
  } else {
    const up = keys['w'] || keys['arrowup'], down = keys['s'] || keys['arrowdown'];
    const left = keys['a'] || keys['arrowleft'], right = keys['d'] || keys['arrowright'];
    ws.send(JSON.stringify({
      type: 'input',
      move: (up ? 1 : 0) - (down ? 1 : 0),
      turn: (right ? 1 : 0) - (left ? 1 : 0),
      fire: firePressed,
    }));
  }
}, 33);

// ---------- rendering ----------
let view = { scale: 1, ox: 0, oy: 0 };
function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

function computeView() {
  if (!maze) return;
  const pad = 20 * devicePixelRatio;
  const availW = canvas.width - pad * 2;
  const availH = canvas.height - pad * 2 - (isTouch ? 120 * devicePixelRatio : 0);
  view.scale = Math.min(availW / maze.W, availH / maze.H);
  view.ox = (canvas.width - maze.W * view.scale) / 2;
  view.oy = pad + Math.max(0, (availH - maze.H * view.scale) / 2) + 30 * devicePixelRatio * 0.5;
}

// interpolation between snapshots
function lerpState() {
  if (!lastState) return null;
  if (!prevState) return lastState;
  const dt = lastStateTime - prevStateTime || 50;
  let f = (performance.now() - lastStateTime) / dt;
  f = Math.max(0, Math.min(f, 1.2));
  const tanks = lastState.tanks.map(t => {
    const p = prevState.tanks.find(q => q.c === t.c);
    if (!p || !t.al || !p.al) return t;
    let da = t.a - p.a;
    if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    return { ...t, x: p.x + (t.x - p.x) * f, y: p.y + (t.y - p.y) * f, a: p.a + da * f };
  });
  return { ...lastState, tanks };
}

function drawTank(t) {
  const col = COLORS[t.c], dark = DARK[t.c];
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.a);
  // treads
  ctx.fillStyle = dark;
  ctx.fillRect(-12, -13, 24, 5);
  ctx.fillRect(-12, 8, 24, 5);
  // body
  ctx.fillStyle = col;
  ctx.fillRect(-11, -9, 22, 18);
  // barrel
  ctx.fillStyle = dark;
  ctx.fillRect(0, -2.5, 20, 5);
  // turret
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fillStyle = dark; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.restore();
  // shield ring
  if (t.sh) {
    ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,220,255,0.8)'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  // weapon indicator
  if (t.w) {
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffdd55';
    ctx.fillText(WEAPON_ICON[t.w] || t.w, t.x, t.y - 22);
  }
  // name
  ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(t.n, t.x, t.y + 30);
}
const WEAPON_ICON = { laser: '⚡LASER', missile: '🚀MISSILE', gatling: '🔫GATLING', frag: '💣FRAG' };
const PU_ICON = { laser: '⚡', missile: '🚀', gatling: '🔫', frag: '💣', shield: '🛡' };

function draw() {
  requestAnimationFrame(draw);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!maze || !lastState) return;
  computeView();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);

  // floor
  ctx.fillStyle = '#e8e4d8';
  ctx.fillRect(0, 0, maze.W, maze.H);
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
  for (let c = 1; c < maze.cols; c++) { ctx.beginPath(); ctx.moveTo(c * 90, 0); ctx.lineTo(c * 90, maze.H); ctx.stroke(); }
  for (let r = 1; r < maze.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * 90); ctx.lineTo(maze.W, r * 90); ctx.stroke(); }

  const s = lerpState();

  // powerups
  for (const pu of s.powerups) {
    const pulse = 1 + Math.sin(performance.now() / 250) * 0.12;
    ctx.save();
    ctx.translate(pu.x, pu.y); ctx.scale(pulse, pulse);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,220,80,0.25)'; ctx.fill();
    ctx.strokeStyle = '#cc9922'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(PU_ICON[pu.type] || '?', 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';

  // bullets
  for (const b of s.bullets) {
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    if (b.k === 'missile') { ctx.fillStyle = '#ff8800'; }
    else if (b.k === 'frag') { ctx.fillStyle = '#333'; }
    else if (b.k === 'shard') { ctx.fillStyle = DARK[b.c] || '#555'; }
    else ctx.fillStyle = '#222';
    ctx.fill();
    if (b.k === 'missile') {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3 + Math.random() * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,140,0,0.4)'; ctx.stroke();
    }
  }

  // tanks
  for (const t of s.tanks) if (t.al) drawTank(t);

  // effects
  for (const e of s.effects) {
    if (e.kind === 'laser') {
      ctx.beginPath();
      ctx.moveTo(e.pts[0].x, e.pts[0].y);
      for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i].x, e.pts[i].y);
      ctx.strokeStyle = COLORS[e.color] || '#fff';
      ctx.lineWidth = 3 + Math.random() * 2;
      ctx.globalAlpha = Math.min(1, e.t / 0.2);
      ctx.stroke();
      ctx.lineWidth = 8; ctx.globalAlpha *= 0.3; ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'explosion') {
      const p = 1 - e.t / 0.8;
      ctx.beginPath(); ctx.arc(e.x, e.y, 8 + p * 26, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${140 - p * 100},0,${1 - p})`; ctx.fill();
    } else if (e.kind === 'shieldPop') {
      ctx.beginPath(); ctx.arc(e.x, e.y, 20 + (0.4 - e.t) * 40, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,220,255,${e.t / 0.4})`; ctx.lineWidth = 3; ctx.stroke();
    }
  }

  // walls (drawn last so bullets appear to pass under edges cleanly)
  ctx.fillStyle = '#3a3a4a';
  for (const w of maze.walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
}
requestAnimationFrame(draw);
})();
