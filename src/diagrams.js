'use strict';

const fs = require('fs');
const path = require('path');
const { ancestors } = require('./metrics');

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'by', 'with', 'from', 'into', 'is', 'be']);

function norm(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitWords(s) {
    const spaced = String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').toLowerCase().trim();
    if (!spaced) return [];
    const out = [];
    for (const w of spaced.split(/\s+/)) {
        if (STOP.has(w)) continue;
        out.push(w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
    }
    return out;
}

function readText(filePath) {
    let txt = fs.readFileSync(filePath, 'utf8');
    return txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt;
}

function wildcardToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function findInputs(root, patterns) {
    const regexes = patterns.map(wildcardToRegex);
    const seen = new Set();
    const out = [];
    for (const sub of ['', 'docs', 'diagrams', 'doc']) {
        const dir = path.join(root, sub);
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entries) {
            if (!e.isFile()) continue;
            if (regexes.some((rx) => rx.test(e.name))) {
                const full = path.join(dir, e.name);
                if (!seen.has(full)) {
                    seen.add(full);
                    out.push(full);
                }
            }
        }
    }
    return out;
}

// --- Class Diagram ---
const DECL_RE = /^(?:abstract\s+class|abstract|class|interface|enum|annotation|entity)\s+(?:"([^"]+)"\s+as\s+(\w+)|([A-Za-z_][\w.]*))/;
const ARROWS = '(?:<\\|--|--\\|>|<\\|\\.\\.|\\.\\.\\|>|\\*--|--\\*|o--|--o|<--|-->|<\\.\\.|\\.\\.>|--|\\.\\.)';
const REL_RE = new RegExp(`^\\s*("?[\\w.]+"?)\\s*(?:"[^"]*"\\s*)?(${ARROWS})\\s*(?:"[^"]*"\\s*)?("?[\\w.]+"?)\\s*(?::.*)?$`);
const INHERIT_LEFT = new Set(['<|--', '<|..']);
const INHERIT_RIGHT = new Set(['--|>', '..|>']);

function cleanName(x) {
    return x.trim().replace(/^"|"$/g, '').split('.').pop();
}

function parseClassDiagram(filePath) {
    const classes = new Map();
    const rels = [];
    const alias = {};
    const addClass = (n) => { if (!classes.has(n)) classes.set(n, new Set()); };

    if (filePath.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(readText(filePath));
        for (const c of data.classes || []) {
            if (typeof c === 'string') addClass(c);
            else {
                addClass(c.name);
                for (const m of c.methods || []) classes.get(c.name).add(m);
            }
        }
        for (const r of data.relations || []) {
            rels.push([r.from, r.type || '--', r.to]);
        }
        return { classes, rels };
    }

    let cur = null;
    for (const raw of readText(filePath).split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || line.startsWith("'") || line.startsWith('@')) continue;
        line = line.replace(/(?<=[-.])(?:up|down|left|right)(?=[-.>])/g, '');
        if (cur !== null) {
            if (line.startsWith('}')) { cur = null; continue; }
            const mm = /([A-Za-z_]\w*)\s*\(/.exec(line);
            if (mm) classes.get(cur).add(mm[1]);
            continue;
        }
        let m = DECL_RE.exec(line);
        if (m) {
            const real = cleanName(m[1] || m[3]);
            addClass(real);
            if (m[2]) alias[m[2]] = real;
            for (const [kind, arrow] of [['extends', '<|--'], ['implements', '<|..']]) {
                const mx = new RegExp(`\\b${kind}\\s+([\\w.]+)`).exec(line);
                if (mx) rels.push([cleanName(mx[1]), arrow, real]);
            }
            if (line.endsWith('{')) cur = real;
            continue;
        }
        m = REL_RE.exec(line);
        if (m) {
            rels.push([cleanName(m[1]), m[2], cleanName(m[3])]);
            continue;
        }
        m = /^("?[\w.]+"?)\s*:\s*(.+)$/.exec(line);
        if (m && m[2].includes('(')) {
            const mm = /([A-Za-z_]\w*)\s*\(/.exec(m[2]);
            if (mm) {
                const cn = cleanName(m[1]);
                addClass(cn);
                classes.get(cn).add(mm[1]);
            }
        }
    }

    const resRels = rels.map(([a, t, b]) => [alias[a] || a, t, alias[b] || b]);
    for (const [a, , b] of resRels) { addClass(a); addClass(b); }
    const resClasses = new Map();
    for (const [k, v] of classes.entries()) {
        const rk = alias[k] || k;
        if (!resClasses.has(rk)) resClasses.set(rk, new Set());
        for (const m of v) resClasses.get(rk).add(m);
    }
    return { classes: resClasses, rels: resRels };
}

function methodNorms(classes, c) {
    const out = new Set(c.methods.map(norm));
    for (const a of ancestors(classes, c.key)) {
        for (const m of classes[a].methods) out.add(norm(m));
    }
    return out;
}

function byNormMap(classes) {
    const out = new Map();
    for (const c of Object.values(classes)) {
        const k = norm(c.name);
        if (!out.has(k)) out.set(k, c);
    }
    return out;
}

function baseNames(classes, c) {
    return new Set(c.bases.map((b) => norm(classes[b] ? classes[b].name : b)));
}

function checkStructure(classes, specClasses, specRels) {
    const byNorm = byNormMap(classes);
    const cnt = { class: [0, 0], method: [0, 0], relation: [0, 0] };
    const missing = [];

    const rec = (kind, label, ok) => {
        cnt[kind][1] += 1;
        if (ok) cnt[kind][0] += 1;
        else missing.push(`${kind} not found in code: ${label}`);
    };

    for (const [name, methods] of specClasses.entries()) {
        const c = byNorm.get(norm(name));
        rec('class', name, !!c);
        for (const m of [...methods].sort()) {
            rec('method', `${name}.${m}()`, !!(c && methodNorms(classes, c).has(norm(m))));
        }
    }

    for (const [a, arrow, b] of specRels) {
        const ca = byNorm.get(norm(a));
        const cb = byNorm.get(norm(b));
        if (INHERIT_LEFT.has(arrow) || INHERIT_RIGHT.has(arrow)) {
            const [parent, child] = INHERIT_LEFT.has(arrow) ? [a, b] : [b, a];
            const cc = byNorm.get(norm(child));
            rec('relation', `${child} inherits ${parent}`, !!(cc && baseNames(classes, cc).has(norm(parent))));
        } else {
            rec('relation', `${a} ${arrow} ${b}`, !!(ca && cb && (ca.refs.has(cb.key) || cb.refs.has(ca.key))));
        }
    }

    const total = cnt.class[1] + cnt.method[1] + cnt.relation[1];
    const passed = cnt.class[0] + cnt.method[0] + cnt.relation[0];
    const specNorms = new Set([...specClasses.keys()].map(norm));
    const extras = Object.values(classes).map((c) => c.name).filter((n) => !specNorms.has(norm(n))).sort();
    let note = `classes ${cnt.class[0]}/${cnt.class[1]}, methods ${cnt.method[0]}/${cnt.method[1]}, relations ${cnt.relation[0]}/${cnt.relation[1]}`;
    if (extras.length > 0) {
        note += `; ${extras.length} code classes not in diagram`;
        missing.push('code classes missing from diagram: ' + extras.slice(0, 15).join(', '));
    }
    return { value: total ? (100.0 * passed) / total : null, note, missing };
}

// --- Sequence Diagram ---
const PART_RE = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i;
const MSG_RE = /^("[^"]+"|[\w.]+)\s*(-{1,2}>{1,2}|<{1,2}-{1,2})\s*("[^"]+"|[\w.]+)\s*:\s*(.+)$/;

function parseSequence(filePath) {
    const alias = {};
    const actors = new Set();
    const msgs = [];
    for (const raw of readText(filePath).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("'") || line.startsWith('@')) continue;
        let m = PART_RE.exec(line);
        if (m) {
            const kind = m[1].toLowerCase();
            const rest = m[2].trim();
            let real, al = null;
            let m1;
            if ((m1 = /^"([^"]+)"\s+as\s+(\w+)/.exec(rest))) { real = m1[1]; al = m1[2]; }
            else if ((m1 = /^(\w+)\s+as\s+"([^"]+)"/.exec(rest))) { real = m1[2]; al = m1[1]; }
            else if ((m1 = /^(\w+)\s+as\s+(\w+)$/.exec(rest))) { real = m1[1]; al = m1[2]; }
            else { real = rest.replace(/^"|"$/g, '').split(/\s+/)[0]; }
            if (al) alias[al] = real;
            if (kind === 'actor') actors.add(real);
            continue;
        }
        m = MSG_RE.exec(line);
        if (m) {
            const a = m[1].replace(/^"|"$/g, '');
            const arrow = m[2];
            const b = m[3].replace(/^"|"$/g, '');
            let label = m[4].trim();
            if (arrow.includes('--')) continue;
            const [frm, to] = arrow.startsWith('-') ? [a, b] : [b, a];
            label = label.replace(/^\d+[.)]\s*/, '');
            const name = label.split('(')[0].trim();
            if (!name || name.toLowerCase().startsWith('return')) continue;
            msgs.push([frm, to, name]);
        }
    }
    const res = (x) => alias[x] || x;
    const resActors = new Set([...actors, ...[...actors].map(res)]);
    return { msgs: msgs.map(([f, t, n]) => [res(f), res(t), n]), actors: resActors };
}

function checkSequence(classes, msgs, actors) {
    const byNorm = byNormMap(classes);
    const actorNorm = new Set([...actors].map(norm));
    let total = 0;
    let passed = 0;
    const problems = [];

    for (const [frm, to, name] of msgs) {
        if (actorNorm.has(norm(to))) continue;
        total += 1;
        const tc = byNorm.get(norm(to));
        if (!tc) {
            problems.push(`${frm} -> ${to} : ${name}  (class '${to}' not found)`);
            continue;
        }
        if (!methodNorms(classes, tc).has(norm(name))) {
            problems.push(`${frm} -> ${to} : ${name}  (method not defined in ${tc.name})`);
            continue;
        }
        const sc = byNorm.get(norm(frm));
        const scCalls = sc ? new Set([...sc.calls].map(norm)) : null;
        if (actorNorm.has(norm(frm)) || !sc || scCalls.has(norm(name))) {
            passed += 1;
        } else {
            problems.push(`${frm} -> ${to} : ${name}  (${sc.name} never calls it)`);
        }
    }
    return {
        value: total ? (100.0 * passed) / total : null,
        note: `${passed}/${total} messages verified`,
        missing: problems
    };
}

// --- Use Cases ---
function checkUsecases(filePath, funcs, classes) {
    const units = [];
    for (const fn of funcs) {
        const toks = new Set();
        for (const part of fn.qual.split('.')) {
            for (const w of splitWords(part)) toks.add(w);
        }
        units.push(toks);
    }
    for (const c of Object.values(classes)) {
        units.push(new Set(splitWords(c.name)));
    }

    let total = 0;
    let covered = 0;
    const missing = [];
    for (const raw of readText(filePath).split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        line = line.replace(/^\s*(?:[-*\u2022]|\d+[.)]|UC[-_ ]?\d+\s*[:.-])\s*/i, '');
        const pipeIdx = line.indexOf('|');
        const name = pipeIdx >= 0 ? line.slice(0, pipeIdx) : line;
        const kws = pipeIdx >= 0 ? line.slice(pipeIdx + 1) : '';
        let ok = false;
        if (kws.trim()) {
            const wanted = kws.split(',').map((k) => new Set(splitWords(k))).filter((s) => s.size > 0);
            ok = wanted.some((w) => units.some((u) => [...w].every((x) => u.has(x))));
        } else {
            const w = new Set(splitWords(name));
            if (w.size === 0) continue;
            ok = units.some((u) => [...w].filter((x) => u.has(x)).length / w.size >= 0.66);
        }
        total += 1;
        if (ok) covered += 1;
        else missing.push('use case without matching code: ' + name.trim());
    }
    return {
        value: total ? (100.0 * covered) / total : null,
        note: `${covered}/${total} use cases matched (name heuristic)`,
        missing
    };
}

// --- Architecture ---
function moduleName(rel) {
    const parts = rel.replace(/\.py$/i, '').split('/');
    if (parts[parts.length - 1] === '__init__') parts.pop();
    return parts.join('.');
}

function pythonImportDeps(fi, modmap) {
    const deps = new Set();
    for (const imp of fi.pyImports || []) {
        let cands = [];
        if (imp.kind === 'import') {
            cands = [imp.name];
        } else {
            let base = imp.module || '';
            if (imp.level) {
                let pkg = moduleName(fi.rel).split('.');
                if (!fi.isInit) pkg = pkg.slice(0, -1);
                pkg = pkg.slice(0, Math.max(0, pkg.length - (imp.level - 1)));
                base = [...pkg, ...(imp.module ? [imp.module] : [])].join('.');
            }
            cands = [base, ...imp.names.map((n) => (base ? `${base}.${n}` : n))];
        }
        for (const c of cands) {
            if (!c) continue;
            for (const [m, rel2] of modmap.entries()) {
                if (rel2 !== fi.rel && (m === c || m.endsWith('.' + c))) deps.add(rel2);
            }
        }
    }
    return deps;
}

function checkArchitecture(filePath, fileInfos, classes) {
    const cfg = JSON.parse(readText(filePath));
    const layers = cfg.layers || {};
    const allow = cfg.allow || {};

    const layerOf = (rel) => {
        const low = '/' + rel.toLowerCase();
        for (const [name, pats] of Object.entries(layers)) {
            const list = typeof pats === 'string' ? [pats] : pats;
            for (const p of list) {
                if (low.includes(String(p).toLowerCase())) return name;
            }
        }
        return null;
    };

    const modmap = new Map();
    for (const fi of fileInfos) {
        if (fi.lang === 'python') modmap.set(moduleName(fi.rel), fi.rel);
    }
    const byFile = new Map();
    for (const c of Object.values(classes)) {
        if (!byFile.has(c.rel)) byFile.set(c.rel, new Set());
        for (const x of c.refs) {
            if (classes[x]) byFile.get(c.rel).add(classes[x].rel);
        }
    }

    let total = 0;
    let viol = 0;
    const problems = [];
    for (const fi of fileInfos) {
        const la = layerOf(fi.rel);
        if (!la) continue;
        const rawDeps = fi.lang === 'python' ? pythonImportDeps(fi, modmap) : (byFile.get(fi.rel) || new Set());
        const deps = [...rawDeps].filter((d) => d !== fi.rel).sort();
        for (const d of deps) {
            const lb = layerOf(d);
            if (!lb || lb === la) continue;
            total += 1;
            if (!(allow[la] || []).includes(lb)) {
                viol += 1;
                problems.push(`layer violation: ${fi.rel} (${la}) -> ${d} (${lb})`);
            }
        }
    }
    const score = total === 0 ? 10.0 : Math.round(10.0 * (1 - viol / total) * 10) / 10;
    return { value: score, note: `${viol} violations in ${total} cross-layer dependencies`, missing: problems };
}

// --- Coverage Reports (JaCoCo / lcov / Cobertura) ---
const COVERAGE_FILES = [
    ['jacoco.xml', 'jacoco'],
    ['lcov.info', ''],
    ['coverage.cobertura.xml', ''],
    ['cobertura-coverage.xml', ''],
    ['cobertura.xml', ''],
    ['coverage.xml', '']
];

function findCoverageReport(root, maxDepth = 6) {
    const found = new Map();
    const skip = new Set(['.git', 'node_modules', 'venv', '.venv', '__pycache__']);
    const stack = [[root, 0]];
    while (stack.length > 0) {
        const [dir, depth] = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (!skip.has(e.name) && depth < maxDepth) stack.push([path.join(dir, e.name), depth + 1]);
            } else if (e.isFile()) {
                for (let rank = 0; rank < COVERAGE_FILES.length; rank++) {
                    const [name, must] = COVERAGE_FILES[rank];
                    if (e.name === name && (!must || dir.includes(must)) && !found.has(rank)) {
                        found.set(rank, path.join(dir, e.name));
                    }
                }
            }
        }
    }
    if (found.size === 0) return null;
    const best = Math.min(...found.keys());
    return found.get(best);
}

function readCoverageReport(filePath) {
    try {
        const content = readText(filePath);
        if (filePath.toLowerCase().endsWith('.info') || filePath.toLowerCase().endsWith('.lcov')) {
            let lf = 0;
            let lh = 0;
            for (const line of content.split(/\r?\n/)) {
                if (line.startsWith('LF:')) lf += parseInt(line.slice(3), 10) || 0;
                else if (line.startsWith('LH:')) lh += parseInt(line.slice(3), 10) || 0;
            }
            return { value: lf ? (100.0 * lh) / lf : null, note: 'lcov report' };
        }
        if (/<report\b/.test(content)) {
            // JaCoCo top-level LINE counter is near the end of the file
            const matches = [...content.matchAll(/<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"/g)];
            if (matches.length > 0) {
                const last = matches[matches.length - 1];
                const miss = parseInt(last[1], 10);
                const cov = parseInt(last[2], 10);
                return { value: miss + cov ? (100.0 * cov) / (miss + cov) : null, note: 'JaCoCo report' };
            }
        }
        const covTag = /<coverage\b([^>]+)>/.exec(content);
        if (covTag) {
            const attrs = covTag[1];
            const lv = /lines-valid="(\d+)"/.exec(attrs);
            const lc = /lines-covered="(\d+)"/.exec(attrs);
            if (lv && lc) {
                const valid = parseInt(lv[1], 10);
                const covered = parseInt(lc[1], 10);
                return { value: valid ? (100.0 * covered) / valid : null, note: 'Cobertura report' };
            }
            const lr = /line-rate="([0-9.]+)"/.exec(attrs);
            if (lr) return { value: 100.0 * parseFloat(lr[1]), note: 'Cobertura report' };
        }
    } catch {
        // ignore parse errors
    }
    return { value: null, note: 'unreadable coverage report' };
}

module.exports = {
    findInputs,
    findCoverageReport,
    readCoverageReport,
    parseClassDiagram,
    checkStructure,
    parseSequence,
    checkSequence,
    checkUsecases,
    checkArchitecture
};