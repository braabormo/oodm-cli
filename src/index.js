'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { langOf, isTestPath, collectFiles, getParser } = require('./parsers');
const { analyzeFile, buildClasses } = require('./analyzers');
const { cboMap, lcom, ditMap, nocMap, polymorphismFactor, reuseIndex, maintainabilityIndex } = require('./metrics');
const {
    findInputs, findCoverageReport, readCoverageReport,
    parseClassDiagram, checkStructure, parseSequence, checkSequence,
    checkUsecases, checkArchitecture
} = require('./diagrams');
const { renderTable, renderCsv, renderMd, renderHtml } = require('./render');

const VERSION = pkg.version || '2.0.0';

const HELP_TEXT = `oodm ${VERSION} - measure 16 object-oriented design / code-quality metrics in one command.
Supports Python, Java, C#, JavaScript/TypeScript, and C++ out of the box (WebAssembly tree-sitter).

Usage:
  npx oodm-cli [path] [options]

Options:
  --format <type>          table | json | csv | md | html (default: html)
  --out <file>             output file (default: oodm-report.html for HTML)
  --no-docstring-check     exclude missing documentation from style findings
  --details                print worst offenders and diagram gaps (with --format table)
  --limit <n>              items per section with --details (default: 10)
  --include-tests          include test files in design metrics
  --coverage-report <file> existing JaCoCo / Cobertura / lcov report (auto-detected if present)
  --class-diagram <file>   PlantUML (.puml) or JSON class diagram
  --sequence <file>        PlantUML sequence diagram
  --usecases <file>        text file, one use case per line ('Name | kw1, kw2' optional)
  --arch <file>            architecture.json with layers and allowed dependencies
  --arch-score <num>       manual Architectural Compliance score (1-10)
  --baseline <file>        previous JSON report; normalizes Reuse Index like QMOOD
  -v, --version            show version
  -h, --help               show this help
`;

function parseArgs(argv) {
    const args = {
        path: '.',
        format: 'html',
        out: null,
        noDocstringCheck: false,
        details: false,
        limit: 10,
        includeTests: false,
        coverageReport: null,
        classDiagram: null,
        sequence: null,
        usecases: null,
        arch: null,
        archScore: null,
        baseline: null,
        help: false,
        version: false
    };

    const takeVal = (i, eqVal, flag) => {
        if (eqVal !== undefined) return [eqVal, i];
        if (i + 1 >= argv.length) throw new Error(`missing value for ${flag}`);
        return [argv[i + 1], i + 1];
    };

    let positionalSet = false;
    for (let i = 0; i < argv.length; i++) {
        let raw = argv[i];
        if (raw === '-h' || raw === '--help') { args.help = true; continue; }
        if (raw === '-v' || raw === '--version') { args.version = true; continue; }
        if (raw === '--no-docstring-check') { args.noDocstringCheck = true; continue; }
        if (raw === '--details') { args.details = true; continue; }
        if (raw === '--include-tests') { args.includeTests = true; continue; }

        let flag = raw;
        let eqVal;
        if (raw.startsWith('--') && raw.includes('=')) {
            const idx = raw.indexOf('=');
            flag = raw.slice(0, idx);
            eqVal = raw.slice(idx + 1);
        }

        if (flag === '--format') {
            [args.format, i] = takeVal(i, eqVal, flag);
            if (!['table', 'json', 'csv', 'md', 'html'].includes(args.format)) {
                throw new Error(`invalid --format '${args.format}' (choose table, json, csv, md, html)`);
            }
        } else if (flag === '--out') {
            [args.out, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--limit') {
            let v;
            [v, i] = takeVal(i, eqVal, flag);
            args.limit = Math.max(1, parseInt(v, 10) || 10);
        } else if (flag === '--coverage-report') {
            [args.coverageReport, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--class-diagram') {
            [args.classDiagram, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--sequence') {
            [args.sequence, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--usecases') {
            [args.usecases, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--arch') {
            [args.arch, i] = takeVal(i, eqVal, flag);
        } else if (flag === '--arch-score') {
            let v;
            [v, i] = takeVal(i, eqVal, flag);
            const num = parseFloat(v);
            if (Number.isNaN(num)) throw new Error(`invalid --arch-score '${v}'`);
            args.archScore = num;
        } else if (flag === '--baseline') {
            [args.baseline, i] = takeVal(i, eqVal, flag);
        } else if (raw.startsWith('-')) {
            throw new Error(`unknown option '${raw}' (run with --help)`);
        } else if (!positionalSet) {
            args.path = raw;
            positionalSet = true;
        }
    }
    return args;
}

async function analyze(a) {
    const root = path.resolve(a.path);
    const allFiles = collectFiles(root);
    const srcFiles = allFiles.filter((f) => a.includeTests || !isTestPath(f, root));
    const testFiles = allFiles.filter((f) => isTestPath(f, root));

    if (srcFiles.length === 0) return null;

    const infos = [];
    const errors = [];
    const skipped = {};

    for (const fp of srcFiles) {
        const lang = langOf(fp);
        const parser = await getParser(lang);
        if (!parser) {
            skipped[lang] = (skipped[lang] || 0) + 1;
            continue;
        }
        try {
            const res = analyzeFile(fp, root, lang, parser, !a.noDocstringCheck);
            if (res.error) errors.push(res.error);
            else infos.push(res.info);
        } catch (err) {
            const rel = path.relative(root, fp).split(path.sep).join('/');
            errors.push(`${rel}: ${err.message}`);
        }
    }

    if (infos.length === 0) return null;

    const classes = buildClasses(infos);
    const classKeys = Object.keys(classes);
    const rows = [];
    const details = {};
    let compOut = {};

    const addRow = (id, metric, dimension, value, display, better, source, note = '') => {
        rows.push({
            id, metric, dimension, value,
            display: value !== null && value !== undefined ? display : 'N/A',
            better, source, note
        });
    };

    const slocTotal = infos.reduce((acc, fi) => acc + (fi.stats ? fi.stats.sloc : 0), 0);
    const NA_CLS = 'no classes found';

    // 1-3 Reusability
    if (classKeys.length > 0) {
        const cb = cboMap(classes);
        const cboEntries = Object.entries(cb).map(([n, s]) => [n, s.size]);
        const avgCbo = cboEntries.reduce((acc, [, v]) => acc + v, 0) / cboEntries.length;
        cboEntries.sort((x, y) => y[1] - x[1]);
        const [worstCboName, worstCboVal] = cboEntries[0];
        addRow(1, 'Coupling Between Objects (CBO)', 'Reusability', avgCbo, avgCbo.toFixed(2), 'lower', 'native',
            `avg per class; max ${worstCboVal} (${worstCboName})`);
        details['CBO - most coupled classes'] = cboEntries.slice(0, 10).map(([n, v]) => {
            const peers = [...cb[n]].sort().slice(0, 6).join(', ');
            return `${n}: ${v} (${peers}${v > 6 ? ', ...' : ''})`;
        });

        const lcEntries = Object.entries(classes)
            .map(([n, c]) => [n, lcom(c)])
            .filter(([, v]) => v !== null);
        if (lcEntries.length > 0) {
            const avgL = lcEntries.reduce((acc, [, v]) => acc + v, 0) / lcEntries.length;
            lcEntries.sort((x, y) => y[1] - x[1]);
            const [wlName, wlVal] = lcEntries[0];
            addRow(2, 'Lack of Cohesion in Methods (LCOM)', 'Reusability', avgL, avgL.toFixed(2), 'lower', 'native',
                `CK definition; avg across ${lcEntries.length} concrete classes (interfaces excluded); max ${wlVal} (${wlName})`);
            details['LCOM - least cohesive classes'] = lcEntries.slice(0, 10).map(([n, v]) => `${n}: ${v}`);
        } else {
            addRow(2, 'Lack of Cohesion in Methods (LCOM)', 'Reusability', null, '', 'lower', 'native',
                'not applicable: no eligible concrete classes');
        }

        let base = null;
        if (a.baseline) {
            try {
                base = JSON.parse(fs.readFileSync(a.baseline, 'utf8')).components || null;
            } catch {
                console.error(`warning: could not read baseline ${a.baseline}`);
            }
        }
        const { idx: ri, comp } = reuseIndex(classes, avgCbo, base);
        compOut = comp;
        addRow(3, 'Reuse Index', 'Reusability', ri, ri.toFixed(2), 'higher', 'native (QMOOD)',
            base ? 'normalized to baseline' : 'raw QMOOD; use --baseline old.json to normalize');
    } else {
        addRow(1, 'Coupling Between Objects (CBO)', 'Reusability', null, '', 'lower', 'native', NA_CLS);
        addRow(2, 'Lack of Cohesion in Methods (LCOM)', 'Reusability', null, '', 'lower', 'native', NA_CLS);
        addRow(3, 'Reuse Index', 'Reusability', null, '', 'higher', 'native', NA_CLS);
    }

    // 4-6 Maintainability
    const funcs = infos.flatMap((fi) => fi.funcs);
    const ccByFile = {};
    for (const fn of funcs) ccByFile[fn.rel] = (ccByFile[fn.rel] || 0) + fn.cc;

    const fileMi = [];
    for (const fi of infos) {
        const v = maintainabilityIndex(fi.stats, ccByFile[fi.rel] || 0);
        if (v !== null) fileMi.push([v, fi.rel]);
    }
    if (fileMi.length > 0) {
        fileMi.sort((x, y) => x[0] - y[0]);
        const miAvg = fileMi.reduce((acc, [v]) => acc + v, 0) / fileMi.length;
        addRow(4, 'Maintainability Index (MI)', 'Maintainability', miAvg, miAvg.toFixed(1), 'higher', 'native',
            `0-100, mean of files; min ${fileMi[0][0].toFixed(1)}`);
        details['MI - weakest files'] = fileMi.slice(0, 15).map(([v, name]) => `${v.toFixed(1)}  ${name}`);
    } else {
        addRow(4, 'Maintainability Index (MI)', 'Maintainability', null, '', 'higher', 'native', 'no code');
    }

    if (funcs.length > 0) {
        const ccAvg = funcs.reduce((acc, f) => acc + f.cc, 0) / funcs.length;
        const sortedCc = [...funcs].sort((x, y) => y.cc - x.cc);
        const over10 = funcs.filter((f) => f.cc > 10).length;
        addRow(5, 'Cyclomatic Complexity (CC)', 'Maintainability', ccAvg, ccAvg.toFixed(2), 'lower', 'native',
            `avg per function; max ${sortedCc[0].cc}; ${over10} functions > 10`);
        details['CC - most complex functions'] = sortedCc.slice(0, 10).map((f) => `${f.cc}  ${f.qual} (${f.rel}:${f.line})`);
    } else {
        addRow(5, 'Cyclomatic Complexity (CC)', 'Maintainability', null, '', 'lower', 'native', 'no functions');
    }

    const sec = infos.flatMap((fi) => fi.sec);
    const bugs = infos.flatMap((fi) => fi.bugs);
    if (slocTotal > 0) {
        const dd = (sec.length + bugs.length) / (slocTotal / 1000.0);
        addRow(6, 'Defect Density', 'Maintainability', dd, `${dd.toFixed(2)} /KLOC`, 'lower', 'native (proxy)',
            `${sec.length} security + ${bugs.length} bug-pattern findings / ${slocTotal} SLOC`);
    } else {
        addRow(6, 'Defect Density', 'Maintainability', null, '', 'lower', 'native (proxy)', 'no code');
    }
    details['Bug-pattern findings'] = bugs.slice(0, 30).map((x) => `${x.file}:${x.line}  ${x.message}`);

    // 7-9 Extensibility
    if (classKeys.length > 0) {
        const dm = ditMap(classes);
        const nm = nocMap(classes);
        const dmEntries = Object.entries(dm).sort((x, y) => y[1] - x[1]);
        const nmEntries = Object.entries(nm).sort((x, y) => y[1] - x[1]);
        const ditAvg = dmEntries.reduce((acc, [, v]) => acc + v, 0) / dmEntries.length;
        const nocAvg = nmEntries.reduce((acc, [, v]) => acc + v, 0) / nmEntries.length;
        addRow(7, 'Depth of Inheritance Tree (DIT)', 'Extensibility', ditAvg, ditAvg.toFixed(2), '', 'native',
            `avg per class; max ${dmEntries[0][1]} (${dmEntries[0][0]})`);
        addRow(8, 'Number of Children (NOC)', 'Extensibility', nocAvg, nocAvg.toFixed(2), '', 'native',
            `avg per class; max ${nmEntries[0][1]} (${nmEntries[0][0]})`);
        const pf = polymorphismFactor(classes);
        addRow(9, 'Polymorphism Factor (PF)', 'Extensibility', pf, pf.toFixed(3), 'higher', 'native (MOOD)',
            'overridden / (new methods x descendants), 0..1');
    } else {
        addRow(7, 'Depth of Inheritance Tree (DIT)', 'Extensibility', null, '', '', 'native', NA_CLS);
        addRow(8, 'Number of Children (NOC)', 'Extensibility', null, '', '', 'native', NA_CLS);
        addRow(9, 'Polymorphism Factor (PF)', 'Extensibility', null, '', '', 'native', NA_CLS);
    }

    // 10-12 Diagram Fidelity
    const clsFiles = a.classDiagram ? [a.classDiagram] : findInputs(root, ['class*.puml', 'class*.plantuml', 'class*.json']);
    if (clsFiles.length > 0) {
        const sc = new Map();
        const sr = [];
        for (const f of clsFiles) {
            try {
                const { classes: c1, rels: r1 } = parseClassDiagram(f);
                for (const [k, v] of c1.entries()) {
                    if (!sc.has(k)) sc.set(k, new Set());
                    for (const m of v) sc.get(k).add(m);
                }
                sr.push(...r1);
            } catch (e) {
                console.error(`warning: cannot parse ${f}: ${e.message}`);
            }
        }
        const { value, note, missing } = checkStructure(classes, sc, sr);
        addRow(10, 'Structural Traceability (%)', 'Diagram Fidelity', value, `${(value || 0).toFixed(1)}%`, 'higher', 'diagram vs code', note);
        details['Structural Traceability - gaps'] = missing;
    } else {
        addRow(10, 'Structural Traceability (%)', 'Diagram Fidelity', null, '', 'higher', '-', 'provide class*.puml (or --class-diagram)');
    }

    const seqFiles = a.sequence ? [a.sequence] : findInputs(root, ['seq*.puml', 'seq*.plantuml']);
    if (seqFiles.length > 0) {
        const msgs = [];
        const actors = new Set();
        for (const f of seqFiles) {
            try {
                const { msgs: m1, actors: a1 } = parseSequence(f);
                msgs.push(...m1);
                for (const x of a1) actors.add(x);
            } catch (e) {
                console.error(`warning: cannot read ${f}: ${e.message}`);
            }
        }
        const { value, note, missing } = checkSequence(classes, msgs, actors);
        addRow(11, 'Behavioral Fidelity (%)', 'Diagram Fidelity', value, `${(value || 0).toFixed(1)}%`, 'higher', 'diagram vs code',
            note + '; static check, order not verified');
        details['Behavioral Fidelity - gaps'] = missing;
    } else {
        addRow(11, 'Behavioral Fidelity (%)', 'Diagram Fidelity', null, '', 'higher', '-', 'provide seq*.puml (or --sequence)');
    }

    const ucFiles = a.usecases ? [a.usecases] : findInputs(root, ['usecases.txt', 'use_cases.txt', 'use-cases.txt']);
    if (ucFiles.length > 0) {
        const { value, note, missing } = checkUsecases(ucFiles[0], funcs, classes);
        addRow(12, 'Use Case Coverage (%)', 'Diagram Fidelity', value, `${(value || 0).toFixed(1)}%`, 'higher', 'usecases vs code', note);
        details['Use Case Coverage - gaps'] = missing;
    } else {
        addRow(12, 'Use Case Coverage (%)', 'Diagram Fidelity', null, '', 'higher', '-', 'provide usecases.txt (or --usecases)');
    }

    // 13 Architecture
    const archFiles = a.arch ? [a.arch] : findInputs(root, ['arch*.json']);
    if (a.archScore !== null) {
        addRow(13, 'Architectural Compliance (1-10)', 'Design Quality', a.archScore, `${a.archScore.toFixed(1)}/10`,
            'higher', 'manual', 'value given with --arch-score');
    } else if (archFiles.length > 0) {
        try {
            const { value, note, missing } = checkArchitecture(archFiles[0], infos, classes);
            addRow(13, 'Architectural Compliance (1-10)', 'Design Quality', value, `${value.toFixed(1)}/10`, 'higher', 'rules', note);
            details['Architectural Compliance - violations'] = missing.slice(0, 30);
        } catch (e) {
            addRow(13, 'Architectural Compliance (1-10)', 'Design Quality', null, '', 'higher', 'rules', `bad architecture.json: ${e.message}`);
        }
    } else {
        addRow(13, 'Architectural Compliance (1-10)', 'Design Quality', null, '', 'higher', '-',
            'provide architecture.json or --arch-score N');
    }

    // 14 Security
    const high = sec.filter((x) => x.severity === 'high').length;
    const med = sec.filter((x) => x.severity === 'medium').length;
    addRow(14, 'Security Issues Count (high)', 'Reliability', high, String(high), 'lower', 'native',
        `${med} medium (pattern rules; not a full audit)`);
    details['Security findings'] = sec.slice(0, 30).map((x) => `[${x.severity}] ${x.file}:${x.line}  ${x.message}`);

    // 15 Test Coverage
    const repFile = a.coverageReport || findCoverageReport(root);
    if (repFile) {
        const { value, note } = readCoverageReport(repFile);
        addRow(15, 'Test Coverage (%)', 'Reliability', value, `${(value || 0).toFixed(1)}%`, 'higher',
            'report: ' + path.basename(repFile), note);
    } else {
        addRow(15, 'Test Coverage (%)', 'Reliability', null, '', 'higher', '-',
            'no coverage report found; generate JaCoCo/lcov/Cobertura or pass --coverage-report FILE');
    }

    // 16 Style / Readability
    const stAll = infos.flatMap((fi) => fi.style.items);
    const stmts = infos.reduce((acc, fi) => acc + fi.style.stmts, 0);
    if (stmts > 0) {
        const score = Math.max(0.0, 10.0 - (10.0 * stAll.length) / stmts);
        const catCounts = {};
        for (const x of stAll) catCounts[x.category] = (catCounts[x.category] || 0) + 1;
        const catNote = Object.entries(catCounts).sort().map(([k, v]) => `${v} ${k}`).join(', ');
        addRow(16, 'Style / Readability Score', 'Maintainability', score, `${score.toFixed(2)}/10`, 'higher', 'native',
            'pylint-like formula' + (catNote ? '; ' + catNote : ''));
    } else {
        addRow(16, 'Style / Readability Score', 'Maintainability', null, '', 'higher', 'native', 'no code');
    }

    const freq = {};
    for (const x of stAll) {
        const k = x.message.split('(')[0].split("'")[0].trim();
        freq[k] = (freq[k] || 0) + 1;
    }
    details['Style - most frequent issues'] = Object.entries(freq)
        .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${v} x ${k}`);
    details['Style findings (first 100)'] = stAll.slice(0, 100)
        .map((x) => `[${x.category}] ${x.file}:${x.line}  ${x.message}`);

    if (errors.length > 0) details['Files that could not be parsed'] = errors;
    if (Object.keys(skipped).length > 0) {
        details['Files skipped'] = Object.entries(skipped).map(([l, n]) => `${n} ${l} file(s): parser unavailable`);
    }

    rows.sort((x, y) => x.id - y.id);

    const langCounts = {};
    for (const fi of infos) langCounts[fi.lang] = (langCounts[fi.lang] || 0) + 1;

    const cleanDetails = {};
    for (const [k, v] of Object.entries(details)) {
        if (v && v.length > 0) cleanDetails[k] = v;
    }

    return {
        tool: 'oodm',
        version: VERSION,
        root,
        summary: {
            files: infos.length,
            classes: classKeys.length,
            sloc: slocTotal,
            test_files: testFiles.length,
            languages: langCounts
        },
        metrics: rows,
        components: compOut,
        details: cleanDetails
    };
}

async function main(argv) {
    let a;
    try {
        a = parseArgs(argv);
    } catch (err) {
        console.error('error:', err.message);
        return 2;
    }
    if (a.help) {
        console.log(HELP_TEXT);
        return 0;
    }
    if (a.version) {
        console.log(`oodm ${VERSION}`);
        return 0;
    }
    if (!fs.existsSync(a.path) || !fs.statSync(a.path).isDirectory()) {
        console.error(`error: ${a.path} is not a folder`);
        return 2;
    }

    const rep = await analyze(a);
    if (!rep) {
        console.error(`No supported source files (.py .java .cs .js .ts .cpp ...) in ${path.resolve(a.path)}`);
        return 1;
    }

    if (a.format === 'html' && !a.out) {
        a.out = path.join(process.cwd(), 'oodm-report.html');
    }

    const renderers = {
        table: () => renderTable(rep, a.details, a.limit),
        csv: () => renderCsv(rep),
        md: () => renderMd(rep),
        html: () => renderHtml(rep),
        json: () => JSON.stringify(rep, null, 2)
    };
    const text = renderers[a.format]();

    if (a.out) {
        fs.writeFileSync(a.out, text.endsWith('\n') ? text : text + '\n', 'utf8');
        console.log(`report written to ${a.out}`);
    } else {
        process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    }
    return 0;
}

module.exports = { VERSION, main, analyze };