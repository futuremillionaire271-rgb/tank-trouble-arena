// Direct unit tests of Room mechanics: pickup, laser, missile, gatling, frag, shield, 5-shot cap
const { Room } = require('./server.js');

function fakeWs() { return { readyState: 0, send() {} }; }
let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; }

const room = new Room('TEST');
const p1 = room.addPlayer(fakeWs(), 'P1');
const p2 = room.addPlayer(fakeWs(), 'P2');
room.roundActive = true;

// --- 5 shot cap ---
p1.x = 200; p1.y = 200; p1.angle = 0; p2.x = 600; p2.y = 400;
room.maze.walls = []; // open field for determinism
for (let i = 0; i < 8; i++) room.fireBullet(p1);
check('5-shot cap', room.bullets.filter(b => b.owner === p1).length === 5);
room.bullets = [];

// --- powerup pickup ---
room.powerups = [{ id: 1, type: 'laser', x: p1.x + 5, y: p1.y }];
room.update(0.025);
check('powerup picked up', room.powerups.length === 0 && p1.weapon === 'laser');

// --- laser kills across the map ---
p2.alive = true; p2.x = p1.x + 300; p2.y = p1.y; p1.angle = 0;
room.handleFire(p1);
check('laser kills target', p2.alive === false);
check('laser consumed', p1.weapon === null);
check('laser effect created', room.effects.some(e => e.kind === 'laser'));

// --- shield blocks a kill ---
p2.alive = true; p2.shield = 5;
room.killTank(p2, 'red');
check('shield blocks kill', p2.alive === true && p2.shield === 0);
room.killTank(p2, 'red');
check('second hit kills', p2.alive === false);

// --- missile spawns and homes ---
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }
room.roundActive = true; room.maze.walls = [];
p2.alive = true; p2.x = p1.x; p2.y = p1.y + 200;
p1.weapon = 'missile'; p1.angle = 0; // firing east, target is south
room.handleFire(p1);
const mis = room.bullets.find(b => b.kind === 'missile');
check('missile fired', !!mis);
const angBefore = Math.atan2(mis.vy, mis.vx);
for (let i = 0; i < 20; i++) room.update(0.025);
const missNow = room.bullets.find(b => b.kind === 'missile');
if (missNow) {
  const angAfter = Math.atan2(missNow.vy, missNow.vx);
  check('missile turns toward target', angAfter > angBefore + 0.3);
} else {
  check('missile hit target (already exploded)', p2.alive === false);
}
room.bullets = [];

// --- frag explodes into shards ---
p1.weapon = 'frag';
room.handleFire(p1);
const frag = room.bullets.find(b => b.kind === 'frag');
check('frag fired', !!frag);
frag.fuse = 0.01;
room.update(0.025);
check('frag explodes into shards', room.bullets.filter(b => b.kind === 'shard').length >= 10);
room.bullets = [];

// --- gatling drains ammo while held ---
p1.weapon = 'gatling'; p1.ammoSpecial = 25; p1.fireHeld = true; p1.gatlingCd = 0;
for (let i = 0; i < 40; i++) room.update(0.05);
check('gatling fires stream', p1.ammoSpecial < 25);
check('gatling empties and reverts', p1.weapon === null || p1.ammoSpecial > 0);

// --- round end awards score ---
const before = p1.score;
p2.alive = false; p1.alive = true;
room.roundActive = true;
room.endRoundCheck();
check('winner gets score', p1.score === before + 1);

console.log(failures === 0 ? '\nALL UNIT TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
