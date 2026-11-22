# Push-Optimal Sokoban Solver

make.fun sokoban-solver-01-run-20261121 entry. BFS over pushes (states: sorted boxes + the player's reachable region) with dead-square and frozen-2x2 pruning and room decomposition, so the first solution found is push-optimal (P*). Budgets are state counts, never the clock: two runs are byte-identical. Practice set: 1,000,000 (13/16/29/47/60 pushes).

Run: MAKEFUN_INPUT_DIR=<set>/input MAKEFUN_OUTPUT_DIR=out node main.ts (Node 22, no dependencies).
