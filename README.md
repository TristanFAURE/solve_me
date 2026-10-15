# solve_me

A lightweight web application for modeling and solving constraint-assignment problems in the browser.

This project provides:

- a **generic constraint modeling page**
- a **school class creation page**
- a **wedding table planning page** with seat topology
- an **Event Staffing page** with date-grouped slots and category coverage
- a shared generic core model for items, groups, containers, positions, relations, constraints, and preferences
- ranked in-browser solving through JavaScript and HiGHS WebAssembly Workers

## Project status

This is a browser-first application built with **plain JavaScript**, **HTML**, **CSS**, and **Vite**.

The app already includes:

- editable generic modeling UI
- validation -> normalization -> solve workflow
- local draft save/load
- JSON import/export
- full-fidelity specialized configuration workbooks
- shared Setup, Data, Rules, Review, and Results workflows
- weighted scoring, diverse alternatives, progress, cancellation, and timeout handling
- Generic, School, Wedding, and Event Staffing authoring and solving flows

## Tech stack

- JavaScript (ES modules)
- HTML/CSS
- Vite
- HiGHS WebAssembly for large local staffing MILP models
- SheetJS `xlsx` for workbook import/export
- Vitest and Playwright for automated verification

## Getting started

### Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 8)
- npm

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Preview the production build

```bash
npm run preview
```

### Run tests

```bash
npm run test
```

### Run browser tests

Install Chromium and its system dependencies once, then run Playwright:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

### Run tests with coverage

```bash
npm run test:coverage
```

Open the HTML coverage report at:

```text
coverage/index.html
```

### Run the manual solver benchmark

This benchmark is not part of the default test suite or CI gate. It is meant for manual iteration on solver capacity and complexity.

```bash
npm run bench:solver
npm run bench:staffing
```

You can configure the generated benchmark size with environment variables:

```bash
BENCH_CONTAINERS=100 BENCH_ITEMS=1000 BENCH_CONSTRAINTS=1000 BENCH_SEED=12345 npm run bench:solver
BENCH_STAFFING_DAYS=180 BENCH_STAFFING_SLOTS_PER_DAY=10 BENCH_STAFFING_PEOPLE=200 BENCH_STAFFING_CATEGORIES=1 BENCH_STAFFING_MODE=first npm run bench:staffing
```

The benchmark prints:

- generated scenario size
- normalization time
- solve wall-clock time
- solver-reported runtime
- solve status
- number of returned solutions
- truncation flag

The staffing benchmark supports `BENCH_STAFFING_ENGINE=highs|js`, `BENCH_STAFFING_MODE=first|topK|optimize`, and bounded timeout/process/memory settings documented in `docs/08-testing-strategy.md`.

## Deploy to GitHub Pages

This repository is configured to deploy automatically to **GitHub Pages** using **GitHub Actions**.

### Included automation

- `vite.config.js` sets the correct base path for the repository site
- `.github/workflows/deploy.yml` runs unit, coverage, and Playwright tests, builds the app, and deploys the `dist/` folder to GitHub Pages on every push to `main`
- `.gitignore` excludes local build and dependency folders

### Deploy flow

Every push to `main` will:

- install dependencies with `npm ci`
- run tests with `npm run test`
- run coverage with `npm run test:coverage`
- install Chromium dependencies and run `npm run test:e2e`
- upload the generated coverage report as a workflow artifact
- build the app with `npm run build`
- publish the built site to GitHub Pages

The expected site URL is:

```text
https://tristanfaure.github.io/solve_me/
```

### Manual local check before pushing

```bash
npm run build
npm run preview
```

Then push your changes:

```bash
git add .
git commit -m "Add GitHub Pages deployment"
git push origin main
```

## Project structure

```text
src/
  app/          # bootstrap, router, app state
  components/   # shared UI pieces
  core/         # generic model, validation, normalization, transforms
  pages/        # generic, school, wedding, Event Staffing pages
  solver/       # JavaScript/HiGHS adapters and separate Worker entry points
  storage/      # local drafts, import/export, model versioning
  workbooks/    # bounded XLSX parsing, configuration envelopes, Worker parsing
  utils/        # shared helpers
scripts/        # generic and Event Staffing benchmarks
tests/          # unit, integration, workbook, and browser suites
```

## Current capabilities

### Generic page

- Create and edit items, groups, containers, and positions
- Define containments, adjacencies, hard constraints, and preferences
- Validate projects before solving
- Normalize authored data into solver-ready structures
- Run the first solver adapter and inspect solutions

### School page

- Author students, teachers, levels, and classes in school-facing language
- Define accepted levels and teacher-class links
- Validate school-specific authoring rules
- Solve class assignment scenarios using the shared generic pipeline
- View solved class cards including linked teachers and accepted levels

### Wedding page

- Author guests, groups, tables, seats, and topology
- Solve container or seat-aware position assignments
- Import/export full configurations and selected results

### Event Staffing page

- Author date-grouped slots, categories, requirements, people, preferences, unavailability, and rules
- Import/export an editable people-by-date/slot preference matrix
- Generate ranked schedules with weighted preference, target, and equity scoring
- Run large supported models through HiGHS WASM without sending planning data to a server

## Solver scope

The JavaScript adapter supports:

- container-mode assignment
- position-mode assignment
- maximum-capacity enforcement
- must-share constraints
- must-not-share constraints
- hard adjacency constraints in position mode
- multiple returned solutions
- complete or explicitly bounded repeated-assignment search
- weighted assignment, count-target, and equity objectives

The HiGHS WASM adapter supports large multiple-container staffing models with sparse assignment variables, capacities, eligibility, fixed/forbidden assignments, cooldown exclusions, scoped count bounds, weighted objectives, and best-found alternatives. Unsupported semantics fail explicitly or remain on the JavaScript adapter in automatic mode.

General relation preferences remain unsupported by the current solvers.

## Testing

The suite currently contains 253 Vitest tests across solver, core, page, workbook, Worker, and cross-domain integration behavior, plus 23 Playwright browser tests.

Current test areas include:

- normalization derivations such as adjacency maps and must-share components
- first solver adapter behavior in container mode
- first solver adapter behavior in position mode
- solver validation and warnings
- solver support modules and capability reporting
- HiGHS objective parity, hard constraints, timeout incumbents, and engine fallback
- workbook safety, migration, configuration round trips, and Worker parsing
- cross-domain compatibility and responsive browser workflow coverage

Tests use small scenario helpers under `tests/helpers/` to keep constraints readable with low boilerplate.

Manual generic and staffing benchmark scripts are available under `scripts/`. They are intentionally opt-in and are not run by default in tests or CI.

## Documentation

Architecture and feature notes are available in `docs/`, including:

- core architecture
- domain semantics
- generic page behavior
- school page behavior
- import/export behavior
- solution display expectations

The project continuity log is maintained in `status.md`.

## Notes for this repository

Because this project is hosted from a repository named `solve_me`, Vite is configured with the GitHub Pages base path:

```text
/solve_me/
```

If you ever rename the repository, you must also update `vite.config.js`.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
