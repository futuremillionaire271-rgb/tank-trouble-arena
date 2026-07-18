// Render API deploy helper
const https = require('https');
const KEY = process.env.RENDER_KEY || 'rnd_oVCDsAwBBLgwkQ9Q4YMudMBVMfhn';
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.render.com', path: '/v1' + path, method,
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Accept': 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
(async () => {
  const cmd = process.argv[2];
  if (cmd === 'owners') {
    const r = await api('GET', '/owners?limit=10');
    console.log(r.status, JSON.stringify(r.body, null, 2));
  } else if (cmd === 'create') {
    const ownerId = process.argv[3];
    const r = await api('POST', '/services', {
      type: 'web_service',
      name: 'tank-trouble-arena',
      ownerId,
      repo: 'https://github.com/futuremillionaire271-rgb/tank-trouble-arena',
      branch: 'master',
      autoDeploy: 'yes',
      serviceDetails: {
        runtime: 'node',
        plan: 'free',
        region: 'oregon',
        envSpecificDetails: { buildCommand: 'npm install', startCommand: 'npm start' },
        healthCheckPath: '/health',
      },
    });
    console.log(r.status, JSON.stringify(r.body, null, 2));
  } else if (cmd === 'status') {
    const id = process.argv[3];
    const r = await api('GET', `/services/${id}`);
    console.log(r.status, JSON.stringify(r.body && r.body.serviceDetails ? { url: r.body.serviceDetails.url, suspended: r.body.suspended } : r.body, null, 2));
  } else if (cmd === 'deploys') {
    const id = process.argv[3];
    const r = await api('GET', `/services/${id}/deploys?limit=1`);
    console.log(r.status, JSON.stringify(r.body, null, 2));
  }
})();
