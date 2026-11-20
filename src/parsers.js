'use strict';

const fs = require('fs');
const path = require('path');
const Parser = require('web-tree-sitter');

const SKIP_DIRS = new Set([
    '.git', '.hg', '.svn', 'venv', '.venv', 'env', 'node_modules', '__pycache__',
    'build', 'dist', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
    'site-packages', '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'out',
    'coverage', 'Pods', 'vendor', '.next', '.nuxt'
]);

const LANGS = {
    python:     { exts: ['.py'], wasm: 'tree-sitter-python.wasm', family: 'python' },
    java:       { exts: ['.java'], wasm: 'tree-sitter-java.wasm', family: 'java' },
    csharp:     { exts: ['.cs'], wasm: 'tree-sitter-c_sharp.wasm', family: 'csharp' },
    javascript: { exts: ['.js', '.jsx', '.mjs', '.cjs'], wasm: 'tree-sitter-javascript.wasm', family: 'js' },
    typescript: { exts: ['.ts', '.mts', '.cts'], wasm: 'tree-sitter-typescript.wasm', family: 'js' },
    tsx:        { exts: ['.tsx'], wasm: 'tree-sitter-tsx.wasm', family: 'js' },
    cpp:        { exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h'], wasm: 'tree-sitter-cpp.wasm', family: 'cpp' }
};

const EXT_TO_LANG = {};
for (const [lang, cfg] of Object.entries(LANGS)) {
    for (const ext of cfg.exts) {
        EXT_TO_LANG[ext] = lang;
    }
}

const FAM = {
    python: {
        classes: new Set(['class_definition']),
        funcs: new Set(['function_definition']),
        heritage: new Set(['argument_list']),
        impl: new Set(),
        fields: new Set(),
        iface: new Set()
    },
    java: {
        classes: new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']),
        funcs: new Set(['method_declaration', 'constructor_declaration']),
        heritage: new Set(['superclass', 'super_interfaces', 'extends_interfaces']),
        impl: new Set(['super_interfaces']),
        fields: new Set(['field_declaration']),
        iface: new Set(['interface_declaration'])
    },
    csharp: {
        classes: new Set(['class_declaration', 'interface_declaration', 'struct_declaration', 'record_declaration', 'enum_declaration']),
        funcs: new Set(['method_declaration', 'constructor_declaration', 'destructor_declaration', 'local_function_statement', 'operator_declaration']),
        heritage: new Set(['base_list']),
        impl: new Set(),
        fields: new Set(['field_declaration', 'property_declaration', 'event_field_declaration']),
        iface: new Set(['interface_declaration'])
    },
    js: {
        classes: new Set(['class_declaration', 'abstract_class_declaration', 'interface_declaration']),
        funcs: new Set(['function_declaration', 'generator_function_declaration', 'method_definition']),
        heritage: new Set(['class_heritage', 'extends_type_clause']),
        impl: new Set(['implements_clause']),
        fields: new Set(['field_definition', 'public_field_definition']),
        iface: new Set(['interface_declaration'])
    },
    cpp: {
        classes: new Set(['class_specifier', 'struct_specifier']),
        funcs: new Set(['function_definition']),
        heritage: new Set(['base_class_clause']),
        impl: new Set(),
        fields: new Set(['field_declaration']),
        iface: new Set()
    }
};

const TEST_FILE_RE = /(^test_|_test\.|\.test\.|\.spec\.|(Test|Tests|IT)\.(java|cs|cpp|cc|cxx)$|^conftest\.py$)/;
const TEST_DIRS = new Set(['tests', 'test', '__tests__', 'spec', 'specs']);

function langOf(filePath) {
    const low = filePath.toLowerCase();
    if (low.endsWith('.d.ts') || low.endsWith('.min.js') || low.endsWith('.bundle.js')) {
        return null;
    }
    return EXT_TO_LANG[path.extname(low)] || null;
}

function groupOf(lang) {
    return LANGS[lang] ? LANGS[lang].family : 'python';
}

function toPosix(p) {
    return p.split(path.sep).join('/');
}

function isTestPath(filePath, root) {
    const rel = toPosix(path.relative(root, filePath));
    const parts = rel.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
        const low = parts[i].toLowerCase();
        if (TEST_DIRS.has(low) || low.endsWith('tests') || low.endsWith('.test') || low.endsWith('_test')) {
            return true;
        }
    }
    return TEST_FILE_RE.test(parts[parts.length - 1]);
}

function collectFiles(root) {
    const out = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const subdirs = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.endsWith('.egg-info')) {
                    subdirs.push(path.join(dir, entry.name));
                }
            } else if (entry.isFile()) {
                const full = path.join(dir, entry.name);
                if (langOf(full)) out.push(full);
            }
        }
        for (let i = subdirs.length - 1; i >= 0; i--) {
            stack.push(subdirs[i]);
        }
    }
    return out;
}

let _initialized = false;
let _wasmDir = null;
const _parsers = new Map();

async function initTreeSitter() {
    if (_initialized) return;
    await Parser.init();
    _wasmDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
    _initialized = true;
}

async function getParser(lang) {
    if (_parsers.has(lang)) return _parsers.get(lang);
    await initTreeSitter();
    const cfg = LANGS[lang];
    if (!cfg) return null;
    const wasmPath = path.join(_wasmDir, cfg.wasm);
    if (!fs.existsSync(wasmPath)) {
        _parsers.set(lang, null);
        return null;
    }
    try {
        const language = await Parser.Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(language);
        _parsers.set(lang, parser);
        return parser;
    } catch {
        _parsers.set(lang, null);
        return null;
    }
}

module.exports = {
    SKIP_DIRS,
    LANGS,
    EXT_TO_LANG,
    FAM,
    langOf,
    groupOf,
    toPosix,
    isTestPath,
    collectFiles,
    initTreeSitter,
    getParser
};