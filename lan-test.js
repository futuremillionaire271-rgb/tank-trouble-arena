// LAN check: verify game reachable on local network IP
const http = require('http');
const WebSocket = require('ws');
const HOST = '192.168.1.29:3000';
http.get(`http://${HOST}/health`, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    console.log('HTTP on LAN IP:', r.statusCode, d);
    const ws = new WebSocket(`ws://${HOST}`);
    let joined = false;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'create', name: 'LanTest' })));
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.type === 'joined') { joined = true; console.log('WS join on LAN IP: OK, room', msg.room); ws.close(); }
    });
    setTimeout(() => { console.log(joined ? 'LAN PASS' : 'LAN FAIL'); process.exit(joined ? 0 : 1); }, 3000);
  });
}).on('error', e => { console.log('ERR', e.message); process.exit(1); });
