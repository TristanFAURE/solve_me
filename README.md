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
- maximum-capacity enforcement
- must-share constraints
- must-not-share constraints
- multiple returned solutions

Some advanced semantics are modeled in the app but not yet fully solved by the first adapter.

## Documentation

Architecture and feature notes are available in `docs/`, including:
- core architecture
- domain semantics
- generic page behavior
- school page behavior
- import/export behavior
- solution display expectations

The project continuity log is maintained in `status.md`.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
