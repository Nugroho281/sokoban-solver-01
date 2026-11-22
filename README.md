# Push-Optimal Sokoban Solver

An entry for make.fun's [Build the best Sokoban solver](https://make.fun/bounty/sokoban-solver-01-run-20261121) bounty ($100 in USDC).

The checker pays an instance's full 1,000 points only for a solution in P* pushes —
the level's push optimum — and 500 × P* / pushes above it, so this solver optimises
pushes, not moves.

## How it works

- **Search over pushes.** A breadth-first search on states of (sorted boxes, the lowest
  square of the player's reachable region); states are met in order of pushes made, so
  the first solved state is provably push-optimal.
- **Sound deadlock pruning.** Pushes onto dead squares (squares from which no push
  sequence reaches a goal, found by pulling back from the goals) and pushes that freeze
  a 2×2 block of walls and boxes with a box off its goal are cut; neither prune can
  remove a solvable state, so the optimum stands.
- **Room decomposition.** A level is a hallway with independent rooms off it, and a box
  can never leave its room, so the level's optimum is the sum of its rooms' optima. The
  solver cuts the level along the dead squares of the player's row and solves each room
  in turn with the other rooms' boxes standing as walls — one huge search becomes a few
  small ones. Levels that do not split fall back to a whole-level push search.
- **Deterministic by construction.** All budgets are state counts, never the clock, so
  two executions write byte-identical answers.

On the kit's practice set it scores the maximum 1,000,000 (every instance solved in
exactly P* pushes: 13, 16, 29, 47, 60), in about 2 seconds of the 60-second budget.

## Run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<set>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads `<input>/<id>/level.txt` (XSB) for every instance id and writes
`<output>/<id>/solution.txt` with the player's moves in LURD. Node 22, no dependencies.
