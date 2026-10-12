/** The console renders only a screenshot; remote page code never runs in this document.
 * Keystrokes go straight to the page and are never logged or stored. */
export function browserConsole(previewUrl: string) {
  const preview = JSON.stringify(previewUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Noa's browser</title><style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fcfcfc;color:#172125;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;display:flex;flex-direction:column}
header{padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:8px;min-height:32px}#status{color:#697176;font-size:12px}#status.live{color:#248258}
#stage{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;background:#eef1f3;border-radius:18px;margin:0 8px}
img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}img.stale{opacity:.45}
#error{margin:8px 12px 0;color:#984a41;background:#fbefed;padding:10px 12px;border-radius:14px}#error:empty{display:none}
nav{display:flex;justify-content:center;gap:10px;padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
button{font:inherit;font-size:18px;border:1px solid #e9edef;border-radius:24px;background:white;color:inherit;min-width:52px;min-height:44px;padding:8px 14px;cursor:pointer}
button[aria-pressed=true]{background:#172125;color:white;border-color:#172125}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #1473c8;outline-offset:2px}
#sink{position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;pointer-events:none}
</style><header><span id="status" role="status">Connecting…</span></header>
<div id="error" role="alert"></div>
<div id="stage"><img id="screen" class="stale" alt="Noa's browser. Tap to click, swipe to scroll." draggable="false"></div>
<input id="sink" aria-label="Type into the page" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
<nav aria-label="Browser controls"><button id="kb" aria-pressed="false" aria-label="Keyboard">⌨︎</button><button id="up" aria-label="Scroll up">↑</button><button id="down" aria-label="Scroll down">↓</button><button id="refresh" aria-label="Refresh">↻</button></nav><script>
const image=document.querySelector('#screen'),error=document.querySelector('#error'),status=document.querySelector('#status'),sink=document.querySelector('#sink'),kb=document.querySelector('#kb');
const Z='\\u200b\\u200b',KEYS=['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
let refreshing=false,busy=false,live=false,queue=[],imageUrl,previewError=false,start;
function show(text,ok){status.textContent=text;status.className=ok?'live':'';image.classList.toggle('stale',!ok);}
async function refresh(){if(refreshing||document.hidden)return;refreshing=true;try{
const r=await fetch(${preview},{cache:'no-store',signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error(r.status===401?'This view expired. Close it and open the browser again.':'The browser disconnected. Close this view and open it again.');
const blob=await r.blob();const next=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>{URL.revokeObjectURL(next);reject(new Error('The browser view could not be shown.'));};probe.src=next;});
if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=next;image.src=next;live=true;show(busy?'Updating…':'Live — tap to click',true);if(previewError){error.textContent='';previewError=false;}
}catch(e){live=false;previewError=true;show('Disconnected',false);error.textContent=e.message;}finally{refreshing=false;}}
async function post(body){const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
if(!r.ok){let m='That didn’t reach the browser. Try again.';try{const d=await r.json();if(typeof d.error==='string')m=d.error;else if(d.error&&typeof d.error.message==='string')m=d.error.message;}catch{}throw new Error(m);}}
function send(body){if(!live)return;const last=queue[queue.length-1];if(body.type==='text'&&last&&last.type==='text')last.text+=body.text;else queue.push(body);pump();}
async function pump(){if(busy)return;busy=true;status.textContent='Updating…';try{while(queue.length){const next=queue.shift();try{await post(next);error.textContent='';}catch(e){error.textContent=e.message;queue=[];}}}finally{busy=false;}await refresh();}
function point(e){const r=image.getBoundingClientRect(),w=image.naturalWidth||1280,h=image.naturalHeight||800;return{x:Math.min(w-1,Math.max(0,Math.floor((e.clientX-r.left)*w/r.width))),y:Math.min(h-1,Math.max(0,Math.floor((e.clientY-r.top)*h/r.height))),scale:h/r.height};}
image.addEventListener('pointerdown',e=>{e.preventDefault();start={y:e.clientY,x:e.clientX};});
image.addEventListener('pointerup',e=>{if(!start)return;const dy=e.clientY-start.y,dx=e.clientX-start.x;start=undefined;const p=point(e);
if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx))send({type:'scroll',deltaY:Math.max(-5000,Math.min(5000,Math.round(-dy*p.scale*1.5)))});else send({type:'click',x:p.x,y:p.y});});
function resetSink(){sink.value=Z;try{sink.setSelectionRange(Z.length,Z.length);}catch{}}
sink.addEventListener('input',()=>{const v=sink.value;if(v.length<Z.length){for(let i=v.length;i<Z.length;i++)send({type:'key',key:'Backspace'});}else{const t=v.startsWith(Z)?v.slice(Z.length):v.replace(/\\u200b/g,'');if(t)send({type:'text',text:t});}resetSink();});
sink.addEventListener('keydown',e=>{if(KEYS.includes(e.key)){e.preventDefault();send({type:'key',key:e.shiftKey&&e.key==='Tab'?'Shift+Tab':e.key});}});
sink.addEventListener('focus',()=>kb.setAttribute('aria-pressed','true'));sink.addEventListener('blur',()=>kb.setAttribute('aria-pressed','false'));
kb.addEventListener('mousedown',e=>e.preventDefault());
kb.onclick=()=>{if(document.activeElement===sink)sink.blur();else{resetSink();sink.focus();}};
document.querySelector('#up').onclick=()=>send({type:'scroll',deltaY:-600});document.querySelector('#down').onclick=()=>send({type:'scroll',deltaY:600});
document.querySelector('#refresh').onclick=()=>{error.textContent='';refresh();};document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();const timer=setInterval(refresh,1000);window.addEventListener('pagehide',()=>{clearInterval(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);});
</script></html>`;
}
