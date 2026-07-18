// Move Railway service to Singapore region (closest to Pakistan) via GraphQL API
const fs = require('fs');
const https = require('https');
const cfg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.railway/config.json', 'utf8'));
const token = cfg.user && (cfg.user.token || cfg.user.accessToken);
if (!token) { console.log('NO TOKEN. keys:', JSON.stringify(Object.keys(cfg))); process.exit(1); }

const SERVICE_ID = 'aa3c1cd2-f190-4ae5-ab74-eb4408232807';
const ENV_ID = 'f3c62b3d-3178-4297-8f05-ce9a6b52e861';

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'regions') {
    const r = await gql(`query { regions { name location region country } }`);
    console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  } else if (cmd === 'set') {
    const region = process.argv[3] || 'asia-southeast1';
    const r = await gql(`mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`, { serviceId: SERVICE_ID, environmentId: ENV_ID, input: { region } });
    console.log(JSON.stringify(r, null, 2));
    if (!r.errors) {
      const d = await gql(`mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }`, { serviceId: SERVICE_ID, environmentId: ENV_ID });
      console.log('redeploy:', JSON.stringify(d, null, 2));
    }
  } else if (cmd === 'setmulti') {
    const region = process.argv[3] || 'asia-southeast1-eqsg3a';
    const r = await gql(`mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`, { serviceId: SERVICE_ID, environmentId: ENV_ID, input: { multiRegionConfig: { [region]: { numReplicas: 1 } } } });
    console.log(JSON.stringify(r, null, 2));
    if (!r.errors) {
      const d = await gql(`mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }`, { serviceId: SERVICE_ID, environmentId: ENV_ID });
      console.log('redeploy:', JSON.stringify(d, null, 2));
    }
  } else if (cmd === 'current') {
    const r = await gql(`query($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { region }
    }`, { serviceId: SERVICE_ID, environmentId: ENV_ID });
    console.log(JSON.stringify(r, null, 2));
  }
})();
