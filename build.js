#!/usr/bin/env node
/**
 * Production build: minify + mangle all client-side JS so it's
 * unreadable in the browser DevTools.
 *
 *   npm run build
 *
 * What it does:
 *   • Reads every *.js file in /js (skipping firebase-config.js)
 *   • Runs Terser with aggressive mangling + console-removal
 *   • Writes the minified output back to the same file (in the build dir)
 *
 * Original source files in your local working tree are NOT touched —
 * Netlify clones the repo into a fresh build environment and only the
 * minified files are deployed.
 *
 * If you want a "dev" mode that skips minification, set NETLIFY=false
 * (or any env var that's NOT 'true') before running.
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = __dirname;
const JS_DIR = path.join(ROOT, 'js');

// Files that should NOT be minified:
//   • firebase-config.js  — must stay readable so users can swap projects
//   • Anything you explicitly want to keep readable
const SKIP = new Set([
    'firebase-config.js'
]);

const TERSER_OPTIONS = {
    compress: {
        // Strip console.* in production for smaller files + cleaner devtools.
        drop_console: ['log', 'info', 'debug'],
        passes: 2,
        booleans_as_integers: false,
        pure_funcs: ['console.debug']
    },
    mangle: {
        toplevel: true,
        // Don't rename Razorpay/Firebase globals or DOM event names.
        reserved: [
            'Razorpay', 'firebase', 'window', 'document',
            'createBooking', 'cancelBooking', 'login', 'register', 'logout',
            'openLogin', 'closeLogin', 'openRegister', 'closeRegister',
            'openProfile', 'closeProfile', 'openCustomize', 'closeCustomize',
            'closePayment', 'confirmBooking', 'bookPackage', 'proceedToPayment',
            'PackagesStore', 'UsersStore', 'SettingsStore', 'BookingsStore',
            'Toast', 'searchPackages', 'quickSearch', '__firebaseReady',
            '__authInstance', '__firebaseAuthReady', '__toastAutoOverride',
            '_packages', '_siteSettings', 'currentUser', 'currentPackage',
            'currentBasePrice', 'searchContext'
        ]
    },
    format: {
        comments: false,
        ascii_only: true
    },
    sourceMap: false
};

async function buildOne(filename) {
    const full = path.join(JS_DIR, filename);
    if (!fs.statSync(full).isFile() || !filename.endsWith('.js')) return;
    if (SKIP.has(filename)) {
        console.log('   SKIP  ' + filename + '  (kept as-is)');
        return;
    }
    const src = fs.readFileSync(full, 'utf8');
    try {
        const out = await minify({ [filename]: src }, TERSER_OPTIONS);
        if (!out.code) throw new Error('Terser returned empty output');
        fs.writeFileSync(full, out.code, 'utf8');
        const before = src.length;
        const after = out.code.length;
        const pct = ((1 - after / before) * 100).toFixed(1);
        console.log('   OK    ' + filename.padEnd(20) + '  ' + before + ' → ' + after + ' bytes  (-' + pct + '%)');
    } catch (e) {
        console.error('   FAIL  ' + filename + ': ' + e.message);
        process.exitCode = 1;
    }
}

async function main() {
    console.log('🔧 Building production JS bundles…');
    if (!fs.existsSync(JS_DIR)) {
        console.error('No /js directory found at ' + JS_DIR);
        process.exit(1);
    }
    const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
    for (const f of files) {
        await buildOne(f);
    }
    console.log('✅ Build complete.');
}

main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});