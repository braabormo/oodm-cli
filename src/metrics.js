'use strict';

const { dunder } = require('./analyzers');

const IGNORED_BASES = new Set([
    'object', 'ABC', 'ABCMeta', 'Protocol', 'Generic', 'NamedTuple',
    'TypedDict', 'Enum', 'IntEnum', 'StrEnum', 'Flag'
]);

function ancestors(classes, name) {
    const seen = new Set();
    const stack = [name];
    while (stack.length > 0) {
        const cur = stack.pop();
        const cls = classes[cur];
        if (!cls) continue;
        for (const b of cls.bases) {
            if (classes[b] && !seen.has(b) && b !== name) {
                seen.add(b);
                stack.push(b);
            }
        }
    }
    return seen;
}

function cboMap(classes) {
    const names = new Set(Object.keys(classes));
    const out = {};
    for (const [n, c] of Object.entries(classes)) {
        const s = new Set();
        for (const r of c.refs) {
            if (names.has(r) && r !== n) s.add(r);
        }
        out[n] = s;
    }
    const both = {};
    for (const [n, s] of Object.entries(out)) both[n] = new Set(s);
    for (const [n, s] of Object.entries(out)) {
        for (const m of s) both[m].add(n);
    }
    return both;
}

function lcom(c) {
    if (c.isInterface) return null;
    const ms = c.methods.filter((m) => m !== '__init__' && m !== '__new__' && !c.statics.has(m));
    const sets = ms.map((m) => c.mfields.get(m) || new Set());
    let p = 0;
    let q = 0;
    for (let i = 0; i < sets.length; i++) {
        for (let j = i + 1; j < sets.length; j++) {
            let shared = false;
            for (const f of sets[i]) {
                if (sets[j].has(f)) { shared = true; break; }
            }
            if (shared) q += 1;
            else p += 1;
        }
    }
    return Math.max(p - q, 0);
}

function cohesion(c) {
    const ms = c.methods.filter((m) => m !== '__init__' && m !== '__new__');
    if (c.allFields.size === 0 || ms.length === 0) return null;
    let sum = 0;
    for (const m of ms) {
        const mf = c.mfields.get(m) || new Set();
        for (const f of mf) {
            if (c.allFields.has(f)) sum += 1;
        }
    }
    return sum / (ms.length * c.allFields.size);
}

function ditMap(classes) {
    const memo = {};
    function d(n, stack) {
        if (n in memo) return memo[n];
        if (stack.includes(n)) return 0;
        let best = 0;
        for (const b of classes[n].bases) {
            if (IGNORED_BASES.has(b) || classes[n].impls.has(b) || (classes[b] && classes[b].isInterface)) {
                continue;
            }
            const val = classes[b] ? 1 + d(b, [...stack, n]) : 1;
            if (val > best) best = val;
        }
        memo[n] = best;
        return best;
    }
    const res = {};
    for (const n of Object.keys(classes)) res[n] = d(n, []);
    return res;
}

function nocMap(classes) {
    const out = {};
    for (const n of Object.keys(classes)) out[n] = 0;
    for (const c of Object.values(classes)) {
        for (const b of new Set(c.bases)) {
            if (b in out && b !== c.key) out[b] += 1;
        }
    }
    return out;
}

function polymorphismFactor(classes) {
    const anc = {};
    const desc = {};
    for (const n of Object.keys(classes)) {
        anc[n] = ancestors(classes, n);
        desc[n] = 0;
    }
    for (const aSet of Object.values(anc)) {
        for (const x of aSet) desc[x] = (desc[x] || 0) + 1;
    }
    let num = 0;
    let den = 0;
    for (const [n, c] of Object.entries(classes)) {
        const inherited = new Set();
        for (const a of anc[n]) {
            for (const m of classes[a].methods) {
                if (!dunder(m)) inherited.add(m);
            }
        }
        const own = c.methods.filter((m) => !dunder(m));
        const mo = own.filter((m) => inherited.has(m)).length;
        num += mo;
        den += (own.length - mo) * (desc[n] || 0);
    }
    return den ? num / den : 0.0;
}

function reuseIndex(classes, cboAvg, base) {
    const vals = Object.values(classes);
    const cohs = vals.map(cohesion).filter((x) => x !== null);
    const pubMethods = vals.reduce((acc, c) => acc + c.methods.filter((m) => !m.startsWith('_')).length, 0);
    const comp = {
        coupling: cboAvg,
        cohesion: cohs.length ? cohs.reduce((a, b) => a + b, 0) / cohs.length : 0.0,
        messaging: pubMethods / vals.length,
        design_size: vals.length
    };
    const rel = (k) => {
        const b = base ? base[k] : undefined;
        if (!base || b === undefined || b === null) return comp[k];
        return b ? comp[k] / b : (comp[k] === 0 ? 1.0 : comp[k]);
    };
    const idx = -0.25 * rel('coupling') + 0.25 * rel('cohesion') + 0.5 * rel('messaging') + 0.5 * rel('design_size');
    return { idx, comp };
}

function maintainabilityIndex(stats, ccSum) {
    if (!stats || stats.sloc <= 0 || stats.volume <= 0) {
        return stats && stats.sloc > 0 ? 100.0 : null;
    }
    const pct = (100.0 * stats.comments) / stats.loc;
    const rad = (pct * Math.PI) / 180.0;
    const raw = 171 - 5.2 * Math.log(stats.volume) - 0.23 * ccSum - 16.2 * Math.log(stats.sloc) +
        50 * Math.sin(Math.sqrt(2.46 * rad));
    return Math.max(0.0, Math.min(100.0, (raw * 100) / 171));
}

module.exports = {
    IGNORED_BASES,
    ancestors,
    cboMap,
    lcom,
    cohesion,
    ditMap,
    nocMap,
    polymorphismFactor,
    reuseIndex,
    maintainabilityIndex
};