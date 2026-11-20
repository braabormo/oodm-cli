<div align="center">

<p>
  <a href="https://braabormo.github.io/oodm-cli/">
    <img src="assets/logo.png" alt="OODM Logo" height="54" />
  </a>
</p>

# OODM CLI

**Measure 16 Object-Oriented Design & Code Quality metrics across 15 programming languages in one command.**

Zero setup · Powered by WebAssembly (`web-tree-sitter`) · 100% local & private · Bilingual interactive HTML report (Arabic & English)

[![npm version](https://img.shields.io/npm/v/oodm-cli?color=00B4FF&style=flat-square)](https://www.npmjs.com/package/oodm-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-00B4FF?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-00B4FF?style=flat-square)](https://nodejs.org)
[![Languages](https://img.shields.io/badge/Languages-15-00B4FF?style=flat-square)](#supported-languages)

[Live Website](https://braabormo.github.io/oodm-cli/) · [npm Package](https://www.npmjs.com/package/oodm-cli) · [Report a Bug](https://github.com/braabormo/oodm-cli/issues)

</div>

---

## Quick Start

Run inside any project folder — no installation or extra dependencies required:

```bash
npx oodm-cli@latest
```

This scans the current directory and generates an interactive bilingual dashboard at **`oodm-report.html`** with:
- Overall Project Health Score (`0–100%`)
- Color-coded grades (**Excellent / Good / Acceptable / Needs Work**)
- Clear scales, target ranges, and plain-language explanations for every metric
- A **Priority Improvement Plan** with actionable refactoring advice
- Searchable file-and-line findings

---

## Supported Languages

All parsers are bundled as WebAssembly (`.wasm`) and lazy-loaded only for languages found in your project:

| Language | Extensions |
|---|---|
| **Dart / Flutter** | `.dart` *(auto-skips `.g.dart`, `.freezed.dart`, `.gr.dart`, `.dart_tool`)* |
| **Python** | `.py` |
| **JavaScript / JSX** | `.js`, `.jsx`, `.mjs`, `.cjs` |
| **TypeScript / TSX** | `.ts`, `.mts`, `.cts`, `.tsx` |
| **Java** | `.java` |
| **C# / .NET** | `.cs` |
| **PHP / Laravel** | `.php` |
| **Kotlin** | `.kt`, `.kts` |
| **Swift** | `.swift` |
| **Go** | `.go` |
| **Rust** | `.rs` |
| **C++** | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.h` |
| **C** | `.c` |
| **Ruby** | `.rb` |

---

## The 16 Measured Metrics

| # | Metric | Dimension | Ideal Target |
|---:|---|---|---|
| 1 | **Coupling Between Objects (CBO)** | Reusability | `≤ 4` avg/class |
| 2 | **Lack of Cohesion in Methods (LCOM)** | Reusability | `0 – 1` |
| 3 | **Reuse Index (QMOOD)** | Reusability | Higher is better |
| 4 | **Maintainability Index (MI)** | Maintainability | `≥ 80 / 100` |
| 5 | **Cyclomatic Complexity (CC)** | Maintainability | `≤ 5` avg/function |
| 6 | **Defect Density** | Maintainability | `0` / 1K SLOC |
| 7 | **Depth of Inheritance Tree (DIT)** | Extensibility | `0 – 3` |
| 8 | **Number of Children (NOC)** | Extensibility | `0 – 4` |
| 9 | **Polymorphism Factor (PF)** | Extensibility | `≥ 0.100` |
| 10 | **Structural Traceability (%)** | Diagram Fidelity | `≥ 90%` |
| 11 | **Behavioral Fidelity (%)** | Diagram Fidelity | `≥ 90%` |
| 12 | **Use Case Coverage (%)** | Diagram Fidelity | `≥ 90%` |
| 13 | **Architectural Compliance (1–10)** | Design Quality | `≥ 9.0 / 10` |
| 14 | **Security Issues Count (high)** | Reliability | `0` |
| 15 | **Test Coverage (%)** | Reliability | `≥ 80%` |
| 16 | **Style / Readability Score** | Maintainability | `≥ 8.5 / 10` |

---

## Usage & CLI Options

```bash
# Scan a specific folder
npx oodm-cli@latest ./path/to/project

# Print table + worst offenders directly in terminal
npx oodm-cli@latest --format table --details

# Export JSON, CSV, Markdown, or custom HTML path
npx oodm-cli@latest --format json --out report.json
npx oodm-cli@latest --format md --out QUALITY.md
npx oodm-cli@latest --format html --out custom-report.html

# Exclude missing docstring/comment checks from style score
npx oodm-cli@latest --no-docstring-check

# Normalize QMOOD Reuse Index against a previous baseline report
npx oodm-cli@latest --baseline baseline.json
```

### All Options

| Option | Description |
|---|---|
| `--format <type>` | Output format: `html` (default), `table`, `json`, `csv`, `md` |
| `--out <file>` | Custom output file path (default: `oodm-report.html` for HTML) |
| `--details` | Print worst offenders and diagram gaps (used with `--format table`) |
| `--limit <n>` | Max items per section with `--details` (default: `10`) |
| `--no-docstring-check` | Ignore missing class/function documentation in style findings |
| `--include-tests` | Include test files in design metrics |
| `--coverage-report <file>` | Path to JaCoCo, lcov, or Cobertura coverage report |
| `--class-diagram <file>` | PlantUML (`.puml`) or JSON class diagram |
| `--sequence <file>` | PlantUML sequence diagram |
| `--usecases <file>` | Use cases file (`Name \| keyword1, keyword2` optional) |
| `--arch <file>` | `architecture.json` defining layers and allowed dependencies |
| `--arch-score <num>` | Manual Architectural Compliance score (`1–10`) |
| `--baseline <file>` | Previous JSON report to normalize QMOOD Reuse Index |
| `-v, --version` | Print tool version |
| `-h, --help` | Print help message |

---

## Optional Inputs (Auto-Detected)

Place any of these files in your project root, `./docs`, or `./diagrams` (or pass them via flags):

- **`class*.puml` / `class*.json`** → Structural Traceability (#10)
- **`seq*.puml`** → Behavioral Fidelity (#11)
- **`usecases.txt`** → Use Case Coverage (#12)
- **`architecture.json`** → Architectural Compliance (#13)
- **`lcov.info` / `jacoco.xml` / `cobertura.xml` / `coverage.xml`** → Test Coverage (#15)

Example `architecture.json`:

```json
{
  "layers": {
    "controllers": ["/controllers/", "/routes/"],
    "services": ["/services/"],
    "repositories": ["/repositories/", "/models/"]
  },
  "allow": {
    "controllers": ["services"],
    "services": ["repositories"],
    "repositories": []
  }
}
```

---

## Privacy

OODM runs **100% locally** on your machine. No source code, metrics, or telemetry are ever sent over the network.

---

## License

MIT © [Braa](https://github.com/braabormo/oodm-cli)