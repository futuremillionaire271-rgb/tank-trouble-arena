// Verify public tunnel: HTTPS page load + secure WebSocket game join
const https = require('https');
const WebSocket = require('ws');
const HOST = 'broadcasting-helen-icon-audio.trycloudflare.com';

function get(p) {
  return new Promise(res => https.get(`https://${HOST}${p}`, r => res(r.statusCode)).on('error', e => res('ERR ' + e.message)));
}
(async () => {
  console.log('GET / ->', await get('/'));
  console.log('GET /client.js ->', await get('/client.js'));
  const ws = new WebSocket(`wss://${HOST}`);
  let states = 0, joined = false, room = null;
  ws.on('open', () => ws.send(JSON.stringify({ type: 'create', name: 'TunnelTest' })));
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'joined') { joined = true; room = m.room; }
    if (m.type === 'state') states++;
  });
  ws.on('error', e => console.log('WS error:', e.message));
  await new Promise(r => setTimeout(r, 5000));
  console.log('joined via wss:', joined, '| room:', room, '| states:', states);
  console.log(joined && states > 10 ? 'TUNNEL PASS' : 'TUNNEL FAIL');
  ws.close();
  process.exit(joined && states > 10 ? 0 : 1);
})();
