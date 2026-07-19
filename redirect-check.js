const https = require('https');
https.get('https://tank-trouble-arena-production.up.railway.app/', r => {
  console.log('status:', r.statusCode, '| location:', r.headers.location || 'none');
  process.exit(0);
}).on('error', e => { console.log('ERR', e.message); process.exit(1); });
