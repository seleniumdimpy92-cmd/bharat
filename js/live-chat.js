/* LIVE Chat widget — orange-red bubble, Firestore-backed, anchored
 * bottom-right. Inline-SVG icons (FA-independent). Photo upload via
 * Cloudinary unsigned preset. Online/offline indicator (IST hours).
 */
(function(){
'use strict';

function getProvider(){try{var r=localStorage.getItem('siteSettings');if(!r)return'custom';return((JSON.parse(r)||{}).chatProvider||'custom').toLowerCase();}catch(_){return'custom';}}
if(getProvider()!=='custom')return;
var path=(location.pathname||'').toLowerCase();
if(path.indexOf('/dashboard')===0||path.indexOf('/migrate')===0)return;

var SESSION_KEY='liveChatSessionId';
var sessionId=(function(){try{var s=localStorage.getItem(SESSION_KEY);if(s&&s.length>8)return s;}catch(_){}var n=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);try{localStorage.setItem(SESSION_KEY,n);}catch(_){}return n;})();

var CLOUDINARY={cloud:'dnvsxgnmu',preset:'andaman_unsigned',folder:'live-chat'};

var ICN={
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
  clip:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  head:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h2v-8H5v-2a7 7 0 0 1 14 0v2h-3v8h2a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/></svg>',
  chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
};

var CSS=[
'.lc-btn{position:fixed;bottom:24px;right:24px;z-index:99999;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#e74c3c 0%,#ff6b35 100%);border:0;cursor:grab;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;box-shadow:0 6px 22px rgba(231,76,60,.5);transition:transform .2s;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}',
'.lc-btn:hover{transform:scale(1.08);box-shadow:0 8px 30px rgba(231,76,60,.65)}',
'.lc-btn svg{width:22px;height:22px;color:#fff;pointer-events:none}',
'.lc-btn .lc-label{color:#fff;font-size:.55rem;font-weight:800;letter-spacing:.12em;line-height:1;pointer-events:none;margin-top:1px}',
'.lc-btn::before{content:"";position:absolute;inset:-4px;border-radius:50%;background:rgba(231,76,60,.32);animation:lc-ping 1.8s infinite;z-index:-1}',
'@keyframes lc-ping{0%{transform:scale(1);opacity:.65}100%{transform:scale(1.45);opacity:0}}',
'.lc-dot-new{position:absolute;top:-4px;left:-4px;min-width:20px;height:20px;padding:0 6px;background:#2ecc71;border:2px solid #fff;border-radius:999px;display:none;color:#fff;font-size:.7rem;font-weight:800;line-height:16px;text-align:center;box-sizing:border-box;box-shadow:0 2px 5px rgba(0,0,0,.18)}',
'body.lc-active .chat-widget-btn,body.lc-active .ck-whatsapp-fab,body.lc-active .chat-panel-wrap.open,body.lc-active .lc-btn{display:none !important}',
'.lc-panel{position:fixed;bottom:24px;right:24px;z-index:99998;width:368px;max-width:calc(100vw - 32px);height:min(560px,calc(100vh - 60px));background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22),0 4px 14px rgba(0,0,0,.08);display:flex;flex-direction:column;overflow:hidden;transform-origin:bottom right;transform:scale(.92) translateY(12px);opacity:0;pointer-events:none;transition:transform .26s cubic-bezier(.34,1.5,.64,1),opacity .2s ease}',
'.lc-panel.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all}',
'.lc-head{background:linear-gradient(135deg,#e74c3c 0%,#ff6b35 100%);padding:.8rem 1rem;color:#fff;display:flex;align-items:center;gap:.65rem;flex-shrink:0}',
'.lc-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff}',
'.lc-avatar svg{width:18px;height:18px}',
'.lc-info{flex:1;min-width:0}',
'.lc-title{font-weight:700;font-size:.94rem;display:flex;align-items:center;gap:.4rem;line-height:1.1}',
'.lc-pill{background:#fff;color:#e74c3c;padding:1px 7px;border-radius:999px;font-size:.6rem;font-weight:800;letter-spacing:.12em}',
'.lc-status{font-size:.72rem;opacity:.92;margin-top:3px;display:flex;align-items:center;gap:.3rem}',
'.lc-dot{display:inline-block;width:7px;height:7px;background:#2ecc71;border-radius:50%;box-shadow:0 0 0 0 rgba(46,204,113,.7);animation:lc-pulse 1.6s infinite}',
'.lc-status.offline .lc-dot{background:#bdc3c7;animation:none;box-shadow:none}',
'@keyframes lc-pulse{0%{box-shadow:0 0 0 0 rgba(46,204,113,.7)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}',
'.lc-close{background:rgba(255,255,255,.2);border:0;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}',
'.lc-close:hover{background:rgba(255,255,255,.36)}',
'.lc-close svg{width:14px;height:14px}',
'.lc-msgs{flex:1 1 0;height:0;overflow-y:auto;padding:1rem .9rem;display:flex;flex-direction:column;gap:.55rem;background:#fff8f5;scroll-behavior:smooth}',
'.lc-msgs::-webkit-scrollbar{width:5px}',
'.lc-msgs::-webkit-scrollbar-thumb{background:#e3c5b9;border-radius:10px}',
'.lc-bubble{max-width:82%;padding:.55rem .85rem;border-radius:14px;font-size:.88rem;line-height:1.5;word-break:break-word;position:relative}',
'.lc-bubble.them{background:#fff;color:#2c3e50;border-radius:4px 14px 14px 14px;box-shadow:0 1px 3px rgba(0,0,0,.06);align-self:flex-start;border:1px solid #f3e3dc}',
'.lc-bubble.them .lc-sender{font-size:.66rem;font-weight:700;color:#e74c3c;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em}',
'.lc-bubble.me{background:linear-gradient(135deg,#e74c3c,#ff6b35);color:#fff;border-radius:14px 14px 4px 14px;align-self:flex-end;box-shadow:0 2px 6px rgba(231,76,60,.28)}',
'.lc-bubble.system{background:rgba(0,0,0,.04);color:#5a6877;font-size:.74rem;align-self:center;border-radius:999px;padding:.3rem .8rem;font-style:italic}',
'.lc-bubble img{max-width:100%;border-radius:8px;display:block;margin-top:.25rem;cursor:pointer}',
'.lc-bubble .lc-time{font-size:.62rem;opacity:.7;margin-top:3px;text-align:right}',
'.lc-bubble.them .lc-time{text-align:left;color:#9aa7b1}',
'.lc-input-bar{display:flex;gap:.45rem;padding:.6rem .7rem;background:#fff;border-top:1px solid #f3dcd3;flex-shrink:0;align-items:center}',
'.lc-attach{width:38px;height:38px;border:0;border-radius:50%;background:#fff;color:#e74c3c;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}',
'.lc-attach:hover{background:#fff0e8}',
'.lc-attach svg{width:18px;height:18px}',
'.lc-input{flex:1 1 auto;min-width:0;border:1.5px solid #f0d4c8;border-radius:22px;padding:.5rem .9rem;font:inherit;font-size:.9rem;outline:none;background:#fffaf7}',
'.lc-input:focus{border-color:#e74c3c;background:#fff}',
'.lc-send{width:38px;height:38px;min-width:38px;border:0;border-radius:50%;background:linear-gradient(135deg,#e74c3c,#ff6b35);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(231,76,60,.32);transition:transform .15s}',
'.lc-send svg{width:16px;height:16px}',
'.lc-send:hover:not(:disabled){transform:scale(1.08)}',
'.lc-send:disabled{opacity:.55;cursor:not-allowed}',
'.lc-hint{font-size:.66rem;color:#9aa7b1;text-align:center;padding:0 0 .35rem;background:#fff;border-top:1px solid #fff5f1;flex-shrink:0}',
'.lc-hint kbd{background:#fff5f1;border:1px solid #f0d4c8;border-radius:3px;padding:1px 5px;font-size:.62rem;color:#7a8b96;font-family:inherit}',
'.lc-up-progress{height:3px;background:#fff5f1;flex-shrink:0;display:none}',
'.lc-up-progress.show{display:block}',
'.lc-up-bar{height:100%;background:linear-gradient(90deg,#e74c3c,#ff6b35);width:0;transition:width .2s}',
'@media (max-width:520px){.lc-panel{width:calc(100vw - 16px);right:8px;left:8px;bottom:18px;height:min(78vh,calc(100vh - 40px));max-width:none}.lc-btn{bottom:18px;right:16px}}'
].join('');

var styleEl=document.createElement('style');
styleEl.textContent=CSS;
document.head.appendChild(styleEl);

/* Floating button */
var btn=document.createElement('button');
btn.className='lc-btn';
btn.id='lcBtn';
btn.title='Live chat with our team';
btn.innerHTML=ICN.chat+'<span class="lc-label">LIVE</span><span class="lc-dot-new" id="lcDotNew"></span>';
document.body.appendChild(btn);

/* Draggable floating button — uses Pointer Events for unified
 * mouse/touch/pen support. Position persists in localStorage. */
(function(){
  var KEY='lcBtnPos';
  var dragging=false,didDrag=false,startX=0,startY=0,startL=0,startT=0,pid=null;
  function applyPos(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw)return;
      var p=JSON.parse(raw);
      if(p&&typeof p.left==='number'&&typeof p.top==='number'){
        var maxL=Math.max(8,window.innerWidth-66);
        var maxT=Math.max(8,window.innerHeight-66);
        btn.style.left=Math.min(Math.max(8,p.left),maxL)+'px';
        btn.style.top=Math.min(Math.max(8,p.top),maxT)+'px';
        btn.style.right='auto';btn.style.bottom='auto';
      }
    }catch(_){}
  }
  applyPos();
  window.addEventListener('resize',applyPos);

  btn.addEventListener('pointerdown',function(e){
    if(e.button!==undefined&&e.button!==0)return;
    dragging=true;didDrag=false;pid=e.pointerId;
    startX=e.clientX;startY=e.clientY;
    var r=btn.getBoundingClientRect();
    startL=r.left;startT=r.top;
    btn.style.left=startL+'px';btn.style.top=startT+'px';
    btn.style.right='auto';btn.style.bottom='auto';
    btn.style.transition='none';btn.style.cursor='grabbing';
    try{btn.setPointerCapture(e.pointerId);}catch(_){}
  });

  btn.addEventListener('pointermove',function(e){
    if(!dragging||e.pointerId!==pid)return;
    var dx=e.clientX-startX,dy=e.clientY-startY;
    if(!didDrag&&(Math.abs(dx)>4||Math.abs(dy)>4))didDrag=true;
    if(!didDrag)return;
    var maxL=Math.max(8,window.innerWidth-66);
    var maxT=Math.max(8,window.innerHeight-66);
    btn.style.left=Math.min(Math.max(8,startL+dx),maxL)+'px';
    btn.style.top=Math.min(Math.max(8,startT+dy),maxT)+'px';
  });

  function endDrag(e){
    if(!dragging)return;
    if(e&&e.pointerId!==pid)return;
    dragging=false;
    btn.style.transition='';btn.style.cursor='';
    try{btn.releasePointerCapture(pid);}catch(_){}
    pid=null;
    if(didDrag){
      try{
        localStorage.setItem(KEY,JSON.stringify({
          left:parseInt(btn.style.left,10),
          top:parseInt(btn.style.top,10)
        }));
      }catch(_){}
      // Suppress the click that follows the drag (capture-phase, one-shot)
      var sup=function(ev){ev.stopPropagation();ev.preventDefault();window.removeEventListener('click',sup,true);};
      window.addEventListener('click',sup,true);
      setTimeout(function(){window.removeEventListener('click',sup,true);},80);
    }
  }
  btn.addEventListener('pointerup',endDrag);
  btn.addEventListener('pointercancel',endDrag);
  btn.addEventListener('lostpointercapture',endDrag);
  btn.addEventListener('dragstart',function(e){e.preventDefault();});
})();


/* Online check — Mon-Sat 9 AM - 9 PM IST */
function isOnlineNow(){
  var n=new Date();
  // Convert UTC -> IST (UTC+5:30)
  var ist=new Date(n.getTime()+(5.5*3600*1000-n.getTimezoneOffset()*60000));
  var day=ist.getUTCDay();// 0=Sun
  var hr=ist.getUTCHours();
  if(day===0)return false;// Sun off
  return hr>=9 && hr<21;
}
var online=isOnlineNow();
var statusText=online?'Online · ~10 min reply':'Offline · we will reply tomorrow';
var statusCls=online?'':' offline';

/* Panel */
var panel=document.createElement('div');
panel.className='lc-panel';
panel.id='lcPanel';
panel.innerHTML=
  '<div class="lc-head">'+
    '<div class="lc-avatar">'+ICN.head+'</div>'+
    '<div class="lc-info">'+
      '<div class="lc-title">Live chat <span class="lc-pill">LIVE</span></div>'+
      '<div class="lc-status'+statusCls+'"><span class="lc-dot"></span>'+statusText+'</div>'+
    '</div>'+
    '<button class="lc-close" id="lcClose" aria-label="Close">'+ICN.close+'</button>'+
  '</div>'+
  '<div class="lc-msgs" id="lcMsgs"></div>'+
  '<div class="lc-up-progress" id="lcUpWrap"><div class="lc-up-bar" id="lcUpBar"></div></div>'+
  '<div class="lc-input-bar">'+
    '<button class="lc-attach" id="lcAttach" title="Attach a photo">'+ICN.clip+
      '<input type="file" id="lcFile" accept="image/*" style="display:none">'+
    '</button>'+
    '<input class="lc-input" id="lcInput" type="text" placeholder="Type your message..." maxlength="500" autocomplete="off">'+
    '<button class="lc-send" id="lcSend" title="Send (Enter)">'+ICN.send+'</button>'+
  '</div>'+
  '<div class="lc-hint">Press <kbd>Enter</kbd> to send · <kbd>Esc</kbd> to close</div>';
document.body.appendChild(panel);

var msgsEl=document.getElementById('lcMsgs');
var input=document.getElementById('lcInput');
var sendBtn=document.getElementById('lcSend');
var newDot=document.getElementById('lcDotNew');
var attachBtn=document.getElementById('lcAttach');
var fileInput=document.getElementById('lcFile');
var upWrap=document.getElementById('lcUpWrap');
var upBar=document.getElementById('lcUpBar');

var isOpen=false,isBusy=false,opened=false,unreadCount=0;

function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmtTime(){var d=new Date();return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}

function addBubble(role,text,senderName,imageUrl){
  var d=document.createElement('div');
  if(role==='me'){
    d.className='lc-bubble me';
    d.innerHTML=(text?escHtml(text).replace(/\n/g,'<br>'):'')+(imageUrl?'<img src="'+escHtml(imageUrl)+'" alt="" loading="lazy">':'')+'<div class="lc-time">'+fmtTime()+'</div>';
  }else if(role==='system'){
    d.className='lc-bubble system';
    d.textContent=text;
  }else{
    d.className='lc-bubble them';
    var html='';
    if(senderName)html+='<div class="lc-sender">'+escHtml(senderName)+'</div>';
    if(text)html+=escHtml(text).replace(/\n/g,'<br>');
    if(imageUrl)html+='<img src="'+escHtml(imageUrl)+'" alt="" loading="lazy">';
    html+='<div class="lc-time">'+fmtTime()+'</div>';
    d.innerHTML=html;
  }
  msgsEl.appendChild(d);
  msgsEl.scrollTop=msgsEl.scrollHeight;
}

/* Firestore wiring */
var fbState={ready:false,fb:null,unsubMsgs:null,msgIds:new Set(),seeded:false};
async function ensureFb(){
  if(fbState.ready)return fbState.fb;
  if(!window.__firebaseReady)return null;
  try{var fb=await window.__firebaseReady;fbState.fb=fb;fbState.ready=true;subscribe();return fb;}
  catch(err){console.warn('[live-chat] firebase init failed:',err);return null;}
}
function subscribe(){
  if(!fbState.fb||fbState.unsubMsgs)return;
  var fb=fbState.fb;
  try{
    var ref=fb.firestore.query(fb.firestore.collection(fb.db,'chats',sessionId,'messages'),fb.firestore.orderBy('createdAt','asc'));
    fbState.unsubMsgs=fb.firestore.onSnapshot(ref,function(snap){
      snap.docChanges().forEach(function(ch){
        if(ch.type!=='added')return;
        var d=ch.doc.data()||{};var id=ch.doc.id;
        if(fbState.msgIds.has(id))return;fbState.msgIds.add(id);
        if(d.role==='admin'||d.role==='agent'||d.role==='whatsapp'){
          addBubble('them',d.text||'',d.senderName||'Andaman Voyages Team',d.imageUrl||'');
          if(!isOpen){unreadCount++;if(newDot){newDot.textContent=String(unreadCount);newDot.style.display='inline-block';}}
        }
      });
    },function(err){console.warn('[live-chat] snapshot failed:',err);});
  }catch(err){console.warn('[live-chat] subscribe failed:',err);}
}

async function persist(role,text,imageUrl){
  var fb=await ensureFb();
  if(!fb)return;
  try{
    var col=fb.firestore.collection(fb.db,'chats',sessionId,'messages');
    var doc={role:role,text:String(text||''),createdAt:fb.firestore.serverTimestamp()};
    if(imageUrl)doc.imageUrl=String(imageUrl);
    await fb.firestore.addDoc(col,doc);
    var parent=fb.firestore.doc(fb.db,'chats',sessionId);
    var preview=text?String(text).slice(0,280):(imageUrl?'📷 Photo':'');
    var patch={lastMessage:preview,lastMessageAt:fb.firestore.serverTimestamp(),lastMessageBy:role,userAgent:String(navigator.userAgent||'').slice(0,200),page:location.pathname+location.search,channel:'live-chat'};
    if(role==='user')patch.unreadByAdmin=true;
    try{var u=(window.UsersStore&&window.UsersStore.getCurrentUser&&window.UsersStore.getCurrentUser())||null;if(u){patch.customerEmail=u.email||'';patch.customerName=u.fullName||u.username||'';patch.customerUid=u.uid||u.id||'';}}catch(_){}
    await fb.firestore.setDoc(parent,patch,{merge:true});
  }catch(err){console.warn('[live-chat] persist failed:',err);}
}

async function pingWhatsApp(text){
  try{
    var s=(window.SettingsStore&&window.SettingsStore.cached&&window.SettingsStore.cached())||{};
    if(!s.whatsappBridgeEnabled||!s.whatsappBridgeWorkerUrl)return;
    var url=String(s.whatsappBridgeWorkerUrl).replace(/\/+$/,'')+'/notify';
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sessionId,preview:String(text||'').slice(0,500)})}).catch(function(){});
  }catch(_){}
}

/* Mirror of pingWhatsApp for the Telegram bridge. The worker owns the
 * bot token + Telegram API call; we just hand it the sessionId + preview
 * so it can format a digest, DM the admin's bot, and route the admin's
 * reply back into /chats/{sessionId}/messages — which then streams to
 * the customer's open browser via the existing Firestore subscription.
 *
 * Both bridges fire side-by-side: admin can have WhatsApp on, Telegram
 * on, both, or neither. The Firestore write is what powers the dashboard
 * so the bridges are pure notification add-ons, not replacements. */
async function pingTelegram(text){
  try{
    var s=(window.SettingsStore&&window.SettingsStore.cached&&window.SettingsStore.cached())||{};
    if(!s.telegramBridgeEnabled||!s.telegramBridgeWorkerUrl)return;
    var url=String(s.telegramBridgeWorkerUrl).replace(/\/+$/,'')+'/notify';
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sessionId,preview:String(text||'').slice(0,500)})}).catch(function(){});
  }catch(_){}
}

/* Cloudinary upload */
function uploadImage(file){
  return new Promise(function(resolve,reject){
    if(!file||!/^image\//.test(file.type))return reject(new Error('Please choose an image file.'));
    if(file.size>8*1024*1024)return reject(new Error('Image is too large (max 8 MB).'));
    var url='https://api.cloudinary.com/v1_1/'+CLOUDINARY.cloud+'/image/upload';
    var fd=new FormData();
    fd.append('file',file);
    fd.append('upload_preset',CLOUDINARY.preset);
    fd.append('folder',CLOUDINARY.folder);
    var xhr=new XMLHttpRequest();
    xhr.open('POST',url);
    xhr.upload.onprogress=function(e){if(e.lengthComputable&&upBar){upBar.style.width=Math.round((e.loaded/e.total)*100)+'%';}};
    xhr.onload=function(){
      try{var r=JSON.parse(xhr.responseText||'{}');if(xhr.status>=200&&xhr.status<300&&r.secure_url){resolve(r.secure_url);}else{reject(new Error(r.error?r.error.message:'Upload failed'));}}
      catch(e){reject(e);}
    };
    xhr.onerror=function(){reject(new Error('Upload failed (network).'));};
    xhr.send(fd);
  });
}

attachBtn.addEventListener('click',function(){if(isBusy)return;fileInput.click();});
fileInput.addEventListener('change',async function(){
  var f=fileInput.files&&fileInput.files[0];
  fileInput.value='';
  if(!f)return;
  if(isBusy)return;
  isBusy=true;sendBtn.disabled=true;attachBtn.disabled=true;
  upWrap.classList.add('show');upBar.style.width='0%';
  try{
    var url=await uploadImage(f);
    addBubble('me','',null,url);
    persist('user','',url).catch(function(){});
    pingWhatsApp('[photo] '+url);
    pingTelegram('[photo] '+url);
    if(!fbState.seeded){fbState.seeded=true;setTimeout(sendAutoReply,500);}
  }catch(err){
    addBubble('system','Could not upload photo: '+(err&&err.message||err));
  }finally{
    isBusy=false;sendBtn.disabled=false;attachBtn.disabled=false;
    upWrap.classList.remove('show');upBar.style.width='0%';
    try{input.focus();}catch(_){}
  }
});

function open(){
  if(isOpen)return;
  isOpen=true;
  panel.classList.add('open');
  document.body.classList.add('lc-active');
  unreadCount=0;
  if(newDot){newDot.style.display='none';newDot.textContent='';}
  if(!opened){
    opened=true;
    addBubble('them','Hi there! 👋 You are now connected to our team. '+(online?'Reply within ~10 minutes during business hours.':'We are offline right now (Mon-Sat, 9 AM - 9 PM IST). Drop your question — we will reply first thing tomorrow.'),'Andaman Voyages Team');
    ensureFb();
  }
  setTimeout(function(){try{input.focus();}catch(_){}},250);
}
function close(){
  if(!isOpen)return;
  isOpen=false;
  panel.classList.remove('open');
  document.body.classList.remove('lc-active');
}

async function send(text){
  text=(text||'').trim();
  if(!text||isBusy)return;
  isBusy=true;sendBtn.disabled=true;
  addBubble('me',text);
  input.value='';
  persist('user',text).catch(function(){});
  pingWhatsApp(text);
  pingTelegram(text);
  if(!fbState.seeded){fbState.seeded=true;setTimeout(sendAutoReply,500);}
  isBusy=false;sendBtn.disabled=false;
  try{input.focus();}catch(_){}
}

/* ── Auto-reply on the customer's first message ─────────────────
 *   Renders an "Andaman Voyages Team" bubble that thanks the visitor
 *   and lets them know we are notified — purely for UX so they don't
 *   feel ignored while a human is being paged. The text is editable
 *   in Dashboard → Settings → Chat Widget (key: liveChatAutoReply); a
 *   sane default is used otherwise. We also persist this bubble to
 *   Firestore as role:'bot' so the dashboard's Live Chats panel sees
 *   the same context the customer is seeing — but with role!='admin'
 *   so the dashboard doesn't mistake it for a real human reply. */
function getAutoReplyText(){
  try{
    var s=(window.SettingsStore&&window.SettingsStore.cached&&window.SettingsStore.cached())||{};
    var custom=String(s.liveChatAutoReply||'').trim();
    if(custom)return custom;
  }catch(_){}
  return 'Thank you for contacting us! 🙏 Please share your query and we will assign someone from our team to answer you shortly. During business hours we usually reply within 10 minutes.';
}
function sendAutoReply(){
  var text=getAutoReplyText();
  // Render in the open bubble immediately
  addBubble('them',text,'Andaman Voyages Team');
  // Persist as role:'bot' so the dashboard's Live Chats list shows
  // the auto-reply in the transcript without mis-attributing it to a
  // real admin (role:'admin' is reserved for human replies, including
  // those that come back via the Telegram / WhatsApp bridges).
  persist('bot',text).catch(function(){});
}

btn.addEventListener('click',function(){isOpen?close():open();});
document.getElementById('lcClose').addEventListener('click',close);
sendBtn.addEventListener('click',function(){send(input.value);});
input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input.value);}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&isOpen)close();});
})();
