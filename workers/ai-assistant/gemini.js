/* ── gemini.js — AI inference helper ─────────────────────────
 *
 * Despite the legacy filename, this module now talks to **Cloudflare
 * Workers AI** (env.AI.run), not Google Gemini. We kept the filename
 * + exported function names (`callGemini`, `tryParseJson`) so worker.js
 * didn't need to change — those names are now misnomers but the
 * imports continue to work.
 *
 * Why Cloudflare Workers AI?
 *   • No separate API key to manage — the env.AI binding (declared in
 *     wrangler.jsonc) gives the worker direct access.
 *   • Free quota: 10,000 neurons/day on the Workers free plan
 *     (≈ 30,000+ calls for an 8B model). Never expires, no card.
 *   • Edge-hosted inference — same Cloudflare colo as your worker,
 *     so latency is measured in tens of milliseconds.
 *   • Same Llama 3.1 8B model the rest of the industry rates as
 *     "good enough for short summarisation + structured output."
 *
 * Model selection: env.AI_MODEL, defaulting to
 *   @cf/meta/llama-3.1-8b-instruct
 * Catalog: https://developers.cloudflare.com/workers-ai/models/
 * ─────────────────────────────────────────────────────────── */

export async function callGemini(env, prompt, opts) {
    if (!env.AI || typeof env.AI.run !== 'function') {
        throw new Error('Cloudflare AI binding not available — check wrangler.jsonc has the "ai" binding');
    }
    const model = (env.AI_MODEL || env.GEMINI_MODEL || '@cf/meta/llama-3.1-8b-instruct');
    const wantJson = !!(opts && opts.json);

    // Llama-style chat-completion input. We split the prompt into a
    // light system message + a user message — that's what
    // instruct-tuned Llama responds best to.
    const systemHint = wantJson
        ? 'You are a precise assistant. Always respond with a single valid JSON object that matches the schema described in the user message. No markdown, no code fences, no explanation — just the JSON.'
        : 'You are a concise, friendly assistant for the Andaman Voyages travel agency. Answer using the format requested in the user message.';

    const messages = [
        { role: 'system', content: systemHint },
        { role: 'user',   content: String(prompt || '') }
    ];

    const inferenceOpts = {
        max_tokens:  (opts && opts.maxTokens)  || 1024,
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.4
    };

    let result;
    try {
        result = await env.AI.run(model, { messages, ...inferenceOpts });
    } catch (err) {
        throw new Error('Cloudflare AI error: ' + (err && err.message || err));
    }

    // Llama 3.1 returns { response: '...' }. Some other models return
    // { result: { response: '...' } } or a raw string. Normalise.
    let text = '';
    if (typeof result === 'string') {
        text = result;
    } else if (result && typeof result.response === 'string') {
        text = result.response;
    } else if (result && result.result && typeof result.result.response === 'string') {
        text = result.result.response;
    } else if (result && Array.isArray(result.choices) && result.choices[0]) {
        text = String((result.choices[0].message && result.choices[0].message.content) || '');
    } else {
        text = JSON.stringify(result || {});
    }

    return { text: String(text).trim(), raw: result };
}

/* Try to extract JSON from an LLM response. Llama sometimes wraps
   the JSON in ```json fences or trailing prose, so we tolerate that.
   Returns null if parsing fails. */
export function tryParseJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    // Strip markdown fences if any
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    // First try as-is
    try { return JSON.parse(s); } catch (_) {}
    // Then try to extract the first {...} block
    const m = /\{[\s\S]*\}/.exec(s);
    if (m) {
        try { return JSON.parse(m[0]); } catch (_) {}
    }
    return null;
}
/* ── Vision: read an image (or PDF page rendered as image) via
 * Cloudflare Workers AI's LLaVA model and extract structured package
 * info. Returns { ok, fields, raw } where `fields` is the parsed
 * JSON conforming to the package schema, or `null` if extraction
 * couldn't produce valid JSON.
 *
 * `imageUrl` should be a publicly fetchable URL (Cloudinary, etc).
 * The worker fetches the bytes, base64-encodes, and passes them to
 * the vision model along with a strict JSON-schema prompt.            */
export async function extractPackageFromImage(env, imageUrl) {
    if (!env.AI || typeof env.AI.run !== 'function') {
        throw new Error('Cloudflare AI binding not available — check wrangler.jsonc has the "ai" binding');
    }
    if (!imageUrl) throw new Error('imageUrl is required');

    // Fetch the image bytes (Cloudinary URLs are public; PDF pages
    // should already have been rendered to image upstream).
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error('Could not fetch image: HTTP ' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes || !bytes.byteLength) throw new Error('Empty image');
    if (bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error('Image too large (max 10 MB after Cloudinary)');
    }

    const VISION_MODEL = env.AI_VISION_MODEL || '@cf/llava-hf/llava-1.5-7b-hf';

    const prompt =
        'You are reading an Andaman Islands travel-package brochure. ' +
        'Extract the package details and respond with ONLY a single JSON object (no markdown, no fences, no prose) matching this exact shape:\n' +
        '{\n' +
        '  "name": "string (the package title, e.g. \\"Luxury Andaman Retreat\\")",\n' +
        '  "desc": "string (a one-line tagline including duration like \\"6N/7D | Port Blair + Havelock | 5* Resorts\\")",\n' +
        '  "price": number (the per-person INR price as a plain number, no commas/symbols),\n' +
        '  "duration": "string (e.g. \\"6N/7D\\" or \\"5 Nights / 6 Days\\")",\n' +
        '  "category": "one of: Budget, Standard, Luxury, Premium, Honeymoon, Family, Adventure (best guess from price + content)",\n' +
        '  "rating": number (default 4.5 if not in the brochure),\n' +
        '  "inclusions": ["array of short strings, e.g. \\"Hotels\\", \\"Ferries\\", \\"Breakfast\\""],\n' +
        '  "exclusions": ["array of short strings, e.g. \\"Flights\\", \\"GST\\""],\n' +
        '  "places": ["array of place names visited, e.g. \\"Port Blair\\", \\"Havelock\\""],\n' +
        '  "itinerary": [\n' +
        '    { "day": 1, "title": "Arrival in Port Blair", "details": "short description of activities for day 1" }\n' +
        '  ]\n' +
        '}\n\n' +
        'Rules:\n' +
        '- Return ONLY the JSON object. No code fences. No commentary.\n' +
        '- If a field is not visible in the brochure, use a sensible default (price 0, rating 4.5, empty arrays).\n' +
        '- "price" must be a number (e.g. 28999), not a string ("28,999" or "₹28,999").\n' +
        '- itinerary must have one entry per day visible in the brochure.\n';

    let result;
    try {
        result = await env.AI.run(VISION_MODEL, {
            image: Array.from(bytes),
            prompt: prompt,
            max_tokens: 1500
        });
    } catch (err) {
        throw new Error('Vision model error: ' + (err && err.message || err));
    }

    let text = '';
    if (typeof result === 'string') text = result;
    else if (result && typeof result.description === 'string') text = result.description;
    else if (result && typeof result.response === 'string') text = result.response;
    else if (result && result.result && typeof result.result.response === 'string') text = result.result.response;
    else text = JSON.stringify(result || {});

    const parsed = tryParseJson(text);
    return { ok: !!parsed, fields: parsed, raw: text };
}
