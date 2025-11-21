# 2D Matrix Path Visualizer

Interactive React demo for exploring how a 2×2 matrix transforms vectors over time. Compare the KAN and exp(t ln A) backends, animate trajectories, place collision lines, and save profiles for later.

## Quick start
1. Install deps: `npm install`
2. Run dev server: `npm run dev`
3. Build for production: `npm run build`

## Features
- 2D trajectories with fading trails or sampled dots, live contact markers against axis-aligned walls
- KAN vs exp-log backends with optional eigen interpolation and custom activation functions
- Profile save/load with matrices, vectors, animation settings, and wall layout
- Guided tour highlighting controls, playback, and diagnostics
