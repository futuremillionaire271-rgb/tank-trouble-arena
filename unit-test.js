// v2 unit tests: all weapons, powerups, kill credit, 6-player rooms
const { Room } = require('./server.js');

function fakeWs() { return { readyState: 0, send() {} }; }
let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; }

const room = new Room('TEST');
const p1 = room.addPlayer(fakeWs(), 'P1');
const p2 = room.addPlayer(fakeWs(), 'P2');
room.roundActive = true;
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }

// --- 6 players ---
const extras = [];
for (let i = 3; i <= 6; i++) extras.push(room.addPlayer(fakeWs(), 'P' + i));
check('6 players join', extras.every(p => p) && room.players.size === 6);
check('7th rejected', room.addPlayer(fakeWs(), 'P7') === null);
check('unique colors', new Set([...room.players.values()].map(p => p.color)).size === 6);
for (const e of extras) { const ws = [...room.players.keys()].find(k => room.players.get(k) === e); room.players.delete(ws); }
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }
room.roundActive = true;

// --- 5 shot cap ---
p1.x = 200; p1.y = 200; p1.angle = 0; p2.x = 600; p2.y = 400; p2.alive = true; p1.alive = true;
room.maze.walls = [];
for (let i = 0; i < 8; i++) room.fireBullet(p1);
check('5-shot cap', room.bullets.filter(b => b.owner === p1).length === 5);
room.bullets = [];

// --- powerup pickup emits event ---
room.events = [];
room.powerups = [{ id: 1, type: 'laser', x: p1.x + 5, y: p1.y }];
room.update(0.016);
check('powerup picked up', room.powerups.length === 0 && p1.weapon === 'laser');
check('pickup event emitted', room.events.some(e => e.e === 'pickup'));

// --- laser kill + kill credit ---
p2.alive = true; p2.x = p1.x + 300; p2.y = p1.y; p1.angle = 0;
const killsBefore = p1.kills;
room.handleFire(p1);
check('laser kills target', p2.alive === false);
check('kill credited', p1.kills === killsBefore + 1);
check('kill event emitted', room.events.some(e => e.e === 'kill'));
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }
room.roundActive = true;

// --- shield ---
p2.alive = true; p2.shield = 5;
room.killTank(p2, p1);
check('shield blocks kill', p2.alive === true && p2.shield === 0);

// --- triple shot ---
p1.weapon = 'triple'; p1.ammoSpecial = 3;
room.bullets = [];
room.handleFire(p1);
check('triple fires 3', room.bullets.length === 3);
check('triple ammo decrements', p1.ammoSpecial === 2);

// --- mine ---
p1.weapon = 'mine'; p1.ammoSpecial = 1;
room.handleFire(p1);
check('mine placed', room.mines.length === 1 && p1.weapon === null);
const mine = room.mines[0];
mine.arm = 0;
p1.x = mine.x + 500; p1.y = mine.y + 500; // owner clear of blast
p2.alive = true; p2.shield = 0; p2.x = mine.x + 5; p2.y = mine.y;
room.update(0.016);
check('mine explodes on enemy', p2.alive === false && room.mines.length === 0);
check('mine owner survives own blast at range', p1.alive === true);
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }
room.roundActive = true;

// --- speed boost ---
p1.speedBoost = 0;
room.powerups = [{ id: 2, type: 'speed', x: p1.x, y: p1.y }];
room.update(0.016);
check('speed boost applied', p1.speedBoost > 0);

// --- ghost ---
room.powerups = [{ id: 3, type: 'ghost', x: p1.x, y: p1.y }];
room.update(0.016);
check('ghost applied', p1.ghost > 0);

// --- missile homing ---
room.bullets = [];
p2.alive = true; p2.x = p1.x; p2.y = p1.y + 200; p2.ghost = 0;
p1.weapon = 'missile'; p1.angle = 0; p1.ghost = 0;
room.handleFire(p1);
const mis = room.bullets.find(b => b.kind === 'missile');
check('missile fired', !!mis);
const angBefore = Math.atan2(mis.vy, mis.vx);
for (let i = 0; i < 20; i++) room.update(0.016);
const misNow = room.bullets.find(b => b.kind === 'missile');
if (misNow) check('missile homes', Math.atan2(misNow.vy, misNow.vx) > angBefore + 0.2);
else check('missile hit target', p2.alive === false);

// --- frag ---
room.bullets = [];
p1.weapon = 'frag';
room.handleFire(p1);
const frag = room.bullets.find(b => b.kind === 'frag');
check('frag fired', !!frag);
frag.fuse = 0.001;
room.update(0.016);
check('frag shards', room.bullets.filter(b => b.kind === 'shard').length >= 10);

// --- gatling ---
room.bullets = [];
p1.weapon = 'gatling'; p1.ammoSpecial = 28; p1.fireHeld = true; p1.gatlingCd = 0;
for (let i = 0; i < 60; i++) room.update(0.05);
check('gatling fires and drains', p1.ammoSpecial < 28);

// --- snapshot shape ---
const snap = room.snapshot();
check('snapshot has velocity for bullets', snap.bullets.every(b => 'vx' in b));
check('snapshot has events array', Array.isArray(snap.events));
check('snapshot has mines', Array.isArray(snap.mines));
check('events cleared after snapshot', room.events.length === 0);

console.log(failures === 0 ? '\nALL UNIT TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
