// Push-optimal Sokoban solver for make.fun's sokoban-solver-01.
//
// Scoring pays in full only for a solution in P* pushes (the level's push optimum) and
// halves fast above it, so this solver searches over pushes, not moves: a breadth-first
// search on (boxes, the player's reachable region) whose first solved state is provably
// push-optimal. Two sound prunes keep the search small: a box pushed onto a dead square
// (one from which no push sequence reaches a goal) can never come back, and a box frozen
// in a 2x2 block of walls and boxes off its goal can never move again.
//
// A level is a hallway with independent rooms off it: a box can never leave its room, so
// the level's optimum is the sum of its rooms' optima. The solver cuts the level into
// rooms along the dead squares of the player's row and solves each room in turn with the
// other rooms' boxes standing as walls, which turns one huge search into a few small
// ones. If a level does not split into rooms, the same push search runs on the whole
// level. All budgets are state counts, never the clock, so two runs answer alike.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The four directions in a fixed order: [dx, dy, the walk letter, the push letter]. */
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Board {
  w: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/**
 * A level in XSB text (# wall, space floor, . goal, $ box, * box on a goal, @ player,
 * + player on a goal), one row a line. Squares a short row never reaches, and the whole
 * outer frame, count as walls: nothing leaves the board.
 */
function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, wall, goals, boxes, player };
}

/**
 * The live squares: those from which a box alone can be pushed onto some goal, found by
 * pulling back from the goals over open floor (a box on square y can be pushed onto the
 * live square x when the square behind y is open for the player to stand on). A box on
 * any other square is dead weight: it can never reach a goal.
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood-fills the squares the player reaches from `from` around walls and the boxes in
 * `occupied`, marking them in `seen` with `stamp`, and answers the region's lowest
 * square: two player positions in one region are the same search state.
 */
function reach(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    const around = [p - w, p + w, p - 1, p + 1];
    for (let k = 0; k < 4; k++) {
      const q = around[k]!;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/**
 * Whether the box just pushed onto `t` sits in a 2x2 block of nothing but walls and
 * boxes with a box among them off its goal: such a block never moves again.
 */
function frozenBlock(w: number, wall: Uint8Array, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters. */
function walkPath(w: number, wall: Uint8Array, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p] + s;
  return s;
}

/**
 * The push-optimal solution of one (sub-)level: a breadth-first search over pushes, so
 * states are met in order of pushes made and the first solved state is optimal. A state
 * is the sorted boxes plus the lowest square of the player's reachable region. Pushes
 * onto dead squares and pushes that freeze a 2x2 block are pruned; neither can prune a
 * solvable state, so the optimum stands. Gives up (null) past `maxStates` states.
 */
function solvePushes(
  w: number,
  wall: Uint8Array,
  goals: number[],
  startBoxes: number[],
  startPlayer: number,
  maxStates: number,
): { pushes: number; moves: string } | null {
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(w, wall, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b] === 1);
  if (startBoxes.some((b) => !live[b])) return null;
  if (solved(startBoxes)) return { pushes: 0, moves: '' };
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  // A state's key: the region's lowest square, then the boxes, packed in base `size`
  // while that stays exact (under 2^53); a string key on the rare bigger board.
  const numeric = size ** (startBoxes.length + 1) < 2 ** 53;
  const keyOf = (bs: number[], low: number): number | string => {
    if (!numeric) return low + '|' + bs.join(',');
    let k = low;
    for (const b of bs) k = k * size + b;
    return k;
  };
  // The states in the order found: their boxes, the square the player ends the push on,
  // and the parent state each came from.
  const boxesAt: number[][] = [startBoxes.slice()];
  const playerAt: number[] = [startPlayer];
  const parent: number[] = [-1];
  const index = new Map<number | string, number>();
  for (const b of startBoxes) occupied[b] = 1;
  index.set(keyOf(startBoxes, reach(w, wall, occupied, startPlayer, seen, ++stamp, stack)), 0);
  for (const b of startBoxes) occupied[b] = 0;
  let found = -1;
  for (let head = 0; head < boxesAt.length && found < 0; head++) {
    const boxes = boxesAt[head]!;
    for (const b of boxes) occupied[b] = 1;
    reach(w, wall, occupied, playerAt[head]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        // A push needs the player behind the box, open floor ahead, and a live landing.
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key: number | string = '';
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, reach(w, wall, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (boxesAt.length >= maxStates) return null;
        index.set(key, boxesAt.length);
        boxesAt.push(next!);
        playerAt.push(b);
        parent.push(head);
        if (solved(next!)) found = boxesAt.length - 1;
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  // Walk the state path back, then spell it out: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = startPlayer;
  let boxes = startBoxes;
  for (const s of path) {
    const nextBoxes = boxesAt[s]!;
    const from = boxes.find((b) => !nextBoxes.includes(b))!;
    const to = nextBoxes.find((b) => !boxes.includes(b))!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkPath(w, wall, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done?: boolean;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a box there
 * reaches no goal) out of the floor, and each part left that holds a box is a room, with
 * its squares, boxes and goals. Null when some part holds more or fewer boxes than
 * goals, or a box starts in the hallway: then the level is no set of rooms.
 */
function roomsOf(board: Board): Room[] | null {
  const { w, wall, goals, boxes, player } = board;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g] < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The square the player stands on after `moves` (LURD, the case aside) from `from`. */
function endSquare(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/** Work budgets, in states kept: generous over what these levels need, and clock-free. */
const ROOM_STATES = 1_000_000;
const LEVEL_STATES = 600_000;

/**
 * The level solved room by room: each room's push-optimal solution in turn, the other
 * rooms' boxes standing as walls (on their goals once their room is done), the player
 * walking on from where the last room left it. A box never leaves its room, so the
 * rooms' optima add up to the level's. Null when a room's search gives up.
 */
function solveByRooms(board: Board, rooms: Room[]): string | null {
  const { w, wall } = board;
  let player = board.player;
  let moves = '';
  for (const room of rooms) {
    const subWall = wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) subWall[b] = 1;
    }
    const part = solvePushes(w, subWall, room.goals.slice().sort((a, b) => a - b), room.boxes.slice().sort((a, b) => a - b), player, ROOM_STATES);
    if (part === null) return null;
    moves += part.moves;
    player = endSquare(w, player, part.moves);
    room.done = true;
  }
  return moves;
}

/** One level's moves: room by room when it splits into rooms, else one whole search. */
function solveLevel(text: string): string {
  const board = parseLevel(text);
  const goalSet = new Set(board.goals);
  if (board.boxes.every((b) => goalSet.has(b))) return '';
  const rooms = roomsOf(board);
  if (rooms !== null) {
    const byRooms = solveByRooms(board, rooms);
    if (byRooms !== null) return byRooms;
  }
  const whole = solvePushes(board.w, board.wall, board.goals, board.boxes, board.player, LEVEL_STATES);
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}

