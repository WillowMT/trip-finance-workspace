const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

const CSS = `
:root{
  --bg:#f4f4f5; --card:#ffffff; --ink:#18181b; --muted:#71717a; --line:#e4e4e7;
  --brand:#2563eb; --brand-ink:#ffffff; --ok:#15803d; --bad:#dc2626; --chip:#f4f4f5;
  --radius:14px; --shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.1);
}
@media (prefers-color-scheme:dark){
  :root{ --bg:#0b0b0d; --card:#18181b; --ink:#fafafa; --muted:#a1a1aa; --line:#27272a;
    --brand:#3b82f6; --ok:#4ade80; --bad:#f87171; --chip:#27272a; --shadow:none; }
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:0 14px 96px}
header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 14px 8px;margin:0 -14px 14px}
.head{display:flex;align-items:center;justify-content:space-between;gap:10px;max-width:680px;margin:0 auto}
h1{font-size:1.15rem;margin:0;letter-spacing:-.01em}
h2{font-size:1rem;margin:0 0 10px;letter-spacing:-.01em}
h3{font-size:.85rem;margin:0 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
p.sub{color:var(--muted);font-size:.8rem;margin:2px 0 0}
.tabs{display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x proximity;margin:10px auto 0;max-width:680px;padding:2px 2px 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
@media(min-width:560px){.tabs button{flex:1 1 0;min-width:0}}
@media(max-width:559px){.tabs{flex-wrap:wrap;overflow:visible}.tabs button{flex:0 1 auto}}
.tabs::-webkit-scrollbar{display:none}
.tabs button{width:auto;flex:0 0 auto;scroll-snap-align:start;background:transparent;color:var(--muted);border:1px solid transparent;border-radius:999px;padding:7px 13px;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--card);color:var(--ink);border-color:var(--line);box-shadow:var(--shadow)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin-bottom:12px;box-shadow:var(--shadow)}
label{display:block;font-size:.78rem;color:var(--muted);font-weight:600;margin:0 0 4px}
input,select,textarea,button{font:inherit;color:var(--ink)}
input,select,textarea{width:100%;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:16px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--brand);outline-offset:-1px}
textarea{min-height:92px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid.three{grid-template-columns:1fr 1fr 1fr}
.full{grid-column:1/-1}
.field{margin-bottom:10px}
button{background:var(--brand);color:var(--brand-ink);border:0;border-radius:10px;padding:11px 14px;font-weight:600;cursor:pointer;width:100%}
button:active{transform:translateY(1px)}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
button.danger{background:transparent;color:var(--bad);border:1px solid var(--line)}
button.mini{width:auto;padding:5px 10px;font-size:.8rem;border-radius:8px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.btns button{width:auto;flex:1;min-width:120px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .who{font-weight:600;font-size:.92rem}
.row .meta{color:var(--muted);font-size:.78rem;margin-top:1px}
.amt{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.pos{color:var(--ok)} .neg{color:var(--bad)}
.chip{display:inline-block;background:var(--chip);color:var(--muted);border-radius:999px;padding:2px 8px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.chip.debt{color:var(--brand)} .chip.payment{color:var(--ok)}
.totals{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.total{background:var(--chip);border-radius:10px;padding:8px 11px;font-variant-numeric:tabular-nums;font-size:.85rem}
.total b{display:block;font-size:1rem}
.empty{color:var(--muted);font-size:.88rem;padding:6px 0}
.err{color:var(--bad);font-size:.85rem;margin-top:8px;white-space:pre-wrap}
details{border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:8px}
summary{cursor:pointer;font-size:.86rem;font-weight:600}
pre{background:var(--chip);border-radius:8px;padding:10px;overflow-x:auto;font-size:12px;margin:8px 0 0}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:50;background:var(--ink);color:var(--bg);border-radius:999px;padding:10px 16px;font-size:.86rem;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:92vw;text-align:center;transition:opacity .2s;opacity:0;pointer-events:none}
.toast.show{opacity:1}
.toast.bad{background:var(--bad);color:#fff}
.hint{color:var(--muted);font-size:.76rem;margin-top:6px}
.swap{display:flex;justify-content:center;margin:-4px 0 6px}
.swap button{width:auto;background:var(--chip);color:var(--ink);padding:4px 10px;font-size:.78rem;font-weight:600}
.inline{display:flex;gap:8px;align-items:flex-end}
.inline > *{flex:1} .inline button{flex:0 0 auto;width:auto}
`;

const page = (title: string, head: string, body: string, script = '') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
${body}
<div id="toast" class="toast" role="status"></div>
${head}
${script ? `<script>${script}</script>` : ''}
</body></html>`;

export const homeHtml = () => page('Trip finance workspace', '', `
<main>
<header><div class="head"><div><h1>Trip finance</h1><p class="sub">One shared link. No accounts.</p></div></div></header>
<div class="card">
<h2>Create a shared workspace</h2>
<div class="field"><label for="f-name">Trip name</label><input id="f-name" placeholder="Chiang Mai 2027" autocomplete="off"></div>
<div class="field"><label for="f-people">People (comma separated, at least 2)</label><input id="f-people" placeholder="Ada, Lin, Mo" autocomplete="off"></div>
<div class="field"><label for="f-currencies">Currencies (first is the default)</label><input id="f-currencies" value="USD, THB" autocomplete="off"></div>
<button id="f-go" type="button">Create shared workspace</button>
<div id="f-err" class="err"></div>
<p class="hint">You get one secret link. Everyone with it can add and edit anything — all changes are audited. Keep it safe; it cannot be recovered.</p>
</div>
</main>`, `
const $=function(id){return document.getElementById(id)};
const toast=function(msg,bad){var t=$('toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast'},2600)};
$('f-go').onclick=async function(){
  var btn=$('f-go'); btn.disabled=true; $('f-err').textContent='';
  try{
    var name=$('f-name').value.trim();
    var people=$('f-people').value.split(',').map(function(s){return s.trim()}).filter(Boolean);
    var codes=$('f-currencies').value.split(',').map(function(s){return s.trim().toUpperCase()}).filter(Boolean);
    if(!name){throw new Error('Give the trip a name.')}
    if(people.length<2){throw new Error('Add at least two people.')}
    if(!codes.length){throw new Error('Add at least one currency.')}
    var seen={}; for(var i=0;i<codes.length;i++){ if(seen[codes[i]]){throw new Error('Duplicate currency '+codes[i])} seen[codes[i]]=1 }
    var res=await fetch('/api/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,people:people,currencies:codes.map(function(c,i){return {code:c,is_default:i===0}})})});
    var data=await res.json().catch(function(){return {}});
    if(res.ok&&data.workspace_url){location.href=data.workspace_url;return}
    throw new Error(data.error||('Could not create the workspace ('+res.status+')'));
  }catch(e){ $('f-err').textContent=e.message||String(e); toast(e.message||'Failed',true) }
  finally{ btn.disabled=false }
};`);

type Row = Record<string, any>;

const APP_SCRIPT = `
var $=function(id){return document.getElementById(id)};
var api=location.pathname.replace(/\\/+$/,'')+'/api';
var boot=window.__initial||{};
var people=boot.people||[], currencies=boot.currencies||[], settings=null, me=null;

function toast(msg,bad){var t=$('toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast'},2800)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function name(id){for(var i=0;i<people.length;i++){if(people[i].id===id){return people[i].display_name}}return '#'+id}
function toMinor(v){
  var s=String(v==null?'':v).replace(/[\\s,]/g,'');
  if(s===''){return null}
  var n=Number(s);
  if(!isFinite(n)||n<=0){return null}
  var m=Math.round(n*100);
  return Number.isSafeInteger(m)&&m>0?m:null;
}
function money(minor,code){
  var v=(Number(minor)||0)/100;
  var s=v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return (code?code+' ':'')+s;
}
function iso(d){return d.toISOString().slice(0,10)}
function today(){return iso(new Date())}

async function call(path,opts){
  opts=opts||{};
  var headers=opts.headers||{};
  if(opts.body!==undefined&&!(opts.raw)){headers['content-type']='application/json';opts.body=JSON.stringify(opts.body)}
  var res,data=null,text='';
  try{ res=await fetch(api+path,{method:opts.method||'GET',headers:headers,body:opts.body}) }
  catch(e){ return {ok:false,status:0,error:'Network error — check your connection.',data:null} }
  try{ text=await res.text(); data=text?JSON.parse(text):null }catch(e){ data=null }
  if(!res.ok){
    var msg=(data&&(data.error||(data.errors&&data.errors.join('; '))))||('Request failed ('+res.status+')');
    return {ok:false,status:res.status,error:msg,data:data};
  }
  return {ok:true,status:res.status,data:data};
}
function busy(btn,on){ if(btn){ btn.disabled=!!on } }

function showTab(tab){
  var tabs=['ledger','balances','tools','audit','settings'];
  for(var i=0;i<tabs.length;i++){
    var section=$(tabs[i]); if(section){section.hidden=tabs[i]!==tab}
    var btn=$('tab-'+tabs[i]); if(btn){btn.setAttribute('aria-selected',String(tabs[i]===tab))}
  }
  if(location.hash!=='#'+tab){try{history.replaceState(null,'','#'+tab)}catch(e){}}
  if(tab==='ledger'){loadLedger()}
  if(tab==='balances'){loadBalances()}
  if(tab==='audit'){loadAudit()}
  if(tab==='settings'){renderSettings()}
}

async function loadState(){
  var r=await call('');
  if(!r.ok){ $('banner').textContent=r.error; $('banner').hidden=false; return false }
  me=r.data.workspace; people=r.data.people||[]; currencies=r.data.currencies||[]; settings=r.data.settings||null;
  $('banner').hidden=true;
  if(me&&me.name){document.title=me.name}
  return true;
}

/* ---------------- ledger ---------------- */
function txRow(t){
  var el=document.createElement('div'); el.className='row';
  var amount=(t.amount_minor<0?'-':'')+money(Math.abs(t.amount_minor),t.currency_code);
  el.innerHTML='<div><div class="who">'+esc(t.topic)+' <span class="chip '+esc(t.entry_kind)+'">'+esc(t.entry_kind)+'</span></div><div class="meta">'+esc(t.occurred_on)+' · '+esc(name(t.creditor_person_id))+' → '+esc(name(t.debtor_person_id))+' · '+esc(t.category)+'</div></div>'+
    '<div style="text-align:right"><div class="amt">'+esc(amount)+'</div><button class="mini danger" data-del="'+t.id+'" type="button">Delete</button></div>';
  return el;
}
async function loadLedger(){
  var list=$('tx-list'); list.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ list.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var txs=(r.data&&r.data.transactions)||[];
  var totals={};
  for(var i=0;i<txs.length;i++){ var t=txs[i]; var signed=(t.entry_kind==='payment')?-t.amount_minor:t.amount_minor; totals[t.currency_code]=(totals[t.currency_code]||0)+signed }
  var keys=Object.keys(totals).sort();
  var box=$('tx-totals'); box.innerHTML='';
  if(keys.length){ for(var k=0;k<keys.length;k++){ var d=document.createElement('div'); d.className='total'; d.innerHTML='<span>'+esc(keys[k])+' outstanding</span><b>'+esc(money(totals[keys[k]],keys[k])||'')+'</b>'; box.appendChild(d) } }
  list.innerHTML='';
  if(!txs.length){ list.innerHTML='<div class="empty">No transactions yet. Add the first one above.</div>'; return }
  for(var j=0;j<txs.length;j++){ list.appendChild(txRow(txs[j])) }
}
async function delTx(id,btn){
  if(!confirm('Delete this transaction? It stays restorable in the audit log.')){return}
  busy(btn,true);
  var r=await call('/transactions/'+id,{method:'DELETE'});
  busy(btn,false);
  if(!r.ok){ toast(r.error,true); return }
  toast('Transaction deleted'); loadLedger();
}
async function addTx(){
  var btn=$('t-add'); var err=$('t-err'); err.textContent='';
  var rows=[{occurred_on:$('t-date').value,entry_kind:$('t-kind').value,topic:$('t-topic').value.trim(),
    category:$('t-category').value.trim(),creditor_person_id:Number($('t-creditor').value),
    debtor_person_id:Number($('t-debtor').value),amount_minor:toMinor($('t-amount').value),
    currency_code:$('t-currency').value,notes:$('t-notes').value.trim()}];
  await commitRows(rows,btn,err);
}
async function commitRows(rows,btn,err){
  if(!rows.length){err.textContent='Nothing to add.';return false}
  if(rows.length===1){ var one=rows[0];
    if(!one.topic||!one.category){err.textContent='Topic and category are required.';return false}
    if(!one.amount_minor){err.textContent='Enter a positive amount.';return false}
    if(one.creditor_person_id===one.debtor_person_id){err.textContent='Creditor and debtor must differ.';return false}
  }
  busy(btn,true);
  var r=(rows.length===1)
    ? await call('/transactions',{method:'POST',body:rows[0]})
    : await call('/batches',{method:'POST',headers:{'idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},body:{rows:rows}});
  busy(btn,false);
  if(!r.ok){ err.textContent=r.error; toast(r.error,true); return false }
  toast(rows.length===1?'Transaction added':(rows.length+' transactions added'));
  $('t-amount').value=''; $('t-topic').value=''; $('t-category').value=''; $('t-notes').value='';
  loadLedger(); return true;
}
/* ---------------- balances ---------------- */
async function loadBalances(){
  var box=$('bal-list'); box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var txs=(r.data&&r.data.transactions)||[];
  var net={};
  for(var i=0;i<txs.length;i++){var t=txs[i];
    net[t.currency_code]=net[t.currency_code]||{};
    net[t.currency_code][t.creditor_person_id]=(net[t.currency_code][t.creditor_person_id]||0)+t.amount_minor;
    net[t.currency_code][t.debtor_person_id]=(net[t.currency_code][t.debtor_person_id]||0)-t.amount_minor;
  }
  var rows=[];
  Object.keys(net).sort().forEach(function(code){ Object.keys(net[code]).forEach(function(pid){ var v=net[code][pid]; if(v!==0){rows.push({code:code,pid:Number(pid),v:v})} }) });
  box.innerHTML='';
  if(!rows.length){ box.innerHTML='<div class="empty">Nothing outstanding — all settled up.</div>'; return }
  for(var j=0;j<rows.length;j++){var b=rows[j];
    var el=document.createElement('div'); el.className='row';
    el.innerHTML='<div><div class="who">'+esc(name(b.pid))+'</div><div class="meta">'+esc(b.code)+' · '+(b.v>0?'is owed':'owes')+'</div></div>'+
      '<div class="amt '+(b.v>0?'pos':'neg')+'">'+esc(money(Math.abs(b.v),b.code))+'</div>';
    box.appendChild(el);
  }
  var ob=$('offset-list'); ob.innerHTML='<div class="empty">Loading…</div>';
  var o=await call('/offset-suggestions');
  if(!o.ok){ ob.innerHTML='<div class="err">'+esc(o.error)+'</div>'; return }
  var sug=(o.data&&o.data.suggestions)||[];
  ob.innerHTML='';
  if(!sug.length){ ob.innerHTML='<div class="empty">No reciprocal balances to offset.</div>'; return }
  for(var k=0;k<sug.length;k++){var s=sug[k];
    var row=document.createElement('div'); row.className='row';
    row.innerHTML='<div><div class="who">'+esc(name(s.first_person_id))+' ↔ '+esc(name(s.second_person_id))+'</div><div class="meta">offsettable '+esc(money(s.offset_amount_minor,s.currency_code))+'</div></div>'+
      '<button class="mini" type="button" data-off="'+s.first_person_id+':'+s.second_person_id+':'+esc(s.currency_code)+'">Offset</button>';
    ob.appendChild(row);
  }
}
async function doOffset(a,b,c,btn){
  busy(btn,true);
  var r=await call('/offsets',{method:'POST',headers:{'idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},body:{first_person_id:a,second_person_id:b,currency_code:c}});
  busy(btn,false);
  if(!r.ok){ toast(r.error,true); return }
  toast('Offset recorded'); loadBalances();
}
/* ---------------- tools: quick entry + import ---------------- */
function parseQuick(text){
  var out=[],problems=[];
  var lines=String(text||'').split(/\\r?\\n/);
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim(); if(!line){continue}
    var parts=line.split('|').map(function(s){return s.trim()});
    if(parts.length<8){ problems.push('Line '+(i+1)+': need 8 fields separated by |'); continue }
    var kind=parts[1].toLowerCase(); if(kind==='debt'||kind==='paid'){kind='debt'}else if(kind==='payment'||kind==='paid back'||kind==='repay'){kind='payment'}else{problems.push('Line '+(i+1)+': kind must be debt or payment'); continue}
    var cr=null,dr=null;
    for(var p=0;p<people.length;p++){ if(people[p].display_name.toLowerCase()===parts[4].toLowerCase()){cr=people[p].id} if(people[p].display_name.toLowerCase()===parts[5].toLowerCase()){dr=people[p].id} }
    if(!cr){problems.push('Line '+(i+1)+': unknown creditor "'+parts[4]+'"');continue}
    if(!dr){problems.push('Line '+(i+1)+': unknown debtor "'+parts[5]+'"');continue}
    if(cr===dr){problems.push('Line '+(i+1)+': creditor and debtor are the same');continue}
    var minor=toMinor(parts[6]); if(!minor){problems.push('Line '+(i+1)+': bad amount "'+parts[6]+'"');continue}
    var code=parts[7].toUpperCase(); var known=false;
    for(var c=0;c<currencies.length;c++){ if(currencies[c].code===code&&!currencies[c].is_archived){known=true} }
    if(!known){problems.push('Line '+(i+1)+': currency '+code+' is not enabled');continue}
    out.push({occurred_on:parts[0],entry_kind:kind,topic:parts[2],category:parts[3],creditor_person_id:cr,debtor_person_id:dr,amount_minor:minor,currency_code:code,notes:parts[8]||null});
  }
  return {rows:out,problems:problems};
}
function renderQuick(){
  var parsed=parseQuick($('q-text').value);
  var box=$('q-preview-out'); box.innerHTML='';
  if(parsed.problems.length){ box.innerHTML='<div class="err">'+esc(parsed.problems.join('\\n'))+'</div>' }
  if(!parsed.rows.length){ if(!parsed.problems.length){box.innerHTML='<div class="empty">Nothing parsed yet.</div>'} $('q-commit').disabled=true; return }
  var t=document.createElement('table');
  t.innerHTML='<tr><th>Date</th><th>Kind</th><th>Topic</th><th>From → To</th><th class="num">Amount</th></tr>'+
    parsed.rows.map(function(r){return '<tr><td>'+esc(r.occurred_on)+'</td><td>'+esc(r.entry_kind)+'</td><td>'+esc(r.topic)+'</td><td>'+esc(name(r.creditor_person_id))+' → '+esc(name(r.debtor_person_id))+'</td><td class="num">'+esc(money(r.amount_minor,r.currency_code))+'</td></tr>'}).join('');
  box.appendChild(t);
  $('q-commit').disabled=false;
}
async function previewImport(){
  var btn=$('csv-preview'); var out=$('csv-result'); out.innerHTML='';
  busy(btn,true);
  var res=await fetch(api+'/imports/preview',{method:'POST',headers:{'content-type':'text/csv'},body:$('csv').value});
  var data=await res.json().catch(function(){return null});
  busy(btn,false);
  if(!res.ok){ $('csv-commit').disabled=true; out.innerHTML='<div class="err">'+esc((data&&(data.errors||[data.error]))?[].concat(data.errors||data.error).join('\\n'):'Import preview failed ('+res.status+')')+'</div>'; return }
  var rows=(data&&data.rows)||[];
  var t=document.createElement('table');
  t.innerHTML='<tr><th>Date</th><th>Kind</th><th>Topic</th><th>Amount</th></tr>'+
    rows.map(function(r){return '<tr><td>'+esc(r.occurred_on)+'</td><td>'+esc(r.entry_kind)+'</td><td>'+esc(r.topic)+'</td><td class="num">'+esc(money(r.amount_minor,r.currency_code))+'</td></tr>'}).join('');
  out.innerHTML='<p class="hint">'+rows.length+' row(s) ready to import.</p>'; out.appendChild(t);
  $('csv-commit').disabled=!rows.length;
}
async function commitImport(){
  var btn=$('csv-commit'); busy(btn,true);
  var r=await call('/imports',{method:'POST',headers:{'content-type':'text/csv','idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},raw:true,body:$('csv').value});
  busy(btn,false);
  if(!r.ok){ $('csv-result').innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var n=(r.data&&r.data.transactions&&r.data.transactions.length)||0;
  toast(n+' transaction(s) imported'); $('csv-result').innerHTML='<div class="empty">Imported '+n+' row(s).</div>'; loadLedger();
}
/* ---------------- audit ---------------- */
async function loadAudit(){
  var box=$('audit-list'); box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/audit');
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var rows=(r.data&&r.data.audit)||[];
  box.innerHTML='';
  if(!rows.length){ box.innerHTML='<div class="empty">No changes recorded yet.</div>'; return }
  for(var i=rows.length-1;i>=0&&box.childElementCount<60;i--){var e=rows[i];
    var d=document.createElement('details');
    var when=String(e.occurred_at||'').slice(0,19).replace('T',' ');
    d.innerHTML='<summary>'+esc(e.entity_type)+' #'+esc(e.entity_id)+' · '+esc(e.action)+' <span class="chip">'+esc(when)+'</span></summary>'+
      '<pre>'+esc(JSON.stringify({before:e.before_json,after:e.after_json},null,1))+'</pre>';
    box.appendChild(d);
  }
}
/* ---------------- settings ---------------- */
function renderSettings(){
  var pbox=$('s-people'); pbox.innerHTML='';
  for(var i=0;i<people.length;i++){var p=people[i];
    var el=document.createElement('div'); el.className='row';
    el.innerHTML='<div><div class="who">'+esc(p.display_name)+'</div><div class="meta">'+(p.is_archived?'archived':'active')+'</div></div>'+
      '<div class="btns" style="margin:0"><button class="mini ghost" type="button" data-ren="'+p.id+'">Rename</button>'+
      '<button class="mini '+(p.is_archived?'':'danger')+'" type="button" data-arch="'+p.id+':'+(p.is_archived?'restore':'archive')+'">'+(p.is_archived?'Restore':'Archive')+'</button></div>';
    pbox.appendChild(el);
  }
  var cbox=$('s-currencies'); cbox.innerHTML='';
  for(var j=0;j<currencies.length;j++){var c=currencies[j];
    var cel=document.createElement('div'); cel.className='row';
    cel.innerHTML='<div><div class="who">'+esc(c.code)+(c.is_default?' <span class="chip">default</span>':'')+'</div><div class="meta">'+(c.is_archived?'archived':'active')+'</div></div>'+
      '<div class="btns" style="margin:0">'+(c.is_default?'':'<button class="mini ghost" type="button" data-def="'+c.id+'">Set default</button>')+
      '<button class="mini '+(c.is_archived?'':'danger')+'" type="button" data-carch="'+c.id+':'+(c.is_archived?'restore':'archive')+'">'+(c.is_archived?'Restore':'Archive')+'</button></div>';
    cbox.appendChild(cel);
  }
  $('s-name').value=(me&&me.name)||'';
}
/* ---------------- wiring ---------------- */
document.addEventListener('click',async function(ev){
  var t=ev.target; if(!t||!t.getAttribute){return}
  var del=t.getAttribute('data-del'); if(del){ delTx(Number(del),t); return }
  var off=t.getAttribute('data-off'); if(off){ var parts=off.split(':'); doOffset(Number(parts[0]),Number(parts[1]),parts[2],t); return }
  var ren=t.getAttribute('data-ren'); if(ren){
    var id=Number(ren); var current=name(id); var next=prompt('Rename person',current);
    if(next&&next.trim()&&next.trim()!==current){ var r=await call('/people/'+id,{method:'PATCH',body:{display_name:next.trim()}}); if(!r.ok){toast(r.error,true)}else{await loadState(); renderSettings(); toast('Renamed')} }
    return;
  }
  var arch=t.getAttribute('data-arch'); if(arch){ var ap=arch.split(':'); var ar=await call('/people/'+ap[0]+'/'+ap[1],{method:'POST'}); if(!ar.ok){toast(ar.error,true)}else{await loadState();renderSettings();toast('Updated')} return }
  var def=t.getAttribute('data-def'); if(def){ var dr=await call('/currencies/'+def,{method:'PATCH',body:{is_default:true}}); if(!dr.ok){toast(dr.error,true)}else{await loadState();renderSettings();toast('Default currency updated')} return }
  var carch=t.getAttribute('data-carch'); if(carch){ var cp=carch.split(':'); var cr=await call('/currencies/'+cp[0]+'/'+cp[1],{method:'POST'}); if(!cr.ok){toast(cr.error,true)}else{await loadState();renderSettings();toast('Updated')} return }
});
function init(){
  window.onerror=function(msg){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+msg; b.hidden=false} return false };
  window.addEventListener('unhandledrejection',function(ev){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+(ev.reason&&ev.reason.message?ev.reason.message:ev.reason); b.hidden=false} });
  var tabs=['ledger','balances','tools','audit','settings'];
  tabs.forEach(function(tab){ var b=$('tab-'+tab); if(b){ b.onclick=function(e){ if(e&&e.preventDefault){e.preventDefault()} showTab(tab) } } });
  if($('t-date')){ $('t-date').value=today() }
  if($('t-add')){ $('t-add').onclick=addTx }
  if($('t-swap')){ $('t-swap').onclick=function(){ var a=$('t-creditor'),b=$('t-debtor'); var tmp=a.value; a.value=b.value; b.value=tmp } }
  if($('q-text')){ $('q-text').oninput=renderQuick }
  if($('q-preview')){ $('q-preview').onclick=renderQuick }
  if($('q-commit')){ $('q-commit').onclick=async function(){ var parsed=parseQuick($('q-text').value); var err=$('q-err'); err.textContent=parsed.problems.join('\\n'); if(parsed.problems.length){return} if(await commitRows(parsed.rows,this,err)){ $('q-text').value=''; renderQuick() } } }
  if($('csv-preview')){ $('csv-preview').onclick=previewImport }
  if($('csv-commit')){ $('csv-commit').onclick=commitImport; $('csv-commit').disabled=true }
  if($('csv-template')){ $('csv-template').onclick=function(){ var head='occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes\\n'; var sample=today()+',debt,Dinner,Food,'+(people[0]?people[0].display_name:'Ada')+','+(people[1]?people[1].display_name:'Lin')+',12.50,'+((currencies[0]&&currencies[0].code)||'USD')+',\\n'; var url='data:text/csv;charset=utf-8,'+encodeURIComponent(head+sample); var a=document.createElement('a'); a.href=url; a.download='transactions-template.csv'; a.click() } }
  if($('s-add-person')){ $('s-add-person').onclick=async function(){ var v=$('s-person').value.trim(); if(!v){return} var r=await call('/people',{method:'POST',body:{display_name:v}}); if(!r.ok){toast(r.error,true);return} $('s-person').value=''; await loadState(); renderSettings(); renderParty(); toast('Person added') } }
  if($('s-add-cur')){ $('s-add-cur').onclick=async function(){ var v=$('s-cur').value.trim().toUpperCase(); if(!v){return} var r=await call('/currencies',{method:'POST',body:{code:v,is_default:false}}); if(!r.ok){toast(r.error,true);return} $('s-cur').value=''; await loadState(); renderSettings(); renderParty(); toast('Currency added') } }
  if($('c-copy')){ $('c-copy').onclick=async function(){ try{ await navigator.clipboard.writeText(location.origin+location.pathname); toast('Link copied') }catch(e){ toast('Copy failed — long-press the address bar instead',true) } } }
  window.addEventListener('hashchange',function(){ var h=(location.hash||'#ledger').slice(1); if(['ledger','balances','tools','audit','settings'].indexOf(h)>=0&&$('tab-'+h)){ showTab(h) } });
  var start=(location.hash||'#ledger').slice(1); if(['ledger','balances','tools','audit','settings'].indexOf(start)<0){start='ledger'}
  showTab(start);
  loadState().then(function(ok){ if(ok){ renderParty(); renderQuick() } });
}
function renderParty(){
  var cs=$('t-creditor'), ds=$('t-debtor'), cur=$('t-currency');
  if(!cs||!ds||!cur){return}
  var keepC=cs.value, keepD=ds.value;
  cs.innerHTML=''; ds.innerHTML='';
  for(var i=0;i<people.length;i++){ if(people[i].is_archived){continue}
    var o1=document.createElement('option'); o1.value=people[i].id; o1.textContent=people[i].display_name; cs.appendChild(o1);
    var o2=document.createElement('option'); o2.value=people[i].id; o2.textContent=people[i].display_name; ds.appendChild(o2);
  }
  if(keepC){cs.value=keepC} if(keepD){ds.value=keepD}
  if(cs.options.length>1&&cs.value===ds.value){ ds.value=cs.options[1].value }
  cur.innerHTML='';
  for(var j=0;j<currencies.length;j++){ if(currencies[j].is_archived){continue}
    var o=document.createElement('option'); o.value=currencies[j].code; o.textContent=currencies[j].code; if(currencies[j].is_default){o.selected=true} cur.appendChild(o);
  }
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',init) } else { init() }
`;

const app = async (db: D1Database, workspaceId: number, name: string): Promise<string> => {
  const peopleResult = await db.prepare('SELECT id, display_name, is_archived FROM workspace_people WHERE workspace_id = ? ORDER BY is_archived, id').bind(workspaceId).all<Row>();
  const currencyResult = await db.prepare('SELECT id, code, is_default, is_archived FROM workspace_currencies WHERE workspace_id = ? ORDER BY is_archived, is_default DESC, id').bind(workspaceId).all<Row>();
  const people = peopleResult.results ?? [];
  const currencies = currencyResult.results ?? [];
  const initial = JSON.stringify({ people, currencies });
  const livePeople = people.filter((p) => !p.is_archived);
  const liveCurrencies = currencies.filter((c) => !c.is_archived);
  const personOptions = livePeople.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('');
  const currencyOptions = liveCurrencies.map((c) => `<option value="${esc(c.code)}"${c.is_default ? ' selected' : ''}>${esc(c.code)}</option>`).join('');
  return page(name, `<script>window.__initial=${initial};</script>`, `
<main>
<header>
  <div class="head">
    <div>
      <h1>${esc(name)}</h1>
      <p class="sub">Shared editable ledger · every change is audited</p>
    </div>
    <button id="c-copy" class="mini ghost" type="button">Copy link</button>
  </div>
  <div class="tabs" role="tablist">
    <button id="tab-ledger" role="tab" aria-selected="true" type="button">Ledger</button>
    <button id="tab-balances" role="tab" aria-selected="false" type="button">Balances</button>
    <button id="tab-tools" role="tab" aria-selected="false" type="button">Bulk &amp; import</button>
    <button id="tab-audit" role="tab" aria-selected="false" type="button">Audit</button>
    <button id="tab-settings" role="tab" aria-selected="false" type="button">Setup</button>
  </div>
</header>
<div id="banner" class="err" hidden></div>

<section id="ledger">
  <div class="card">
    <h2>Add transaction</h2>
    <div class="field"><label for="t-kind">Type</label>
      <select id="t-kind">
        <option value="debt">Someone owes — one person paid</option>
        <option value="payment">Repayment — someone paid back</option>
      </select>
    </div>
    <div class="grid three">
      <div class="field"><label for="t-amount">Amount</label><input id="t-amount" type="text" inputmode="decimal" placeholder="12.50" autocomplete="off"></div>
      <div class="field"><label for="t-currency">Currency</label><select id="t-currency">${currencyOptions}</select></div>
      <div class="field"><label for="t-date">Date</label><input id="t-date" type="date"></div>
    </div>
    <div class="grid">
      <div class="field"><label for="t-creditor">Paid by (is owed)</label><select id="t-creditor">${personOptions}</select></div>
      <div class="field"><label for="t-debtor">For (owes)</label><select id="t-debtor">${personOptions}</select></div>
    </div>
    <div class="swap"><button id="t-swap" type="button">↕ Swap people</button></div>
    <div class="grid">
      <div class="field"><label for="t-topic">What for</label><input id="t-topic" placeholder="Dinner" autocomplete="off"></div>
      <div class="field"><label for="t-category">Category</label><input id="t-category" placeholder="Food" autocomplete="off"></div>
    </div>
    <div class="field"><label for="t-notes">Notes (optional)</label><input id="t-notes" autocomplete="off"></div>
    <button id="t-add" type="button">Add transaction</button>
    <div id="t-err" class="err"></div>
  </div>
  <div class="card">
    <h2>Transactions</h2>
    <div id="tx-totals" class="totals"></div>
    <div id="tx-list"><div class="empty">Loading…</div></div>
  </div>
</section>

<section id="balances" hidden>
  <div class="card"><h2>Who owes whom</h2><div id="bal-list"><div class="empty">Loading…</div></div></div>
  <div class="card"><h2>Settle up (offsets)</h2><div id="offset-list"><div class="empty">Loading…</div></div>
    <p class="hint">Offsetting records a repayment pair that clears equal amounts in both directions.</p></div>
</section>

<section id="tools" hidden>
  <div class="card">
    <h2>Quick entry (many at once)</h2>
    <p class="hint">One line per transaction: <b>date | debt or payment | what for | category | paid by | for | amount | currency</b></p>
    <div class="field"><textarea id="q-text" placeholder="2026-10-09 | debt | Dinner | Food | Ada | Lin | 12.50 | USD"></textarea></div>
    <div class="btns">
      <button id="q-preview" class="ghost" type="button">Preview</button>
      <button id="q-commit" type="button" disabled>Add all</button>
    </div>
    <div id="q-err" class="err"></div>
    <div id="q-preview-out"></div>
  </div>
  <div class="card">
    <h2>Import CSV</h2>
    <p class="hint">Header must be: occurred_on, entry_kind, topic, category, creditor, debtor, amount, currency, notes</p>
    <div class="field"><textarea id="csv" placeholder="occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes"></textarea></div>
    <div class="btns">
      <button id="csv-template" class="ghost" type="button">Template</button>
      <button id="csv-preview" class="ghost" type="button">Preview</button>
      <button id="csv-commit" type="button">Import</button>
    </div>
    <div id="csv-result"></div>
  </div>
</section>

<section id="audit" hidden>
  <div class="card"><h2>Audit log</h2><p class="hint">Newest first · before/after snapshots</p><div id="audit-list"><div class="empty">Loading…</div></div></div>
</section>

<section id="settings" hidden>
  <div class="card"><h2>Trip</h2>
    <div class="inline"><div class="field" style="margin:0"><label>Trip name</label><input id="s-name" readonly></div></div>
    <div class="btns"><button class="ghost" type="button" id="s-rename" onclick="(function(){var v=prompt('Trip name',document.getElementById('s-name').value);if(v&&v.trim()){fetch(location.pathname.replace(/\\/+$/,'')+'/api',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:v.trim()})}).then(function(){location.reload()})}})()">Rename trip</button></div>
  </div>
  <div class="card"><h2>People</h2><div id="s-people"></div>
    <div class="inline"><div class="field" style="margin:0"><label>Add person</label><input id="s-person" autocomplete="off"></div><button id="s-add-person" type="button">Add</button></div>
  </div>
  <div class="card"><h2>Currencies</h2><div id="s-currencies"></div>
    <div class="inline"><div class="field" style="margin:0"><label>Add currency (3-letter code)</label><input id="s-cur" maxlength="3" autocomplete="off"></div><button id="s-add-cur" type="button">Add</button></div>
  </div>
</section>
</main>`, APP_SCRIPT);
};

export const appHtml = async (db: D1Database, workspaceId: number, name: string) => app(db, workspaceId, name);
