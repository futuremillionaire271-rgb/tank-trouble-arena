// Joystick (vec input) movement behavior tests
const { Room } = require('./server.js');
function fakeWs() { return { readyState: 0, send() {} }; }
let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; }

const room = new Room('JOY');
const p1 = room.addPlayer(fakeWs(), 'P1');
const p2 = room.addPlayer(fakeWs(), 'P2');
if (room.resetTimer) { clearTimeout(room.resetTimer); room.resetTimer = null; }
room.roundActive = true;
room.maze.walls = [];
p2.x = 2000; p2.y = 2000;

// stick forward: tank moves in stick direction
p1.x = 300; p1.y = 300; p1.angle = 0;
p1.input.vecAngle = 0; p1.input.vecThrottle = 1;
const x0 = p1.x;
for (let i = 0; i < 30; i++) room.update(0.016);
check('stick forward drives forward', p1.x > x0 + 30);

// stick behind: tank reverses instead of slow-turning
p1.x = 300; p1.y = 300; p1.angle = 0;
p1.input.vecAngle = Math.PI; p1.input.vecThrottle = 1;
const x1 = p1.x, a1 = p1.angle;
for (let i = 0; i < 30; i++) room.update(0.016);
check('stick behind reverses (moves -x)', p1.x < x1 - 20);
check('reverse does not flip heading', Math.abs(p1.angle - a1) < 0.6);

// stick sideways: tank turns toward it while still moving
p1.x = 300; p1.y = 300; p1.angle = 0;
p1.input.vecAngle = Math.PI / 2; p1.input.vecThrottle = 1;
for (let i = 0; i < 60; i++) room.update(0.016);
check('stick side turns toward stick', Math.abs(p1.angle - Math.PI / 2) < 0.35);
check('tank still moved while turning', p1.y > 310);

// deadzone: tiny throttle does not move
p1.x = 300; p1.y = 300; p1.angle = 0;
p1.input.vecAngle = 0; p1.input.vecThrottle = 0.05;
for (let i = 0; i < 30; i++) room.update(0.016);
check('deadzone holds still', Math.abs(p1.x - 300) < 1 && Math.abs(p1.y - 300) < 1);

console.log(failures === 0 ? '\nJOYSTICK TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
