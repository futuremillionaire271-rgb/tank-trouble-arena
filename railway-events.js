const fs = require('fs');
const https = require('https');
const cfg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.railway/config.json', 'utf8'));
const token = cfg.user && (cfg.user.token || cfg.user.accessToken);
function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(data) },
    }, res => { let out = ''; res.on('data', c => out += c); res.on('end', () => resolve(JSON.parse(out))); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}
(async () => {
  const id = process.argv[2] || '8cbf98d4-21d7-473d-b116-1d1b90339a31';
  const r = await gql(`query($id: String!) {
    deploymentEvents(id: $id) { edges { node { step createdAt payload { error } } } }
  }`, { id });
  console.log(JSON.stringify(r, null, 2).slice(0, 3000));
})();
