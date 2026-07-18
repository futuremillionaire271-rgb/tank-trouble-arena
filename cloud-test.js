// Full 6-player e2e against the cloud deployment
const https = require('https');
const WebSocket = require('ws');
const HOST = process.argv[2] || 'tank-trouble-arena-production.up.railway.app';
const results = { joined: [], states: 0, roundEnds: 0, colors: [] };
let roomCode = null;
function mk(n, j) {
  return new Promise(res => {
    const w = new WebSocket(`wss://${HOST}`);
    w.on('open', () => w.send(JSON.stringify(Object.assign({ name: n }, j))));
    w.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'joined') { results.joined.push(n); results.colors.push(m.color); roomCode = m.room; res(w); }
      if (m.type === 'state') results.states++;
      if (m.type === 'roundEnd') results.roundEnds++;
      if (m.type === 'error') res(null);
    });
    w.on('error', () => res(null));
  });
}
(async () => {
  const t0 = Date.now();
  const a = await mk('A', { type: 'create' });
  const others = [];
  for (const n of ['B', 'C', 'D', 'E', 'F']) others.push(await mk(n, { type: 'join', room: roomCode }));
  const all = [a, ...others];
  console.log('joined:', results.joined.length, '| colors:', results.colors.join(','));
  const iv = setInterval(() => {
    for (const [i, c] of all.entries()) if (c && c.readyState === 1)
      c.send(JSON.stringify({ type: 'input', move: 1, turn: (i % 2 ? -1 : 1) * Math.random(), fire: Math.random() > 0.4 }));
  }, 50);
  await new Promise(r => setTimeout(r, 15000));
  clearInterval(iv);
  console.log('states:', results.states, '| roundEnds:', results.roundEnds);
  const pass = results.joined.length === 6 && results.states > 200 && results.roundEnds >= 1;
  console.log(pass ? 'CLOUD E2E PASS' : 'CLOUD E2E FAIL');
  all.forEach(c => c && c.close());
  process.exit(pass ? 0 : 1);
})();
