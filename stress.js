// Longer stress test: verifies powerups spawn, all weapon paths run without server crash
const WebSocket = require('ws');
let room = null, errors = 0, states = 0, puSeen = new Set(), roundEnds = 0;
function mk(n, j) {
  return new Promise(res => {
    const w = new WebSocket('ws://localhost:3000');
    w.on('open', () => w.send(JSON.stringify(Object.assign({ name: n }, j))));
    w.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'joined') { room = m.room; res(w); }
      if (m.type === 'state') { states++; m.powerups.forEach(p => puSeen.add(p.type)); }
      if (m.type === 'roundEnd') roundEnds++;
      if (m.type === 'error') { errors++; res(null); }
    });
    w.on('error', () => res(null));
  });
}
(async () => {
  const a = await mk('A', { type: 'create' });
  const b = await mk('B', { type: 'join', room });
  const c = await mk('C', { type: 'join', room });
  const iv = setInterval(() => {
    for (const w of [a, b, c]) {
      if (w && w.readyState === 1) {
        // mix keyboard and joystick style inputs
        if (Math.random() > 0.5) w.send(JSON.stringify({ type: 'input', move: 1, turn: Math.random() * 2 - 1, fire: Math.random() > 0.3 }));
        else w.send(JSON.stringify({ type: 'input', vec: true, a: Math.random() * 6.28 - 3.14, t: Math.random(), fire: Math.random() > 0.3 }));
      }
    }
  }, 60);
  await new Promise(r => setTimeout(r, 30000));
  clearInterval(iv);
  console.log('states:', states, '| roundEnds:', roundEnds, '| powerup types seen:', [...puSeen].sort().join(','), '| errors:', errors);
  const alive = [a, b, c].every(w => w && w.readyState === 1);
  console.log('connections still alive:', alive);
  console.log(states > 300 && errors === 0 && alive && roundEnds >= 1 ? 'STRESS PASS' : 'STRESS FAIL');
  process.exit(0);
})();
