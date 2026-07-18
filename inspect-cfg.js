const fs = require('fs');
const c = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.railway/config.json', 'utf8'));
console.log('user keys:', Object.keys(c.user || {}));
