// End-to-end smoke test: HTTP + 3 websocket players play a round
const http = require('http');
const WebSocket = require('ws');

function get(p) {
  return new Promise((res) => http.get('http://localhost:3000' + p, r => res(r.statusCode)).on('error', e => res('ERR ' + e.message)));
}

async function main() {
  console.log('GET / ->', await get('/'));
  console.log('GET /client.js ->', await get('/client.js'));

  const clients = [];
  const results = { joined: [], states: 0, rounds: 0, roundEnds: 0, colors: [] };
  let roomCode = null;

  function mkClient(name, joinMsg) {
    return new Promise((resolve) => {
      const ws = new WebSocket('ws://localhost:3000');
      ws.on('open', () => ws.send(JSON.stringify({ name, ...joinMsg })));
      ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.type === 'joined') { results.joined.push(name); results.colors.push(m.color); roomCode = m.room; resolve(ws); }
        if (m.type === 'state') results.states++;
        if (m.type === 'round') results.rounds++;
        if (m.type === 'roundEnd') { results.roundEnds++; results.winner = m.winner; }
        if (m.type === 'error') { console.log('ERROR msg for', name, m.msg); resolve(null); }
      });
    });
  }

  const c1 = await mkClient('Alice', { type: 'create' });
  console.log('room:', roomCode);
  const c2 = await mkClient('Bob', { type: 'join', room: roomCode });
  const c3 = await mkClient('Carol', { type: 'join', room: roomCode });
  // 4th should be rejected
  const c4 = await mkClient('Dave', { type: 'join', room: roomCode });
  console.log('colors:', results.colors.join(','), '| 4th rejected:', c4 === null);

  // drive: Alice spins and fires constantly, others idle -> eventually someone dies
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (c1.readyState === 1) c1.send(JSON.stringify({ type: 'input', move: 1, turn: 0.5, fire: Math.random() > 0.4 }));
    if (c2.readyState === 1) c2.send(JSON.stringify({ type: 'input', move: 1, turn: -0.3, fire: Math.random() > 0.5 }));
    if (c3.readyState === 1) c3.send(JSON.stringify({ type: 'input', move: 1, turn: 0.8, fire: Math.random() > 0.5 }));
  }, 50);

  await new Promise(r => {
    const check = setInterval(() => {
      if (results.roundEnds >= 1 || Date.now() - t0 > 30000) { clearInterval(check); r(); }
    }, 200);
  });
  clearInterval(iv);

  console.log('states received:', results.states);
  console.log('round msgs:', results.rounds, '| roundEnds:', results.roundEnds, '| winner:', results.winner);
  // wait for auto new round
  await new Promise(r => setTimeout(r, 3800));
  console.log('rounds after reset:', results.rounds, '(should have increased)');

  const pass = results.joined.length === 3 && c4 === null && results.states > 20 && results.roundEnds >= 1 && results.rounds >= 1;
  console.log(pass ? 'ALL TESTS PASS' : 'TESTS FAILED');
  [c1, c2, c3].forEach(c => c && c.close());
  process.exit(pass ? 0 : 1);
}
main();
