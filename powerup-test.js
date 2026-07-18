// Powerup test: 3 idle players, verify powerups spawn, get picked up, weapons fire
const WebSocket = require('ws');
let room = null, states = 0, puSeen = new Set(), weaponsHeld = new Set(), effectsSeen = new Set();
function mk(n, j) {
  return new Promise(res => {
    const w = new WebSocket('ws://localhost:3000');
    w.on('open', () => w.send(JSON.stringify(Object.assign({ name: n }, j))));
    w.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'joined') { room = m.room; w.color = m.color; res(w); }
      if (m.type === 'state') {
        states++;
        w.lastState = m;
        m.powerups.forEach(p => puSeen.add(p.type));
        m.tanks.forEach(t => { if (t.w) weaponsHeld.add(t.w); });
        m.effects.forEach(e => effectsSeen.add(e.kind));
      }
      if (m.type === 'error') res(null);
    });
    w.on('error', () => res(null));
  });
}
(async () => {
  const a = await mk('A', { type: 'create' });
  const b = await mk('B', { type: 'join', room });
  const c = await mk('C', { type: 'join', room });
  // drive toward nearest powerup, fire once holding a weapon
  const iv = setInterval(() => {
    for (const w of [a, b, c]) {
      if (!w || w.readyState !== 1 || !w.lastState) continue;
      const me = w.lastState.tanks.find(t => t.c === w.color);
      if (!me || !me.al) continue;
      const pus = w.lastState.powerups;
      if (me.w) {
        // has weapon: fire it
        w.send(JSON.stringify({ type: 'input', move: 0, turn: 0, fire: true }));
        setTimeout(() => { if (w.readyState === 1) w.send(JSON.stringify({ type: 'input', move: 0, turn: 0, fire: false })); }, 100);
      } else if (pus.length) {
        // steer toward powerup with joystick-style input
        let best = pus[0], bd = Infinity;
        for (const p of pus) { const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2; if (d < bd) { bd = d; best = p; } }
        const ang = Math.atan2(best.y - me.y, best.x - me.x);
        w.send(JSON.stringify({ type: 'input', vec: true, a: ang, t: 1, fire: false }));
      } else {
        w.send(JSON.stringify({ type: 'input', move: 0, turn: 0.3, fire: false }));
      }
    }
  }, 120);
  await new Promise(r => setTimeout(r, 45000));
  clearInterval(iv);
  console.log('states:', states);
  console.log('powerup types spawned:', [...puSeen].sort().join(',') || 'NONE');
  console.log('weapons held by tanks:', [...weaponsHeld].sort().join(',') || 'NONE');
  console.log('effects seen:', [...effectsSeen].sort().join(',') || 'NONE');
  const pass = puSeen.size >= 3 && weaponsHeld.size >= 1;
  console.log(pass ? 'POWERUP PASS' : 'POWERUP FAIL');
  process.exit(0);
})();
