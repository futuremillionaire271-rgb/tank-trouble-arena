const fs = require('fs');
const https = require('https');
const cfg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.railway/config.json', 'utf8'));
const token = cfg.user && (cfg.user.token || cfg.user.accessToken);
const SERVICE_ID = 'aa3c1cd2-f190-4ae5-ab74-eb4408232807';
const ENV_ID = 'f3c62b3d-3178-4297-8f05-ce9a6b52e861';
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
  const r = await gql(`query($serviceId: String!, $environmentId: String!) {
    deployments(first: 3, input: { serviceId: $serviceId, environmentId: $environmentId }) {
      edges { node { id status createdAt statusUpdatedAt deploymentStopped } }
    }
  }`, { serviceId: SERVICE_ID, environmentId: ENV_ID });
  console.log(JSON.stringify(r, null, 2));
})();
