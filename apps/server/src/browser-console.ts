/** The console renders only a screenshot; remote page code never runs in this document.
 * Keystrokes go straight to the page and are never logged or stored.
 * The app sends {type:"control"} to lock or unlock input; without it (older apps) input is on. */
export function browserConsole(previewUrl: string) {
  const preview = JSON.stringify(previewUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Noa's browser</title><style>
*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:#111416;color:#f4f6f7;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;overflow:hidden}
#stage{position:absolute;inset:0;overflow:hidden}
img{display:block;width:100%;height:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:opacity .2s}img.stale{opacity:.5}
#note{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(20,24,26,.85);padding:7px 12px;border-radius:16px;font-size:12px;pointer-events:none}#note:empty{display:none}
#error{position:absolute;left:12px;right:12px;bottom:12px;color:#ffd9d3;background:rgba(80,30,24,.92);padding:10px 12px;border-radius:14px}#error:empty{display:none}
#sink{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;pointer-events:none}
</style><div id="stage"><img id="screen" class="stale" alt="Noa's browser" draggable="false"></div>
<div id="note" role="status">Connecting…</div><div id="error" role="alert"></div>
<input id="sink" aria-label="Type into the page" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><script>
const stage=document.querySelector('#stage'),image=document.querySelector('#screen'),error=document.querySelector('#error'),note=document.querySelector('#note'),sink=document.querySelector('#sink');
const Z='\\u200b\\u200b',KEYS=['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
let refreshing=false,busy=false,live=false,queue=[],imageUrl,previewError=false,start,control=true,lastY=0;
function tell(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));else if(parent!==window)parent.postMessage(m,'*');}
window.addEventListener('message',e=>{let d=e.data;if(typeof d==='string'){try{d=JSON.parse(d);}catch{return;}}if(d&&d.type==='control'){control=!!d.value;if(!control)sink.blur();}});
function show(ok){image.classList.toggle('stale',!ok);if(ok)note.textContent='';}
async function refresh(){if(refreshing||document.hidden)return;refreshing=true;try{
const r=await fetch(${preview},{cache:'no-store',signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error(r.status===401?'This view expired. Close it and open the browser again.':'The browser disconnected. Close this view and open it again.');
const blob=await r.blob();const next=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>{URL.revokeObjectURL(next);reject(new Error('The browser view could not be shown.'));};probe.src=next;});
if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=next;image.src=next;live=true;show(true);if(previewError){error.textContent='';previewError=false;}
}catch(e){live=false;previewError=true;show(false);note.textContent='Disconnected';error.textContent=e.message;}finally{refreshing=false;}}
async function post(body){const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
if(!r.ok){let m='That didn’t reach the browser. Try again.';try{const d=await r.json();if(typeof d.error==='string')m=d.error;else if(d.error&&typeof d.error.message==='string')m=d.error.message;}catch{}throw new Error(m);}return r.json().catch(()=>({}));}
function send(body){if(!live)return;const last=queue[queue.length-1];if(body.type==='text'&&last&&last.type==='text')last.text+=body.text;else queue.push(body);pump();}
async function pump(){if(busy)return;busy=true;try{while(queue.length){const next=queue.shift();try{const result=await post(next);error.textContent='';
if(next.type==='tap'){if(result&&result.editable){resetSink();sink.focus();}else if(document.activeElement===sink)sink.blur();}}catch(e){error.textContent=e.message;queue=[];}}}finally{busy=false;}await refresh();}
function point(e){const r=image.getBoundingClientRect();return{x:Math.min(.999,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(.999,Math.max(0,(e.clientY-r.top)/r.height)),top:r.top,height:r.height};}
image.addEventListener('pointerdown',e=>{e.preventDefault();start={y:e.clientY,x:e.clientX};});
image.addEventListener('pointerup',e=>{if(!start)return;const dy=e.clientY-start.y,dx=e.clientX-start.x;start=undefined;if(!control){tell({type:'locked'});return;}const p=point(e);
if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx))send({type:'swipe',deltaY:Math.max(-4,Math.min(4,-dy/p.height*1.5))});else{lastY=e.clientY-p.top;send({type:'tap',x:p.x,y:p.y});}});
function reveal(){if(document.activeElement!==sink)return;stage.scrollTop=Math.max(0,lastY-stage.clientHeight*0.4);}
window.addEventListener('resize',reveal);if(window.visualViewport)window.visualViewport.addEventListener('resize',reveal);
function resetSink(){sink.value=Z;try{sink.setSelectionRange(Z.length,Z.length);}catch{}}
sink.addEventListener('input',()=>{const v=sink.value;if(v.length<Z.length){for(let i=v.length;i<Z.length;i++)send({type:'key',key:'Backspace'});}else{const t=v.startsWith(Z)?v.slice(Z.length):v.replace(/\\u200b/g,'');if(t)send({type:'text',text:t});}resetSink();});
sink.addEventListener('keydown',e=>{if(KEYS.includes(e.key)){e.preventDefault();send({type:'key',key:e.shiftKey&&e.key==='Tab'?'Shift+Tab':e.key});}});
sink.addEventListener('focus',()=>{tell({type:'keyboard',value:true});setTimeout(reveal,300);});sink.addEventListener('blur',()=>{tell({type:'keyboard',value:false});stage.scrollTop=0;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();const timer=setInterval(refresh,1000);window.addEventListener('pagehide',()=>{clearInterval(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);});
</script></html>`;
}
