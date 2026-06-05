/* dashboard-chats.js — Admin Live Chats panel.
 * Subscribes to /chats and /chats/{id}/messages, lets the admin read & reply.
 * js/live-chat.js (public site) is the writer side.
 * Drop-in: needs <a data-section="chats">, <section id="section-chats">
 * containing <div id="lcAdminRoot"></div>, plus window.__firebaseReady.
 */
(function(){
'use strict';
var fb=null,sessions=[],activeId=null,activeSession=null,activeMsgs=[];
var unsubS=null,unsubM=null,sending=false,lastRendered=null;
function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.from((r||document).querySelectorAll(s));}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function tm(t){try{if(!t)return'';var d=t.toDate?t.toDate():(t instanceof Date?t:new Date(t));if(!d||isNaN(d))return'';var n=new Date();if(d.toDateString()===n.toDateString())return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(n-d<6048e5)return d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toLocaleDateString([],{day:'2-digit',month:'short'});}catch(_){return'';}}
function sid(i){var s=String(i||'');return s.length>10?s.slice(0,6)+'…'+s.slice(-3):s;}
function adminName(){try{var r=localStorage.getItem('currentUser');if(r){var u=JSON.parse(r);return u.fullName||u.username||u.email||'Andaman Voyages Team';}}catch(_){}return 'Andaman Voyages Team';}

function buildShell(){
  var root=$('#lcAdminRoot');if(!root||root.dataset.b==='1')return;root.dataset.b='1';
  root.innerHTML='<div class="lca-split"><aside class="lca-sidebar table-card"><div class="lca-sidebar-head"><h3><i class="fas fa-comments"></i> Sessions</h3><span class="lca-count" id="lcaCount">0</span></div><div class="lca-sidebar-tools"><input type="text" id="lcaSearch" class="lca-search" placeholder="Search sessions..."><label class="lca-filter-unread"><input type="checkbox" id="lcaUnreadOnly"> Unread only</label></div><div class="lca-sessions" id="lcaSessions"><p class="lca-empty">Connecting…</p></div></aside><section class="lca-main" id="lcaMain"><div class="lca-empty-state"><i class="fas fa-hand-pointer"></i><p>Select a chat session on the left to view and reply.</p></div></section></div>';
  var s=$('#lcaSearch'),u=$('#lcaUnreadOnly');
  if(s)s.addEventListener('input',renderList);
  if(u)u.addEventListener('change',renderList);
}

function renderList(){
  var le=$('#lcaSessions'),ce=$('#lcaCount');if(!le)return;
  var q=(($('#lcaSearch')||{}).value||'').toLowerCase().trim();
  var uo=!!(($('#lcaUnreadOnly')||{}).checked);
  var items=sessions.slice();
  if(uo)items=items.filter(function(s){return !!s.unreadByAdmin;});
  if(q)items=items.filter(function(s){return [s.id,s.customerName,s.customerEmail,s.lastMessage,s.page].map(function(v){return String(v||'').toLowerCase();}).some(function(v){return v.indexOf(q)>=0;});});
  if(ce)ce.textContent=String(items.length);
  if(!items.length){le.innerHTML='<p class="lca-empty">'+(sessions.length?'No sessions match your filters.':'No live chats yet.<br><small>When a visitor opens the LIVE bubble, the conversation will appear here.</small>')+'</p>';return;}
  le.innerHTML=items.map(function(s){
    var name=esc(s.customerName||s.customerEmail||('Visitor '+sid(s.id)));
    var prev=esc(String(s.lastMessage||'').slice(0,100));
    var time=esc(tm(s.lastMessageAt));
    var ucls=s.unreadByAdmin?' is-unread':'';
    var acls=(s.id===activeId)?' is-active':'';
    var byMe=s.lastMessageBy==='admin'||s.lastMessageBy==='agent';
    var ic=byMe?'<i class="fas fa-reply lca-by-me"></i> ':'';
    return '<button type="button" class="lca-session'+ucls+acls+'" data-id="'+esc(s.id)+'"><div class="lca-session-row1"><span class="lca-session-name">'+name+'</span><span class="lca-session-time">'+time+'</span></div><div class="lca-session-row2"><span class="lca-session-preview">'+ic+(prev||'<em>(no message yet)</em>')+'</span>'+(s.unreadByAdmin?'<span class="lca-session-dot"></span>':'')+'</div><div class="lca-session-meta"><span class="lca-session-id"><i class="fas fa-fingerprint"></i> '+esc(sid(s.id))+'</span>'+(s.page?'<span class="lca-session-page">'+esc(String(s.page).slice(0,42))+'</span>':'')+'</div></button>';
  }).join('');
  $$('.lca-session',le).forEach(function(el){el.addEventListener('click',function(){openSession(el.getAttribute('data-id'));});});
}

function renderConv(){
  var main=$('#lcaMain');if(!main)return;
  var s=activeSession;
  if(!s){main.innerHTML='<div class="lca-empty-state"><i class="fas fa-hand-pointer"></i><p>Select a chat session on the left to view and reply.</p></div>';return;}
  var rebuild=(lastRendered!==activeId);
  lastRendered=activeId;
  var name=esc(s.customerName||s.customerEmail||('Visitor '+sid(s.id)));
  var sub=[];
  if(s.customerEmail)sub.push('<i class="fas fa-envelope"></i> '+esc(s.customerEmail));
  if(s.page)sub.push('<i class="fas fa-link"></i> '+esc(s.page));
  if(s.userAgent){sub.push('<i class="fas fa-display"></i> '+(/Mobile|Android|iPhone|iPad/i.test(String(s.userAgent))?'Mobile':'Desktop'));}
  var bubbles=(activeMsgs||[]).map(function(m){
    var t=esc(m.text||''),role=String(m.role||'').toLowerCase(),when=esc(tm(m.createdAt));
    var body=t.replace(/\n/g,'<br>');
    if(role==='user')return '<div class="lca-bubble them"><div class="lca-bub-text">'+body+'</div><div class="lca-bub-meta">'+when+'</div></div>';
    if(role==='admin'||role==='agent')return '<div class="lca-bubble me"><div class="lca-bub-text">'+body+'</div><div class="lca-bub-meta">'+esc(m.senderName||'You')+' · '+when+'</div></div>';
    if(role==='whatsapp')return '<div class="lca-bubble me wa"><div class="lca-bub-text">'+body+'</div><div class="lca-bub-meta"><i class="fab fa-whatsapp"></i> WhatsApp · '+when+'</div></div>';
    if(role==='bot')return '<div class="lca-bubble bot"><div class="lca-bub-text">'+body+'</div><div class="lca-bub-meta">Bot · '+when+'</div></div>';
    return '<div class="lca-bubble system"><div class="lca-bub-text">'+t+'</div></div>';
  }).join('')||'<p class="lca-empty">No messages yet.</p>';
  if(rebuild){
    main.innerHTML='<header class="lca-conv-head"><div class="lca-conv-info"><div class="lca-conv-name">'+name+'</div><div class="lca-conv-sub">'+(sub.join(' · ')||('Session '+esc(sid(s.id))))+'</div></div><div class="lca-conv-actions">'+(s.unreadByAdmin?'<button type="button" class="lca-btn lca-btn-ghost" id="lcaMarkRead"><i class="fas fa-check-double"></i> Mark read</button>':'')+'</div></header><div class="lca-msgs" id="lcaMsgs">'+bubbles+'</div><div class="lca-compose"><textarea id="lcaInput" placeholder="Type your reply… (Enter to send, Shift+Enter for newline)" maxlength="4000"></textarea><button type="button" id="lcaSend" class="lca-btn lca-btn-primary"><i class="fas fa-paper-plane"></i> Send</button></div>';
    var sendBtn=$('#lcaSend'),inp=$('#lcaInput'),mr=$('#lcaMarkRead');
    if(sendBtn)sendBtn.addEventListener('click',sendReply);
    if(inp)inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply();}});
    if(mr)mr.addEventListener('click',markRead);
    setTimeout(function(){if(inp)try{inp.focus();}catch(_){}},80);
  }else{
    var msgs=$('#lcaMsgs');if(msgs)msgs.innerHTML=bubbles;
  }
  var ms=$('#lcaMsgs');if(ms)ms.scrollTop=ms.scrollHeight;
}

function openSession(id){
  if(!id||!fb)return;
  if(unsubM){try{unsubM();}catch(_){}unsubM=null;}
  activeId=id;
  activeSession=sessions.filter(function(x){return x.id===id;})[0]||{id:id};
  activeMsgs=[];
  lastRendered=null;
  renderList();
  renderConv();
  try{
    var col=fb.firestore.collection(fb.db,'chats',id,'messages');
    var qy=fb.firestore.query(col,fb.firestore.orderBy('createdAt','asc'));
    unsubM=fb.firestore.onSnapshot(qy,function(snap){
      var arr=[];snap.forEach(function(d){var x=d.data()||{};x._id=d.id;arr.push(x);});
      activeMsgs=arr;renderConv();autoMarkRead();
    },function(err){console.warn('[dashboard-chats] msgs:',err);});
  }catch(err){console.warn('[dashboard-chats] subscribe failed:',err);}
}

function autoMarkRead(){
  if(!fb||!activeId||!activeSession||!activeSession.unreadByAdmin)return;
  setTimeout(function(){markRead();},800);
}

function markRead(){
  if(!fb||!activeId)return;
  try{
    var ref=fb.firestore.doc(fb.db,'chats',activeId);
    fb.firestore.setDoc(ref,{unreadByAdmin:false,readAt:fb.firestore.serverTimestamp(),readBy:adminName()},{merge:true}).catch(function(err){console.warn('[dashboard-chats] mark read failed:',err);});
  }catch(err){console.warn('[dashboard-chats] mark read failed:',err);}
}

function sendReply(){
  if(sending||!fb||!activeId)return;
  var inp=$('#lcaInput'),btn=$('#lcaSend');
  if(!inp)return;
  var text=String(inp.value||'').trim();
  if(!text)return;
  sending=true;
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Sending\u2026';}
  var who=adminName();
  var col=fb.firestore.collection(fb.db,'chats',activeId,'messages');
  var parent=fb.firestore.doc(fb.db,'chats',activeId);
  Promise.all([
    fb.firestore.addDoc(col,{role:'admin',text:text,senderName:who,createdAt:fb.firestore.serverTimestamp()}),
    fb.firestore.setDoc(parent,{lastMessage:text.slice(0,280),lastMessageAt:fb.firestore.serverTimestamp(),lastMessageBy:'admin',unreadByAdmin:false,readAt:fb.firestore.serverTimestamp(),readBy:who},{merge:true})
  ]).then(function(){
    inp.value='';
    if(window.Toast&&window.Toast.success)window.Toast.success('Reply sent');
  }).catch(function(err){
    console.error('[dashboard-chats] send failed:',err);
    if(window.Toast&&window.Toast.error)window.Toast.error('Send failed: '+(err&&err.message||'unknown'));
    else alert('Send failed: '+(err&&err.message||err));
  }).finally(function(){
    sending=false;
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-paper-plane"></i> Send';}
    try{inp.focus();}catch(_){}
  });
}

function subscribeSessions(){
  if(!fb||unsubS)return;
  try{
    var col=fb.firestore.collection(fb.db,'chats');
    var qy=fb.firestore.query(col,fb.firestore.orderBy('lastMessageAt','desc'),fb.firestore.limit(200));
    unsubS=fb.firestore.onSnapshot(qy,function(snap){
      var arr=[];snap.forEach(function(d){var x=d.data()||{};x.id=d.id;arr.push(x);});
      sessions=arr;
      if(activeId){
        var found=sessions.filter(function(x){return x.id===activeId;})[0];
        if(found)activeSession=found;
      }
      renderList();
      if(activeId&&activeSession)renderConv();
      updateBadge();
    },function(err){
      console.warn('[dashboard-chats] sessions snapshot:',err);
      var le=document.querySelector('#lcaSessions');
      if(le)le.innerHTML='<p class="lca-empty">Could not load chats.<br><small>'+String(err&&err.message||err)+'</small></p>';
    });
  }catch(err){console.warn('[dashboard-chats] subscribe failed:',err);}
}

function updateBadge(){
  var n=0;for(var i=0;i<sessions.length;i++)if(sessions[i].unreadByAdmin)n++;
  var link=document.querySelector('.sidebar-link[data-section="chats"]');
  if(!link)return;
  var ex=link.querySelector('.lca-nav-badge');
  if(n>0){
    if(!ex){ex=document.createElement('span');ex.className='lca-nav-badge';link.appendChild(ex);}
    ex.textContent=String(n);
  }else if(ex){ex.remove();}
}

function injectStyles(){
  if(document.getElementById('lca-styles'))return;
  var css=document.createElement('style');
  css.id='lca-styles';
  css.textContent=[
    '.lca-split{display:flex;gap:.75rem;height:calc(100vh - 240px);min-height:520px;}',
    '.lca-sidebar{flex:0 0 340px;display:flex;flex-direction:column;padding:0;overflow:hidden;margin:0;}',
    '.lca-sidebar-head{display:flex;align-items:center;justify-content:space-between;padding:.85rem 1rem;border-bottom:1px solid #e3e8ef;background:linear-gradient(135deg,#fff5f1 0%,#fff 100%);}',
    '.lca-sidebar-head h3{margin:0;font-size:.96rem;color:#1c2b48;display:inline-flex;align-items:center;gap:.4rem;}',
    '.lca-sidebar-head h3 i{color:#e74c3c;}',
    '.lca-count{background:#e74c3c;color:#fff;font-size:.7rem;font-weight:800;padding:.18rem .55rem;border-radius:999px;letter-spacing:.04em;}',
    '.lca-sidebar-tools{display:flex;flex-direction:column;gap:.4rem;padding:.6rem .8rem;border-bottom:1px solid #f0f3f6;}',
    '.lca-search{width:100%;padding:.5rem .75rem;border:1px solid #e0e6ec;border-radius:8px;font-family:inherit;font-size:.86rem;outline:none;}',
    '.lca-search:focus{border-color:#e74c3c;box-shadow:0 0 0 3px rgba(231,76,60,.12);}',
    '.lca-filter-unread{font-size:.78rem;color:#5a6877;display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;}',
    '.lca-sessions{flex:1 1 0;overflow-y:auto;padding:.4rem .25rem;}',
    '.lca-empty{padding:1.2rem 1rem;text-align:center;color:#7a8b96;font-size:.86rem;line-height:1.55;}',
    '.lca-empty small{color:#9aa7b1;font-size:.78rem;display:inline-block;margin-top:.4rem;}',
    '.lca-session{width:calc(100% - .5rem);margin:.2rem .25rem;text-align:left;background:#fff;border:1px solid transparent;border-radius:9px;padding:.65rem .85rem;cursor:pointer;font-family:inherit;display:block;color:#1c2b48;transition:background .12s,border-color .12s;}',
    '.lca-session:hover{background:#fafbfc;border-color:#e3e8ef;}',
    '.lca-session.is-active{background:#fff5f1;border-color:#e74c3c;}',
    '.lca-session.is-unread .lca-session-name{font-weight:800;color:#0d1d33;}',
    '.lca-session-row1{display:flex;align-items:center;justify-content:space-between;gap:.45rem;}',
    '.lca-session-name{font-size:.92rem;font-weight:600;color:#1c2b48;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.lca-session-time{font-size:.72rem;color:#9aa7b1;flex-shrink:0;}',
    '.lca-session-row2{display:flex;align-items:center;gap:.45rem;margin-top:.18rem;}',
    '.lca-session-preview{flex:1 1 auto;font-size:.82rem;color:#5a6877;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.lca-by-me{color:#0d7a8a;font-size:.7rem;}',
    '.lca-session-dot{width:8px;height:8px;border-radius:50%;background:#e74c3c;flex-shrink:0;box-shadow:0 0 0 3px rgba(231,76,60,.18);}',
    '.lca-session-meta{display:flex;gap:.6rem;margin-top:.28rem;font-size:.7rem;color:#9aa7b1;}',
    '.lca-session-id i{margin-right:.2rem;}',
    '.lca-session-page{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;}',
    '.lca-main{flex:1 1 0;min-width:0;background:#fff;border:1px solid #e3e8ef;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 2px 8px rgba(10,31,68,.05);}',
    '.lca-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1 1 0;gap:.6rem;color:#9aa7b1;}',
    '.lca-empty-state i{font-size:2.4rem;color:#cfd9df;}',
    '.lca-empty-state p{margin:0;font-size:.96rem;}',
    '.lca-conv-head{display:flex;align-items:center;gap:.85rem;padding:.85rem 1.1rem;border-bottom:1px solid #e3e8ef;background:linear-gradient(135deg,#fff5f1 0%,#fff 100%);flex-shrink:0;}',
    '.lca-conv-info{flex:1 1 auto;min-width:0;}',
    '.lca-conv-name{font-weight:800;color:#1c2b48;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.lca-conv-sub{font-size:.78rem;color:#7a8b96;margin-top:.2rem;display:flex;flex-wrap:wrap;gap:.45rem;}',
    '.lca-conv-actions{flex-shrink:0;}',
    '.lca-msgs{flex:1 1 0;height:0;overflow-y:auto;padding:1.05rem 1.1rem;background:#fbfcfd;display:flex;flex-direction:column;gap:.6rem;}',
    '.lca-bubble{max-width:78%;padding:.55rem .85rem;border-radius:12px;font-size:.92rem;line-height:1.5;word-break:break-word;box-shadow:0 1px 3px rgba(10,31,68,.06);}',
    '.lca-bubble.them{background:#fff;color:#1c2b48;border-radius:4px 14px 14px 14px;align-self:flex-start;border:1px solid #eef1f4;}',
    '.lca-bubble.me{background:linear-gradient(135deg,#e74c3c,#ff6b35);color:#fff;border-radius:14px 14px 4px 14px;align-self:flex-end;}',
    '.lca-bubble.me.wa{background:linear-gradient(135deg,#25d366,#128c7e);}',
    '.lca-bubble.bot{background:#f3f8fa;color:#0d2c3a;border:1px solid #d6e6ea;align-self:flex-start;border-radius:4px 14px 14px 14px;}',
    '.lca-bubble.system{background:rgba(0,0,0,.04);color:#5a6877;font-size:.78rem;align-self:center;border-radius:999px;padding:.32rem .85rem;box-shadow:none;}',
    '.lca-bub-text{white-space:pre-wrap;word-break:break-word;}',
    '.lca-bub-meta{font-size:.68rem;opacity:.85;margin-top:.2rem;text-align:right;}',
    '.lca-bubble.them .lca-bub-meta{color:#9aa7b1;text-align:left;}',
    '.lca-compose{display:flex;gap:.55rem;padding:.7rem .85rem;border-top:1px solid #e3e8ef;background:#fff;flex-shrink:0;align-items:flex-end;}',
    '.lca-compose textarea{flex:1 1 auto;min-height:42px;max-height:160px;border:1px solid #e0e6ec;border-radius:10px;padding:.55rem .75rem;font:inherit;font-size:.92rem;resize:vertical;outline:none;background:#fafbfc;}',
    '.lca-compose textarea:focus{border-color:#e74c3c;background:#fff;box-shadow:0 0 0 3px rgba(231,76,60,.12);}',
    '.lca-btn{padding:.5rem .95rem;border-radius:8px;font-family:inherit;font-size:.86rem;font-weight:700;cursor:pointer;border:0;display:inline-flex;align-items:center;gap:.35rem;transition:filter .12s,transform .12s;}',
    '.lca-btn-primary{background:linear-gradient(135deg,#e74c3c,#ff6b35);color:#fff;box-shadow:0 2px 6px rgba(231,76,60,.28);}',
    '.lca-btn-primary:hover:not(:disabled){filter:brightness(1.05);}',
    '.lca-btn-primary:disabled{opacity:.65;cursor:not-allowed;}',
    '.lca-btn-ghost{background:#fff;border:1px solid #e3e8ef;color:#5a6877;}',
    '.lca-btn-ghost:hover{background:#f6f9fa;}',
    '.lca-nav-badge{display:inline-block;margin-left:.4rem;min-width:18px;height:18px;line-height:18px;padding:0 5px;font-size:.66rem;font-weight:800;letter-spacing:.04em;color:#fff;background:#e74c3c;border-radius:999px;text-align:center;}',
    '@media (max-width:880px){.lca-split{flex-direction:column;height:auto;}.lca-sidebar{flex:0 0 auto;max-height:50vh;}}'
  ].join('\n');
  document.head.appendChild(css);
}

function init(){
  // Staff users have no business in the Live Chats panel — and the
  // Firestore security rules deny them /chats reads anyway, so wiring
  // up the onSnapshot listener would just spam the console with
  // "Missing or insufficient permissions". Hard-bail BEFORE we touch
  // the DOM or Firestore. The CSS in dashboard.html already hides the
  // sidebar link + the section, this is defence in depth.
  if(window.__dashRole==='staff'){return;}
  injectStyles();
  buildShell();
  if(window.__firebaseReady){
    window.__firebaseReady.then(function(_fb){fb=_fb;subscribeSessions();}).catch(function(err){console.warn('[dashboard-chats] firebase init failed:',err);});
  }
  // Show panel-on-link-click is already handled by dashboard.js sidebar router.
  // Cleanup on page unload
  window.addEventListener('beforeunload',function(){if(unsubS){try{unsubS();}catch(_){}}if(unsubM){try{unsubM();}catch(_){}}});
  // Expose minimal API for debugging
  window.DashboardChats={openSession:openSession,sendReply:sendReply};
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();
