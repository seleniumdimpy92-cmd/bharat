/* ── ai-assistant.js — front-end client for the AI Worker ─────
 *
 * Adds three admin-only capabilities to the dashboard:
 *
 *   1. ✨ Suggest Reply — button injected into the Inbox preview pane.
 *      Calls POST /draft-reply on the ai-assistant Worker, drops the
 *      generated text straight into the Compose modal so the admin
 *      can review, edit, and send.
 *
 *   2. AI summary on each opened email — calls POST /summarize and
 *      shows a one-line summary + intent badge at the top of the
 *      preview. Cached per email-id in sessionStorage so re-opening
 *      the same email doesn't burn another Gemini call.
 *
 *   3. Daily AI report — a "Generate report now" button on the
 *      Overview tab + section that hits GET /daily-report and
 *      renders the HTML in-page. The Worker also fires once a day
 *      via cron and emails the same report — see workers/ai-assistant.
 *
 * Configuration
 *   window.AI_ASSISTANT_WORKER_URL must be set (in dashboard.html)
 *   to the deployed Worker URL, e.g.
 *     window.AI_ASSISTANT_WORKER_URL = 'https://ai-assistant.<sub>.workers.dev';
 *
 *   If it's missing or unreachable, every entrypoint silently no-ops
 *   (no console spam, no broken UI) — admins can still use Inbox /
 *   Compose / Overview without the AI features.
 *
 * Auth
 *   Each Worker call sends `Authorization: Bearer <Firebase ID token>`.
 *   The token is read from the live Firebase Auth instance exposed
 *   on window.__authInstance (set by js/firebase-config.js).
 * ───────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    /* ── Config & utilities ─────────────────────────────── */
    function workerUrl() {
        const u = String(window.AI_ASSISTANT_WORKER_URL || '').trim();
        if (!u) return '';
        return u.replace(/\/+$/, '');
    }
    function isConfigured() { return !!workerUrl(); }

    async function getIdToken() {
        // Match the pattern js/refund.js uses (which works on dashboard.html).
        // The dashboard waits on window.__firebaseReady — a Promise that
        // resolves to { auth, db, ... } once js/firebase-config.js has finished
        // bootstrapping the modular Firebase SDK. The legacy compat fallback
        // uses window.firebase.auth().currentUser for very-old code paths.
        try {
            if (window.__firebaseReady) {
                const fb = await window.__firebaseReady;
                if (fb && fb.auth && fb.auth.currentUser) {
                    return await fb.auth.currentUser.getIdToken();
                }
            }
            if (window.firebase && window.firebase.auth) {
                const u = window.firebase.auth().currentUser;
                if (u) return await u.getIdToken();
            }
            // Last-ditch: legacy globals some pages set
            const auth = window.__authInstance;
            if (auth && auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
                return await auth.currentUser.getIdToken();
            }
        } catch (e) {}
        return null;
    }

    async function call(path, init) {
        const base = workerUrl();
        if (!base) throw new Error('AI_ASSISTANT_WORKER_URL not configured');
        const token = await getIdToken();
        if (!token) throw new Error('Not signed in');
        const opts = Object.assign({}, init || {});
        opts.headers = Object.assign({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        }, opts.headers || {});
        const res = await fetch(base + path, opts);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(body.error || ('HTTP ' + res.status));
        }
        return body;
    }

    /* ── Toast helper (re-uses the project's toast.js if loaded) ── */
    function toast(msg, kind) {
        if (window.showToast) { window.showToast(msg, kind || 'info'); return; }
        // Light fallback
        try { console[kind === 'error' ? 'warn' : 'log']('[AI] ' + msg); } catch (_) {}
    }

    /* ════════════════════════════════════════════════════════════
     * 1. Email summary (cached) + ✨ Suggest Reply button in Inbox
     * ═══════════════════════════════════════════════════════════ */

    // sessionStorage cache so re-opening the same email reuses the summary.
    function cacheKey(emailId) { return 'aiSummary:' + emailId; }
    function readCachedSummary(id) {
        try { return JSON.parse(sessionStorage.getItem(cacheKey(id)) || 'null'); }
        catch (e) { return null; }
    }
    function writeCachedSummary(id, data) {
        try { sessionStorage.setItem(cacheKey(id), JSON.stringify(data)); } catch (e) {}
    }

    async function summarizeIfPossible(email) {
        if (!isConfigured() || !email) return null;
        const id = email.id || email._id || email.messageId;
        if (id) {
            const cached = readCachedSummary(id);
            if (cached) return cached;
        }
        try {
            const out = await call('/summarize', {
                method: 'POST',
                body: JSON.stringify({
                    text:    String(email.text || email.snippet || ''),
                    subject: String(email.subject || ''),
                    from:    String(email.from || '')
                })
            });
            if (id) writeCachedSummary(id, out);
            return out;
        } catch (err) {
            console.warn('[AI] summarize failed:', err.message);
            return null;
        }
    }

    /* Render the summary pill into the preview pane. The Inbox preview
       (rendered by js/inbox.js) puts metadata in .ipv-head and the body
       in .ipv-body. We tuck a single floating panel between them. */
    function renderSummaryPanel(email, summaryObj) {
        const previewWrap = document.getElementById('inboxPreview');
        if (!previewWrap) return;
        // Remove any previous AI panel for this preview render
        previewWrap.querySelectorAll('.ai-summary-panel').forEach(n => n.remove());
        if (!summaryObj) return;
        const head = previewWrap.querySelector('.ipv-head');
        if (!head) return;

        const intentColor = {
            booking:        '#0d7a8a',
            enquiry:        '#3498db',
            cancellation:   '#e74c3c',
            complaint:      '#a04000',
            payment_query:  '#8e44ad',
            itinerary_change:'#f39c12'
        }[String(summaryObj.intent || '').toLowerCase()] || '#5a6877';
        const urgencyColor = {
            high:   '#e74c3c',
            normal: '#7a8b96',
            low:    '#16a085'
        }[String(summaryObj.urgency || '').toLowerCase()] || '#7a8b96';

        const panel = document.createElement('div');
        panel.className = 'ai-summary-panel';
        panel.innerHTML =
            '<div class="ai-sum-row">' +
                '<span class="ai-sum-badge" style="background:' + intentColor + ';">' +
                    '<i class="fas fa-robot"></i> ' + escapeHtml(summaryObj.intent || 'other') +
                '</span>' +
                '<span class="ai-urg" style="color:' + urgencyColor + ';">' +
                    '<i class="fas fa-bolt"></i> ' + escapeHtml(summaryObj.urgency || 'normal') +
                '</span>' +
                (Array.isArray(summaryObj.tags) && summaryObj.tags.length
                    ? '<span class="ai-tags">' + summaryObj.tags.map(t =>
                        '<em>#' + escapeHtml(t) + '</em>').join(' ') + '</span>'
                    : '') +
            '</div>' +
            '<p class="ai-sum-text">' + escapeHtml(summaryObj.summary || '') + '</p>';
        head.parentNode.insertBefore(panel, head.nextSibling);
    }

    /* Hook the Suggest Reply button. js/inbox.js renders the
       preview's .ipv-actions toolbar — we inject one extra button. */
    function injectSuggestReplyButton(email) {
        if (!isConfigured()) return;
        const actions = document.querySelector('#inboxPreview .ipv-actions');
        if (!actions) return;
        if (actions.querySelector('.ipv-ai-reply')) return; // already there

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ipv-ai-reply';
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Suggest reply';
        btn.title = 'Generate a draft reply with Gemini';
        btn.addEventListener('click', () => suggestReply(email, btn));
        // Insert just after the "Reply" button if present, else at the end.
        const replyBtn = actions.querySelector('.ipv-reply');
        if (replyBtn && replyBtn.nextSibling) {
            actions.insertBefore(btn, replyBtn.nextSibling);
        } else {
            actions.appendChild(btn);
        }
    }

    async function suggestReply(email, btn) {
        if (!isConfigured() || !email) return;
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
        try {
            const out = await call('/draft-reply', {
                method: 'POST',
                body: JSON.stringify({
                    emailText: String(email.text || email.snippet || ''),
                    subject:   String(email.subject || ''),
                    from:      String(email.from || '')
                })
            });
            const reply = String((out && out.reply) || '').trim();
            if (!reply) { toast('AI returned an empty reply', 'error'); return; }

            // Open the existing Compose modal pre-filled with the reply.
            // js/inbox.js exposes a global `openComposeModal(prefill)` helper
            // when the Compose machinery loads. Fall back to setting field
            // values directly if the helper isn't available.
            const prefill = {
                to:      email.fromEmail || extractEmail(email.from) || '',
                subject: prefixRe(email.subject || ''),
                body:    reply,
                inReplyTo: email.messageId || email.id || ''
            };
            if (typeof window.openComposeModal === 'function') {
                window.openComposeModal(prefill);
            } else {
                // Fallback: try to find compose-modal fields directly
                const m = document.getElementById('inboxComposeModal');
                if (m) {
                    m.classList.add('open');
                    setVal(m, '#icTo',      prefill.to);
                    setVal(m, '#icSubject', prefill.subject);
                    setVal(m, '#icBody',    prefill.body);
                } else {
                    // Last resort — show the suggestion in an alert so the
                    // admin can copy/paste manually.
                    alert('Suggested reply:\n\n' + reply);
                }
            }
            toast('AI reply ready — review &amp; send', 'success');
        } catch (err) {
            toast('Suggest reply failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function setVal(root, sel, v) {
        const el = root.querySelector(sel);
        if (el && typeof v === 'string') el.value = v;
    }
    function prefixRe(s) {
        s = String(s || '').trim();
        if (/^re:\s/i.test(s)) return s;
        return 'Re: ' + s;
    }    function extractEmail(s) {
        s = String(s || '');
        const m = /<\s*([^>\s]+@[^>\s]+)\s*>/.exec(s) || /([^\s,;<>]+@[^\s,;<>]+)/.exec(s);
        return m ? m[1] : '';
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    /* ════════════════════════════════════════════════════════════
     * 2. Daily report panel — Overview tab
     * ═══════════════════════════════════════════════════════════ */
    function injectDailyReportPanel() {
        if (!isConfigured()) return;
        const overview = document.getElementById('section-overview');
        if (!overview) return;
        if (document.getElementById('aiReportPanel')) return;

        const panel = document.createElement('div');
        panel.id = 'aiReportPanel';
        panel.className = 'ai-report-panel';
        panel.innerHTML =
            '<div class="ai-report-head">' +
                '<h3><i class="fas fa-robot"></i> AI Daily Report ' +
                    '<small>(Gemini · last 24 h)</small></h3>' +
                '<div class="ai-report-actions">' +
                    '<button type="button" class="ai-report-btn" id="aiReportRunBtn">' +
                        '<i class="fas fa-bolt"></i> Generate now' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="ai-report-body" id="aiReportBody">' +
                '<p class="ai-report-empty">' +
                    'Click <strong>Generate now</strong> to fetch a fresh report ' +
                    'from Gemini, or wait for the daily 8 AM IST email.</p>' +
            '</div>';
        const statsGrid = overview.querySelector('.stats-grid');
        if (statsGrid && statsGrid.parentNode === overview) {
            overview.insertBefore(panel, statsGrid.nextSibling);
        } else {
            overview.insertBefore(panel, overview.firstChild);
        }
        document.getElementById('aiReportRunBtn').addEventListener('click', runDailyReport);
    }

    async function runDailyReport() {
        const btn  = document.getElementById('aiReportRunBtn');
        const body = document.getElementById('aiReportBody');
        if (!btn || !body) return;
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Working…';
        body.innerHTML = '<p class="ai-report-empty"><i class="fas fa-spinner fa-spin"></i> Asking Gemini for a fresh summary…</p>';
        try {
            const out = await call('/daily-report?dryRun=1', { method: 'GET' });
            const s = out.stats || {};
            const meta =
                '<div class="ai-report-meta">' +
                    '<span><i class="fas fa-calendar-check"></i> ' + (s.bookingsCount || 0) + ' bookings</span>' +
                    '<span><i class="fas fa-rupee-sign"></i> \u20B9' + Number(s.revenue || 0).toLocaleString('en-IN') + '</span>' +
                    '<span><i class="fas fa-inbox"></i> ' + (s.emailsCount || 0) + ' emails</span>' +
                    '<span><i class="fas fa-envelope-open-text"></i> ' + (s.unreadEmails || 0) + ' unread</span>' +
                '</div>';
            body.innerHTML = meta + '<div class="ai-report-html">' + (out.html || '') + '</div>';
        } catch (err) {
            // ── Friendly "secret not set" setup card ───────────────
            // The Cloudflare Worker throws this exact message when its
            // FIREBASE_SERVICE_ACCOUNT_KEY (or BREVO_API_KEY / GEMINI_API_KEY)
            // hasn't been provisioned via `wrangler secret put`. Instead of
            // showing the bare error string, we render a one-step setup card
            // with the exact CLI commands so the admin can fix it in 60 s.
            const m = String(err.message || '').match(/^([A-Z_]+)\s+secret\s+not\s+set/i);
            if (m) {
                const secret = m[1];
                body.innerHTML =
                    '<div class="ai-report-setup">' +
                        '<div class="ai-report-setup-head">' +
                            '<i class="fas fa-circle-exclamation"></i> ' +
                            '<strong>AI assistant not fully configured</strong>' +
                        '</div>' +
                        '<p>The Cloudflare Worker is missing the <code>' + escapeHtml(secret) + '</code> secret. ' +
                            'Run these commands once on your machine to fix it:</p>' +
                        '<pre class="ai-report-setup-cmds">' +
                            'cd workers/ai-assistant\n' +
                            'npm install            # one-time\n' +
                            'npx wrangler login     # one-time browser auth\n' +
                            (secret === 'GEMINI_API_KEY'
                                ? '# Get key from https://aistudio.google.com/app/apikey\n' +
                                  'npx wrangler secret put GEMINI_API_KEY\n'
                              : secret === 'BREVO_API_KEY'
                                ? '# Get key from https://app.brevo.com/settings/keys/api\n' +
                                  'npx wrangler secret put BREVO_API_KEY\n'
                                : '# Firebase Console → Project settings → Service accounts\n' +
                                  '#   → Generate new private key (downloads a JSON file)\n' +
                                  'cat ~/Downloads/&lt;your-service-account&gt;.json | \\\n' +
                                  '    npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY\n') +
                            'npx wrangler deploy' +
                        '</pre>' +
                        '<p style="margin-top:.5rem;font-size:.82rem;color:#7a8b96;">' +
                            'Full walkthrough: <code>ai_assistant_setup.md</code> in the repo. ' +
                            'Until configured, this widget stays inert &mdash; the rest of the dashboard is unaffected.' +
                        '</p>' +
                    '</div>';
            } else {
                body.innerHTML = '<p class="ai-report-error"><i class="fas fa-triangle-exclamation"></i> ' +
                    escapeHtml(err.message) + '</p>';
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    /* ════════════════════════════════════════════════════════════
     * 3. Init — wait for inbox preview + observe selection changes.
     *    js/inbox.js doesn't expose an "email opened" event, so we
     *    use a MutationObserver on #inboxPreview and re-inject our
     *    UI every time the preview content changes (i.e. a row was
     *    clicked). The same observer fires the AI summary call.
     * ═══════════════════════════════════════════════════════════ */
    function readPreviewedEmail() {
        // js/inbox.js stashes the latest opened email at window.__lastPreviewedEmail.
        // If it isn't set, fall back to scraping the .ipv-meta block.
        if (window.__lastPreviewedEmail) return window.__lastPreviewedEmail;
        const wrap = document.getElementById('inboxPreview');
        if (!wrap) return null;
        const subject = (wrap.querySelector('.ipv-subject') || {}).textContent || '';
        const text    = (wrap.querySelector('.ipv-body pre, .ipv-body') || {}).textContent || '';
        const fromEl  = wrap.querySelector('.ipv-meta');
        const fromTxt = fromEl ? (fromEl.textContent.split('\n').find(l => /from/i.test(l)) || '') : '';
        if (!subject && !text) return null;
        return { subject: subject.trim(), text: text.trim().slice(0, 5000), from: fromTxt.trim() };
    }

    /* Inject a "🤖 Summarize" button into the preview's action toolbar.
       We do NOT auto-summarize every opened email any more — that
       blew through the Gemini free-tier RPM quota whenever the admin
       clicked through their inbox quickly. Now the admin clicks the
       button explicitly when they want a summary; cached results
       still display automatically on re-open via sessionStorage. */
    function injectSummarizeButton(email) {
        if (!isConfigured()) return;
        const actions = document.querySelector('#inboxPreview .ipv-actions');
        if (!actions) return;
        if (actions.querySelector('.ipv-ai-sum')) return; // already there

        const id = email.id || email._id || email.messageId;
        const cached = id ? readCachedSummary(id) : null;
        if (cached) {
            // Cached summary — render it without burning a quota call.
            renderSummaryPanel(email, cached);
            return;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ipv-ai-sum';
        btn.innerHTML = '<i class="fas fa-robot"></i> AI summary';
        btn.title = 'Ask Gemini for a one-line summary + intent';
        btn.addEventListener('click', async () => {
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Summarising…';
            try {
                const sum = await summarizeIfPossible(email);
                if (sum) {
                    renderSummaryPanel(email, sum);
                    btn.remove();   // job done — get out of the way
                } else {
                    toast('AI summary unavailable right now', 'error');
                }
            } catch (e) {
                toast('AI summary failed: ' + e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        });
        // Place at the end of the action row.
        actions.appendChild(btn);
    }

    let _previewObserver = null;
    let _previewDebounce = null;
    function attachPreviewObserver() {
        const wrap = document.getElementById('inboxPreview');
        if (!wrap || _previewObserver) return;
        _previewObserver = new MutationObserver(() => {
            // Debounce — many small mutations come in a burst when js/inbox.js
            // builds the preview. Wait 80ms after the last one.
            clearTimeout(_previewDebounce);
            _previewDebounce = setTimeout(() => {
                const email = readPreviewedEmail();
                if (!email) return;
                // Inject our two buttons (Suggest reply + AI summary).
                // No automatic Gemini calls — admin opts in by clicking.
                // If a cached summary exists for this email it is rendered
                // synchronously inside injectSummarizeButton().
                injectSuggestReplyButton(email);
                injectSummarizeButton(email);
            }, 80);
        });
        _previewObserver.observe(wrap, { childList: true, subtree: true });
    }

    function injectStyles() {
        if (document.getElementById('ai-assistant-styles')) return;
        const css = document.createElement('style');
        css.id = 'ai-assistant-styles';
        css.textContent = [
            '.ai-summary-panel{margin:0 1rem;padding:.65rem .85rem;background:#f0f8fa;border:1px solid #cfe2e6;border-radius:8px;}',
            '.ai-summary-panel .ai-sum-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.35rem;font-size:.78rem;}',
            '.ai-summary-panel .ai-sum-badge{display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .55rem;border-radius:999px;color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.7rem;}',
            '.ai-summary-panel .ai-urg{display:inline-flex;align-items:center;gap:.25rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.7rem;}',
            '.ai-summary-panel .ai-tags em{font-style:normal;color:#5a6877;font-size:.72rem;margin-left:.2rem;}',
            '.ai-summary-panel .ai-sum-text{margin:0;color:#1c2b48;font-size:.92rem;line-height:1.45;}',
            '.ipv-ai-reply{padding:.4rem .85rem;border-radius:6px;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;border:1px solid transparent;background:linear-gradient(135deg,#8e44ad,#3498db);color:#fff;display:inline-flex;align-items:center;gap:.35rem;box-shadow:0 2px 6px rgba(142,68,173,.22);}',
            '.ipv-ai-reply:hover:not(:disabled){filter:brightness(1.05);}',
            '.ipv-ai-reply:disabled{opacity:.7;cursor:not-allowed;}',
            '.ipv-ai-sum{padding:.4rem .85rem;border-radius:6px;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;border:1px solid #cfe2e6;background:#fff;color:#0d7a8a;display:inline-flex;align-items:center;gap:.35rem;}',
            '.ipv-ai-sum:hover:not(:disabled){background:#e8f4f7;border-color:#0d7a8a;}',
            '.ipv-ai-sum:disabled{opacity:.65;cursor:not-allowed;}',
            '.ai-report-panel{background:#fff;border:1px solid #e3e8ef;border-radius:12px;box-shadow:0 2px 8px rgba(10,31,68,0.05);margin-bottom:.75rem;overflow:hidden;}',
            '.ai-report-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.75rem 1rem;background:linear-gradient(135deg,#f6fafb 0%,#eef6f8 100%);border-bottom:1px solid #e3e8ef;}',
            '.ai-report-head h3{margin:0;font-size:.95rem;color:#1c2b48;display:inline-flex;align-items:center;gap:.4rem;}',
            '.ai-report-head h3 i{color:#8e44ad;}',
            '.ai-report-head small{color:#888;font-weight:400;}',
            '.ai-report-btn{padding:.45rem .95rem;border-radius:6px;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;border:0;background:linear-gradient(135deg,#8e44ad,#3498db);color:#fff;display:inline-flex;align-items:center;gap:.35rem;}',
            '.ai-report-btn:hover:not(:disabled){filter:brightness(1.05);}',
            '.ai-report-btn:disabled{opacity:.7;cursor:not-allowed;}',
            '.ai-report-body{padding:1rem 1.1rem;font-size:.9rem;color:#1c2b48;line-height:1.55;}',
            '.ai-report-empty{color:#888;text-align:center;margin:.5rem 0;}',
            '.ai-report-error{color:#c0392b;background:#fdedec;padding:.5rem .75rem;border-radius:6px;margin:.25rem 0;}',
            '.ai-report-meta{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.85rem;}',
            '.ai-report-meta span{padding:.3rem .65rem;background:#f3f8fa;border:1px solid #cfe2e6;border-radius:999px;color:#0d2c3a;font-weight:600;font-size:.78rem;}',
            '.ai-report-html h2{font-size:1rem;color:#1c2b48;margin:1rem 0 .35rem;}',
            '.ai-report-html ul,.ai-report-html ol{margin:0 0 .5rem 1.25rem;}',
            '.ai-report-html li{margin-bottom:.25rem;}',
            /* Friendly setup card shown when a Worker secret is missing */
            '.ai-report-setup{background:#fef9e7;border:1px solid #f1c40f;border-radius:8px;padding:.85rem 1rem;color:#7d6608;}',
            '.ai-report-setup-head{display:flex;align-items:center;gap:.45rem;margin-bottom:.5rem;font-size:.95rem;color:#7d6608;}',
            '.ai-report-setup-head i{color:#f39c12;font-size:1rem;}',
            '.ai-report-setup p{margin:.25rem 0;color:#5a4a08;font-size:.86rem;line-height:1.55;}',
            '.ai-report-setup code{background:#fff8e1;border:1px solid #f5d76e;border-radius:4px;padding:.05rem .35rem;font-size:.82rem;color:#7d6608;}',
            '.ai-report-setup-cmds{background:#1c2b48;color:#e1f4ff;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.78rem;line-height:1.55;padding:.7rem .9rem;border-radius:6px;overflow-x:auto;white-space:pre;margin:.4rem 0 .25rem;}'
        ].join('\n');
        document.head.appendChild(css);
    }

    function init() {
        injectStyles();
        injectDailyReportPanel();
        attachPreviewObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public surface for testing / manual triggers from console.
    window.AIAssistant = {
        isConfigured,
        summarize:    summarizeIfPossible,
        suggestReply: (email) => suggestReply(email, document.createElement('button')),
        runReport:    runDailyReport
    };
})();
