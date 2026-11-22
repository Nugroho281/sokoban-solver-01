// Push-optimal Sokoban solver (make.fun sokoban-solver-01): BFS over pushes on
// (sorted boxes, lowest square of the player's reachable region) — first solved state
// is push-optimal (P*). Sound prunes: dead-square pushes, 2x2-freeze pushes. Levels
// split into rooms along the player's row, solved room by room; whole-level fallback.
// Budgets are state counts, never the clock, so runs are byte-identical.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const WL = 'udlr', PL = 'UDLR'; // direction k has delta [-w, w, -1, 1][k]

// XSB text -> board; squares a short row never reaches and the outer frame are walls.
function parse(t) {
  const rows = t.split('\n').filter((r) => r.length), h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1), goals = [], boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x], i = y * w + x;
      if (c === '#') continue;
      wall[i] = 0;
      if ('.*+'.includes(c)) goals.push(i);
      if ('$*'.includes(c)) boxes.push(i);
      if ('@+'.includes(c)) player = i;
    }
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (!x || !y || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  boxes.sort((a, b) => a - b);
  return { w, wall, goals, boxes, player };
}

// Squares from which a box alone can be pushed onto a goal (pull-back from goals).
function live(w, wall, goals) {
  const lv = new Uint8Array(wall.length), q = [], D = [-w, w, -1, 1];
  for (const g of goals) { lv[g] = 1; q.push(g); }
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    for (const d of D) {
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !lv[y]) { lv[y] = 1; q.push(y); }
    }
  }
  return lv;
}

// Player's reachable region from `from`, stamped in sn; returns its lowest square.
function rch(w, wall, occ, from, sn, stamp, st) {
  let low = from, n = 0;
  st[n++] = from; sn[from] = stamp;
  while (n) {
    const p = st[--n];
    if (p < low) low = p;
    for (const q of [p - w, p + w, p - 1, p + 1])
      if (wall[q] === 0 && occ[q] === 0 && sn[q] !== stamp) { sn[q] = stamp; st[n++] = q; }
  }
  return low;
}

// Is the box just pushed onto t frozen in a 2x2 block of walls/boxes, a box off-goal?
function frz(w, wall, occ, goal, t) {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const cs = [a, a + 1, a + w, a + w + 1];
    if (cs.every((c) => wall[c] || occ[c]) && cs.some((c) => occ[c] && !goal[c])) return true;
  }
  return false;
}

// Shortest walk from -> to around walls and boxes, in lower LURD letters.
function wlk(w, wall, occ, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1), how = [], q = [from], D = [-w, w, -1, 1];
  prev[from] = from;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    if (p === to) break;
    for (let k = 0; k < 4; k++) {
      const s = p + D[k];
      if (wall[s] || occ[s] || prev[s] !== -1) continue;
      prev[s] = p; how[s] = WL[k]; q.push(s);
    }
  }
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}
// Push-optimal solution of one (sub-)level, or null past mx kept states. State key:
// region low square + sorted boxes, packed in base N while exact (< 2^53), else text.
function slv(w, wall, goals, sb, sp, mx) {
  const N = wall.length, G = new Uint8Array(N), D = [-w, w, -1, 1];
  for (const g of goals) G[g] = 1;
  const lv = live(w, wall, goals), done = (bs) => bs.every((b) => G[b]);
  if (sb.some((b) => !lv[b])) return null;
  if (done(sb)) return { p: 0, m: '' };
  const oc = new Uint8Array(N), sn = new Int32Array(N), mk = new Int32Array(N), st = new Int32Array(N);
  let tm = 0;
  const num = N ** (sb.length + 1) < 2 ** 53;
  const key = (bs, low) => {
    if (!num) return low + '|' + bs.join(',');
    let k = low;
    for (const b of bs) k = k * N + b;
    return k;
  };
  const ba = [sb.slice()], pa = [sp], pr = [-1], ix = new Map();
  for (const b of sb) oc[b] = 1;
  ix.set(key(sb, rch(w, wall, oc, sp, sn, ++tm, st)), 0);
  for (const b of sb) oc[b] = 0;
  let fd = -1;
  for (let hd = 0; hd < ba.length && fd < 0; hd++) {
    const bs = ba[hd];
    for (const b of bs) oc[b] = 1;
    rch(w, wall, oc, pa[hd], sn, ++tm, st);
    const hr = tm;
    for (let bi = 0; bi < bs.length && fd < 0; bi++) {
      const b = bs[bi];
      for (let k = 0; k < 4; k++) {
        const d = D[k], t = b + d;
        // A push needs the player behind the box, floor ahead, a live landing.
        if (sn[b - d] !== hr || wall[t] || oc[t] || !lv[t]) continue;
        oc[b] = 0; oc[t] = 1;
        const fz = frz(w, wall, oc, G, t);
        let ky = '', nx = null;
        if (!fz) {
          nx = bs.slice(); nx[bi] = t; nx.sort((x, y) => x - y);
          ky = key(nx, rch(w, wall, oc, b, mk, ++tm, st));
        }
        oc[t] = 0; oc[b] = 1;
        if (fz || ix.has(ky)) continue;
        if (ba.length >= mx) return null;
        ix.set(ky, ba.length);
        ba.push(nx); pa.push(b); pr.push(hd);
        if (done(nx)) fd = ba.length - 1;
      }
    }
    for (const b of bs) oc[b] = 0;
  }
  if (fd < 0) return null;
  // Spell the state path out: walk to each push's stand square, then the push letter.
  const path = [];
  for (let s = fd; s > 0; s = pr[s]) path.push(s);
  path.reverse();
  let mv = '', pl = sp, cb = sb;
  for (const s of path) {
    const nb = ba[s], from = cb.find((b) => !nb.includes(b)), to = nb.find((b) => !cb.includes(b)), d = to - from;
    for (const b of cb) oc[b] = 1;
    mv += wlk(w, wall, oc, pl, from - d);
    for (const b of cb) oc[b] = 0;
    mv += PL[D.indexOf(d)];
    pl = from; cb = nb;
  }
  return { p: path.length, m: mv };
}

// Rooms of a level: cut the player's row's dead squares out of the floor; each part
// left holds its boxes and goals. Null if a part's boxes != goals or a box starts in
// the hallway.
function rooms(board) {
  const { w, wall, goals, boxes, player } = board, lv = live(w, wall, goals), row = (player / w) | 0;
  const cut = new Uint8Array(wall.length), D = [-w, w, -1, 1];
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !lv[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1), rms = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const sq = [s];
    part[s] = rms.length;
    for (let i = 0; i < sq.length; i++) for (const d of D) {
      const q = sq[i] + d;
      if (!wall[q] && !cut[q] && part[q] < 0) { part[q] = rms.length; sq.push(q); }
    }
    rms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) rms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0) || rms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rms.filter((r) => r.boxes.length > 0);
}

// Solve room by room (budgets: 1e6 states/room, 600k whole-level); the player walks
// on from where the last room left it. Room optima sum to the level optimum.
function byRooms(board, rms) {
  const { w, wall } = board;
  let pl = board.player, mv = '';
  for (const room of rms) {
    const sub = wall.slice();
    for (const o of rms) {
      if (o === room) continue;
      for (const b of o.done ? o.goals : o.boxes) sub[b] = 1;
    }
    const part = slv(w, sub, room.goals.slice().sort((a, b) => a - b), room.boxes.slice().sort((a, b) => a - b), pl, 1e6);
    if (part === null) return null;
    mv += part.m;
    for (const ch of part.m.toLowerCase()) pl += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
    room.done = true;
  }
  return mv;
}

// One level: room by room when it splits, else one whole-level search.
function level(text) {
  const board = parse(text), gs = new Set(board.goals);
  if (board.boxes.every((b) => gs.has(b))) return '';
  const rms = rooms(board);
  if (rms !== null) {
    const by = byRooms(board, rms);
    if (by !== null) return by;
  }
  const whole = slv(board.w, board.wall, board.goals, board.boxes, board.player, 600000);
  return whole === null ? '' : whole.m;
}

for (const id of readdirSync(I).sort()) {
  const mv = level(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${mv}\n`);
}
