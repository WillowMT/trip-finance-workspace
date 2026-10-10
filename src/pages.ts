import { KEEP_BACKUPS } from './backups';

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
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px auto 0;max-width:680px;padding:2px 2px 4px}
.tabs button{width:auto;flex:0 1 auto;min-width:0;background:transparent;color:var(--muted);border:1px solid transparent;border-radius:999px;padding:7px 13px;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--card);color:var(--ink);border-color:var(--line);box-shadow:var(--shadow)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin-bottom:12px;box-shadow:var(--shadow)}
label{display:block;font-size:.78rem;color:var(--muted);font-weight:600;margin:0 0 4px}
input,select,textarea,button{font:inherit;color:var(--ink)}
input,select,textarea{width:100%;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:16px}
input[readonly]{background:rgba(127,127,127,.09);color:var(--muted);cursor:not-allowed}
input:focus,select:focus,textarea:focus{outline:2px solid var(--brand);outline-offset:-1px}
textarea{min-height:92px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid > *{min-width:0}
.grid.three{grid-template-columns:1fr 1fr 1fr}
/* a native date control is wider than its share of a three-up row, so give it the full width on phones */
@media(max-width:559px){.grid.three{grid-template-columns:1fr 1fr}.grid.three > .field:last-child{grid-column:1 / -1}}
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
.person-card{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:8px;cursor:pointer;color:inherit;font:inherit}
.person-card:hover{border-color:var(--brand)} .person-card:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.person-card.archived{opacity:.6}
.person-card .avatar{flex:0 0 36px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--chip);color:var(--brand);font-weight:800;font-size:.82rem}
.person-card .p-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.person-card .p-nets{display:flex;flex-wrap:wrap;gap:8px;margin-top:3px}
.person-card .chev{color:var(--muted);font-size:1.3rem;line-height:1;flex:0 0 auto}
.modal{position:fixed;inset:0;background:rgba(9,9,11,.55);display:flex;align-items:flex-end;justify-content:center;z-index:60}
.modal[hidden]{display:none}
.modal .sheet{background:var(--card);width:100%;max-width:640px;max-height:90vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px;border:1px solid var(--line)}
@media(min-width:620px){ .modal{align-items:center;padding:18px} .modal .sheet{border-radius:16px;max-height:86vh} }
.dlg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:-16px;background:var(--card);padding:2px 0 8px;margin:-2px 0 0;border-bottom:1px solid var(--line);z-index:2}
.dlg-head h2{margin:0;font-size:1.05rem}
.pm-nets{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px;font-size:.95rem}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px;margin:10px 0 4px}
.kpi{background:var(--chip);border-radius:12px;padding:10px}
.kpi .k-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;line-height:1.25}
.kpi .k-value{font-size:.98rem;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pair{border-bottom:1px solid var(--line)}
.pair-head{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;background:none;border:0;padding:10px 0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.pair-head .p-open{color:var(--muted);font-size:.78rem;font-weight:700;white-space:nowrap}
.pair-head .who{display:block;font-weight:600;font-size:.92rem}
.pair-head .who .amt{margin-left:6px;font-size:.88rem}
.pair-head .p-open{margin-left:auto;flex:0 0 auto}
.pair-head .meta{display:block;color:var(--muted);font-size:.76rem;margin-top:2px}
.pair-detail{border-left:2px solid var(--line);margin:0 0 10px 3px;padding:2px 0 2px 11px}
.rec{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:5px 0;font-size:.85rem}
.rec .r-main{min-width:0;display:block}
.rec .r-main>span{display:block}
.rec .r-meta{display:block;color:var(--muted);font-size:.75rem;margin-top:1px;line-height:1.3}
.rec .r-amt{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.tag-arch{display:inline-block;background:var(--chip);color:var(--muted);border-radius:999px;padding:1px 7px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-left:6px}
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
#ai-prompt{max-height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:50;background:var(--ink);color:var(--bg);border-radius:999px;padding:10px 16px;font-size:.86rem;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:92vw;text-align:center;transition:opacity .2s;opacity:0;pointer-events:none}
.toast.show{opacity:1}
.toast.bad{background:var(--bad);color:#fff}
.hint{color:var(--muted);font-size:.76rem;margin-top:6px}
.swap{display:flex;justify-content:center;margin:-4px 0 6px}
.swap button{width:auto;background:var(--chip);color:var(--ink);padding:4px 10px;font-size:.78rem;font-weight:600}
.inline{display:flex;gap:8px;align-items:flex-end}
.inline > *{flex:1} .inline button{flex:0 0 auto;width:auto}
.people{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.check{display:flex;align-items:center;gap:8px;margin:0;padding:9px 10px;border:1px solid var(--line);border-radius:10px;font-size:.9rem;font-weight:600;color:var(--ink)}
.check input{width:18px;height:18px;padding:0;flex:0 0 auto;accent-color:var(--brand)}
.check.off{opacity:.5}
.chip.split{color:var(--brand)}
.split-sum{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.split-sum:last-child{border-bottom:0}
.split-sum .who{font-weight:600;font-size:.92rem}
.split-sum .paid{color:var(--muted);font-size:.76rem;margin-top:1px}
.split-sum .share{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.people-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}
.people-actions button{flex:0 0 auto;width:auto}
.people-actions .hint{margin:0}
#split .btns button{white-space:nowrap}
#split .totals{margin:10px 0 0}
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
    var res=await fetch('/api/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,people:people,currencies:codes.map(function(c,i){return {code:c,is_default:i===0}}),timezone:(function(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){return ''}})()})});
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
var people=boot.people||[], currencies=boot.currencies||[], settings=null, me=null, rosterSig='', backups=null;

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

var TABS=(function(){
  var out=[], nodes=null;
  try{ nodes=document.querySelectorAll('.tabs button') }catch(e){ nodes=null }
  if(nodes&&nodes.length){ for(var i=0;i<nodes.length;i++){ var id=nodes[i].id||''; if(id.indexOf('tab-')===0){ out.push(id.slice(4)) } } }
  return out.length?out:['ledger','balances','split','tools','audit','settings'];
})();
function showTab(tab){
  for(var i=0;i<TABS.length;i++){
    var section=$(TABS[i]); if(section){section.hidden=TABS[i]!==tab}
    var btn=$('tab-'+TABS[i]); if(btn){btn.setAttribute('aria-selected',String(TABS[i]===tab))}
  }
  if(location.hash!=='#'+tab){try{history.replaceState(null,'','#'+tab)}catch(e){}}
  if(tab==='ledger'){loadLedger()}
  if(tab==='balances'){loadBalances()}
  if(tab==='split'){renderSplit()}
  if(tab==='audit'){loadAudit()}
  if(tab==='settings'){renderSettings()}
}

function rosterSignature(){
  return people.map(function(p){return p.id+':'+p.display_name+':'+(p.is_archived?1:0)}).join('|')+'/'+currencies.map(function(c){return c.id+':'+c.code+':'+(c.is_archived?1:0)+':'+(c.is_default?1:0)}).join('|')+'/'+((settings&&settings.timezone)||'');
}
function renderSplitPeople(){
  var box=$('sp-people'); if(!box){return}
  var inputs=box.querySelectorAll('input[type=checkbox]'); var chosen={}; var any=false;
  for(var i=0;i<inputs.length;i++){ if(inputs[i].checked){chosen[inputs[i].value]=1;any=true} }
  var html='';
  for(var k=0;k<people.length;k++){ var p=people[k]; if(p.is_archived){continue}
    var on=any?!!chosen[String(p.id)]:true;
    html+='<label class="check"><input type="checkbox" value="'+p.id+'"'+(on?' checked':'')+'><span>'+esc(p.display_name)+'</span></label>';
  }
  box.innerHTML=html;
}
async function syncInstructions(){
  var r=await call('/instructions'); if(!r.ok||!r.data){return}
  var el=$('ai-prompt'); if(el&&typeof r.data.text==='string'&&el.textContent!==r.data.text){ el.textContent=r.data.text }
}
async function loadState(){
  var r=await call('');
  if(!r.ok){ $('banner').textContent=r.error; $('banner').hidden=false; return false }
  me=r.data.workspace; people=r.data.people||[]; currencies=r.data.currencies||[]; settings=r.data.settings||null; backups=r.data.backups||null;
  $('banner').hidden=true;
  if(me&&me.name){document.title=me.name}
  var sig=rosterSignature(); if(sig!==rosterSig){ rosterSig=sig; renderSplitPeople() }
  await syncInstructions();
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
  var doneMsg=rows.length===1?'Transaction added':(rows.length+' transactions added');
  if(r.data&&r.data.netted_pairs){ doneMsg+=' \u00b7 '+r.data.netted_pairs+' reciprocal balance'+(r.data.netted_pairs===1?'':'s')+' netted' }
  toast(doneMsg);
  $('t-amount').value=''; $('t-topic').value=''; $('t-category').value=''; $('t-notes').value='';
  loadLedger(); return true;
}
/* ---------------- balances ---------------- */
async function loadBalances(){
  var box=$('bal-list'); box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var txs=(r.data&&r.data.transactions)||[];
  var credits={}, debits={}, counts={};
  for(var i=0;i<txs.length;i++){var t=txs[i];
    credits[t.creditor_person_id]=credits[t.creditor_person_id]||{}; credits[t.creditor_person_id][t.currency_code]=(credits[t.creditor_person_id][t.currency_code]||0)+t.amount_minor;
    debits[t.debtor_person_id]=debits[t.debtor_person_id]||{}; debits[t.debtor_person_id][t.currency_code]=(debits[t.debtor_person_id][t.currency_code]||0)-t.amount_minor;
    counts[t.creditor_person_id]=(counts[t.creditor_person_id]||0)+1; counts[t.debtor_person_id]=(counts[t.debtor_person_id]||0)+1;
  }
  box.innerHTML='';
  var order=people.slice().sort(function(a,b){ return (a.is_archived?1:0)-(b.is_archived?1:0) || String(a.display_name).localeCompare(String(b.display_name)) });
  if(!order.length){ box.innerHTML='<div class="empty">No people yet — add them in Settings.</div>'; return }
  for(var j=0;j<order.length;j++){ var p=order[j];
    var mineC=credits[p.id]||{}, mineD=debits[p.id]||{}, seen={}, codes=[];
    var ka=Object.keys(mineC), kb=Object.keys(mineD);
    for(var x=0;x<ka.length;x++){ if(!seen[ka[x]]){seen[ka[x]]=1;codes.push(ka[x])} }
    for(var y=0;y<kb.length;y++){ if(!seen[kb[y]]){seen[kb[y]]=1;codes.push(kb[y])} }
    codes.sort();
    var chips='';
    for(var z=0;z<codes.length;z++){ var v=(mineC[codes[z]]||0)+(mineD[codes[z]]||0); if(v===0){continue}
      chips+='<span class="amt '+(v>0?'pos':'neg')+'">'+esc((v>0?'+':'−')+money(Math.abs(v),codes[z]))+'</span>';
    }
    var n=counts[p.id]||0;
    var el=document.createElement('button'); el.type='button';
    el.className='person-card'+(p.is_archived?' archived':''); el.setAttribute('data-person',p.id); el.setAttribute('aria-haspopup','dialog');
    el.innerHTML='<span class="avatar" aria-hidden="true">'+esc(initials(p.display_name))+'</span>'+
      '<span class="p-main"><span class="who">'+esc(p.display_name)+(p.is_archived?' <span class="chip">archived</span>':'')+'</span>'+
      '<span class="meta">'+n+' record'+(n===1?'':'s')+'</span>'+
      '<span class="p-nets">'+(chips||'<span class="meta">nothing outstanding</span>')+'</span></span>'+
      '<span class="chev" aria-hidden="true">›</span>';
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
  toast('Offset recorded'); loadBalances(); if(pmOpenId){ openPerson(pmOpenId) }
}
/* ---------------- person popup ---------------- */
var pmOpenId=null, pmData=null;
function initials(n){ var parts=String(n==null?'':n).trim().split(/\s+/); if(!parts[0]){return '?'} var out=parts[0].slice(0,1); if(parts.length>1){ out=out+parts[parts.length-1].slice(0,1) } return out.toUpperCase() }
function signedMoney(v,code){ if(!v){return '—'} return (v>0?'+':'−')+money(Math.abs(v),code) }
function kpi(label,value){ return '<div class="kpi"><div class="k-label">'+esc(label)+'</div><div class="k-value">'+esc(value)+'</div></div>' }
function recRow(t){
  var dir=t.direction, label=dir==='paid_for'?'fronted for '+t.counterparty:dir==='covered_for_them'?t.counterparty+' covered for them':dir==='settled_out'?'paid '+t.counterparty:'received from '+t.counterparty;
  var cls=dir==='paid_for'?'pos':(dir==='covered_for_them'?'neg':'');
  return '<div class="rec"><span class="r-main"><span>'+esc(t.topic)+'</span>'+((t.is_deleted===1)?'<span class="tag-arch">archived</span>':'')+
    '<span class="r-meta">'+esc(t.occurred_on)+' · '+esc(t.entry_kind)+(t.category?' · '+esc(t.category):'')+' · '+esc(label)+'</span></span>'+
    '<span class="r-amt '+cls+'">'+esc(money(Math.abs(t.amount_minor),t.currency_code))+'</span></div>';
}
function pairRecords(id){ var out=[], recs=(pmData&&pmData.recent)||[]; for(var i=0;i<recs.length;i++){ if(recs[i].counterparty_id===id){ out.push(recs[i]) } } return out }
function togglePair(key){
  var el=$('pm-pair-'+key); if(!el){return}
  el.hidden=!el.hidden;
  var head=document.querySelector('[data-pair="'+key+'"]');
  if(head){ head.setAttribute('aria-expanded',String(!el.hidden)); var tag=head.querySelector('.p-open'); if(tag){ tag.textContent=el.hidden?'View records':'Hide records' } }
}
async function openPerson(id){
  var modal=$('person-modal'); if(!modal){return}
  pmOpenId=Number(id); pmData=null; modal.hidden=false; document.body.style.overflow='hidden';
  var body=$('pm-body'); body.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/people/'+pmOpenId+'/summary');
  if(!r.ok){ body.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  pmData=r.data; renderPerson();
  var closer=$('pm-close'); if(closer){ try{closer.focus()}catch(e){} }
}
function closePerson(){
  var modal=$('person-modal'); if(!modal||modal.hidden){return}
  modal.hidden=true; document.body.style.overflow='';
  var id=pmOpenId; pmOpenId=null; pmData=null;
  var card=document.querySelector('[data-person="'+id+'"]'); if(card){ try{card.focus()}catch(e){} }
}
function renderPerson(){
  var d=pmData||{}, p=d.person||{}, body=$('pm-body'), title=$('pm-title');
  if(title){ title.textContent=(p.display_name||'Person')+(p.is_archived?' (archived)':'') }
  var totals=d.totals||[], records=d.records||{}, html='';
  var chips='';
  for(var i=0;i<totals.length;i++){ var t0=totals[i];
    chips+='<span class="amt '+(t0.net_minor>0?'pos':(t0.net_minor<0?'neg':''))+'">'+esc(signedMoney(t0.net_minor,t0.currency_code))+
      (t0.net_minor>0?' owed to them':(t0.net_minor<0?' they owe':''))+'</span>';
  }
  html+='<div class="pm-nets">'+(chips||'<span class="empty">Nothing outstanding — settled up.</span>')+'</div>';
  html+='<p class="meta">'+(records.active||0)+' active record'+((records.active===1)?'':'s')+((records.archived||0)?' · '+records.archived+' archived':'')+'</p>';
  for(var c=0;c<totals.length;c++){ var t=totals[c];
    html+='<h3 style="margin-top:14px">'+esc(t.currency_code)+'</h3><div class="kpi-grid">'+
      kpi('Fronted for others',money(t.paid_for_minor,t.currency_code))+
      kpi('Covered for them',money(t.covered_for_them_minor,t.currency_code))+
      kpi('Net position',signedMoney(t.net_minor,t.currency_code))+
      kpi('Settled out / in',money(t.settled_out_minor,t.currency_code)+' / '+money(t.settled_in_minor,t.currency_code))+
      '</div>';
  }
  var pairs=d.counterparties||[];
  html+='<h3 style="margin-top:16px">Balances by person</h3>';
  if(!pairs.length){ html+='<div class="empty">No counterparties yet.</div>' }
  for(var q=0;q<pairs.length;q++){ var pr=pairs[q]; var key=pr.currency_code+'-'+pr.counterparty_id; var recs=pairRecords(pr.counterparty_id);
    var settled=(pr.settled_out_minor||0)+(pr.settled_in_minor||0);
    html+='<div class="pair"><button class="pair-head" type="button" data-pair="'+esc(key)+'" aria-expanded="false">'+
      '<span class="p-main"><span class="who">'+esc(pr.counterparty)+' <span class="amt '+(pr.net_minor>0?'pos':(pr.net_minor<0?'neg':''))+'">'+esc(signedMoney(pr.net_minor,pr.currency_code))+'</span></span>'+
      '<span class="meta">'+esc(pr.currency_code)+' · '+pr.records+' active record'+(pr.records===1?'':'s')+(pr.archived_records?' · '+pr.archived_records+' archived':'')+' · fronted '+esc(money(pr.paid_for_minor,pr.currency_code))+' · covered '+esc(money(pr.covered_minor,pr.currency_code))+(settled?' · settled '+esc(money(settled,pr.currency_code)):'')+'</span></span>'+
      '<span class="p-open">View records</span></button>'+
      '<div class="pair-detail" id="pm-pair-'+esc(key)+'" hidden>'+(recs.length?recs.map(recRow).join(''):'<div class="empty">No records in the latest window.</div>')+'</div></div>';
  }
  var recs2=d.recent||[];
  html+='<h3 style="margin-top:16px">Recent activity</h3>'+(recs2.length?recs2.map(recRow).join(''):'<div class="empty">No records yet.</div>');
  if((records.total||0)>recs2.length){ html+='<p class="hint">Showing the latest '+recs2.length+' of '+records.total+' records.</p>' }
  var sug=d.suggestions||[];
  if(sug.length){ html+='<h3 style="margin-top:16px">Settle up</h3>';
    for(var s=0;s<sug.length;s++){ var g=sug[s];
      html+='<div class="row"><div><div class="who">'+esc(g.counterparty)+' ↔ '+esc(p.display_name||'')+'</div><div class="meta">offsettable '+esc(money(g.offset_amount_minor,g.currency_code))+'</div></div>'+
        '<button class="mini" type="button" data-off="'+p.id+':'+g.counterparty_id+':'+esc(g.currency_code)+'">Offset</button></div>';
    }
  }
  body.innerHTML=html;
}

/* ---------------- tools: receipt instructions + import ---------------- */
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
function auditSnapshot(value){
  if(value===null||value===undefined) return null;
  if(typeof value==='object') return value;
  try{ return JSON.parse(value) }catch(_){ return null }
}
function auditQuery(){
  var qs=[];
  var en=$('au-entity'), ac=$('au-action'), q=$('au-q');
  if(en&&en.value) qs.push('entity='+encodeURIComponent(en.value));
  if(ac&&ac.value) qs.push('action='+encodeURIComponent(ac.value));
  if(q&&q.value.trim()) qs.push('q='+encodeURIComponent(q.value.trim()));
  return qs.length?('?'+qs.join('&')):'';
}
function auditSummaryText(e){
  var snap=auditSnapshot(e.after_json)||auditSnapshot(e.before_json)||{};
  var bits=[];
  if(e.entity_type==='transaction'){
    if(snap.topic) bits.push(snap.topic);
    if(snap.amount_minor!==null&&snap.amount_minor!==undefined) bits.push((snap.currency_code||'')+' '+(Number(snap.amount_minor)/100).toFixed(2));
    if(snap.entry_kind) bits.push(snap.entry_kind);
  } else if(snap.display_name) bits.push(snap.display_name);
  else if(snap.name) bits.push(snap.name);
  else if(snap.code) bits.push(snap.code);
  var verb={create:'Created',update:'Updated',archive:'Archived',restore:'Restored',delete:'Deleted'}[e.action]||e.action;
  return verb+(bits.length?(' · '+bits.join(' · ')):'');
}
async function loadAudit(){
  var box=$('audit-list'); box.innerHTML='<div class="empty">Loading…</div>';
  var summary=$('au-summary'); if(summary){ summary.textContent='' }
  var r=await call('/audit'+auditQuery());
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var data=(r.data&&r.data)||{}, rows=data.audit||[];
  if(summary){
    var filtered=(auditQuery()!=='');
    summary.textContent='Showing '+rows.length+' of '+((data.total||0))+' entries'+
      (filtered?(' · '+((data.matched||0))+' match your filters'):'')+
      (data.truncated?' · narrow the filters to see the rest':'');
  }
  box.innerHTML='';
  if(!rows.length){ box.innerHTML='<div class="empty">No audit entries match these filters.</div>'; return }
  for(var i=0;i<rows.length;i++){var e=rows[i];
    var d=document.createElement('details');
    var when=String(e.occurred_at||'').slice(0,19).replace('T',' ');
    d.innerHTML='<summary>'+esc(auditSummaryText(e))+' · '+esc(e.entity_type)+' #'+esc(e.entity_id)+' <span class="chip">'+esc(when)+'</span></summary>'+
      '<pre>'+esc(JSON.stringify({before:e.before_json,after:e.after_json},null,1))+'</pre>';
    box.appendChild(d);
  }
}
/* ---------------- settings ---------------- */
function bytesLabel(n){
  if(!(n>=0)){return ''}
  if(n<1024){return n+' B'}
  if(n<1048576){return (n/1024).toFixed(1)+' KB'}
  return (n/1048576).toFixed(1)+' MB'
}
function stamp(value){
  if(!value){return 'unknown time'}
  var date=new Date(value); if(isNaN(date.getTime())){return String(value)}
  return date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
}

function renderBackups(){
  var box=$('s-backup-status'); if(!box){return}
  var status=(backups&&backups.status)||null, entries=(backups&&backups.entries)||[];
  box.innerHTML='';
  if(backups&&!backups.configured){ box.innerHTML='<span class="err">Backup storage is not configured on this deployment.</span>' }
  else if(status){
    box.innerHTML='Automatic backups run every <b>'+status.every+'</b> transactions · '+status.rows_since_backup+' written since the last one'+
      (status.due_in>0?(' · next in '+status.due_in):' · due now')+
      (status.rows_total?(' · '+status.rows_total+' transactions in total'):'')+
      (status.state&&status.state.last_backup_at?('<br>Last backup: '+stamp(status.state.last_backup_at)+' ('+(status.state.last_backup_rows||0)+' transactions, '+bytesLabel(status.state.last_backup_bytes)+')'):'<br>No backup has been written yet.')+
      (status.state&&status.state.last_error?('<br><span class="err">'+esc(status.state.last_error)+'</span>'):'');
  }
  if($('s-backup-every')){ $('s-backup-every').value=String((status&&status.every)||(settings&&settings.backup_every)||100) }
  var list=$('s-backup-list'); if(!list){return}
  list.innerHTML='';
  if(!entries.length){ list.innerHTML='<div class="empty">No snapshots yet.</div>'; return }
  for(var i=0;i<entries.length;i++){var e=entries[i];
    var row=document.createElement('div'); row.className='row';
    row.innerHTML='<div><div class="who">Backup #'+e.sequence+' · '+e.rows+' transactions <span class="chip">'+(e.trigger==='manual'?'manual':'automatic')+'</span></div>'+
      '<div class="meta">'+stamp(e.created_at)+' · '+bytesLabel(e.bytes)+'</div></div>'+
      '<div class="btns" style="margin:0"><a class="mini ghost" style="text-decoration:none" href="'+api+'/backups/'+e.sequence+'" download>Download</a>'+
      '<button class="mini ghost" type="button" data-restore="'+e.sequence+'">Restore</button></div>';
    list.appendChild(row);
  }
}
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
  if($('s-auto-offset')){ $('s-auto-offset').checked=!((settings&&settings.auto_offset)===0) }
  renderBackups();
}
/* ---------------- split an expense ---------------- */
function splitBoxes(){
  var el=$('sp-people'); if(!el){return []}
  var found=[], list=null;
  try{ list=(el.querySelectorAll?el.querySelectorAll('input[type=checkbox]'):null) }catch(e){ list=null }
  if(list&&list.length){ for(var i=0;i<list.length;i++){ found.push(list[i]) } return found }
  var kids=el.children||[];
  for(var j=0;j<kids.length;j++){ var inp=(kids[j].querySelector?kids[j].querySelector('input'):null); if(inp){ found.push(inp) } }
  return found;
}
function splitPicked(){
  var out=[], bs=splitBoxes();
  for(var i=0;i<bs.length;i++){ if(bs[i].checked){ out.push(Number(bs[i].value)) } }
  return out;
}
/* Mirrors the server's allocation exactly: floor the share, then hand the leftover
   minor units to the lowest ids one each. Anything else would let the preview lie. */
function allocate(total,ids){
  var sorted=ids.slice().sort(function(a,b){return a-b});
  var base=Math.floor(total/sorted.length), rem=total%sorted.length, out=[];
  for(var i=0;i<sorted.length;i++){ out.push({person_id:sorted[i],amount_minor:base+(i<rem?1:0)}) }
  return out;
}
function splitDraft(){
  return {
    occurred_on:($('sp-date')||{}).value,
    payer_person_id:Number(($('sp-payer')||{}).value),
    participant_person_ids:splitPicked(),
    amount_minor:toMinor($('sp-amount')?$('sp-amount').value:''),
    topic:($('sp-topic')||{}).value.trim(),
    category:($('sp-category')||{}).value.trim(),
    currency_code:($('sp-currency')||{}).value,
    notes:null
  };
}
function splitProblem(d){
  if(!d.topic){return 'Say what the expense was for.'}
  if(!d.category){return 'Add a category.'}
  if(!d.occurred_on){return 'Pick a date.'}
  if(!d.participant_person_ids.length){return 'Tick who is sharing this expense.'}
  var others=d.participant_person_ids.filter(function(id){return id!==d.payer_person_id});
  if(!others.length){return 'Tick at least one person besides whoever paid — the payer cannot owe themselves.'}
  if(!d.amount_minor){return 'Enter a total amount above zero.'}
  return '';
}
function renderSplit(){
  var count=$('sp-count'), box=$('sp-people');
  if(box&&box.children){ for(var i=0;i<box.children.length;i++){
    var row=box.children[i], inp=(row.querySelector?row.querySelector('input'):null);
    if(inp&&row.classList&&row.classList.toggle){ row.classList.toggle('off',!inp.checked) }
  } }
  var d=splitDraft();
  if(count){ count.textContent=splitPicked().length+' sharing' }
  var out=$('sp-out'); if(!out){return}
  if(!d.amount_minor||!d.participant_person_ids.length){ out.innerHTML='<div class="empty">Enter an amount and tick who is sharing to see each share.</div>'; return }
  var alloc=allocate(d.amount_minor,d.participant_person_ids), owed=0, rows='';
  for(var j=0;j<alloc.length;j++){
    var a=alloc[j], payer=a.person_id===d.payer_person_id;
    if(!payer){ owed+=a.amount_minor }
    rows+='<div class="split-sum"><div><div class="who">'+esc(name(a.person_id))+'</div><div class="paid">'+(payer?'paid — owes nothing':'owes '+esc(name(d.payer_person_id)))+'</div></div>'+
      '<div class="share">'+esc(money(a.amount_minor,d.currency_code))+'</div></div>';
  }
  out.innerHTML='<div class="totals" style="margin:10px 0 0"><div class="total"><span>Bill</span><b>'+esc(money(d.amount_minor,d.currency_code))+'</b></div>'+
    '<div class="total"><span>New debts</span><b>'+esc(money(owed,d.currency_code))+'</b></div></div>'+rows;
}
async function previewSplit(){
  var btn=$('sp-preview'), err=$('sp-err'), out=$('sp-out');
  err.textContent='';
  var d=splitDraft(), problem=splitProblem(d);
  if(problem){ err.textContent=problem; return }
  busy(btn,true);
  var r=await call('/splits/preview',{method:'POST',body:d});
  busy(btn,false);
  if(!r.ok){ err.textContent=r.error; return }
  var data=r.data||{}, alloc=data.participant_allocations||[], txs=data.transactions||[];
  var rows='';
  for(var i=0;i<alloc.length;i++){ var a=alloc[i];
    rows+='<div class="split-sum"><div><div class="who">'+esc(name(a.person_id))+'</div><div class="paid">'+(a.person_id===d.payer_person_id?'paid — owes nothing':'owes '+esc(name(d.payer_person_id)))+'</div></div>'+
      '<div class="share">'+esc(money(a.amount_minor,d.currency_code))+'</div></div>';
  }
  out.innerHTML='<div class="hint">Checked against the server: '+txs.length+' debt(s) totalling '+esc(money(data.debt_amount_minor,d.currency_code))+'.</div>'+rows;
}
async function commitSplit(){
  var btn=$('sp-commit'), err=$('sp-err'); err.textContent='';
  var d=splitDraft(), problem=splitProblem(d);
  if(problem){ err.textContent=problem; toast(problem,true); return }
  busy(btn,true);
  var r=await call('/splits',{method:'POST',headers:{'idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},body:d});
  busy(btn,false);
  if(!r.ok){ err.textContent=r.error; toast(r.error,true); return }
  var txs=(r.data&&r.data.transactions)||[], owed=(r.data&&r.data.debt_amount_minor)||0;
  toast(txs.length+(txs.length===1?' debt':' debts')+' added');
  $('sp-amount').value=''; $('sp-topic').value=''; $('sp-category').value='';
  renderSplit();
  var out=$('sp-out');
  if(out){ out.innerHTML='<div class="hint">Split added: '+txs.length+' debt(s) totalling '+esc(money(owed,d.currency_code))+', now in the ledger.</div>'+
    txs.map(function(t){return '<div class="split-sum"><div><div class="who">'+esc(name(t.debtor_person_id))+' owes '+esc(name(t.creditor_person_id))+'</div><div class="paid">'+esc(t.topic)+' · '+esc(t.occurred_on)+'</div></div><div class="share">'+esc(money(t.amount_minor,t.currency_code))+'</div></div>'}).join('') }
  loadLedger();
}
/* ---------------- wiring ---------------- */
document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'){ closePerson() } });
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
  if(ev.target.id==='person-modal'){ closePerson(); return }
  var pclose=ev.target.closest?ev.target.closest('#pm-close'):null; if(pclose){ closePerson(); return }
  var pcard=ev.target.closest?ev.target.closest('[data-person]'):null; if(pcard){ openPerson(Number(pcard.getAttribute('data-person'))); return }
  var pairHead=ev.target.closest?ev.target.closest('[data-pair]'):null; if(pairHead){ togglePair(pairHead.getAttribute('data-pair')); return }
  var carch=t.getAttribute('data-carch'); if(carch){ var cp=carch.split(':'); var cr=await call('/currencies/'+cp[0]+'/'+cp[1],{method:'POST'}); if(!cr.ok){toast(cr.error,true)}else{await loadState();renderSettings();toast('Updated')} return }
});
function init(){
  window.onerror=function(msg){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+msg; b.hidden=false} return false };
  window.addEventListener('unhandledrejection',function(ev){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+(ev.reason&&ev.reason.message?ev.reason.message:ev.reason); b.hidden=false} });
  TABS.forEach(function(tab){ var b=$('tab-'+tab); if(b){ b.onclick=function(e){ if(e&&e.preventDefault){e.preventDefault()} showTab(tab) } } });
  if($('t-add')){ $('t-add').onclick=addTx }
  if($('au-apply')){ $('au-apply').onclick=function(){ loadAudit() } }
  if($('au-clear')){ $('au-clear').onclick=function(){ if($('au-entity')){$('au-entity').value=''} if($('au-action')){$('au-action').value=''} if($('au-q')){$('au-q').value=''} loadAudit() } }
  if($('au-entity')){ $('au-entity').onchange=function(){ loadAudit() } }
  if($('au-action')){ $('au-action').onchange=function(){ loadAudit() } }
  if($('au-q')){ $('au-q').onkeydown=function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); loadAudit() } } }
  if($('s-save-auto-offset')){ $('s-save-auto-offset').onclick=async function(){ var on=$('s-auto-offset')?!!$('s-auto-offset').checked:true; var r=await call('',{method:'PATCH',body:{settings:{auto_offset:on}}}); if(!r.ok){ toast(r.error||'Could not save netting',true); return } toast('Automatic netting '+(on?'on':'off')); location.reload() } }
  if($('s-save-tz')){ $('s-save-tz').onclick=async function(){ var e=$('s-tz-err'); if(e){e.textContent=''}; var v=$('s-tz')?$('s-tz').value:''; if(!v){ if(e){e.textContent='Pick a zone.'} return } var r=await call('',{method:'PATCH',body:{settings:{timezone:v}}}); if(!r.ok){ var m=r.error||'Could not save the time zone.'; if(e){e.textContent=m} toast(m,true); return } toast('Time zone saved'); location.reload() } }
  if($('sp-people')){ $('sp-people').addEventListener('change',function(){ renderSplit() }) }
  if($('sp-all')){ $('sp-all').onclick=function(){ var bs=splitBoxes(); for(var i=0;i<bs.length;i++){bs[i].checked=true} renderSplit() } }
  if($('sp-none')){ $('sp-none').onclick=function(){ var bs=splitBoxes(); for(var i=0;i<bs.length;i++){bs[i].checked=false} renderSplit() } }
  if($('sp-payer')){ $('sp-payer').onchange=function(){ var pid=Number(this.value), bs=splitBoxes(); for(var i=0;i<bs.length;i++){ if(Number(bs[i].value)===pid){bs[i].checked=true} } renderSplit() } }
  if($('sp-amount')){ $('sp-amount').oninput=renderSplit }
  if($('sp-topic')){ $('sp-topic').oninput=renderSplit }
  if($('sp-currency')){ $('sp-currency').onchange=renderSplit }
  if($('sp-preview')){ $('sp-preview').onclick=previewSplit }
  if($('sp-commit')){ $('sp-commit').onclick=commitSplit }
  if($('t-swap')){ $('t-swap').onclick=function(){ var a=$('t-creditor'),b=$('t-debtor'); var tmp=a.value; a.value=b.value; b.value=tmp } }
  if($('ai-copy')){ $('ai-copy').onclick=async function(){ var txt=$('ai-prompt').textContent; try{ await navigator.clipboard.writeText(txt); toast('Instructions copied') }catch(e){ try{ var range=document.createRange(); range.selectNodeContents($('ai-prompt')); var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); toast('Press Ctrl/Cmd+C to copy') }catch(e2){ toast('Copy failed - select the instructions and copy them',true) } } } }
  if($('csv-preview')){ $('csv-preview').onclick=previewImport }
  if($('csv-commit')){ $('csv-commit').onclick=commitImport; $('csv-commit').disabled=true }
  if($('csv-template')){ $('csv-template').onclick=function(){ var head='occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes\\n'; var sample=today()+',debt,Dinner,Food,'+(people[0]?people[0].display_name:'Ada')+','+(people[1]?people[1].display_name:'Lin')+',12.50,'+((currencies[0]&&currencies[0].code)||'USD')+',\\n'; var url='data:text/csv;charset=utf-8,'+encodeURIComponent(head+sample); var a=document.createElement('a'); a.href=url; a.download='transactions-template.csv'; a.click() } }
  if($('s-save-backup-every')){ $('s-save-backup-every').onclick=async function(){ var every=Number($('s-backup-every').value); if(!isFinite(every)||Math.round(every)!==every||every<5||every>10000){ toast('Back up every 5 to 10000 transactions',true); return } var r=await call('',{method:'PATCH',body:{settings:{backup_every:every}}}); if(!r.ok){ toast(r.error||'Could not save the backup interval',true); return } await loadState(); renderSettings(); toast('Backups will run every '+every+' transactions') } }
  if($('s-backup-now')){ $('s-backup-now').onclick=async function(){ var btn=$('s-backup-now'); btn.disabled=true; var r=await call('/backups',{method:'POST'}); btn.disabled=false; if(!r.ok){ toast(r.error||'Could not write a backup',true); return } await loadState(); renderSettings(); toast('Backup #'+r.data.backup.sequence+' written ('+r.data.backup.rows+' transactions)') } }
  if($('s-backup-list')){ $('s-backup-list').onclick=async function(ev){ var t=ev.target; var seq=t&&t.getAttribute?t.getAttribute('data-restore'):null; if(!seq){return} if(!confirm('Restore backup #'+seq+' into a new workspace? This workspace is left untouched.')){return} t.disabled=true; var r=await call('/backups/'+seq+'/restore',{method:'POST'}); t.disabled=false; var out=$('s-restore-out'); if(!r.ok){ toast(r.error||'Could not restore this backup',true); return } var link=location.origin+r.data.workspace_url; out.innerHTML='Restored into a new workspace: <b>'+r.data.restored.transactions+'</b> transactions, '+r.data.restored.people+' people'+(r.data.restored.skipped_transactions?(' · '+r.data.restored.skipped_transactions+' rows skipped'):'')+'.<br>Open or share: <a href="'+r.data.workspace_url+'">'+esc(link)+'</a>'; toast('Restored into a new workspace') } }
  if($('s-add-person')){ $('s-add-person').onclick=async function(){ var v=$('s-person').value.trim(); if(!v){return} var r=await call('/people',{method:'POST',body:{display_name:v}}); if(!r.ok){toast(r.error,true);return} $('s-person').value=''; await loadState(); renderSettings(); renderParty(); toast('Person added') } }
  if($('s-add-cur')){ $('s-add-cur').onclick=async function(){ var v=$('s-cur').value.trim().toUpperCase(); if(!v){return} var r=await call('/currencies',{method:'POST',body:{code:v,is_default:false}}); if(!r.ok){toast(r.error,true);return} $('s-cur').value=''; await loadState(); renderSettings(); renderParty(); toast('Currency added') } }
  if($('c-copy')){ $('c-copy').onclick=async function(){ try{ await navigator.clipboard.writeText(location.origin+location.pathname); toast('Link copied') }catch(e){ toast('Copy failed — long-press the address bar instead',true) } } }
  window.addEventListener('hashchange',function(){ var h=(location.hash||'#ledger').slice(1); if(TABS.indexOf(h)>=0&&$('tab-'+h)){ showTab(h) } });
  var start=(location.hash||'#ledger').slice(1); if(TABS.indexOf(start)<0){start='ledger'}
  showTab(start);
  loadState().then(function(ok){ if(ok){ renderParty(); renderSplit() } });
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

export const aiInstructions = (options: { names: string[]; codes: string[]; defaultCode: string; tz: string; today: string }): string => {
  const { names, codes, defaultCode, tz, today } = options;
  const aiNames = names.join(', ');
  const aiCodes = codes;
  const aiDefault = defaultCode;
  const todayServer = today;
  const first = names[0] ?? 'Ada';
  const second = names[1] ?? 'Lin';
  return `You convert trip receipts into CSV rows for a shared expense ledger.

Reply with CSV only - no explanation, no code fences, no markdown.

First line must be exactly this header:
occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes

What each column means
- occurred_on: the date as YYYY-MM-DD. Use the date on the receipt; if there is none, use ${todayServer} (today in ${tz}).
- entry_kind: "debt" when someone owes money for something paid on their behalf; "payment" when someone is paying money back.
- topic: what the money was for, short (max 200 characters).
- category: one short label (max 80 characters), for example Food, Transport, Lodging, Activities, Shopping, Other.
- creditor: the person who PAID and is owed. Use exactly one of: ${aiNames}
- debtor: the person who OWES. Use exactly one of those same names, and never the same person as the creditor.
- amount: a positive number in major units, up to 2 decimals - write 12.50, never 1250, with no currency symbol and no thousands separator.
- currency: one of: ${aiCodes.join(', ')}. Use ${aiDefault} unless the receipt is clearly in another listed currency.
- notes: optional; keep item detail here (max 4000 characters).

Rules
- One row per person who owes. For a bill paid by one person and shared equally, write one row per other sharer, with their own share, the same date and the same topic.
- Never invent people: only use the names listed above, spelled exactly that way.
- No totals, no subtotals, no blank lines, and do not merge several people into one row.
- Quote any field that contains a comma.

Example
occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes
2026-10-10,debt,Night market dinner,Food,${first},${second},40.00,${aiDefault},pad thai and drinks`;
};

export const DEFAULT_TIME_ZONE = 'Asia/Bangkok';
export const ZONES = ['Asia/Bangkok','Asia/Yangon','Asia/Singapore','Asia/Kuala_Lumpur','Asia/Ho_Chi_Minh','Asia/Kolkata','Asia/Tokyo','Asia/Shanghai','Asia/Dubai','Europe/London','Europe/Berlin','America/New_York','America/Los_Angeles','Australia/Sydney','Pacific/Auckland','UTC'];
export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}
export const zonedParts = (tz: string): { date: string; clock: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, clock: `${get('hour')}:${get('minute')}` };
};

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
  const personChecks = livePeople.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" checked><span>${esc(p.display_name)}</span></label>`).join('');
  const settingsRow = await db.prepare('SELECT timezone FROM workspace_settings WHERE workspace_id = ?').bind(workspaceId).first<{ timezone: string }>();
  const tz = settingsRow?.timezone && isValidTimeZone(settingsRow.timezone) ? settingsRow.timezone : DEFAULT_TIME_ZONE;
  const { date: dateToday, clock: clockNow } = zonedParts(tz);
  const tzOptions = ZONES.map((zone) => `<option value="${zone}"${zone === tz ? ' selected' : ''}>${zone}</option>`).join('');
  const todayServer = dateToday;
  const aiCodes = liveCurrencies.map((c) => c.code);
  const aiDefault = (liveCurrencies.find((c) => c.is_default) ?? liveCurrencies[0])?.code ?? 'USD';
  const aiPrompt = aiInstructions({ names: livePeople.map((p) => p.display_name), codes: aiCodes, defaultCode: aiDefault, tz, today: todayServer });
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
    <button id="tab-ledger" role="tab" aria-selected="true" type="button"><span aria-hidden="true">📒</span> Ledger</button>
    <button id="tab-split" role="tab" aria-selected="false" type="button"><span aria-hidden="true">✂️</span> Split</button>
    <button id="tab-balances" role="tab" aria-selected="false" type="button"><span aria-hidden="true">⚖️</span> Balances</button>
    <button id="tab-tools" role="tab" aria-selected="false" type="button"><span aria-hidden="true">📥</span> Bulk &amp; import</button>
    <button id="tab-audit" role="tab" aria-selected="false" type="button"><span aria-hidden="true">🕐</span> Audit</button>
    <button id="tab-settings" role="tab" aria-selected="false" type="button"><span aria-hidden="true">⚙️</span> Setup</button>
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
      <div class="field"><label for="t-date">Date</label><input id="t-date" type="text" value="${dateToday}" readonly aria-readonly="true"><div class="hint">Today in ${esc(tz)} &middot; ${esc(clockNow)}</div></div>
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

<section id="split" hidden>
  <div class="card">
    <h2>Split an expense</h2>
    <p class="hint">One person pays the bill. Everyone ticked shares it equally: each other person's share is recorded as a debt to whoever paid.</p>
    <div class="grid">
      <div class="field"><label for="sp-topic">What for</label><input id="sp-topic" placeholder="Dinner" autocomplete="off"></div>
      <div class="field"><label for="sp-category">Category</label><input id="sp-category" placeholder="Food" autocomplete="off"></div>
    </div>
    <div class="grid three">
      <div class="field"><label for="sp-amount">Total amount</label><input id="sp-amount" type="text" inputmode="decimal" placeholder="120.00" autocomplete="off"></div>
      <div class="field"><label for="sp-currency">Currency</label><select id="sp-currency">${currencyOptions}</select></div>
      <div class="field"><label for="sp-date">Date</label><input id="sp-date" type="text" value="${dateToday}" readonly aria-readonly="true"><div class="hint">Today in ${esc(tz)} &middot; ${esc(clockNow)}</div></div>
    </div>
    <div class="field"><label for="sp-payer">Paid by</label><select id="sp-payer">${personOptions}</select></div>
    <div class="field">
      <label id="sp-people-label">Split between</label>
      <div class="people-actions">
        <button id="sp-all" class="mini ghost" type="button">Everyone</button>
        <button id="sp-none" class="mini ghost" type="button">Nobody</button>
        <span id="sp-count" class="hint"></span>
      </div>
      <div class="people" id="sp-people" role="group" aria-labelledby="sp-people-label">${personChecks}</div>
    </div>
    <div class="btns">
      <button id="sp-preview" class="ghost" type="button">Preview shares</button>
      <button id="sp-commit" type="button">Add split</button>
    </div>
    <div id="sp-err" class="err"></div>
    <div id="sp-out"></div>
  </div>
</section>

<section id="balances" hidden>
  <div class="card"><h2>People</h2><p class="hint">Tap a person for their full picture — what they fronted, what was covered for them, who they owe or are owed by, and every record behind it.</p><div id="bal-list"><div class="empty">Loading…</div></div></div>
  <div class="card"><h2>Settle up (offsets)</h2><p class="hint">Reciprocal balances are netted automatically as soon as an entry creates them. Anything listed here is what is still left to offset by hand.</p><div id="offset-list"><div class="empty">Loading…</div></div>
    <p class="hint">Offsetting records a repayment pair that clears equal amounts in both directions.</p></div>
</section>

<section id="tools" hidden>
  <div class="card">
    <h2>Turn a receipt into a CSV</h2>
    <p class="hint">Copy these instructions into ChatGPT, Claude or Gemini as the system message, then send the receipt text or photo with it. Paste the CSV it replies with into the box below.</p>
    <div class="field"><pre id="ai-prompt">${esc(aiPrompt)}</pre></div>
    <div class="btns">
      <button id="ai-copy" type="button">Copy instructions</button>
    </div>
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
  <div class="card"><h2>Audit log</h2>
    <p class="hint">Newest first · before/after snapshots · nothing is ever erased, only archived — filter for "Archived or deleted" to find removed entries.</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:10px 0">
      <label class="hint" style="display:flex;flex-direction:column;gap:4px">Entity
        <select id="au-entity" style="min-width:150px">
          <option value="">All entities</option>
          <option value="transaction">Transactions</option>
          <option value="person">People</option>
          <option value="currency">Currencies</option>
          <option value="workspace_settings">Settings</option>
          <option value="workspace">Workspace</option>
        </select>
      </label>
      <label class="hint" style="display:flex;flex-direction:column;gap:4px">Action
        <select id="au-action" style="min-width:170px">
          <option value="">All actions</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="archive">Archived</option>
          <option value="restore">Restored</option>
          <option value="delete">Deleted</option>
          <option value="archive,delete">Archived or deleted</option>
        </select>
      </label>
      <label class="hint" style="display:flex;flex-direction:column;gap:4px">Search
        <input id="au-q" type="search" placeholder="topic, person, notes…" style="min-width:210px">
      </label>
      <div class="btns" style="margin:0"><button id="au-apply" type="button">Apply</button><button id="au-clear" class="ghost" type="button">Clear</button></div>
    </div>
    <div id="au-summary" class="hint"></div>
    <div id="audit-list"><div class="empty">Loading…</div></div>
  </div>
</section>

<section id="settings" hidden>
  <div class="card"><h2>Trip</h2>
    <div class="inline"><div class="field" style="margin:0"><label>Trip name</label><input id="s-name" readonly></div></div>
    <div class="btns"><button class="ghost" type="button" id="s-rename" onclick="(function(){var v=prompt('Trip name',document.getElementById('s-name').value);if(v&&v.trim()){fetch(location.pathname.replace(/\\/+$/,'')+'/api',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:v.trim()})}).then(function(){location.reload()})}})()">Rename trip</button></div>
  </div>
  <div class="card"><h2>Time zone</h2>
    <p class="hint">Transactions are dated in this zone. The date fields are read-only and always show today's date here.</p>
    <div class="inline"><div class="field" style="margin:0"><label for="s-tz">Zone</label><select id="s-tz">${tzOptions}</select></div><button id="s-save-tz" type="button">Save</button></div>
    <div id="s-tz-err" class="err"></div>
  </div>
  <div class="card"><h2>Automatic netting</h2>
    <p class="hint">When two people owe each other in the same currency, the overlapping amount is offset automatically with the entry that creates the overlap. Each netting is written as an audited offset, so the trail still shows both original debts.</p>
    <label class="inline" for="s-auto-offset" style="gap:8px"><input type="checkbox" id="s-auto-offset" style="width:auto"> Offset reciprocal balances automatically</label>
    <div class="btns" style="margin-top:8px"><button id="s-save-auto-offset" type="button">Save</button></div>
  </div>
  <div class="card"><h2>Backups</h2>
    <p class="hint">Once this workspace has added the set number of transactions since the last snapshot, the whole workspace &mdash; people, currencies, settings and every transaction &mdash; is exported automatically and kept privately. Restoring writes it into a <b>new</b> workspace, so nothing here is ever overwritten. The newest ${KEEP_BACKUPS} snapshots are kept; older ones roll off.</p>
    <div id="s-backup-status" class="meta"></div>
    <div class="inline" style="margin-top:10px"><div class="field" style="margin:0"><label for="s-backup-every">Back up every (transactions)</label><input id="s-backup-every" type="number" min="5" max="10000" step="1" inputmode="numeric"></div><button id="s-save-backup-every" type="button">Save</button></div>
    <div class="btns" style="margin-top:8px"><button class="ghost" type="button" id="s-backup-now">Back up now</button></div>
    <div id="s-backup-list" style="margin-top:12px"></div>
    <div id="s-restore-out" class="meta" style="margin-top:10px"></div>
  </div>
  <div class="card"><h2>People</h2><div id="s-people"></div>
    <div class="inline"><div class="field" style="margin:0"><label>Add person</label><input id="s-person" autocomplete="off"></div><button id="s-add-person" type="button">Add</button></div>
  </div>
  <div class="card"><h2>Currencies</h2><div id="s-currencies"></div>
    <div class="inline"><div class="field" style="margin:0"><label>Add currency (3-letter code)</label><input id="s-cur" maxlength="3" autocomplete="off"></div><button id="s-add-cur" type="button">Add</button></div>
  </div>
</section>
<div id="person-modal" class="modal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pm-title">
    <div class="dlg-head"><h2 id="pm-title">Person</h2><button class="mini" type="button" id="pm-close">Close</button></div>
    <div id="pm-body"><div class="empty">Loading…</div></div>
  </div>
</div>
</main>`, APP_SCRIPT);
};

export const linkRetiredHtml = () => page('Link not active', '', `
<main>
<header><div class="head"><div><h1>&#128274; This link isn&rsquo;t active</h1><p class="sub">No workspace answers to it.</p></div></div></header>
<div class="card">
<p>The link was retired and replaced with a fresh one, or the trip&rsquo;s workspace was closed.</p>
<p class="hint">Ask whoever shared the trip for the current link &mdash; or start a new workspace.</p>
<div class="btns"><a href="/" style="display:inline-block;padding:11px 14px;border-radius:10px;background:var(--brand);color:var(--brand-ink);font-weight:600;text-decoration:none;text-align:center;flex:1;min-width:120px">Create a new workspace</a></div>
</div>
</main>
`);

export const appHtml = async (db: D1Database, workspaceId: number, name: string) => app(db, workspaceId, name);
