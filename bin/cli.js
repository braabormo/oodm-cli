#!/usr/bin/env node
'use strict';

const { main } = require('../src/index');

main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('oodm fatal error:', err && err.message ? err.message : err);
        process.exit(1);
    });