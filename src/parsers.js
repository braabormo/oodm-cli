'use strict';

const fs = require('fs');
const path = require('path');
const Parser = require('web-tree-sitter');

const SKIP_DIRS = new Set([
    '.git', '.hg', '.svn', 'venv', '.venv', 'env', 'node_modules', '__pycache__',
    'build', 'dist', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
    'site-packages', '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'out',
    'coverage', 'Pods', 'vendor', '.next', '.nuxt', '.dart_tool', '.fvm',
    '.pub-cache', '.swiftpm', 'DerivedData', '.build', 'ephemeral'
]);

const LANGS = {
    python:     { exts: ['.py'], wasm: 'tree-sitter-python.wasm', family: 'python' },
    java:       { exts: ['.java'], wasm: 'tree-sitter-java.wasm', family: 'java' },
    csharp:     { exts: ['.cs'], wasm: 'tree-sitter-c_sharp.wasm', family: 'csharp' },
    javascript: { exts: ['.js', '.jsx', '.mjs', '.cjs'], wasm: 'tree-sitter-javascript.wasm', family: 'js' },
    typescript: { exts: ['.ts', '.mts', '.cts'], wasm: 'tree-sitter-typescript.wasm', family: 'js' },
    tsx:        { exts: ['.tsx'], wasm: 'tree-sitter-tsx.wasm', family: 'js' },
    cpp:        { exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h'], wasm: 'tree-sitter-cpp.wasm', family: 'cpp' },
    c:          { exts: ['.c'], wasm: 'tree-sitter-c.wasm', family: 'c', group: 'cpp' },
    dart:       { exts: ['.dart'], wasm: 'tree-sitter-dart.wasm', family: 'dart' },
    php:        { exts: ['.php'], wasm: 'tree-sitter-php.wasm', family: 'php' },
    kotlin:     { exts: ['.kt', '.kts'], wasm: 'tree-sitter-kotlin.wasm', family: 'kotlin' },
    swift:      { exts: ['.swift'], wasm: 'tree-sitter-swift.wasm', family: 'swift' },
    go:         { exts: ['.go'], wasm: 'tree-sitter-go.wasm', family: 'go' },
    rust:       { exts: ['.rs'], wasm: 'tree-sitter-rust.wasm', family: 'rust' },
    ruby:       { exts: ['.rb'], wasm: 'tree-sitter-ruby.wasm', family: 'ruby' }
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
    },
    c: {
        classes: new Set(['struct_specifier']),
        funcs: new Set(['function_definition']),
        heritage: new Set(),
        impl: new Set(),
        fields: new Set(['field_declaration']),
        iface: new Set()
    },
    dart: {
        classes: new Set(['class_definition', 'mixin_declaration', 'enum_declaration', 'extension_declaration']),
        funcs: new Set(['method_signature', 'function_signature']),
        heritage: new Set(['superclass', 'interfaces', 'mixins', 'on_clause']),
        impl: new Set(['interfaces', 'mixins']),
        fields: new Set(['declaration']),
        iface: new Set()
    },
    php: {
        classes: new Set(['class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration']),
        funcs: new Set(['method_declaration', 'function_definition']),
        heritage: new Set(['base_clause', 'class_interface_clause']),
        impl: new Set(['class_interface_clause']),
        fields: new Set(['property_declaration']),
        iface: new Set(['interface_declaration'])
    },
    kotlin: {
        classes: new Set(['class_declaration', 'object_declaration']),
        funcs: new Set(['function_declaration', 'secondary_constructor']),
        heritage: new Set(['delegation_specifier', 'delegation_specifiers']),
        impl: new Set(),
        fields: new Set(['property_declaration']),
        iface: new Set()
    },
    swift: {
        classes: new Set(['class_declaration', 'protocol_declaration']),
        funcs: new Set(['function_declaration', 'init_declaration', 'deinit_declaration']),
        heritage: new Set(['inheritance_specifier']),
        impl: new Set(),
        fields: new Set(['property_declaration']),
        iface: new Set(['protocol_declaration'])
    },
    go: {
        classes: new Set(['type_spec']),
        funcs: new Set(['function_declaration', 'method_declaration']),
        heritage: new Set(),
        impl: new Set(),
        fields: new Set(['field_declaration']),
        iface: new Set(['interface_type'])
    },
    rust: {
        classes: new Set(['struct_item', 'enum_item', 'trait_item']),
        funcs: new Set(['function_item']),
        heritage: new Set(),
        impl: new Set(),
        fields: new Set(['field_declaration']),
        iface: new Set(['trait_item'])
    },
    ruby: {
        classes: new Set(['class', 'module']),
        funcs: new Set(['method', 'singleton_method']),
        heritage: new Set(['superclass']),
        impl: new Set(),
        fields: new Set(),
        iface: new Set(['module'])
    }
};

const GENERATED_SUFFIXES = [
    '.d.ts', '.min.js', '.bundle.js',
    '.g.dart', '.freezed.dart', '.gr.dart', '.mocks.dart',
    '.pb.dart', '.pbenum.dart', '.pbjson.dart', '.pbserver.dart',
    '.pb.go', '.generated.cs', '.designer.cs'
];

const TEST_FILE_RE = /(^test_|_test\.|_spec\.|\.test\.|\.spec\.|(Test|Tests|IT)\.(java|cs|cpp|cc|cxx|php|kt|kts|swift)$|^conftest\.py$)/;
const TEST_DIRS = new Set(['tests', 'test', '__tests__', 'spec', 'specs', 'integration_test']);

function langOf(filePath) {
    const low = filePath.toLowerCase();
    for (const suf of GENERATED_SUFFIXES) {
        if (low.endsWith(suf)) return null;
    }
    return EXT_TO_LANG[path.extname(low)] || null;
}

function groupOf(lang) {
    if (!LANGS[lang]) return 'python';
    return LANGS[lang].group || LANGS[lang].family;
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