# solve_me

A lightweight web application for modeling and solving constraint-assignment problems in the browser.

This project provides:

- a **generic constraint modeling page**
- a **school class creation page**
- groundwork for a **wedding table planning page**
- a shared generic core model for items, groups, containers, positions, relations, constraints, and preferences
- an in-browser MVP solver for container-based assignment scenarios

## Project status

This is an early MVP built with **plain JavaScript**, **HTML**, **CSS**, and **Vite**.

The app already includes:

- editable generic modeling UI
- validation -> normalization -> solve workflow
- local draft save/load
- JSON import/export
- multi-solution navigation
- a first working school-oriented authoring and solving flow

## Tech stack

- JavaScript (ES modules)
- HTML/CSS
- Vite

## Getting started

### Prerequisites

- Node.js 18+ recommended
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

### Run tests with coverage

```bash
npm run test:coverage
```

Open the HTML coverage report at:

```text
coverage/index.html
```

## Deploy to GitHub Pages

This repository is configured to deploy automatically to **GitHub Pages** using **GitHub Actions**.

### Included automation

- `vite.config.js` sets the correct base path for the repository site
- `.github/workflows/deploy.yml` runs tests, runs coverage, uploads the coverage artifact, builds the app, and deploys the `dist/` folder to GitHub Pages on every push to `main`
- `.gitignore` excludes local build and dependency folders

### Deploy flow

Every push to `main` will:

- install dependencies with `npm ci`
- run tests with `npm run test`
- run coverage with `npm run test:coverage`
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
  pages/        # generic, school, wedding pages
  solver/       # solver boundary and adapters
  storage/      # local drafts, import/export, model versioning
  utils/        # shared helpers
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

## Solver scope in the current MVP

The first solver adapter currently focuses on a narrow but working subset:

- container-mode assignment
- position-mode assignment
- maximum-capacity enforcement
- must-share constraints
- must-not-share constraints
- hard adjacency constraints in position mode
- multiple returned solutions

Some advanced semantics are modeled in the app but not yet fully solved by the first adapter.

## Testing

Solver and normalization tests are organized around generic semantics rather than page/domain features.

Current test areas include:

- normalization derivations such as adjacency maps and must-share components
- first solver adapter behavior in container mode
- first solver adapter behavior in position mode
- solver validation and warnings
- solver support modules and capability reporting

Tests use small scenario helpers under `tests/helpers/` to keep constraints readable with low boilerplate.

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
