'use strict';

const fs = require('fs');
const path = require('path');
const { LANGS, FAM, groupOf, toPosix } = require('./parsers');

const LINE_LIMIT = 100;

const DEC_TYPES = new Set([
    'if_statement', 'elif_clause', 'else_if_clause', 'if_expression', 'if_element',
    'for_statement', 'enhanced_for_statement', 'foreach_statement', 'for_in_statement',
    'for_range_loop', 'for_expression', 'for_element', 'for_in_clause', 'if_clause',
    'while_statement', 'while_expression', 'do_statement', 'do_while_statement',
    'repeat_while_statement', 'loop_expression', 'guard_statement',
    'catch_clause', 'catch_block', 'except_clause', 'rescue', 'assert_statement',
    'ternary_expression', 'conditional_expression', 'conditional', 'elvis_expression',
    'nil_coalescing_expression', 'if_null_expression',
    'switch_block_statement_group', 'switch_rule', 'switch_section', 'switch_case',
    'switch_statement_case', 'switch_entry', 'switch_expression_arm', 'case_statement',
    'case_clause', 'when_entry', 'match_arm', 'match_conditional_expression',
    'expression_case', 'type_case', 'communication_case',
    'boolean_operator', 'conjunction_expression', 'disjunction_expression',
    'logical_and_expression', 'logical_or_expression',
    'if', 'elsif', 'unless', 'if_modifier', 'unless_modifier', 'for', 'while', 'until', 'when'
]);

const DEFAULT_CASE_TYPES = new Set([
    'switch_block_statement_group', 'switch_rule', 'switch_section',
    'case_statement', 'switch_statement_case', 'switch_entry'
]);

const CONTROL_TYPES = new Set([
    'if_statement', 'if_expression', 'guard_statement',
    'for_statement', 'enhanced_for_statement', 'foreach_statement', 'for_in_statement',
    'for_range_loop', 'for_expression', 'while_statement', 'while_expression',
    'do_statement', 'do_while_statement', 'repeat_while_statement', 'loop_expression',
    'try_statement', 'with_statement', 'switch_statement', 'switch_expression',
    'when_expression', 'match_expression', 'if', 'unless', 'while', 'until', 'begin', 'case'
]);

const FUNC_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);
const TYPE_ARG_NODES = new Set(['type_arguments', 'type_argument_list', 'template_argument_list']);
const BODY_TYPES = new Set([
    'class_body', 'enum_class_body', 'enum_body', 'extension_body', 'protocol_body',
    'declaration_list', 'body_statement', 'function_body', 'block', 'compound_statement',
    'field_declaration_list', 'statements'
]);
const NAME_NODE_TYPES = new Set([
    'identifier', 'type_identifier', 'simple_identifier', 'name', 'constant', 'field_identifier'
]);
const DART_SIG_TYPES = new Set([
    'function_signature', 'getter_signature', 'setter_signature',
    'constructor_signature', 'constant_constructor_signature',
    'factory_constructor_signature', 'redirecting_factory_constructor_signature',
    'operator_signature'
]);

const PY_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
    'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
    'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
    'return', 'try', 'while', 'with', 'yield', 'match', 'case'
]);

const NAME_PY_FN = /^_{0,2}[a-z][a-z0-9_]*_?$|^_$/;
const NAME_PY_ARG = /^_*[a-z][a-z0-9_]*$|^_$/;
const NAME_CLS = /^_?[A-Z][A-Za-z0-9]*$/;
const NAME_CAMEL_FN = /^_?[a-z][A-Za-z0-9]*$/;
const NAME_CS_FN = /^[A-Z][A-Za-z0-9]*$/;
const NAME_JS_FN = /^[#_$a-z][A-Za-z0-9_$]*$|^[A-Z][A-Za-z0-9]*$/;
const NAME_PHP_FN = /^_{0,2}[a-z][A-Za-z0-9_]*$/;
const NAME_RUST_FN = /^_?[a-z][a-z0-9_]*$/;
const NAME_RUBY_FN = /^_?[a-z][a-z0-9_]*[?!=]?$/;
const OK_PY_FN = new Set([
    'setUp', 'tearDown', 'setUpClass', 'tearDownClass', 'setUpModule',
    'tearDownModule', 'asyncSetUp', 'asyncTearDown', 'generic_visit', 'maxDiff'
]);

// Safe bounded regexes (no catastrophic backtracking)
const SECRET_RE = /\b[A-Za-z0-9_]{0,30}(?:passw(?:or)?d|passwd|secret|api_?key|token|private_?key)[A-Za-z0-9_]{0,30}\s*[:=]\s*[@$]?["'][^"'\r\n]{3,120}["']/i;

const C_SEC_RULES = [
    [/\b(?:gets|strcpy|strcat|sprintf|vsprintf)\s*\(/, 'high', 'unsafe C string function'],
    [/\b(?:system|popen)\s*\(/, 'high', 'shell command execution'],
    [/\bscanf\s*\(\s*"[^"\r\n]{0,120}%s/, 'high', 'unbounded scanf %s']
];

const SEC_RULES = {
    python: [
        [/\b(?:eval|exec)\s*\(/, 'high', 'use of eval()/exec()'],
        [/\bos\.(?:system|popen)\s*\(/, 'high', 'shell command via os.system/popen'],
        [/\bsubprocess\.[A-Za-z_]+\([^)\r\n]{0,200}\bshell\s*=\s*True/, 'high', 'subprocess with shell=True'],
        [/\b(?:pickle|cPickle|marshal|dill)\.loads?\s*\(/, 'high', 'unsafe deserialization'],
        [/\byaml\.load\s*\((?![^)\r\n]{0,160}Loader\s*=)/, 'high', 'yaml.load without SafeLoader'],
        [/\bhashlib\.(?:md5|sha1)\s*\(/, 'high', 'weak hash algorithm (md5/sha1)'],
        [/\btempfile\.mktemp\s*\(/, 'medium', 'insecure tempfile.mktemp'],
        [/_create_unverified_context\s*\(/, 'high', 'TLS verification disabled'],
        [/\bverify\s*=\s*False\b/, 'high', 'TLS verification disabled (verify=False)'],
        [/\.run\s*\([^)\r\n]{0,160}\bdebug\s*=\s*True\b/, 'medium', 'debug=True in run()'],
        [/\.executemany?\s*\(\s*(?:f["']|["'][^"'\r\n]{0,200}["']\s*(?:\+|%|\.format\s*\())/, 'high', 'possible SQL injection (string-built query)']
    ],
    java: [
        [/Runtime\.getRuntime\(\)\s*\.exec\s*\(/, 'high', 'shell command via Runtime.exec'],
        [/new\s+ProcessBuilder\s*\(/, 'medium', 'external process via ProcessBuilder'],
        [/\.readObject\s*\(\s*\)/, 'high', 'unsafe deserialization (readObject)'],
        [/MessageDigest\.getInstance\(\s*"(?:md5|sha-?1)"/i, 'high', 'weak hash algorithm'],
        [/\.(?:execute|executeQuery|executeUpdate|createQuery|createNativeQuery)\s*\(\s*"[^"\r\n]{0,200}"\s*\+/, 'high', 'possible SQL injection (string-built query)']
    ],
    csharp: [
        [/Process\.Start\s*\(/, 'high', 'external process via Process.Start'],
        [/new\s+BinaryFormatter\s*\(/, 'high', 'unsafe deserialization (BinaryFormatter)'],
        [/\b(?:MD5|SHA1)(?:CryptoServiceProvider)?\.Create\s*\(|new\s+(?:MD5|SHA1)CryptoServiceProvider/, 'high', 'weak hash algorithm'],
        [/new\s+SqlCommand\s*\(\s*(?:\$"|"[^"\r\n]{0,200}"\s*\+)/, 'high', 'possible SQL injection (string-built query)'],
        [/ServerCertificateValidationCallback\s*\+?=[^\r\n]{0,120}true/, 'high', 'TLS validation disabled']
    ],
    js: [
        [/\beval\s*\(/, 'high', 'use of eval()'],
        [/new\s+Function\s*\(/, 'high', 'dynamic code via new Function()'],
        [/\bexec(?:Sync)?\s*\(\s*(?:`[^`\r\n]{0,200}\$\{|[^)\r\n]{0,200}\+)/, 'high', 'shell command built from strings'],
        [/\.innerHTML\s*=|document\.write\s*\(/, 'high', 'possible XSS (innerHTML / document.write)'],
        [/dangerouslySetInnerHTML/, 'medium', 'dangerouslySetInnerHTML'],
        [/createHash\(\s*['"](?:md5|sha1)['"]/, 'high', 'weak hash algorithm'],
        [/rejectUnauthorized\s*:\s*false/, 'high', 'TLS validation disabled']
    ],
    cpp: C_SEC_RULES,
    c: C_SEC_RULES,
    dart: [
        [/Process\.run(?:Sync)?\s*\([^)\r\n]{0,200}runInShell\s*:\s*true/, 'high', 'shell command with runInShell: true'],
        [/badCertificateCallback\s*=[^\r\n]{0,120}true/, 'high', 'TLS certificate validation disabled'],
        [/\b(?:md5|sha1)\.convert\s*\(/, 'high', 'weak hash algorithm (md5/sha1)'],
        [/\.(?:rawQuery|rawInsert|rawUpdate|rawDelete|execute)\s*\(\s*['"][^'"\r\n]{0,200}(?:\$|\+)/, 'high', 'possible SQL injection (interpolated query)']
    ],
    php: [
        [/\b(?:eval|exec|shell_exec|system|passthru|proc_open|popen)\s*\(/, 'high', 'dangerous code/shell execution'],
        [/\bunserialize\s*\(/, 'high', 'unsafe deserialization (unserialize)'],
        [/\b(?:md5|sha1)\s*\(/, 'high', 'weak hash algorithm (md5/sha1)'],
        [/(?:mysql_query|mysqli_query|->query|->exec)\s*\([^)\r\n]{0,160}\$/, 'high', 'possible SQL injection (variable in query)'],
        [/CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)\b/i, 'high', 'TLS verification disabled']
    ],
    kotlin: [
        [/Runtime\.getRuntime\(\)\s*\.exec\s*\(/, 'high', 'shell command via Runtime.exec'],
        [/MessageDigest\.getInstance\(\s*"(?:md5|sha-?1)"/i, 'high', 'weak hash algorithm'],
        [/\.(?:rawQuery|execSQL|executeQuery|executeUpdate)\s*\(\s*"[^"\r\n]{0,200}(?:\$|\+)/, 'high', 'possible SQL injection (interpolated query)'],
        [/ObjectInputStream\s*\(/, 'high', 'unsafe deserialization (ObjectInputStream)']
    ],
    swift: [
        [/\b(?:CC_MD5|CC_SHA1)\b|Insecure\.(?:MD5|SHA1)/, 'high', 'weak hash algorithm (MD5/SHA1)'],
        [/NSAllowsArbitraryLoads/, 'medium', 'ATS arbitrary loads allowed'],
        [/sqlite3_exec\s*\([^)\r\n]{0,160}\\\(/, 'high', 'possible SQL injection (string interpolation)'],
        [/\bProcess\s*\(\s*\)/, 'medium', 'external process execution']
    ],
    go: [
        [/\bexec\.Command\s*\(/, 'medium', 'external command execution (exec.Command)'],
        [/\b(?:md5|sha1)\.(?:New|Sum)\s*\(/, 'high', 'weak hash algorithm (md5/sha1)'],
        [/InsecureSkipVerify\s*:\s*true/, 'high', 'TLS verification disabled (InsecureSkipVerify)'],
        [/\.(?:Query|Exec|QueryRow)\s*\(\s*(?:fmt\.Sprintf|"[^"\r\n]{0,200}"\s*\+)/, 'high', 'possible SQL injection (string-built query)']
    ],
    rust: [
        [/\bunsafe\s*\{/, 'medium', 'unsafe Rust block'],
        [/Command::new\s*\(/, 'medium', 'external process execution'],
        [/danger_accept_invalid_certs\s*\(\s*true\s*\)/, 'high', 'TLS verification disabled'],
        [/\b(?:Md5|Sha1)::/, 'high', 'weak hash algorithm (MD5/SHA1)']
    ],
    ruby: [
        [/\b(?:eval|instance_eval|class_eval|module_eval)\s*(?:\(|\s)/, 'high', 'dynamic code execution (eval)'],
        [/\b(?:system|exec)\s*\(|%x\[/, 'high', 'shell command execution'],
        [/\b(?:Marshal\.load|YAML\.load)\b/, 'high', 'unsafe deserialization'],
        [/Digest::(?:MD5|SHA1)/, 'high', 'weak hash algorithm (MD5/SHA1)'],
        [/VERIFY_NONE/, 'high', 'TLS verification disabled']
    ]
};

const EMPTY_CATCH_RE = /\bcatch\s*(?:\([^)\r\n]{0,120}\))?\s*\{\s*\}/g;

function dunder(n) {
    return n.startsWith('__') && n.endsWith('__');
}

function identLeaves(node, skip = TYPE_ARG_NODES) {
    const out = [];
    const stack = [node];
    while (stack.length > 0) {
        const n = stack.pop();
        if (skip && skip.has(n.type)) continue;
        if (n.childCount === 0) {
            if (n.type.endsWith('identifier') || n.type === 'name' || n.type === 'constant') {
                out.push(n.text);
            }
        } else {
            for (let i = n.childCount - 1; i >= 0; i--) {
                stack.push(n.child(i));
            }
        }
    }
    return out;
}

function firstChildOfTypes(n, types) {
    for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (types.has(c.type)) return c;
    }
    return null;
}

function nodeName(n, family) {
    if (!n) return null;
    if (family === 'cpp' || family === 'c') {
        let d = n.childForFieldName('declarator');
        while (d && (d.type === 'function_declarator' || d.type === 'pointer_declarator' ||
            d.type === 'reference_declarator' || d.type === 'parenthesized_declarator')) {
            const nxt = d.childForFieldName('declarator');
            if (!nxt) break;
            d = nxt;
        }
        if (d) return d.text;
    }
    if (family === 'dart') {
        const nm = dartSigName(n);
        if (nm) return nm;
    }
    const f = n.childForFieldName('name') || n.childForFieldName('property');
    if (f) return f.text;
    const ch = firstChildOfTypes(n, NAME_NODE_TYPES);
    return ch ? ch.text : null;
}

function nodeBody(n) {
    if (!n) return null;
    return n.childForFieldName('body') || firstChildOfTypes(n, BODY_TYPES);
}

function dartSigName(n) {
    if (!n) return null;
    if (n.type === 'method_signature') {
        for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i);
            if (DART_SIG_TYPES.has(c.type)) return dartSigName(c);
        }
    }
    if (DART_SIG_TYPES.has(n.type)) {
        const nm = n.childForFieldName('name');
        if (nm) return nm.text;
        const ids = [];
        for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i);
            if (c.type === 'identifier') ids.push(c.text);
        }
        if (ids.length > 0) return ids[0];
    }
    return null;
}

function pyBaseName(n) {
    if (!n) return null;
    if (n.type === 'identifier') return n.text;
    if (n.type === 'attribute') {
        const attr = n.childForFieldName('attribute');
        return attr ? attr.text : null;
    }
    if (n.type === 'subscript') return pyBaseName(n.childForFieldName('value'));
    if (n.type === 'call') return pyBaseName(n.childForFieldName('function'));
    return null;
}

function heritage(cnode, fam, family) {
    const bases = [];
    const impls = new Set();

    if (family === 'python') {
        const sup = cnode.childForFieldName('superclasses');
        if (sup) {
            for (let i = 0; i < sup.namedChildCount; i++) {
                const b = pyBaseName(sup.namedChild(i));
                if (b) bases.push(b);
            }
        }
        return { bases: [...new Set(bases)], impls };
    }

    function walk(n, inImpl) {
        if (TYPE_ARG_NODES.has(n.type)) return;
        if (n.childCount === 0) {
            if (n.type.endsWith('identifier') || n.type === 'name' || n.type === 'constant') {
                const txt = n.text;
                if (txt !== 'extends' && txt !== 'implements' && txt !== 'with' && txt !== 'on') {
                    bases.push(txt);
                    if (inImpl) impls.add(txt);
                }
            }
            return;
        }
        for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i);
            walk(c, inImpl || fam.impl.has(c.type));
        }
    }

    for (let i = 0; i < cnode.childCount; i++) {
        const c = cnode.child(i);
        if (fam.heritage.has(c.type)) {
            walk(c, fam.impl.has(c.type));
        }
    }
    if (family === 'csharp') {
        for (const b of bases) {
            if (/^I[A-Z]/.test(b)) impls.add(b);
        }
    }
    return { bases: [...new Set(bases)], impls };
}

function isStatic(n, family) {
    if (family === 'ruby' && n.type === 'singleton_method') return true;
    const head = n.text.slice(0, 80).split('{')[0].split('(')[0];
    if (/\bstatic\b/.test(head)) return true;
    for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.type === 'static' || ((c.type === 'modifiers' || c.type === 'modifier' || c.type === 'storage_class_specifier') && c.text.includes('static'))) {
            return true;
        }
    }
    return false;
}

function fieldNames(n, family) {
    const out = new Set();
    if (family === 'java' || family === 'csharp') {
        const stack = [n];
        while (stack.length > 0) {
            const x = stack.pop();
            if (x.type === 'variable_declarator') {
                const nm = x.childForFieldName('name');
                if (nm) out.add(nm.text);
                else {
                    const ids = identLeaves(x);
                    if (ids.length) out.add(ids[0]);
                }
            } else if (x.type === 'property_declaration' || x.type === 'event_declaration') {
                const nm = x.childForFieldName('name');
                if (nm) out.add(nm.text);
            } else {
                for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
            }
        }
    } else if (family === 'js') {
        const nm = n.childForFieldName('property') || n.childForFieldName('name');
        if (nm) out.add(nm.text);
    } else if (family === 'php') {
        const stack = [n];
        while (stack.length > 0) {
            const x = stack.pop();
            if (x.type === 'variable_name') {
                const nm = x.text.replace(/^\$/, '');
                if (nm) out.add(nm);
            } else {
                for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
            }
        }
    } else if (family === 'dart') {
        const stack = [n];
        while (stack.length > 0) {
            const x = stack.pop();
            if (x.type === 'initialized_identifier' || x.type === 'static_final_declaration') {
                const id = firstChildOfTypes(x, new Set(['identifier']));
                if (id) out.add(id.text);
            } else if (!DART_SIG_TYPES.has(x.type) && x.type !== 'function_body') {
                for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
            }
        }
    } else if (family === 'kotlin' || family === 'swift') {
        const nm = n.childForFieldName('name') || firstChildOfTypes(n, new Set(['simple_identifier', 'identifier', 'pattern', 'variable_declaration']));
        if (nm) {
            const ids = identLeaves(nm, TYPE_ARG_NODES);
            if (ids.length) out.add(ids[0]);
        }
    } else if (family === 'go' || family === 'rust') {
        for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i);
            if (c.type === 'field_identifier') out.add(c.text);
        }
    } else {
        const stack = [n];
        while (stack.length > 0) {
            const x = stack.pop();
            if (x.childCount === 0) {
                if (x.type === 'field_identifier') out.add(x.text);
            } else {
                for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
            }
        }
    }
    return out;
}

function thisAssigned(body) {
    const out = new Set();
    const stack = [body];
    while (stack.length > 0) {
        const x = stack.pop();
        if (x.type === 'assignment_expression') {
            const left = x.childForFieldName('left');
            if (left && left.type === 'member_expression') {
                const obj = left.childForFieldName('object');
                const prop = left.childForFieldName('property');
                if (obj && prop && obj.text === 'this') out.add(prop.text);
            }
        }
        for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
    }
    return out;
}

function usedFields(mnode, fields) {
    if (!mnode || !fields || fields.size === 0) return new Set();
    const out = new Set();
    for (const t of identLeaves(mnode, null)) {
        const clean = t.replace(/^[@$]/, '');
        if (fields.has(clean)) out.add(clean);
    }
    return out;
}

function scanClass(cnode, family) {
    const refs = new Set();
    const calls = new Set();
    const stack = [cnode];

    while (stack.length > 0) {
        const x = stack.pop();
        if (family === 'python') {
            if (x.type === 'identifier') refs.add(x.text);
            else if (x.type === 'attribute') {
                const a = x.childForFieldName('attribute');
                if (a) refs.add(a.text);
            } else if (x.type === 'call') {
                const f = x.childForFieldName('function');
                if (f) {
                    if (f.type === 'attribute') {
                        const a = f.childForFieldName('attribute');
                        if (a) calls.add(a.text);
                    } else if (f.type === 'identifier') {
                        calls.add(f.text);
                    }
                }
            }
            for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
            continue;
        }

        if (x.childCount === 0) {
            const txt = x.text;
            if (x.type === 'type_identifier' || x.type === 'namespace_identifier' || x.type === 'constant' ||
                ((x.type.endsWith('identifier') || x.type === 'name') && txt.length > 0 && txt[0] >= 'A' && txt[0] <= 'Z')) {
                refs.add(txt);
            }
            continue;
        }

        const t = x.type;
        if (t === 'method_invocation' || t === 'member_call_expression' || t === 'nullsafe_member_call_expression' || t === 'scoped_call_expression') {
            const nm = x.childForFieldName('name');
            if (nm) calls.add(nm.text);
        } else if (t === 'invocation_expression' || t === 'call_expression' || t === 'function_call_expression' || t === 'call') {
            const f = x.childForFieldName('function') || x.childForFieldName('method') || x.namedChild(0);
            if (f) {
                const ids = identLeaves(f, null);
                if (ids.length > 0) calls.add(ids[ids.length - 1]);
            }
        } else if (family === 'dart' && t === 'selector') {
            const nm = firstChildOfTypes(x, new Set(['unconditional_assignable_selector', 'conditional_assignable_selector']));
            if (nm) {
                const id = firstChildOfTypes(nm, new Set(['identifier']));
                if (id) calls.add(id.text);
            }
        }
        for (let i = x.childCount - 1; i >= 0; i--) stack.push(x.child(i));
    }
    return { refs, calls };
}

function ctorAlias(mname, nodeType, className) {
    if (nodeType === 'constructor_declaration' || nodeType === 'destructor_declaration' ||
        nodeType === 'secondary_constructor' || nodeType === 'init_declaration' || nodeType === 'deinit_declaration' ||
        mname === 'constructor' || mname === '__construct' || mname === 'initialize' || mname === 'init' ||
        mname === className || mname.startsWith('~')) {
        return '__init__';
    }
    return mname;
}

function extractClassesFromTree(root, rel, lang) {
    const family = LANGS[lang].family;
    const fam = FAM[family];
    const classes = [];
    const pendingMethods = [];
    const stack = [root];

    while (stack.length > 0) {
        const n = stack.pop();
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));

        // Out-of-class method attachment for C++, Go, and Rust
        if (family === 'cpp' && n.type === 'function_definition') {
            const full = nodeName(n, 'cpp') || '';
            if (full.includes('::')) {
                const parts = full.split('::');
                const scope = parts[parts.length - 2];
                const mn = ctorAlias(parts[parts.length - 1], n.type, scope);
                const { refs, calls } = scanClass(n, 'cpp');
                pendingMethods.push({ scope, mname: mn, usedIdents: new Set(identLeaves(n, null)), refs, calls });
            }
        } else if (family === 'go' && n.type === 'method_declaration') {
            const recv = n.childForFieldName('receiver');
            const mn = nodeName(n, 'go');
            if (recv && mn) {
                const typeIds = [];
                const rstack = [recv];
                while (rstack.length) {
                    const x = rstack.pop();
                    if (x.type === 'type_identifier') typeIds.push(x.text);
                    else for (let i = x.childCount - 1; i >= 0; i--) rstack.push(x.child(i));
                }
                if (typeIds.length) {
                    const { refs, calls } = scanClass(n, 'go');
                    pendingMethods.push({ scope: typeIds[0], mname: mn, usedIdents: new Set(identLeaves(n, null)), refs, calls });
                }
            }
        } else if (family === 'rust' && n.type === 'impl_item') {
            const typeNode = n.childForFieldName('type');
            const traitNode = n.childForFieldName('trait');
            const implBody = nodeBody(n);
            if (typeNode && implBody) {
                const typeIds = identLeaves(typeNode, TYPE_ARG_NODES);
                const scope = typeIds[typeIds.length - 1];
                const traitIds = traitNode ? identLeaves(traitNode, TYPE_ARG_NODES) : [];
                const traitName = traitIds.length ? traitIds[traitIds.length - 1] : null;
                const { refs, calls } = scanClass(n, 'rust');
                if (scope) {
                    for (let i = 0; i < implBody.namedChildCount; i++) {
                        const ch = implBody.namedChild(i);
                        if (ch.type === 'function_item') {
                            const mn = nodeName(ch, 'rust');
                            if (mn) {
                                pendingMethods.push({
                                    scope, mname: mn, traitName,
                                    usedIdents: new Set(identLeaves(ch, null)), refs, calls
                                });
                            }
                        }
                    }
                    if (traitName) {
                        pendingMethods.push({ scope, mname: null, traitName, usedIdents: new Set(), refs, calls });
                    }
                }
            }
        }

        if (!fam.classes.has(n.type)) continue;

        // Go: only struct_type and interface_type type_specs represent classes/interfaces
        if (family === 'go') {
            const tNode = n.childForFieldName('type');
            if (!tNode || (tNode.type !== 'struct_type' && tNode.type !== 'interface_type')) continue;
            const nm = n.childForFieldName('name');
            if (!nm) continue;
            const name = nm.text;
            const isIface = tNode.type === 'interface_type';
            const fields = new Set();
            const methods = new Set();
            const bases = [];
            const bstack = [tNode];
            while (bstack.length) {
                const x = bstack.pop();
                if (x.type === 'field_declaration') {
                    const fids = fieldNames(x, 'go');
                    if (fids.size > 0) {
                        for (const f of fids) fields.add(f);
                    } else {
                        // Embedded struct/interface acts like base
                        for (const id of identLeaves(x, TYPE_ARG_NODES)) bases.push(id);
                    }
                } else if (x.type === 'method_spec') {
                    const mn = x.childForFieldName('name');
                    if (mn) methods.add(mn.text);
                } else {
                    for (let i = x.childCount - 1; i >= 0; i--) bstack.push(x.child(i));
                }
            }
            const { refs, calls } = scanClass(n, 'go');
            classes.push({
                name, rel, line: n.startPosition.row + 1, bases: [...new Set(bases)],
                methods: [...methods], mfields: new Map(), allFields: fields, refs, calls,
                statics: new Set(), impls: new Set(), isInterface: isIface, group: groupOf(lang), key: ''
            });
            continue;
        }

        const body = nodeBody(n);
        const name = nodeName(n, family);
        if (!body || !name) continue;

        const { bases, impls } = heritage(n, fam, family);
        const methods = new Set();
        const methodNodes = new Map();
        const statics = new Set();
        const fields = new Set();

        // Python
        if (family === 'python') {
            const classLevel = new Set();
            for (let i = 0; i < body.namedChildCount; i++) {
                let ch = body.namedChild(i);
                let isStat = false;
                if (ch.type === 'decorated_definition') {
                    for (let j = 0; j < ch.namedChildCount; j++) {
                        const sub = ch.namedChild(j);
                        if (sub.type === 'decorator' && sub.text.trim() === '@staticmethod') isStat = true;
                    }
                    const defNode = ch.childForFieldName('definition');
                    if (!defNode) continue;
                    ch = defNode;
                }
                if (ch.type === 'function_definition') {
                    const mn = nodeName(ch, 'python');
                    if (mn) {
                        methods.add(mn);
                        methodNodes.set(mn, ch);
                        if (isStat) statics.add(mn);
                    }
                } else if (ch.type === 'expression_statement') {
                    const inner = ch.namedChild(0);
                    if (inner && inner.type === 'assignment') {
                        const left = inner.childForFieldName('left');
                        if (left && left.type === 'identifier') classLevel.add(left.text);
                    }
                }
            }
            const mfields = new Map();
            for (const [mname, mnode] of methodNodes.entries()) {
                const fsSet = new Set();
                const mstack = [mnode];
                while (mstack.length > 0) {
                    const x = mstack.pop();
                    if (x.type === 'attribute') {
                        const obj = x.childForFieldName('object');
                        const attr = x.childForFieldName('attribute');
                        if (obj && attr && (obj.text === 'self' || obj.text === 'cls')) {
                            if (!methods.has(attr.text)) fsSet.add(attr.text);
                        }
                    }
                    for (let i = x.childCount - 1; i >= 0; i--) mstack.push(x.child(i));
                }
                mfields.set(mname, fsSet);
                for (const f of fsSet) fields.add(f);
            }
            for (const f of classLevel) fields.add(f);
            const { refs, calls } = scanClass(n, 'python');
            classes.push({
                name, rel, line: n.startPosition.row + 1, bases,
                methods: [...methods], mfields, allFields: fields, refs, calls,
                statics, impls, isInterface: false, group: groupOf(lang), key: ''
            });
            continue;
        }

        // Dart / Flutter (methods are signature + sibling function_body)
        if (family === 'dart') {
            for (let i = 0; i < body.namedChildCount; i++) {
                const ch = body.namedChild(i);
                const t = ch.type;
                if (t === 'method_signature') {
                    let mn = dartSigName(ch);
                    if (mn) {
                        mn = ctorAlias(mn, t, name);
                        methods.add(mn);
                        const next = ch.nextNamedSibling;
                        methodNodes.set(mn, next && next.type === 'function_body' ? next : ch);
                        if (isStatic(ch, 'dart')) statics.add(mn);
                    }
                } else if (t === 'declaration') {
                    const sig = firstChildOfTypes(ch, DART_SIG_TYPES);
                    if (sig) {
                        let mn = dartSigName(sig);
                        if (mn) {
                            mn = ctorAlias(mn, sig.type, name);
                            methods.add(mn);
                            methodNodes.set(mn, ch);
                            if (isStatic(ch, 'dart')) statics.add(mn);
                        }
                    } else {
                        for (const f of fieldNames(ch, 'dart')) fields.add(f);
                    }
                }
            }
            const mfields = new Map();
            for (const [mname, mnode] of methodNodes.entries()) {
                mfields.set(mname, usedFields(mnode, fields));
            }
            const head = n.text.slice(0, 60);
            const isIface = /\babstract\s+interface\s+class\b|\binterface\s+class\b/.test(head);
            const { refs, calls } = scanClass(n, 'dart');
            classes.push({
                name, rel, line: n.startPosition.row + 1, bases,
                methods: [...methods], mfields, allFields: fields, refs, calls,
                statics, impls, isInterface: isIface, group: groupOf(lang), key: ''
            });
            continue;
        }

        // Ruby (instance variables @foo + include/extend mixins)
        if (family === 'ruby') {
            for (let i = 0; i < body.namedChildCount; i++) {
                const ch = body.namedChild(i);
                if (ch.type === 'method' || ch.type === 'singleton_method') {
                    let mn = nodeName(ch, 'ruby');
                    if (mn) {
                        mn = ctorAlias(mn, ch.type, name);
                        methods.add(mn);
                        methodNodes.set(mn, ch);
                        if (ch.type === 'singleton_method') statics.add(mn);
                    }
                } else if (ch.type === 'call') {
                    const m = ch.childForFieldName('method')?.text;
                    if (m === 'include' || m === 'extend' || m === 'prepend') {
                        const args = ch.childForFieldName('arguments');
                        if (args) {
                            for (const id of identLeaves(args, TYPE_ARG_NODES)) {
                                bases.push(id);
                                impls.add(id);
                            }
                        }
                    }
                }
            }
            const mfields = new Map();
            for (const [mname, mnode] of methodNodes.entries()) {
                const fsSet = new Set();
                const mstack = [mnode];
                while (mstack.length) {
                    const x = mstack.pop();
                    if (x.type === 'instance_variable') fsSet.add(x.text.replace(/^@/, ''));
                    for (let i = x.childCount - 1; i >= 0; i--) mstack.push(x.child(i));
                }
                mfields.set(mname, fsSet);
                for (const f of fsSet) fields.add(f);
            }
            const { refs, calls } = scanClass(n, 'ruby');
            classes.push({
                name, rel, line: n.startPosition.row + 1, bases: [...new Set(bases)],
                methods: [...methods], mfields, allFields: fields, refs, calls,
                statics, impls, isInterface: n.type === 'module', group: groupOf(lang), key: ''
            });
            continue;
        }

        // Java, C#, JS/TS, C++, C, PHP, Kotlin, Swift, Rust
        if (family === 'kotlin') {
            // Primary constructor val/var properties
            const pctor = firstChildOfTypes(n, new Set(['primary_constructor']));
            if (pctor) {
                const pstack = [pctor];
                while (pstack.length) {
                    const x = pstack.pop();
                    if (x.type === 'class_parameter' && /\b(?:val|var)\b/.test(x.text)) {
                        const id = firstChildOfTypes(x, new Set(['simple_identifier', 'identifier']));
                        if (id) fields.add(id.text);
                    } else {
                        for (let i = x.childCount - 1; i >= 0; i--) pstack.push(x.child(i));
                    }
                }
            }
        }

        for (let i = 0; i < body.childCount; i++) {
            const ch = body.child(i);
            const t = ch.type;
            if (fam.funcs.has(t) || (family === 'js' && (t === 'method_signature' || t === 'abstract_method_signature'))) {
                let mn = nodeName(ch, family);
                if (mn) {
                    mn = ctorAlias(mn.split('::').pop(), t, name);
                    methods.add(mn);
                    methodNodes.set(mn, ch);
                    if (isStatic(ch, family)) statics.add(mn);
                }
            } else if (fam.fields.has(t)) {
                const value = ch.childForFieldName('value');
                const decl = ch.childForFieldName('declarator');
                if (family === 'js' && value && FUNC_VALUE_TYPES.has(value.type)) {
                    const mn = nodeName(ch, family);
                    if (mn) {
                        methods.add(mn);
                        methodNodes.set(mn, ch);
                    }
                } else if (family === 'cpp' && decl && decl.type === 'function_declarator') {
                    let mn = nodeName(ch, family);
                    if (mn) {
                        mn = ctorAlias(mn.split('::').pop(), t, name);
                        if (!methods.has(mn)) {
                            methods.add(mn);
                            methodNodes.set(mn, ch);
                        }
                    }
                } else {
                    for (const f of fieldNames(ch, family)) fields.add(f);
                }
            }
        }

        if (family === 'js') {
            for (const f of thisAssigned(body)) fields.add(f);
            const ctor = methodNodes.get('__init__');
            const params = ctor ? ctor.childForFieldName('parameters') : null;
            if (params) {
                for (let i = 0; i < params.childCount; i++) {
                    const p = params.child(i);
                    let hasAcc = false;
                    for (let j = 0; j < p.childCount; j++) {
                        if (p.child(j).type === 'accessibility_modifier') { hasAcc = true; break; }
                    }
                    if (hasAcc) {
                        const pat = p.childForFieldName('pattern');
                        if (pat) fields.add(pat.text);
                    }
                }
            }
        }

        const mfields = new Map();
        for (const [mname, mnode] of methodNodes.entries()) {
            mfields.set(mname, usedFields(mnode, fields));
        }
        const isIface = fam.iface.has(n.type) ||
            (family === 'kotlin' && /^\s*(?:[a-z]+\s+)*interface\b/.test(n.text.slice(0, 60)));
        const { refs, calls } = scanClass(n, family);
        classes.push({
            name, rel, line: n.startPosition.row + 1, bases,
            methods: [...methods], mfields, allFields: fields, refs, calls,
            statics, impls, isInterface: isIface, group: groupOf(lang), key: ''
        });
    }

    return { classes, pendingMethods };
}

function countedFunctionInfo(n, fam, family) {
    const t = n.type;
    if (family === 'dart') {
        if (t === 'method_signature' || (t === 'function_signature' && n.parent?.type !== 'method_signature')) {
            const body = n.nextNamedSibling;
            if (!body || body.type !== 'function_body') return null;
            return { name: dartSigName(n) || '<anonymous>', body, endRow: body.endPosition.row };
        }
        return null;
    }
    if (fam.funcs.has(t)) {
        const body = nodeBody(n);
        if (!body) return null;
        return { name: nodeName(n, family) || '<anonymous>', body, endRow: n.endPosition.row };
    }
    if (family === 'js' && FUNC_VALUE_TYPES.has(t)) {
        const p = n.parent;
        if (p && (p.type === 'variable_declarator' || p.type === 'field_definition' ||
            p.type === 'public_field_definition' || p.type === 'pair' || p.type === 'assignment_expression')) {
            const nm = p.childForFieldName('name') || p.childForFieldName('property') ||
                p.childForFieldName('key') || p.childForFieldName('left');
            return { name: nm ? nm.text : '<anonymous>', body: n, endRow: n.endPosition.row };
        }
    }
    return null;
}

function enclosingPrefix(n, fam, family) {
    const parts = [];
    let p = n.parent;
    while (p) {
        if (fam.classes.has(p.type)) {
            const nm = nodeName(p, family);
            if (nm) parts.push(nm);
            if (family !== 'python') break;
        } else if (family === 'rust' && p.type === 'impl_item') {
            const tNode = p.childForFieldName('type');
            if (tNode) {
                const ids = identLeaves(tNode, TYPE_ARG_NODES);
                if (ids.length) parts.push(ids[ids.length - 1]);
            }
            break;
        } else if (family === 'python' && p.type === 'function_definition') {
            const nm = nodeName(p, 'python');
            if (nm) parts.push(nm);
        }
        p = p.parent;
    }
    return parts.reverse().join('.');
}

function ccOfNode(target, fam, family) {
    let count = 1;
    const stack = [];
    for (let i = target.childCount - 1; i >= 0; i--) stack.push(target.child(i));

    while (stack.length > 0) {
        const n = stack.pop();
        if (fam.classes.has(n.type) || n.type === 'lambda' || n.type === 'closure_expression' ||
            countedFunctionInfo(n, fam, family) !== null) {
            continue;
        }
        const t = n.type;
        if (DEC_TYPES.has(t)) {
            const firstText = n.childCount > 0 ? n.child(0).text.trimStart() : '';
            if (!(DEFAULT_CASE_TYPES.has(t) && firstText.startsWith('default'))) {
                count += 1;
            }
        } else if (t === 'binary_expression' || t === 'binary') {
            const op = n.childForFieldName('operator');
            if (op && (op.text === '&&' || op.text === '||' || op.text === '??' || op.text === 'and' || op.text === 'or')) {
                count += 1;
            }
        }
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
    }
    return count;
}

function extractFunctions(root, rel, lang) {
    const family = LANGS[lang].family;
    const fam = FAM[family];
    const out = [];
    const stack = [root];

    while (stack.length > 0) {
        const n = stack.pop();
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));

        const info = countedFunctionInfo(n, fam, family);
        if (!info) continue;

        let nm = info.name;
        let owner = '';
        if (family === 'cpp' && nm.includes('::')) {
            const parts = nm.split('::');
            owner = parts[parts.length - 2];
            nm = parts[parts.length - 1];
        } else if (family === 'go' && n.type === 'method_declaration') {
            const recv = n.childForFieldName('receiver');
            if (recv) {
                const ids = identLeaves(recv, TYPE_ARG_NODES);
                if (ids.length) owner = ids[ids.length - 1];
            }
        }
        owner = owner || enclosingPrefix(n, fam, family);
        const qual = owner ? `${owner}.${nm}` : nm;
        const ccTarget = family === 'dart' ? info.body : n;
        out.push({ qual, cc: ccOfNode(ccTarget, fam, family), rel, line: n.startPosition.row + 1 });
    }
    return out;
}

function tokenStats(root, src, lang) {
    const isPy = lang === 'python';
    const ops = new Set();
    const operands = new Set();
    let n1 = 0;
    let n2 = 0;
    const codeRows = new Set();
    const commentRows = new Set();
    const stack = [root];

    while (stack.length > 0) {
        const n = stack.pop();
        if (n.type.includes('comment')) {
            for (let r = n.startPosition.row; r <= n.endPosition.row; r++) commentRows.add(r);
            continue;
        }
        if (n.childCount === 0) {
            if (n.endIndex === n.startIndex) continue;
            for (let r = n.startPosition.row; r <= n.endPosition.row; r++) codeRows.add(r);
            const txt = n.text;
            if (!n.isNamed || (isPy && PY_KEYWORDS.has(txt))) {
                ops.add(txt);
                n1 += 1;
            } else {
                operands.add(txt);
                n2 += 1;
            }
            continue;
        }
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
    }

    let pureComments = 0;
    for (const r of commentRows) {
        if (!codeRows.has(r)) pureComments += 1;
    }
    const vocab = ops.size + operands.size;
    const loc = Math.max(1, src.split('\n').length);
    const volume = vocab > 1 ? (n1 + n2) * Math.log2(vocab) : 0.0;
    return { sloc: codeRows.size, comments: pureComments, loc, volume };
}

function securityScan(src, rel, lang) {
    const out = [];
    const family = LANGS[lang].family;
    const rules = SEC_RULES[family] || [];
    const lines = src.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 600) continue;
        const trimmed = line.trimStart();
        const isComment = (family === 'python' || family === 'ruby')
            ? trimmed.startsWith('#')
            : (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
        if (isComment) continue;

        for (const [rx, sev, msg] of rules) {
            if (rx.test(line)) {
                out.push({ severity: sev, message: msg, file: rel, line: i + 1 });
            }
        }
        if (SECRET_RE.test(line)) {
            out.push({ severity: 'medium', message: 'hard-coded secret', file: rel, line: i + 1 });
        }
    }
    return out;
}

function bugScan(root, src, rel, lang) {
    const out = [];
    if (lang !== 'python') {
        EMPTY_CATCH_RE.lastIndex = 0;
        let m;
        while ((m = EMPTY_CATCH_RE.exec(src)) !== null) {
            const line = src.slice(0, m.index).split('\n').length;
            out.push({ message: 'empty catch block (exception swallowed)', file: rel, line });
        }
        return out;
    }

    const stack = [root];
    while (stack.length > 0) {
        const n = stack.pop();
        const t = n.type;
        if (t === 'except_clause') {
            const block = n.namedChildren.find((c) => c.type === 'block');
            const hasType = n.namedChildren.some((c) => c.type !== 'block' && c.type !== 'comment');
            if (!hasType) out.push({ message: 'bare except', file: rel, line: n.startPosition.row + 1 });
            if (block) {
                const stmts = block.namedChildren.filter((c) => c.type !== 'comment');
                if (stmts.length === 1 && stmts[0].type === 'pass_statement') {
                    out.push({ message: 'exception silently swallowed', file: rel, line: n.startPosition.row + 1 });
                }
            }
        } else if (t === 'default_parameter' || t === 'typed_default_parameter') {
            const val = n.childForFieldName('value');
            if (val && (val.type === 'list' || val.type === 'dictionary' || val.type === 'set' ||
                (val.type === 'call' && ['list', 'dict', 'set'].includes(val.childForFieldName('function')?.text || '')))) {
                out.push({ message: 'mutable default argument', file: rel, line: val.startPosition.row + 1 });
            }
        } else if (t === 'comparison_operator') {
            const txt = n.text;
            if (/(?:==|!=)\s*None\b|\bNone\s*(?:==|!=)/.test(txt)) {
                out.push({ message: 'comparison to None with ==/!=', file: rel, line: n.startPosition.row + 1 });
            }
        } else if (t === 'block') {
            const stmts = n.namedChildren.filter((c) => c.type !== 'comment');
            for (let i = 0; i < stmts.length - 1; i++) {
                const st = stmts[i].type;
                if (st === 'return_statement' || st === 'raise_statement' || st === 'continue_statement' || st === 'break_statement') {
                    out.push({ message: 'unreachable code', file: rel, line: stmts[i + 1].startPosition.row + 1 });
                    break;
                }
            }
        }
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
    }
    return out;
}

function hasPyDocstring(blockNode) {
    if (!blockNode) return false;
    for (let i = 0; i < blockNode.namedChildCount; i++) {
        const ch = blockNode.namedChild(i);
        if (ch.type === 'comment') continue;
        if (ch.type === 'expression_statement') {
            const inner = ch.namedChild(0);
            return !!(inner && (inner.type === 'string' || inner.type === 'concatenated_string'));
        }
        return false;
    }
    return false;
}

function styleScan(root, src, rel, lang, isInit, checkDocs) {
    const family = LANGS[lang].family;
    const fam = FAM[family];
    const out = [];
    let stmts = 0;

    const add = (category, message, line) => out.push({ category, message, file: rel, line });

    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > LINE_LIMIT) {
            add('convention', `line too long (${lines[i].length} > ${LINE_LIMIT})`, i + 1);
        }
    }

    if (family === 'python') {
        const topStmts = root.namedChildren.filter((c) => c.type !== 'comment');
        if (checkDocs && topStmts.length > 0 && !isInit && !hasPyDocstring(root)) {
            add('convention', 'missing module docstring', 1);
        }

        const used = new Set();
        const stackU = [root];
        while (stackU.length > 0) {
            const n = stackU.pop();
            if (n.type === 'import_statement' || n.type === 'import_from_statement') continue;
            if (n.type === 'identifier') used.add(n.text);
            if (n.type === 'assignment') {
                const left = n.childForFieldName('left');
                const right = n.childForFieldName('right');
                if (left && left.text === '__all__' && right) {
                    for (const m of right.text.matchAll(/["']([A-Za-z_]\w*)["']/g)) used.add(m[1]);
                }
            }
            for (let i = n.childCount - 1; i >= 0; i--) stackU.push(n.child(i));
        }

        const stack = [root];
        while (stack.length > 0) {
            const n = stack.pop();
            for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
            const t = n.type;
            if (t.endsWith('_statement') || t === 'class_definition' || t === 'function_definition') stmts += 1;

            if (t === 'import_from_statement') {
                const mod = n.childForFieldName('module_name')?.text || '';
                const hasWildcard = n.namedChildren.some((c) => c.type === 'wildcard_import');
                if (hasWildcard) add('warning', `wildcard import from ${mod}`, n.startPosition.row + 1);
                if (!isInit && mod !== '__future__') {
                    for (let i = 0; i < n.namedChildCount; i++) {
                        const c = n.namedChild(i);
                        if (c === n.childForFieldName('module_name') || c.type === 'wildcard_import') continue;
                        let local = null;
                        if (c.type === 'aliased_import') local = c.childForFieldName('alias')?.text;
                        else if (c.type === 'dotted_name') local = c.text.split('.')[0];
                        if (local && !used.has(local)) add('warning', `unused import '${local}'`, n.startPosition.row + 1);
                    }
                }
            } else if (t === 'import_statement' && !isInit) {
                for (let i = 0; i < n.namedChildCount; i++) {
                    const c = n.namedChild(i);
                    let local = null;
                    if (c.type === 'aliased_import') local = c.childForFieldName('alias')?.text;
                    else if (c.type === 'dotted_name') local = c.text.split('.')[0];
                    if (local && !used.has(local)) add('warning', `unused import '${local}'`, n.startPosition.row + 1);
                }
            } else if (t === 'class_definition') {
                const nm = n.childForFieldName('name')?.text || '';
                const line = n.startPosition.row + 1;
                if (nm && !NAME_CLS.test(nm)) add('convention', `class name '${nm}' is not PascalCase`, line);
                if (checkDocs && nm && !nm.startsWith('_') && !hasPyDocstring(n.childForFieldName('body'))) {
                    add('convention', `missing class docstring (${nm})`, line);
                }
            } else if (t === 'function_definition') {
                const nm = n.childForFieldName('name')?.text || '';
                const line = n.startPosition.row + 1;
                if (nm && !(dunder(nm) || OK_PY_FN.has(nm) || nm.startsWith('visit_') || NAME_PY_FN.test(nm))) {
                    add('convention', `function name '${nm}' is not snake_case`, line);
                }
                const body = n.childForFieldName('body');
                const bodyLen = body ? body.namedChildren.filter((c) => c.type !== 'comment').length : 0;
                if (checkDocs && nm && !nm.startsWith('_') && !nm.startsWith('test') && bodyLen > 2 && !hasPyDocstring(body)) {
                    add('convention', `missing function docstring (${nm})`, line);
                }
                const params = n.childForFieldName('parameters');
                const argNames = [];
                if (params) {
                    for (let i = 0; i < params.namedChildCount; i++) {
                        const p = params.namedChild(i);
                        let an = null;
                        if (p.type === 'identifier') an = p.text;
                        else if (p.type === 'typed_parameter' || p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
                            an = p.childForFieldName('name')?.text || p.namedChild(0)?.text;
                        }
                        if (an && an !== 'self' && an !== 'cls') argNames.push(an);
                    }
                }
                if (argNames.length > 5) add('refactor', `too many arguments in ${nm}() (${argNames.length})`, line);
                for (const a of argNames) {
                    if (!NAME_PY_ARG.test(a)) add('convention', `argument name '${a}' is not snake_case`, line);
                }
                if (n.endPosition.row - n.startPosition.row + 1 > 50) {
                    add('refactor', `function ${nm}() is longer than 50 lines`, line);
                }
                let deepest = 0;
                const st2 = [];
                for (let i = n.childCount - 1; i >= 0; i--) st2.push([n.child(i), 0]);
                while (st2.length > 0) {
                    const [x, d] = st2.pop();
                    if (x.type === 'class_definition' || x.type === 'function_definition' || x.type === 'lambda') continue;
                    const nd = CONTROL_TYPES.has(x.type) ? d + 1 : d;
                    if (nd > deepest) deepest = nd;
                    for (let i = x.childCount - 1; i >= 0; i--) st2.push([x.child(i), nd]);
                }
                if (deepest > 4) add('refactor', `deep nesting in ${nm}() (>4 levels)`, line);
            }
        }
        return { items: out, stmts };
    }

    const headOf = (n) => n.text.slice(0, 200).split('{')[0].split('(')[0];
    const hasDoc = (n) => {
        const p = n.parent && n.parent.type === 'export_statement' ? n.parent : n;
        const prev = p.previousNamedSibling;
        return !!(prev && prev.type.includes('comment'));
    };
    const isPublic = (n, name) => {
        if (family === 'java' || family === 'csharp' || family === 'php') return headOf(n).includes('public');
        if (family === 'js') {
            const h = headOf(n);
            return !name.startsWith('_') && !name.startsWith('#') && name !== 'constructor' &&
                !h.includes('private') && !h.includes('protected');
        }
        if (family === 'dart') return !name.startsWith('_');
        if (family === 'go') return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
        if (family === 'rust') return /\bpub\b/.test(headOf(n));
        if (family === 'kotlin' || family === 'swift') {
            const h = headOf(n);
            return !h.includes('private') && !h.includes('internal') && !h.includes('protected');
        }
        if (family === 'ruby') return !name.startsWith('_') && name !== 'initialize';
        return false;
    };

    const fnNameRegex = {
        java: NAME_CAMEL_FN,
        csharp: NAME_CS_FN,
        js: NAME_JS_FN,
        dart: NAME_CAMEL_FN,
        kotlin: NAME_CAMEL_FN,
        swift: NAME_CAMEL_FN,
        php: NAME_PHP_FN,
        rust: NAME_RUST_FN,
        ruby: NAME_RUBY_FN
    }[family] || null;

    const stack = [root];
    while (stack.length > 0) {
        const n = stack.pop();
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
        const t = n.type;
        if (t.endsWith('_statement') || t.endsWith('_declaration') || t.endsWith('_definition') ||
            t.endsWith('_expression') && n.parent === root || t === 'function_item' || t === 'method') {
            stmts += 1;
        }

        if (fam.classes.has(t)) {
            const name = nodeName(n, family);
            if (name) {
                const lineNo = n.startPosition.row + 1;
                if (family !== 'cpp' && family !== 'c' && family !== 'go' && !NAME_CLS.test(name)) {
                    add('convention', `class name '${name}' is not PascalCase`, lineNo);
                }
                if (checkDocs && family !== 'cpp' && family !== 'c' && isPublic(n, name) && !hasDoc(n)) {
                    add('convention', `missing class documentation (${name})`, lineNo);
                }
            }
        }

        const finfo = countedFunctionInfo(n, fam, family);
        if (!finfo) continue;
        const short = finfo.name.split('::').pop();
        const lineNo = n.startPosition.row + 1;
        const isCtor = t === 'constructor_declaration' || t === 'destructor_declaration' ||
            t === 'secondary_constructor' || t === 'init_declaration' || t === 'deinit_declaration' ||
            short === 'constructor' || short === '__construct' || short === 'initialize' ||
            (family === 'dart' && /^[A-Z]/.test(short));
        if (fnNameRegex && !isCtor && t !== 'local_function_statement' && !fnNameRegex.test(short)) {
            add('convention', `function name '${short}' violates the language naming convention`, lineNo);
        }

        const body = finfo.body;
        const nBody = body ? body.namedChildren.filter((c) => !c.type.includes('comment')).length : 0;
        if (checkDocs && family !== 'cpp' && family !== 'c' && isPublic(n, short) && nBody > 2 && !hasDoc(n)) {
            add('convention', `missing function documentation (${short})`, lineNo);
        }

        let params = n.childForFieldName('parameters') || firstChildOfTypes(n, new Set(['formal_parameter_list', 'formal_parameters', 'function_value_parameters', 'method_parameters', 'parameters']));
        if (!params && (family === 'cpp' || family === 'c')) {
            const d = n.childForFieldName('declarator');
            params = d ? d.childForFieldName('parameters') : null;
        }
        if (params && params.namedChildren.filter((c) => !c.type.includes('comment')).length > 5) {
            add('refactor', `too many arguments in ${short}() (>5)`, lineNo);
        }
        if (finfo.endRow - n.startPosition.row + 1 > 50) {
            add('refactor', `function ${short}() is longer than 50 lines`, lineNo);
        }

        let deepest = 0;
        const target = family === 'dart' ? body : n;
        const st2 = [];
        for (let i = target.childCount - 1; i >= 0; i--) st2.push([target.child(i), 0]);
        while (st2.length > 0) {
            const [x, d] = st2.pop();
            if (fam.classes.has(x.type) || countedFunctionInfo(x, fam, family) !== null) continue;
            const nd = CONTROL_TYPES.has(x.type) ? d + 1 : d;
            if (nd > deepest) deepest = nd;
            for (let i = x.childCount - 1; i >= 0; i--) st2.push([x.child(i), nd]);
        }
        if (deepest > 4) add('refactor', `deep nesting in ${short}() (>4 levels)`, lineNo);
    }
    return { items: out, stmts };
}

function extractPythonImports(root) {
    const imports = [];
    const stack = [root];
    while (stack.length > 0) {
        const n = stack.pop();
        if (n.type === 'import_statement') {
            for (let i = 0; i < n.namedChildCount; i++) {
                const c = n.namedChild(i);
                if (c.type === 'dotted_name') imports.push({ kind: 'import', name: c.text });
                else if (c.type === 'aliased_import') {
                    const nm = c.childForFieldName('name');
                    if (nm) imports.push({ kind: 'import', name: nm.text });
                }
            }
        } else if (n.type === 'import_from_statement') {
            const modNode = n.childForFieldName('module_name');
            let level = 0;
            let mod = '';
            if (modNode) {
                if (modNode.type === 'relative_import') {
                    for (let i = 0; i < modNode.childCount; i++) {
                        const c = modNode.child(i);
                        if (c.type === 'import_prefix') level = c.text.length;
                        else if (c.type === 'dotted_name') mod = c.text;
                    }
                } else {
                    mod = modNode.text;
                }
            }
            const names = [];
            for (let i = 0; i < n.namedChildCount; i++) {
                const c = n.namedChild(i);
                if (c === modNode || c.type === 'wildcard_import') continue;
                if (c.type === 'dotted_name') names.push(c.text);
                else if (c.type === 'aliased_import') {
                    const nm = c.childForFieldName('name');
                    if (nm) names.push(nm.text);
                }
            }
            imports.push({ kind: 'from', level, module: mod, names });
        }
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
    }
    return imports;
}

function analyzeFile(filePath, rootDir, lang, parser, checkDocs) {
    const rel = toPosix(path.relative(rootDir, filePath));
    const stat = fs.statSync(filePath);
    if (stat.size > 2000000) {
        return { error: `${rel}: file larger than 2 MB, skipped` };
    }
    let src = fs.readFileSync(filePath, 'utf8');
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    const isInit = lang === 'python' && path.basename(filePath) === '__init__.py';

    const tree = parser.parse(src);
    try {
        const root = tree.rootNode;
        const { classes, pendingMethods } = extractClassesFromTree(root, rel, lang);
        const funcs = extractFunctions(root, rel, lang);
        const stats = tokenStats(root, src, lang);
        const sec = securityScan(src, rel, lang);
        const bugs = bugScan(root, src, rel, lang);
        const style = styleScan(root, src, rel, lang, isInit, checkDocs);
        const pyImports = lang === 'python' ? extractPythonImports(root) : [];
        return {
            info: { path: filePath, rel, lang, isInit, classes, pendingMethods, funcs, stats, sec, bugs, style, pyImports }
        };
    } finally {
        tree.delete();
    }
}

function buildClasses(fileInfos) {
    const byGroup = new Map();
    for (const fi of fileInfos) {
        const g = groupOf(fi.lang);
        if (!byGroup.has(g)) byGroup.set(g, { map: new Map(), pendingMethods: [] });
        const entry = byGroup.get(g);
        for (const c of fi.classes) entry.map.set(c.name, c);
        for (const p of fi.pendingMethods) entry.pendingMethods.push(p);
    }

    // Attach out-of-class methods for C++, Go, and Rust
    for (const [, entry] of byGroup.entries()) {
        for (const p of entry.pendingMethods) {
            const c = entry.map.get(p.scope);
            if (!c) continue;
            if (p.mname) {
                if (!c.methods.includes(p.mname)) c.methods.push(p.mname);
                const used = new Set();
                for (const id of p.usedIdents) {
                    if (c.allFields.has(id)) used.add(id);
                }
                c.mfields.set(p.mname, used);
            }
            if (p.traitName) {
                if (!c.bases.includes(p.traitName)) c.bases.push(p.traitName);
                c.impls.add(p.traitName);
            }
            if (p.refs) for (const r of p.refs) c.refs.add(r);
            if (p.calls) for (const cl of p.calls) c.calls.add(cl);
        }
    }

    const allc = {};
    const index = new Map();
    for (const g of [...byGroup.keys()].sort()) {
        for (const [name, c] of byGroup.get(g).map.entries()) {
            const key = allc[name] ? `${name}@${g}` : name;
            c.key = key;
            c.group = g;
            allc[key] = c;
            index.set(`${g}\0${name}`, key);
        }
    }

    for (const c of Object.values(allc)) {
        const g = c.group;
        const newRefs = new Set();
        for (const r of c.refs) {
            const k = index.get(`${g}\0${r}`);
            if (k) newRefs.add(k);
        }
        c.refs = newRefs;
        c.bases = c.bases.map((b) => index.get(`${g}\0${b}`) || b);
        const newImpls = new Set();
        for (const b of c.impls) newImpls.add(index.get(`${g}\0${b}`) || b);
        c.impls = newImpls;
    }

    return allc;
}

module.exports = {
    LINE_LIMIT,
    dunder,
    analyzeFile,
    buildClasses
};