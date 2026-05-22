// ── AI Chat Widget for Bharat Tours & Travels ─────────────────
(function () {
    'use strict';

    // ── Client-side fallback (works even without Netlify) ──────
    function clientFallback(msg) {
        const q = (msg || '').toLowerCase();
        if (/hi|hello|hey|namaste|good/.test(q))
            return '👋 Hello! Welcome to **Bharat Tours & Travels**! I\'m your Andaman travel assistant. Ask me anything about packages, prices, beaches or activities! 🏝️';
        if (/price|cost|rate|how much|₹|rupee|afford/.test(q))
            return '💰 Our packages:\n• **Budget Escape** – ₹15,999/person (4N/5D)\n• **Standard Bliss** – ₹21,999/person (6N/7D)\n• **Luxury Retreat** – ₹28,999/person (6N/7D)\n• **Honeymoon Paradise** – ₹24,999/couple (5N/6D)\n\nAll include hotels, ferries & breakfast! 🏖️';
        if (/honeymoon|couple|romantic|anniversary|wedding/.test(q))
            return '💑 Our **Honeymoon Paradise** (5N/6D, ₹24,999) is perfect for couples!\n\nIncludes: Sea-view suite, candlelight beach dinner, couple spa, sunset cruise & professional photoshoot. Book now! 🌅';
        if (/luxury|premium|5 star|five star|best|vip/.test(q))
            return '✨ **Luxury Andaman Retreat** (6N/7D, ₹28,999):\n• 5-star beachfront resort\n• Private yacht transfers\n• All meals included\n• Advanced PADI scuba diving\n• Daily spa treatments\n• Personal concierge 24/7';
        if (/budget|cheap|affordable|economy|low cost/.test(q))
            return '🌊 **Budget Andaman Escape** (4N/5D, ₹15,999/person):\n• Port Blair + Havelock Island\n• Hotel accommodation\n• Ferry transfers\n• Daily breakfast\n• Cellular Jail & Ross Island tour\n\nGreat value for an amazing trip!';
        if (/standard|mid|normal|medium/.test(q))
            return '⭐ **Standard Andaman Bliss** (6N/7D, ₹21,999):\n• Port Blair + Havelock + Neil Island\n• Deluxe hotels\n• Beginner scuba diving\n• All sightseeing included\n• Premium ferries';
        if (/scuba|dive|diving|underwater/.test(q))
            return '🤿 Andaman has world-class diving! \n\n• **Beginner scuba** included in Standard & Honeymoon packages\n• **Advanced PADI** diving in Luxury package\n• Best spots: Elephant Beach, North Bay, Barren Island\n\nNo experience needed for beginner sessions!';
        if (/snorkel/.test(q))
            return '🐠 Snorkeling is fantastic at **Elephant Beach** (Havelock) and **Bharatpur Beach** (Neil Island). Included in Standard, Luxury & Honeymoon packages. Crystal clear waters with vibrant coral reefs!';
        if (/beach|radhanagar|havelock|neil|port blair|island/.test(q))
            return '🏖️ Must-visit beaches:\n• **Radhanagar Beach** (Havelock) – Asia\'s Best Beach\n• **Elephant Beach** – best for snorkeling\n• **Laxmanpur Beach** (Neil) – amazing sunset\n• **Corbyn\'s Cove** (Port Blair) – palm-lined bay\n\nAll covered in our packages!';
        if (/when|best time|season|monsoon|weather|visit/.test(q))
            return '☀️ **Best time:** October – May\n• Oct–Nov: Post-monsoon, lush & calm seas\n• Dec–Feb: Peak season, perfect weather\n• Mar–May: Warm, less crowded\n\n⚠️ Avoid June–September (monsoon). Book early for December!';
        if (/book|booking|reserve|payment|pay|how to/.test(q))
            return '📱 **Easy Booking:**\n1. Choose your package\n2. Click "Book Now"\n3. Select dates & guests\n4. Pay securely via Razorpay\n\nWe accept UPI, credit/debit cards & net banking. Instant confirmation! ✅';
        if (/duration|days|nights|how long|long/.test(q))
            return '📅 Package durations:\n• Budget: **4 Nights / 5 Days**\n• Standard: **6 Nights / 7 Days**\n• Luxury: **6 Nights / 7 Days**\n• Honeymoon: **5 Nights / 6 Days**\n\nCustom durations available on request!';
        if (/include|inclus|what.*get|cover/.test(q))
            return '✅ **All packages include:**\n• Hotel accommodation\n• Ferry transfers\n• Daily breakfast\n• Airport pickup & drop\n\n**Extras by package:**\n• Standard: Scuba diving\n• Luxury: All meals + spa + yacht\n• Honeymoon: Candlelight dinners + photoshoot';
        if (/exclude|not include|extra|additional/.test(q))
            return '❌ **Generally NOT included:**\n• Airfare to Port Blair\n• Lunch & dinner (Budget/Standard)\n• Personal expenses\n• Travel insurance\n• Extra water sports\n\nContact us for custom add-ons!';
        if (/contact|phone|email|call|reach|whatsapp|support/.test(q))
            return '📞 **Contact Us:**\n• Phone: +91 88801 95191 / +91 94341 25698\n• Email: info@andamanvoyages.in\n  · Bookings: booking@andamanvoyages.in\n  · Cancellations: cancellation@andamanvoyages.in\n• Hours: Mon–Sat, 9am–7pm IST\n\nWe\'d love to plan your dream trip! 🌴';
        if (/cancel|refund|policy/.test(q))
            return '📋 **Cancellation Policy:**\n• 15+ days before: 100% refund\n• 7–14 days before: 50% refund\n• Within 7 days: No refund\n\nWe recommend travel insurance for peace of mind!';
        if (/activity|activities|what to do|adventure|fun/.test(q))
            return '🎯 **Top Andaman Activities:**\n• 🤿 Scuba diving & snorkeling\n• 🚤 Island hopping\n• 🐠 Glass-bottom boat rides\n• 🏄 Sea walking & jet ski\n• 🌅 Sunset cruises\n• 📸 Professional photoshoots\n• 🏛️ Cellular Jail heritage tour';
        if (/flight|fly|airport|how to reach/.test(q))
            return '✈️ **Getting to Andaman:**\n• Fly to **Veer Savarkar International Airport**, Port Blair\n• Direct flights from Chennai, Kolkata, Delhi, Mumbai, Bangalore\n• ~2 hour flight from Chennai/Kolkata\n\nAirfare is NOT included in packages (book separately).';
        return '😊 Great question! I\'d love to help you plan your **Andaman trip**. You can ask me about:\n• 💰 Package prices\n• 🏖️ Best beaches\n• 🤿 Activities & diving\n• 📅 Best time to visit\n• 📞 How to book\n\nOr visit our Contact page for personalized assistance!';
    }

    // ── Inject CSS ─────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
    .chat-widget-btn {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 99999;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1976d2, #0e8c72);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 24px rgba(26,188,156,0.55);
        transition: transform 0.2s, box-shadow 0.2s;
    }
    .chat-widget-btn:hover { transform: scale(1.1); box-shadow: 0 8px 32px rgba(26,188,156,0.65); }
    .chat-widget-btn i { color: #fff; font-size: 1.65rem; pointer-events: none; }
    .chat-notif-dot {
        position: absolute;
        top: 3px; right: 3px;
        width: 16px; height: 16px;
        background: #e74c3c;
        border-radius: 50%;
        border: 2.5px solid #fff;
        display: none;
        animation: chat-pulse 1.6s infinite;
    }
    @keyframes chat-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.35)} }

    .chat-panel-wrap {
        position: fixed;
        bottom: 106px;
        right: 28px;
        z-index: 99998;
        width: 460px;
        height: min(680px, calc(100vh - 130px));
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 12px 48px rgba(0,0,0,0.22);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform-origin: bottom right;
        transform: scale(0.88) translateY(16px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.28s cubic-bezier(.34,1.5,.64,1), opacity 0.22s ease;
    }
    .chat-panel-wrap.open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: all;
    }

    /* Header */
    .cp-header {
        background: linear-gradient(135deg, #1976d2, #0e8c72);
        padding: 1.1rem 1.4rem;
        display: flex;
        align-items: center;
        gap: 0.85rem;
        flex-shrink: 0;
    }
    .cp-avatar {
        width: 48px; height: 48px;
        border-radius: 50%;
        background: rgba(255,255,255,0.22);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        font-size: 1.4rem;
        color: #fff;
    }
    .cp-info { flex: 1; min-width: 0; }
    .cp-name { color: #fff; font-weight: 700; font-size: 1.08rem; }
    .cp-status { color: rgba(255,255,255,0.85); font-size: 0.82rem; margin-top: 2px; }
    .cp-close {
        background: rgba(255,255,255,0.18);
        border: none; color: #fff;
        width: 34px; height: 34px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1rem;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s;
        flex-shrink: 0;
    }
    .cp-close:hover { background: rgba(255,255,255,0.32); }

    /* Messages */
    .cp-messages {
        flex: 1 1 0;
        height: 0;
        overflow-y: auto;
        padding: 1.35rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: #f4f7fb;
        scroll-behavior: smooth;
    }
    .cp-messages::-webkit-scrollbar { width: 5px; }
    .cp-messages::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }

    .cp-bubble {
        max-width: 80%;
        padding: 0.8rem 1.1rem;
        border-radius: 16px;
        font-size: 0.97rem;
        line-height: 1.65;
        word-break: break-word;
    }
    .cp-bubble.bot {
        background: #fff;
        color: #2d2d2d;
        border-radius: 4px 16px 16px 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        align-self: flex-start;
    }
    .cp-bubble.user {
        background: linear-gradient(135deg, #1976d2, #0e8c72);
        color: #fff;
        border-radius: 16px 16px 4px 16px;
        align-self: flex-end;
    }
    .cp-bubble.typing {
        background: #fff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        align-self: flex-start;
        border-radius: 4px 16px 16px 16px;
        padding: 0.85rem 1.1rem;
    }
    .cp-typing-dots { display: flex; gap: 5px; align-items: center; }
    .cp-typing-dots span {
        width: 8px; height: 8px;
        background: #bbb;
        border-radius: 50%;
        animation: cp-bounce 1.2s infinite;
    }
    .cp-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .cp-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes cp-bounce {
        0%,80%,100% { transform: translateY(0); }
        40% { transform: translateY(-7px); }
    }

    /* Quick replies */
    .cp-quick {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.6rem 1.25rem 0.8rem;
        background: #f4f7fb;
        border-top: 1px solid #eaf0f6;
    }
    .cp-quick-btn {
        padding: 0.42rem 0.95rem;
        border: 1.5px solid #1976d2;
        background: #fff;
        color: #0e8c72;
        border-radius: 22px;
        font-size: 0.87rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.18s;
        font-family: inherit;
    }
    .cp-quick-btn:hover { background: #1976d2; color: #fff; border-color: #1976d2; }

    /* Input bar */
    .cp-input-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.9rem 1.25rem;
        background: #fff;
        border-top: 1px solid #e8eef4;
        flex-shrink: 0;
    }
    .cp-input {
        flex: 1;
        border: 1.5px solid #dce4ed;
        border-radius: 26px;
        padding: 0.72rem 1.15rem;
        font-family: inherit;
        font-size: 0.97rem;
        color: #333;
        outline: none;
        background: #f7fafc;
        transition: border-color 0.2s, background 0.2s;
    }
    .cp-input:focus { border-color: #1976d2; background: #fff; }
    .cp-send {
        width: 46px; height: 46px;
        border-radius: 50%;
        background: #1976d2;
        border: none;
        color: #fff;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 1rem;
        flex-shrink: 0;
        transition: background 0.2s, transform 0.15s;
    }
    .cp-send:hover:not(:disabled) { background: #0e8c72; transform: scale(1.1); }
    .cp-send:disabled { background: #c5d5da; cursor: not-allowed; }

    @media (max-width: 520px) {
        .chat-panel-wrap {
            width: calc(100vw - 20px);
            right: 10px;
            bottom: 100px;
            height: min(600px, calc(100vh - 120px));
        }
        .chat-widget-btn { bottom: 20px; right: 16px; }
    }
    `;
    document.head.appendChild(style);

    // ── Inject HTML ────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'chat-panel-wrap';
    panel.id = 'cpPanel';
    panel.innerHTML = `
        <div class="cp-header">
            <div class="cp-avatar"><i class="fas fa-robot"></i></div>
            <div class="cp-info">
                <div class="cp-name">Andaman AI Guide</div>
                <div class="cp-status"><span style="color:#a8f5de;">●</span> Online · Always here to help</div>
            </div>
            <button class="cp-close" id="cpClose" title="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="cp-messages" id="cpMessages"></div>
        <div class="cp-quick" id="cpQuick"></div>
        <div class="cp-input-bar">
            <input class="cp-input" id="cpInput" type="text" placeholder="Type your question here…" maxlength="400" autocomplete="off">
            <button class="cp-send" id="cpSend" title="Send"><i class="fas fa-paper-plane"></i></button>
        </div>
    `;

    const btn = document.createElement('button');
    btn.className = 'chat-widget-btn';
    btn.id = 'cpBtn';
    btn.title = 'Chat with us';
    btn.innerHTML = `<i class="fas fa-comments" id="cpBtnIcon"></i><span class="chat-notif-dot" id="cpDot"></span>`;

    document.body.appendChild(panel);
    document.body.appendChild(btn);

    // ── Refs ───────────────────────────────────────────────────
    const msgs    = document.getElementById('cpMessages');
    const input   = document.getElementById('cpInput');
    const sendBtn = document.getElementById('cpSend');
    const closeEl = document.getElementById('cpClose');
    const btnIcon = document.getElementById('cpBtnIcon');
    const dot     = document.getElementById('cpDot');
    const quick   = document.getElementById('cpQuick');

    let isOpen = false, isBusy = false, opened = false;
    let history = [];

    const QUICK_Q = [
        '💰 Package prices', '🏖️ Best beaches', '🤿 Scuba diving',
        '💑 Honeymoon', '📅 Best time to visit', '📞 Contact us'
    ];

    // ── Helpers ────────────────────────────────────────────────
    function fmt(t) {
        return String(t)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function addBot(text) {
        const el = document.createElement('div');
        el.className = 'cp-bubble bot';
        el.innerHTML = fmt(text);
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function addUser(text) {
        const el = document.createElement('div');
        el.className = 'cp-bubble user';
        el.textContent = text;
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function showTyping() {
        const el = document.createElement('div');
        el.className = 'cp-bubble typing';
        el.id = 'cpTyping';
        el.innerHTML = `<div class="cp-typing-dots"><span></span><span></span><span></span></div>`;
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function removeTyping() {
        document.getElementById('cpTyping')?.remove();
    }

    function renderQuick() {
        quick.innerHTML = '';
        QUICK_Q.forEach(q => {
            const b = document.createElement('button');
            b.className = 'cp-quick-btn';
            b.textContent = q;
            b.onclick = () => { quick.innerHTML = ''; send(q.replace(/^[^\w₹]*/,'').trim()); };
            quick.appendChild(b);
        });
    }

    function openChat() {
        isOpen = true;
        panel.classList.add('open');
        btnIcon.className = 'fas fa-times';
        dot.style.display = 'none';
        if (!opened) {
            opened = true;
            addBot('👋 Hi! I\'m your **Andaman AI Guide** from Bharat Tours & Travels.\n\nAsk me anything about our packages, beaches, activities or pricing! 🌊');
            renderQuick();
        }
        setTimeout(() => input.focus(), 250);
    }

    function closeChat() {
        isOpen = false;
        panel.classList.remove('open');
        btnIcon.className = 'fas fa-comments';
    }

    // ── Send ───────────────────────────────────────────────────
    async function send(text) {
        text = (text || '').trim();
        if (!text || isBusy) return;
        isBusy = true;
        sendBtn.disabled = true;
        quick.innerHTML = '';
        addUser(text);
        input.value = '';
        showTyping();
        history.push({ role: 'user', text });

        try {
            const res = await fetch('/.netlify/functions/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: history.slice(-10) })
            });
            if (!res.ok) throw new Error('status ' + res.status);
            const data = await res.json();
            removeTyping();
            const reply = (data && data.reply) ? data.reply : clientFallback(text);
            addBot(reply);
            history.push({ role: 'bot', text: reply });
        } catch {
            removeTyping();
            // Use client-side fallback when function unavailable
            const reply = clientFallback(text);
            addBot(reply);
            history.push({ role: 'bot', text: reply });
        }

        isBusy = false;
        sendBtn.disabled = false;
        input.focus();
    }

    // ── Events ─────────────────────────────────────────────────
    btn.addEventListener('click', () => isOpen ? closeChat() : openChat());
    closeEl.addEventListener('click', closeChat);
    sendBtn.addEventListener('click', () => send(input.value));
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });

    // Notification dot after 4 seconds
    setTimeout(() => { if (!opened) dot.style.display = 'block'; }, 4000);
})();