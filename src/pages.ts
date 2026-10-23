import { KEEP_BACKUPS } from './backups';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

const CSS = `/* person popup: one group-settlement action per currency, with direct records available on demand */
.pm-why{margin:var(--sp-4) 0;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.pm-why-top{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4) var(--sp-5);border-bottom:1px solid var(--line)}
.pm-why-top .who{font-weight:700;font-size:var(--fs-lg)}
.pm-why-top .amt{font-size:var(--fs-xl);font-weight:800;font-variant-numeric:tabular-nums}
.pm-why-explanation{margin:0;padding:var(--sp-4) var(--sp-5);color:var(--muted);font-size:var(--fs-sm)}
.pm-why .pm-sides{gap:0;margin:0;flex-wrap:nowrap}
.pm-why .pm-side{flex:1 1 50%;padding:var(--sp-4);background:transparent;border:0;border-radius:0}
.pm-why .pm-side+.pm-side{border-left:1px solid var(--line)}
.pm-line{display:flex;justify-content:space-between;gap:var(--sp-5);padding:var(--sp-3) 0;border-bottom:1px solid var(--line)}
.pm-line:last-child{border-bottom:0}
.pm-line-val{font-variant-numeric:tabular-nums;font-weight:600}
/* the two numbers the net is made of: green comes to this person, red leaves them */
.pm-sides{display:flex;flex-wrap:wrap;gap:var(--sp-3);margin-top:var(--sp-4)}
.pm-sides-in{margin-top:0;margin-bottom:var(--sp-4)}
.pm-side{flex:1 1 148px;min-width:0;display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4);background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg)}
.pm-side .s-label{font-size:var(--fs-sm);font-weight:600;color:var(--muted);min-width:0;overflow-wrap:anywhere}
/* a relationship row is a button, so it has to look like one: chevron, no repeated label */
.pair-head .p-caret{flex:0 0 auto;width:7px;height:7px;margin-left:auto;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform var(--dur) var(--ease)}
.pair-head[aria-expanded="true"] .p-caret{transform:rotate(-135deg)}
/* ── tokens: every colour, size and space comes from here ───────────────── */
:root{
  --bg:#f4f4f5; --card:#ffffff; --ink:#18181b; --muted:#71717a; --line:#e4e4e7; --line-strong:#d4d4d8;
  --brand:#2563eb; --brand-ink:#ffffff; --brand-hover:#1d4ed8; --ok:#15803d; --bad:#dc2626;
  --surface:#f4f4f5; --hover:#ececee;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.1);
  --ctl:44px; --ctl-sm:34px; --ctl-tab:36px; --ctl-area:92px; --avatar:36px; --emoji-w:88px;
  --r-sm:8px; --r-md:10px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --sp-1:4px; --sp-2:6px; --sp-3:8px; --sp-4:10px; --sp-5:12px; --sp-6:14px; --sp-7:16px; --sp-8:24px;
  --fs-2xs:.68rem; --fs-xs:.75rem; --fs-sm:.8rem; --fs-md:.88rem; --fs-base:.95rem; --fs-lg:1rem; --fs-xl:1.15rem; --fs-2xl:1.6rem;
  --dur:.15s; --ease:cubic-bezier(.2,.7,.2,1); --maxw:680px;
  --rank-bar-min:6%; --rank-row-main-basis:12rem;
}
/* Dark is opt-in, chosen in Settings - not a copy of the phone's setting. Light is what a visitor gets
   with no saved choice, so the palette has to be a property of the page, not of the operating system. */
html[data-theme="dark"]{
  --bg:#0b0b0d; --card:#18181b; --ink:#fafafa; --muted:#a1a1aa; --line:#27272a; --line-strong:#3f3f46;
  --brand:#3b82f6; --brand-hover:#2f6fe0; --ok:#4ade80; --bad:#f87171; --surface:#27272a; --hover:#212124; --shadow:none;
}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
/* mobile: pinch-zoom and double-tap zoom are off, and controls stay at 16px so focusing a field cannot zoom the page */
*{touch-action:pan-x pan-y;-webkit-tap-highlight-color:transparent;}
@media (max-width:600px){:where(input,select,textarea){font-size:16px}}
:root{color-scheme:light}
html[data-theme="dark"]{color-scheme:dark}
body{background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:var(--maxw);margin:0 auto;padding:0 var(--sp-6) 96px}
header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line);padding:var(--sp-5) var(--sp-6) var(--sp-3);margin:0 calc(var(--sp-6) * -1) var(--sp-6)}
.head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-5);max-width:var(--maxw);margin:0 auto}
a{color:var(--brand);text-decoration-thickness:1px;text-underline-offset:2px}
h1{font-size:var(--fs-xl);margin:0;letter-spacing:-.01em}
h2{font-size:var(--fs-lg);margin:0 0 var(--sp-4);letter-spacing:-.01em}
h3{font-size:var(--fs-2xs);margin:0 0 var(--sp-2);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
p.sub{color:var(--muted);font-size:var(--fs-sm);margin:var(--sp-1) 0 0}
[hidden]{display:none !important}
::selection{background:var(--brand);color:var(--brand-ink)}

/* ── one focus treatment for everything you can tab to ──────────────────── */
:where(a,button,select,input,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--brand);outline-offset:2px}
:where(input,select,textarea):focus-visible{outline-offset:-1px}

/* ── form controls: one height, one radius, arrows we draw ourselves ────── */
label{display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:600;margin:0 0 var(--sp-1)}
input,select,textarea,button{font:inherit;color:var(--ink)}
:where(input:not([type=checkbox]):not([type=radio]),select,textarea){
  width:100%;min-height:var(--ctl);padding:0 var(--sp-5);border:1px solid var(--line);border-radius:var(--r-lg);
  background-color:var(--card);font-size:16px;line-height:1.2;
  transition:border-color var(--dur) var(--ease),background-color var(--dur) var(--ease),opacity var(--dur) var(--ease);
}
:where(input:not([type=checkbox]):not([type=radio]),select,textarea):hover{border-color:var(--line-strong)}
:where(input:not([type=checkbox]):not([type=radio]),select,textarea):disabled{opacity:.6;cursor:not-allowed;background-color:var(--surface)}
:where(input,textarea)[readonly]{background-color:var(--surface);color:var(--muted);cursor:not-allowed}
:where(input,select,textarea)[aria-invalid=true]{border-color:var(--bad);background-color:color-mix(in srgb,var(--bad) 6%,var(--card));box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 16%,transparent)}
:where(input,select,textarea)[aria-invalid=true]:focus-visible{outline-color:var(--bad)}
::placeholder{color:var(--muted);opacity:.85}
select{
  appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:calc(var(--sp-5) + 22px);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%2371717a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right var(--sp-5) center;background-size:12px 8px;
}
html[data-theme="dark"] select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%23a1a1aa' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
option{background:var(--card);color:var(--ink)}
select::-ms-expand{display:none}
textarea{min-height:var(--ctl-area);padding:var(--sp-4) var(--sp-5);line-height:1.5;resize:vertical}
textarea.mono,pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
textarea.mono{font-size:13px}

/* ── buttons: one scale (44px / 34px / icon) with real states ───────────── */
button{
  background:var(--brand);color:var(--brand-ink);border:1px solid transparent;border-radius:var(--r-lg);min-height:var(--ctl);
  padding:0 var(--sp-7);font-weight:600;cursor:pointer;width:100%;display:inline-flex;align-items:center;justify-content:center;
  gap:var(--sp-2);line-height:1.2;white-space:nowrap;
  transition:background var(--dur) var(--ease),color var(--dur) var(--ease),border-color var(--dur) var(--ease),opacity var(--dur) var(--ease);
}
button:hover{background:var(--brand-hover)}
button:active{transform:translateY(1px)}
button:disabled{opacity:.55;cursor:not-allowed;pointer-events:none}
button[aria-busy=true]{pointer-events:none;opacity:.75}
button[aria-busy=true]::after{content:"";width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
button.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
button.ghost:hover{background:var(--hover);border-color:var(--line-strong)}
button.danger{background:transparent;color:var(--bad);border-color:var(--line)}
button.danger:hover{background:var(--bad);border-color:var(--bad);color:#fff}
/* a label styled as a ghost button: taps open the file picker natively, no scripted click on a hidden input */
label.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:var(--r-lg);min-height:var(--ctl);padding:0 var(--sp-7);font-weight:600;cursor:pointer;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2);line-height:1.2;white-space:nowrap;user-select:none;-webkit-tap-highlight-color:transparent;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease)}
label.ghost:hover{background:var(--hover);border-color:var(--line-strong)}
label.ghost:active{transform:translateY(1px)}
.vh{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
/* every compact action in the app shares this one rule */
button.mini,button.icon,.swap button,.pager button,.emoji-edit button,.people-actions button{width:auto;flex:0 0 auto;min-height:var(--ctl-sm);padding:0 var(--sp-5);font-size:var(--fs-sm);border-radius:var(--r-md)}
button.icon{position:relative;width:var(--ctl-sm);padding:0;font-size:var(--fs-base)}
button.icon::after{content:'';position:absolute;inset:-5px;border-radius:var(--r-md)}
button.icon>span{pointer-events:none}
.btns{display:flex;gap:var(--sp-3);flex-wrap:wrap;margin-top:var(--sp-4)}
.btns button{width:auto;flex:1 1 140px;min-width:0}

/* ── layout helpers ─────────────────────────────────────────────────────── */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-xl);padding:var(--sp-6);margin-bottom:var(--sp-5);box-shadow:var(--shadow)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4)}
.grid > *{min-width:0}
.grid.three{grid-template-columns:1fr 1fr 1fr}
/* a native date control is wider than its share of a three-up row, so give it the full width on phones */
@media(max-width:559px){.grid.three{grid-template-columns:1fr 1fr}.grid.three > .field:last-child{grid-column:1 / -1}}
.full{grid-column:1/-1}
.field{margin-bottom:var(--sp-4)}
.inline{display:flex;gap:var(--sp-3);align-items:flex-end}
.inline > *{flex:1} .inline button{flex:0 0 auto;width:auto}
.people{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2)}
.check{display:flex;align-items:center;gap:var(--sp-3);margin:0;padding:var(--sp-4) var(--sp-4);border:1px solid var(--line);border-radius:var(--r-md);font-size:var(--fs-md);font-weight:600;color:var(--ink);cursor:pointer;transition:border-color var(--dur) var(--ease),background var(--dur) var(--ease)}
.check:hover{border-color:var(--line-strong)}
.check input{width:18px;height:18px;min-height:0;padding:0;flex:0 0 auto;accent-color:var(--brand);cursor:pointer}
.check.off{opacity:.5}

/* ── navigation: a hidden sidebar behind a hamburger ───────────────────── */
.navbar{display:flex;align-items:center;gap:var(--sp-4);margin:var(--sp-4) auto 0;max-width:var(--maxw)}
.hamburger{width:auto;flex:0 0 auto;min-width:0;min-height:var(--ctl-tab);padding:0 var(--sp-5);background:var(--card);color:var(--ink);border-color:var(--line);border-radius:var(--r-pill);font-size:var(--fs-sm);box-shadow:var(--shadow)}
.nav-now{color:var(--muted);font-size:var(--fs-sm);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer-backdrop{position:fixed;inset:0;z-index:54;background:rgba(9,9,11,.45);opacity:0;visibility:hidden;transition:opacity var(--dur) var(--ease),visibility var(--dur)}
body.nav-open .drawer-backdrop{opacity:1;visibility:visible}
.drawer{position:fixed;top:0;bottom:0;left:0;z-index:55;width:min(84vw,300px);background:var(--card);border-right:1px solid var(--line);box-shadow:var(--shadow);padding:var(--sp-6) var(--sp-5);overflow-y:auto;transform:translateX(-102%);visibility:hidden;transition:transform var(--dur) var(--ease),visibility var(--dur)}
body.nav-open .drawer{transform:none;visibility:visible}
.drawer-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);margin-bottom:var(--sp-5)}
.drawer-title{font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.drawer nav{display:flex;flex-direction:column;gap:2px}
.nav-group{font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:var(--sp-5) 0 var(--sp-2)}
.drawer button{width:auto;flex:0 1 auto;min-width:0;justify-content:flex-start;text-align:left;background:transparent;color:var(--muted);border-color:transparent;border-radius:var(--r-md);padding:0 var(--sp-5);min-height:var(--ctl);font-size:var(--fs-base)}
.drawer button:hover{background:var(--hover);color:var(--ink)}
.drawer button[aria-selected=true]{background:var(--surface);color:var(--ink);border-color:var(--line);font-weight:600}

/* a data card that opens on demand — the summary row is the whole title */
details.card.fold{padding:0}
details.card.fold > summary{display:flex;align-items:center;gap:var(--sp-3);cursor:pointer;list-style:none;padding:var(--sp-6);border-radius:var(--r-xl)}
/* Reset the global section-heading margin inside a one-line accordion summary.
   Keep the title, optional count, and chevron on a common visual centreline. */
details.card.fold > summary h2{display:flex;align-items:center;gap:var(--sp-3);min-width:0;flex:0 1 auto;margin:0;line-height:1.2}
details.card.fold > summary h2 > [aria-hidden=true]{display:inline-flex;align-items:center;justify-content:center;flex:0 0 1.25em;width:1.25em;line-height:1}
details.card.fold > summary .fold-count{align-self:center;line-height:1.2}
details.card.fold > summary::-webkit-details-marker{display:none}
details.card.fold > summary::after{content:'▾';display:flex;align-items:center;justify-content:center;align-self:center;margin-left:auto;min-width:1.25em;color:var(--muted);font-size:var(--fs-md);line-height:1;transition:transform var(--dur) var(--ease)}
details.card.fold[open] > summary::after{transform:rotate(180deg)}
details.card.fold > summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
details.card.fold > .fold-body{padding:0 var(--sp-6) var(--sp-6)}
.fold-count{color:var(--muted);font-size:var(--fs-sm);font-weight:600;white-space:nowrap}

/* ── ranking ────────────────────────────────────────────────────────────── */
.ranking-currencies{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin:var(--sp-4) 0}
.ranking-currencies button{width:auto;min-height:var(--ctl-sm);padding:0 var(--sp-5);border-radius:var(--r-pill);background:var(--surface);color:var(--ink);border-color:var(--line)}
.ranking-currencies button[aria-pressed=true]{background:var(--brand);color:var(--brand-ink);border-color:var(--brand)}
.ranking-list{display:flex;flex-direction:column;gap:var(--sp-3)}
.ranking-row{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-5);text-align:left;white-space:normal;background:var(--card);color:var(--ink);border-color:var(--line)}
.ranking-row:hover{background:var(--hover);border-color:var(--line-strong)}
.ranking-row-main{flex:1 1 var(--rank-row-main-basis);min-width:0}
.ranking-row-identity{display:flex;align-items:center;gap:var(--sp-2);min-width:0}
.ranking-row-rank{flex:0 0 auto;color:var(--muted);font-size:var(--fs-xs);font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.ranking-row-avatar{flex:0 0 var(--ctl-sm);width:var(--ctl-sm);height:var(--ctl-sm);display:inline-flex;align-items:center;justify-content:center;background:var(--surface);border-radius:var(--r-pill);font-size:var(--fs-lg);line-height:1}
.ranking-row-name{min-width:0}
.ranking-row-name,.ranking-row-amount{display:block;overflow-wrap:anywhere}
.ranking-row-name{font-weight:700}
.ranking-row-amount{color:var(--muted);font-size:var(--fs-sm);margin-top:var(--sp-1)}
.ranking-bar{width:100%;height:var(--sp-2);overflow:hidden;background:var(--surface);border-radius:var(--r-pill)}
.ranking-bar-fill{display:block;height:100%;min-width:var(--rank-bar-min);background:var(--bad);border-radius:inherit}

/* ── lists: ledger rows, pairs, records, split summary ──────────────────── */
.row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4) var(--sp-2);margin:0 calc(var(--sp-2) * -1);border-bottom:1px solid var(--line);border-radius:var(--r-sm)}
.row:last-child{border-bottom:0}
.row:hover{background:var(--hover)}
.row .who{font-weight:600;font-size:var(--fs-base)}
.row .meta{color:var(--muted);font-size:var(--fs-xs);margin-top:1px;overflow-wrap:anywhere}
.row-main{flex:1 1 auto;min-width:0}
.row-side{display:flex;flex-direction:row;align-items:center;gap:var(--sp-3);flex:0 0 auto;margin-left:auto}
.amt{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.amt.zero{color:var(--muted)}
.pos{color:var(--ok)} .neg{color:var(--bad)}
.p-block{min-width:0;flex:1 1 auto}
.pm-analytics{margin-top:var(--sp-6)}
.pm-analytics-title{margin:0 0 var(--sp-3);font-size:var(--fs-sm);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pm-analytics-grid{display:grid;grid-template-columns:1fr;gap:var(--sp-3)}
.analytics-item{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.analytics-item.in{background:color-mix(in srgb,var(--ok) 6%,var(--surface));border-color:color-mix(in srgb,var(--ok) 22%,var(--line))}
.analytics-item.out{background:color-mix(in srgb,var(--bad) 4%,var(--surface));border-color:color-mix(in srgb,var(--bad) 18%,var(--line))}
.pm-analytics-card{display:flex;align-items:center;gap:var(--sp-4);width:100%;padding:var(--sp-5);background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:normal}
.pm-analytics-card:hover{background:var(--hover)}
.pm-analytics-main{display:block;min-width:0;flex:1 1 auto}
.pm-analytics-label{display:block;margin-bottom:2px;font-size:var(--fs-xs);font-weight:750;letter-spacing:.055em;text-transform:uppercase;color:var(--muted)}
.pm-analytics-count{display:block;color:var(--muted);font-size:var(--fs-xs)}
.pm-analytics-amounts{min-width:0;flex:0 1 auto;text-align:right}
.pm-analytics-amount{display:block;font-size:var(--fs-xl);line-height:1.15;font-variant-numeric:tabular-nums;font-weight:800;overflow-wrap:anywhere}
.pm-analytics-amount+.pm-analytics-amount{margin-top:var(--sp-2)}
.analytics-detail{padding:0 var(--sp-5) var(--sp-4);border-top:1px solid var(--line)}
.analytics-detail .rec:first-child{padding-top:var(--sp-4)}
.pm-analytics-card .p-caret{flex:0 0 auto;width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform var(--dur) var(--ease)}
.pm-analytics-card[aria-expanded="true"] .p-caret{transform:rotate(-135deg)}
@media(max-width:420px){.pm-analytics-card{padding:var(--sp-4)}.analytics-detail{padding:0 var(--sp-4) var(--sp-3)}}
/* activity and the original direct records are reference material, so both fold away under one
   plain label instead of stacking more open panels under the action */
.pm-more{margin-top:var(--sp-4);background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.pm-more>summary{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-4) var(--sp-5);font-weight:700;cursor:pointer;list-style:none}
.pm-more>summary::-webkit-details-marker{display:none}
.pm-more>summary::after{content:'';flex:0 0 auto;width:7px;height:7px;margin-left:auto;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform var(--dur) var(--ease)}
.pm-more[open]>summary::after{transform:rotate(225deg)}
.pm-more .pm-analytics{margin:0;padding:0 var(--sp-4) var(--sp-4)}
.pm-more .pm-relations{padding:0 var(--sp-4) var(--sp-4)}
.pm-more .pm-ledger-trail-hint{margin:0;padding:0 var(--sp-5) var(--sp-3)}
/* phones: the folded sections and the action line lose one step of padding so a person's drawer
   fits without a scroll for the common case */
@media(max-width:420px){.pm-more>summary{padding:var(--sp-3) var(--sp-4)}.pm-more .pm-analytics{padding:0 var(--sp-3) var(--sp-3)}.pm-more .pm-relations{padding:0 var(--sp-3) var(--sp-3)}.pm-more .pm-ledger-trail-hint{padding:0 var(--sp-4) var(--sp-3)}.pm-why-top{padding:var(--sp-3) var(--sp-4)}}
.pm-ledger-trail-hint{margin:0;padding:0 var(--sp-5) var(--sp-5);color:var(--muted);font-size:var(--fs-sm)}
.pm-relations-empty{margin:0;padding:var(--sp-5);border-top:1px solid var(--line)}
/* Activity counts what someone has done over the life of the trip, not a balance they owe or are owed,
   so the figures and their cards carry no green/red — the label above each one already says which way
   it points. Colour is reserved for the plan lines, which are the only actionable numbers here. */
.pm-analytics-amount,.pm-analytics-amount.pos,.pm-analytics-amount.neg,.pm-analytics-amount.zero{color:inherit}
.analytics-item.in,.analytics-item.out{background:var(--surface);border-color:var(--line)}
/* Record rows are history, not a balance to act on, so their amounts stay plain as well: each row's own
   words ("Ww paid for Hen", "Hen paid Ww back", "offset") already say which way the money went. */
.pm-relations .r-amt,.pm-relations .r-amt.pos,.pm-relations .r-amt.neg,.pm-analytics .r-amt,.pm-analytics .r-amt.pos,.pm-analytics .r-amt.neg{color:inherit}
/* Original balances answer "what do the direct records say", and the sentence already says which way the
   money runs ("Ww owes Hen"), so green/red here only competes with the plan card above it and reads as a
   verdict on the payment. The amounts keep the text colour and let the words carry the direction. */
.pm-relations .amt,.pm-relations .amt.pos,.pm-relations .amt.neg,.pm-relations .amt.zero{color:inherit}
.pm-full-history{margin-top:var(--sp-4)}
.pm-history-group{margin-top:var(--sp-4);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.pm-history-heading{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:2px var(--sp-4);margin:0;padding:var(--sp-4) var(--sp-5);font-size:var(--fs-sm);font-weight:500;background:var(--surface)}
.pm-history-currency{grid-column:1;font-weight:700;font-variant-numeric:tabular-nums}
.pm-history-order{grid-column:1;font-size:var(--fs-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.pm-history-net{grid-column:2;grid-row:1/span 2;justify-self:end;font-size:var(--fs-lg);font-variant-numeric:tabular-nums;font-weight:800;white-space:nowrap;color:var(--ink)}
.pm-history-net.pos{color:var(--ok)}
.pm-history-net.neg{color:var(--bad)}
.pm-history-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pm-history-table{width:100%;min-width:560px;border-collapse:collapse;font-size:var(--fs-sm)}
.pm-history-table th,.pm-history-table td{padding:var(--sp-3) var(--sp-5);border-top:1px solid var(--line);text-align:left;vertical-align:top}
.pm-history-table th{font-size:var(--fs-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700;background:var(--card)}
.pm-history-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pm-history-date{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.pm-history-detail{min-width:200px}
.pm-history-kind{display:inline-block;margin-right:var(--sp-3);padding:1px var(--sp-2);border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font-size:var(--fs-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.pm-history-event{font-weight:650;overflow-wrap:anywhere}
.pm-history-note{display:block;margin-top:2px;color:var(--muted);font-size:var(--fs-xs)}
.pm-history-amount{font-weight:700}
.pm-history-amount.pos{color:var(--ok)}
.pm-history-amount.neg{color:var(--bad)}
.pm-history-balance{color:var(--muted)}
@media(max-width:520px){.pm-history-table{min-width:100%}.pm-history-table thead{display:none}.pm-history-table,.pm-history-table tbody{display:block;width:100%}.pm-history-table tr{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:2px var(--sp-3);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--line)}.pm-history-table td{border:0;padding:0}.pm-history-date{grid-column:1;grid-row:1;font-size:var(--fs-xs)}.pm-history-amount{grid-column:2;grid-row:1;text-align:right;font-size:var(--fs-sm)}.pm-history-detail{grid-column:1/span 2;grid-row:2;min-width:0}.pm-history-balance{grid-column:1/span 2;grid-row:3;text-align:right;font-size:var(--fs-xs)}.pm-history-balance::before{content:"balance ";text-transform:lowercase;letter-spacing:.06em}.pm-history-event{font-size:var(--fs-sm)}.pm-history-heading{padding:var(--sp-3) var(--sp-4)}.pm-history-kind{margin-right:var(--sp-2)}}
@media(max-width:420px){.pm-history-heading{padding:var(--sp-3) var(--sp-4)}.pm-history-table th,.pm-history-table td{padding:var(--sp-3)}}
.pair{border-top:1px solid var(--line)}
.pair-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);width:100%;background:none;border:0;border-radius:0;padding:var(--sp-5);color:inherit;font:inherit;text-align:left;cursor:pointer}
/* content cards are buttons too, but their text must wrap (the base button rule is nowrap) */
.pair-head,.person-card{white-space:normal}
.pair-head:hover{background:var(--hover)}
.pair-head .who{display:block;min-width:0;flex:1 1 auto;font-weight:600;font-size:var(--fs-base)}
.pair-head .who .amt{margin-left:var(--sp-2);font-size:var(--fs-md)}
.pair-head .p-open{margin-left:auto;flex:0 0 auto;color:var(--muted);font-size:var(--fs-xs);font-weight:700;white-space:nowrap}
.pair-head .meta{display:block;color:var(--muted);font-size:var(--fs-xs);margin-top:2px;overflow-wrap:anywhere}
/* Expanded relationship history stays in the same column as its header: no orphaned left rail,
   one quiet summary surface, then a ledger-like list with amounts in a single aligned column. */
.pair-detail{margin:0;padding:var(--sp-5) var(--sp-5) var(--sp-4);background:var(--card)}
.pair-detail .pm-sides{margin:0 0 var(--sp-3)}
.pair-detail .pm-side{flex-basis:100%;padding:var(--sp-3) var(--sp-4);border-radius:var(--r-md)}
.rec{display:grid;grid-template-columns:minmax(0,1fr) max-content max-content;align-items:center;column-gap:var(--sp-5);row-gap:var(--sp-2);padding:var(--sp-4) 0;border-top:1px solid var(--line);font-size:var(--fs-sm)}
.rec .r-main{grid-column:1;min-width:0;display:block}
.rec .r-main>span{display:block}
.rec .r-head{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;min-width:0}
.rec .r-topic{min-width:0;overflow-wrap:anywhere}
.rec .r-head .tag-arch{margin-left:0}
.rec.is-arch .r-topic{color:var(--muted)}
.rec .r-meta{display:block;color:var(--muted);font-size:var(--fs-xs);margin-top:1px;line-height:1.3}
.rec .r-amt{grid-column:2;justify-self:end;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.rec .r-act{grid-column:3;justify-self:end;white-space:nowrap}
@media(max-width:420px){.pair-detail{padding:0 var(--sp-4) var(--sp-3)}.rec{grid-template-columns:minmax(0,1fr) max-content}.rec .r-act{grid-column:1 / -1;justify-self:end}}
.split-sum{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4) 0;border-bottom:1px solid var(--line)}
.split-sum:last-child{border-bottom:0}
.split-sum .who{font-weight:600;font-size:var(--fs-base)}
.split-sum .paid{color:var(--muted);font-size:var(--fs-xs);margin-top:1px}
.split-sum .share{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.recent-split{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4) var(--sp-2);margin:0 calc(var(--sp-2) * -1);border-bottom:1px solid var(--line)}
.recent-split:last-child{border-bottom:0}
.recent-split .who{font-weight:600;font-size:var(--fs-base)}
.recent-split .meta{color:var(--muted);font-size:var(--fs-xs);margin-top:1px;overflow-wrap:anywhere}
.empty{color:var(--muted);font-size:var(--fs-md);padding:var(--sp-2) 0}
.err{color:var(--bad);font-size:var(--fs-sm);margin-top:var(--sp-3);white-space:pre-wrap}
.hint{color:var(--muted);font-size:var(--fs-xs);margin-top:var(--sp-2)}

/* ── chips, stats, avatars ──────────────────────────────────────────────── */
.chip,.tag-arch{display:inline-block;background:var(--surface);color:var(--muted);border-radius:var(--r-pill);padding:2px var(--sp-3);font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.tag-arch{margin-left:var(--sp-2)}
.chip.debt{color:var(--brand)} .chip.payment{color:var(--ok)} .chip.split{color:var(--brand)}
.totals{display:flex;gap:var(--sp-3);flex-wrap:wrap;margin-bottom:var(--sp-4)}
.total,.kpi{background:var(--surface);border-radius:var(--r-md);padding:var(--sp-4) var(--sp-5);font-variant-numeric:tabular-nums;font-size:var(--fs-md)}
.total b,.kpi .k-value{display:block;font-size:var(--fs-lg);font-weight:800;margin-top:var(--sp-1);overflow-wrap:anywhere}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(132px,100%),1fr));gap:var(--sp-3);margin:var(--sp-4) 0 var(--sp-1)}
.kpi-grid > .kpi.wide{grid-column:1/-1}
.kpi-grid > *,.kpi,.total{min-width:0}
.kpi{padding:var(--sp-4);min-width:0}
.kpi .k-label{font-size:var(--fs-2xs);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;line-height:1.25}
.bal-label{margin:0 0 var(--sp-2);font-size:var(--fs-xs);font-weight:750;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.bal-legend{margin:0 0 var(--sp-3);max-width:56ch;color:var(--muted);font-size:var(--fs-sm);line-height:1.45}
#balance-people{border-top:1px solid var(--line)}
.person-card{display:flex;align-items:center;gap:var(--sp-4);width:100%;text-align:left;background:transparent;color:inherit;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:var(--sp-4) 0;margin:0;font:inherit;cursor:pointer;transition:background var(--dur) var(--ease)}
.person-card:hover{background:transparent;border-color:var(--line)}
.person-card:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.person-card.archived{opacity:.6}
.person-card .p-chev{flex:0 0 auto;width:var(--ctl-sm);height:var(--ctl-sm);display:flex;align-items:center;justify-content:center;border:1px solid var(--line-strong);border-radius:50%;color:var(--muted);font-size:var(--fs-sm);line-height:1}
.person-card .avatar{flex:0 0 var(--avatar);width:var(--avatar);height:var(--avatar);border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--surface);color:var(--brand);font-weight:800;font-size:var(--fs-sm)}
.person-card .p-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.person-card .who{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;letter-spacing:.045em;text-transform:uppercase;overflow-wrap:anywhere}
.person-card .p-nets{flex:0 0 auto;margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
.person-card .p-net{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap;color:var(--ink)}
.person-card .p-net.pos{color:var(--ok)}
.person-card .p-net.neg{color:var(--bad)}
.person-card .p-net.sub{font-size:var(--fs-sm);font-weight:600}
.person-card .p-settled{color:var(--muted);font-size:var(--fs-sm);font-weight:600}
.settle-row{display:flex;align-items:center;gap:var(--sp-4);padding:var(--sp-4) 0;border-bottom:1px solid var(--line)}
.settle-names{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:var(--sp-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;letter-spacing:.045em;text-transform:uppercase;overflow-wrap:anywhere}
.settle-arrow{color:var(--muted);font-weight:500}
.settle-amt{flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.settle-btn{flex:0 0 auto;width:auto;min-height:var(--ctl-sm);padding:0 var(--sp-5);border-radius:var(--r-pill);background:transparent;color:var(--brand);border:1px solid var(--brand);font-size:var(--fs-sm);font-weight:650}
.settle-btn:hover{background:var(--brand);color:var(--brand-ink)}
.emoji-edit{display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-3)}
#s-people input.emoji-input{width:var(--emoji-w);min-height:var(--ctl-sm);padding:0 var(--sp-3);text-align:center;font-size:var(--fs-lg)}
.people-actions{display:flex;gap:var(--sp-3);align-items:center;flex-wrap:wrap;margin:0 0 var(--sp-3)}
.people-actions .hint{margin:0}
.swap{display:flex;justify-content:center;margin:calc(var(--sp-1) * -1) 0 var(--sp-2)}
.swap button{background:var(--surface);color:var(--ink);border-radius:var(--r-pill)}
.swap button:hover{background:var(--hover)}

/* ── review sheet, dialogs, toast, pager ────────────────────────────────── */
.rf-head{font-size:var(--fs-lg);font-weight:650;line-height:1.5;margin:0 0 2px}
.rf-head .rf-v{color:var(--muted);font-weight:500}
.rf-head .rf-who{font-weight:700}
.rf-amt{font-size:clamp(var(--fs-lg),5.5vw,var(--fs-2xl));font-weight:700;font-variant-numeric:tabular-nums;line-height:1.2;margin:var(--sp-1) 0 0;overflow-wrap:anywhere}
.rf-why{color:var(--muted);font-size:var(--fs-md);margin:var(--sp-2) 0 0;line-height:1.45}
.rf-rows{display:grid;grid-template-columns:auto 1fr;gap:var(--sp-2) var(--sp-6);font-size:var(--fs-md);margin:var(--sp-5) 0 0;padding-top:var(--sp-4);border-top:1px solid var(--line)}
.rf-rows .k{color:var(--muted);white-space:nowrap}
.rf-rows .v{font-weight:550;word-break:break-word}
.rf-chips{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin:var(--sp-5) 0 0}
.rf-chips .chip{white-space:nowrap}
.rf-chips .chip.payer{background:var(--surface);border-color:var(--line)}
.modal{position:fixed;inset:0;background:rgba(9,9,11,.55);display:flex;align-items:flex-end;justify-content:center;z-index:60;animation:fade var(--dur) var(--ease)}
.modal[hidden]{display:none}
.modal .sheet{background:var(--card);width:100%;max-width:640px;max-height:90vh;overflow:auto;border-radius:var(--r-xl) var(--r-xl) 0 0;padding:var(--sp-7);border:1px solid var(--line)}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media(min-width:620px){.modal{align-items:center;padding:var(--sp-7)}.modal .sheet{border-radius:var(--r-xl);max-height:86vh}}
.dlg-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);position:sticky;top:calc(var(--sp-7) * -1);background:var(--card);padding:2px 0 var(--sp-3);margin:-2px 0 0;border-bottom:1px solid var(--line);z-index:2}
.dlg-head h2{margin:0;font-size:var(--fs-lg)}
.pm-nets{display:flex;flex-wrap:wrap;gap:var(--sp-3);margin:var(--sp-4) 0 var(--sp-1);font-size:var(--fs-base)}
.p-nets .amt,.pm-nets .amt{flex:0 0 auto;white-space:normal;overflow-wrap:anywhere}
.p-nets .say,.pm-nets .say{color:var(--muted)}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:var(--sp-7);z-index:50;background:var(--ink);color:var(--bg);border-radius:var(--r-pill);padding:var(--sp-4) var(--sp-7);font-size:var(--fs-md);font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:92vw;text-align:center;transition:opacity .2s;opacity:0;pointer-events:none}
.toast.show{opacity:1}
.toast.bad{background:var(--bad);color:#fff}
.pager{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);margin-top:var(--sp-5);padding-top:var(--sp-5);border-top:1px solid var(--line)}
.pager[hidden]{display:none}
.pager .pager-info{flex:1 1 auto;text-align:center;color:var(--muted);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
details{border:1px solid var(--line);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-5);margin-bottom:var(--sp-3)}
summary{cursor:pointer;font-size:var(--fs-md);font-weight:600}
summary:hover{color:var(--brand)}
pre{background:var(--surface);border-radius:var(--r-sm);padding:var(--sp-4);overflow-x:auto;font-size:12px;margin:var(--sp-3) 0 0}
#ai-prompt{max-height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}

/* ── phone ──────────────────────────────────────────────────────────────── */
@media (max-width:520px){
  main{padding:0 var(--sp-5) 88px}
  header{padding:var(--sp-4) var(--sp-5) var(--sp-3);margin:0 calc(var(--sp-5) * -1) var(--sp-5)}
  .head{gap:var(--sp-3)}
  .card{padding:var(--sp-5)}
  .navbar{gap:var(--sp-3)}
  .drawer button{padding:0 var(--sp-4);min-height:var(--ctl-sm);font-size:var(--fs-sm)}
  .row .meta .cat{display:none}
  .kpi .k-value{font-size:var(--fs-base)}
}
@media (max-width:400px){.people{grid-template-columns:1fr}}
/* layout utilities — one consistent replacement for one-off inline styles */
.flush{margin:0}
.stack{display:flex;flex-direction:column;gap:var(--sp-1)}
.filter-bar{display:flex;flex-wrap:wrap;gap:var(--sp-4);align-items:flex-end;margin:var(--sp-4) 0}
.filter-bar > label{flex:1 1 150px;min-width:0}
.filter-bar > .btns{flex:1 1 100%;margin:0}
.mt-8{margin-top:var(--sp-3)}
.mt-10{margin-top:var(--sp-4)}
.mt-12{margin-top:var(--sp-5)}
.mt-14{margin-top:var(--sp-6)}
.mt-16{margin-top:var(--sp-7)}
.link-plain{text-decoration:none}
/* receipt backlog board: a manual two-column tracker, not an importer */
.rec-board{display:grid;grid-template-columns:minmax(min(260px,100%),1fr) minmax(min(260px,100%),1fr);gap:var(--sp-4);align-items:start;margin-top:var(--sp-4)}
.rec-col{display:flex;flex-direction:column;gap:var(--sp-3);min-width:0}
.rec-head{display:flex;flex-direction:column;gap:2px;padding:0 var(--sp-1)}
.rec-head h3{display:flex;align-items:center;gap:var(--sp-2);margin:0;font-size:var(--fs-md)}
.rec-head .count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--hover);color:var(--muted);font-size:var(--fs-2xs);font-weight:600}
.rec-list{display:flex;flex-direction:column;gap:var(--sp-3);min-width:0}
.rec-card{display:flex;flex-direction:column;gap:var(--sp-2);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--sp-5);background:var(--surface);min-width:0;white-space:normal}
.rec-main{display:flex;flex-direction:column;gap:var(--sp-2);min-width:0}
.rec-title{font-weight:600;font-size:var(--fs-md);overflow-wrap:anywhere}
.rec-note{color:var(--muted);font-size:var(--fs-sm);white-space:pre-wrap;overflow-wrap:anywhere}
.rec-meta{color:var(--muted);font-size:var(--fs-2xs);overflow-wrap:anywhere}
.rec-meta a{color:var(--brand)}
.rec-atts{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
.att{position:relative;display:block;width:64px;height:64px;min-width:0;padding:0;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line);background:var(--hover);cursor:zoom-in}
.att img{width:100%;height:100%;object-fit:cover;display:block}
/* Tapping a photo opens it, so a tile stays a plain image; taking it off happens in the viewer. */
#rec-view{position:fixed;inset:0;z-index:70;background:rgba(6,6,8,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-5);padding:var(--sp-6)}
#rec-view[hidden]{display:none}
#rec-view img{max-width:100%;max-height:66vh;border-radius:var(--r-lg);background:var(--hover)}
#rec-view .btns{width:100%;max-width:420px}
.rec-acts{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
/* ---------------- spend by day ---------------- */
.chart{margin-top:var(--sp-5)}
.chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap}
.bars{display:flex;align-items:flex-end;gap:var(--sp-1);height:var(--ctl-area);margin-top:var(--sp-4);border-bottom:1px solid var(--line)}
.bars .col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:2px}
.bars .track{flex:1 1 auto;display:flex;align-items:flex-end;min-height:0}
.bars .fill{width:100%;min-height:3px;background:var(--brand);border-radius:var(--r-sm) var(--r-sm) 0 0}
.bars .day{color:var(--muted);font-size:var(--fs-2xs);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---------------- since your last visit ---------------- */
.dg-head{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap}
.dg-head h2{margin:0}
.dg-list{margin:var(--sp-4) 0 0;padding-left:var(--sp-6);color:var(--muted);font-size:var(--fs-sm)}
.dg-list li{margin-bottom:var(--sp-1);overflow-wrap:anywhere}
/* Maximum payment panel — only the Record a payment page carries one. */
.limits{border:1px solid var(--line);border-radius:var(--r-md);padding:var(--sp-4);background:var(--hover);margin:var(--sp-4) 0}
.limits h3{margin:0;font-size:var(--fs-sm)}
.limits .pill-row{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin-top:var(--sp-3)}
.limits .pill{display:inline-flex;align-items:center;gap:var(--sp-2);padding:var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);border:1px solid var(--line);border-radius:var(--r-pill);background:var(--card);font-size:var(--fs-sm)}
.limits .pill b{font-variant-numeric:tabular-nums;white-space:nowrap}
.limits .pill.zero{opacity:.62}
.limits .hint{display:block;margin-top:var(--sp-3)}
/* The digest is the app's notification panel: the bell carries the red dot, the list pops out under
   it, and because the bell sits in the shared header it is there on every page. */
.head-acts{display:flex;align-items:center;gap:var(--sp-3);flex:0 0 auto}
.bell{position:relative}
.bell .dot{position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:var(--bad);box-shadow:0 0 0 2px var(--card)}
#digest{position:fixed;z-index:60;top:76px;right:max(var(--sp-5),calc((100vw - var(--maxw)) / 2 + var(--sp-6)));margin:0;width:min(92vw,380px);max-height:min(72vh,520px);overflow-y:auto}
#digest[hidden]{display:none}
@media (max-width:640px){.rec-board{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms !important;transition-duration:.01ms !important}}`;

const page = (title: string, head: string, body: string, script = '', manifest = '') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#f4f4f5">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${manifest ? '<link rel="manifest" href="' + manifest + '">' : ''}
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<script>/* The theme is a property of this device, not of the trip: the same link can be open on two phones
  and one wanting light must not force the other. Light is the default, so a visitor with no saved choice
  gets light even when the phone itself is dark. This runs before the stylesheet, so the first paint is
  already the chosen palette and switching never flashes the other one. */
  (function(){var t='light';try{if(localStorage.getItem('tfw_theme')==='dark'){t='dark'}}catch(e){}
    document.documentElement.setAttribute('data-theme',t);
    var m=document.querySelector('meta[name="theme-color"]');
    if(m){m.setAttribute('content',t==='dark'?'#0b0b0d':'#f4f4f5')}})();</script>
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
var people=boot.people||[], currencies=boot.currencies||[], settings=null, me=null, rosterSig='', backups=null, receipts=boot.receipts||[];

function toast(msg,bad){var t=$('toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast'},2800)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function name(id){for(var i=0;i<people.length;i++){if(people[i].id===id){var p=people[i];return (p.emoji?p.emoji+' ':'')+p.display_name}}return '#'+id}
function bareName(id){for(var i=0;i<people.length;i++){if(people[i].id===id){return people[i].display_name}}return ''}
/* Reads "205708", "205,708" and "1.234.567" as grouping, "205708,50" and "1.234,56" as comma
   decimals (one comma with up to two digits after it). Built by string digit math, so a VND-sized
   amount cannot drift through a float, and the result is always an integer count of minor units. */
function toMinor(v){
  var s=String(v==null?'':v).replace(/[\\s\\u00a0]/g,'');
  if(s===''||!/^[\\d.,]+$/.test(s)){return null}
  var comma=s.lastIndexOf(','), dot=s.lastIndexOf('.'), dec=-1;
  if(comma>=0&&dot>=0){dec=comma>dot?comma:dot}
  else if(comma>=0){dec=(s.length-comma-1)<=2&&s.indexOf(',')===comma?comma:-1}
  else if(dot>=0){dec=(s.length-dot-1)<=2&&s.indexOf('.')===dot?dot:-1}
  var intp=(dec>=0?s.slice(0,dec):s).replace(/[.,]/g,'');
  var frac=(dec>=0?s.slice(dec+1):'').replace(/[.,]/g,'');
  if(intp===''){intp='0'}
  if(!/^\\d*$/.test(intp)||!/^\\d*$/.test(frac)){return null}
  var m=(intp+(frac+'00').slice(0,2)).replace(/^0+/,'');
  if(m.length===0||m.length>15){return null}
  var n=Number(m);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
/* Currencies whose everyday unit is the whole unit: a whole amount drops the ".00", a fractional
   one keeps both decimals, so a sub-unit value in the data is never hidden. Grouping uses the comma
   convention, which is also what toMinor() reads back, so display and input agree. */
var NODEC=['BIF','CLP','DJF','GNF','HUF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF'];
function money(minor,code){
  var m=Number(minor)||0, cur=String(code||'').toUpperCase();
  var dec=(NODEC.indexOf(cur)>=0&&m%100===0)?0:2;
  var s=(m/100).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  return (code?code+' ':'')+s;
}
function iso(d){return d.toISOString().slice(0,10)}
function today(){return iso(new Date())}
/* Drops a trailing ".00" with plain string surgery: this page script is a template literal, so an
   escaped dot inside a regex collapses to a wildcard and eats real digits ("VND 15,300" → "VND 15,"). */
function trimMoney(text){ var s=String(text); return s.slice(-3)==='.00'?s.slice(0,-3):s }

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
function busy(btn,on){ if(btn){ btn.disabled=!!on; if(on){btn.setAttribute('aria-busy','true')}else{btn.removeAttribute('aria-busy')} } }

var TABS=(function(){
  var out=[], nodes=null;
  try{ nodes=document.querySelectorAll('#nav-drawer nav button') }catch(e){ nodes=null }
  if(nodes&&nodes.length){ for(var i=0;i<nodes.length;i++){ var id=nodes[i].id||''; if(id.indexOf('tab-')===0){ out.push(id.slice(4)) } } }
  return out.length?out:['add','pay','split','ledger','balances','ranking','receipts','tools','audit','settings'];
})();
/* the drawer holds navigation, so the page it switches to is named once, plainly, next to the ☰ */
/* classList is not guaranteed — a stripped embedder or a DOM stub can hand us a bare body — so the
   drawer state is applied through one guarded pair instead of reaching for classList inline. */
function navIsOpen(){ var b=document.body; return !!(b&&b.classList&&b.classList.contains('nav-open')) }
function navSetOpen(on){ var b=document.body; if(!b||!b.classList){return} if(on){ b.classList.add('nav-open') } else { b.classList.remove('nav-open') } }
function openNav(){
  navSetOpen(true);
  var b=$('nav-open'); if(b){ b.setAttribute('aria-expanded','true') }
  var first=null; try{ first=document.querySelector('#nav-drawer button[role="tab"]') }catch(e){}
  if(first&&first.focus){ try{first.focus()}catch(err){} }
}
function closeNav(){
  if(!navIsOpen()){return}
  navSetOpen(false);
  var b=$('nav-open'); if(b){ b.setAttribute('aria-expanded','false'); if(b.focus){ try{b.focus()}catch(err){} } }
}
function navMark(tab){
  var btn=null; try{ btn=document.getElementById('tab-'+tab) }catch(e){}
  var now=$('nav-now');
  if(now&&btn&&btn.textContent){ now.textContent=btn.textContent.replace(/\\s+/g,' ').trim() }
  closeNav();
}
var stateReady=false, selectedTab='ledger', telegram=null;
/* Painting the chosen section is pure DOM, so it is deliberately not gated behind stateReady().
   The app is served with the ledger visible and every other section hidden, so waiting for /api
   before swapping showed the ledger first and then flicked to the real section - init() calls
   showTab() before loadState() for exactly that reason. Only the data loads wait for state. */
function paintTab(tab){
  for(var i=0;i<TABS.length;i++){
    var section=$(TABS[i]); if(section){section.hidden=TABS[i]!==tab}
    var btn=$('tab-'+TABS[i]); if(btn){btn.setAttribute('aria-selected',String(TABS[i]===tab))}
  }
}
function showTab(tab){
  selectedTab=tab;
  navMark(tab);
  paintTab(tab);
  if(!stateReady){return}
  if(location.hash!=='#'+tab){try{history.replaceState(null,'','#'+tab)}catch(e){}}
  if(tab==='ledger'){loadLedger()}
  if(tab==='ranking'){loadRanking()}
  if(tab==='balances'){loadBalances()}
  if(tab==='split'){renderSplit();loadRecentSplits()}
  if(tab==='audit'){loadAudit()}
  if(tab==='settings'){renderSettings()}
  if(tab==='receipts'){refreshReceipts()}
}

function rosterSignature(){
  return people.map(function(p){return p.id+':'+p.display_name+':'+(p.emoji||'')+':'+(p.is_archived?1:0)}).join('|')+'/'+currencies.map(function(c){return c.id+':'+c.code+':'+(c.is_archived?1:0)+':'+(c.is_default?1:0)}).join('|')+'/'+((settings&&settings.timezone)||'');
}
function renderSplitPeople(){
  var box=$('sp-people'); if(!box){return}
  var inputs=box.querySelectorAll('input[type=checkbox]'); var chosen={}; var any=false;
  for(var i=0;i<inputs.length;i++){ if(inputs[i].checked){chosen[inputs[i].value]=1;any=true} }
  var html='';
  for(var k=0;k<people.length;k++){ var p=people[k]; if(p.is_archived){continue}
    var on=any?!!chosen[String(p.id)]:true;
    html+='<label class="check"><input type="checkbox" value="'+p.id+'"'+(on?' checked':'')+'><span>'+esc((p.emoji?p.emoji+' ':'')+p.display_name)+'</span></label>';
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
  me=r.data.workspace; people=r.data.people||[]; currencies=r.data.currencies||[]; settings=r.data.settings||null; backups=r.data.backups||null; telegram=r.data.telegram||null;
  $('banner').hidden=true;
  if(me&&me.name){document.title=me.name}
  var sig=rosterSignature(); if(sig!==rosterSig){ rosterSig=sig; renderSplitPeople() }
  await syncInstructions();
  stateReady=true;
  if(selectedTab){showTab(selectedTab)}
  return true;
}

/* ---------------- ledger ---------------- */
function txRow(t){
  var el=document.createElement('div'); el.className='row';
  /* a repayment moves money the other way, so it counts as a negative movement of what is outstanding */
  /* One arithmetic for every surface, so no two views can disagree about the same row: a debt adds
     to what is owed, a repayment reduces it, and an offset row already carries its own signed value
     because netting writes both directions negative. */
  var signed=signedMinor(t);
  var cls=signed>0?'pos':(signed<0?'neg':'zero');
  el.innerHTML='<div class="row-main"><div class="who">'+esc(t.topic)+' <span class="chip '+esc(t.entry_kind)+'">'+esc(t.entry_kind)+'</span></div><div class="meta">'+esc(t.occurred_on)+' · '+esc(name(t.creditor_person_id))+' → '+esc(name(t.debtor_person_id))+'<span class="cat"> · '+esc(t.category)+'</span></div></div>'+
    '<div class="row-side"><div class="amt '+cls+'">'+esc(signedMoney(signed,t.currency_code))+'</div><button class="mini icon danger" data-del="'+t.id+'" type="button" title="Delete transaction" aria-label="Delete transaction"><span aria-hidden="true">🗑️</span></button></div>';
  return el;
}
var TXPAGE=50, txPage=1, txCache=[];
async function loadLedger(){
  var list=$('tx-list'); list.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ list.innerHTML='<div class="err">'+esc(r.error)+'</div>'; var p0=$('tx-pager'); if(p0){p0.hidden=true} return }
  var txs=(r.data&&r.data.transactions)||[]; txCache=txs;
  var totals={};
  for(var i=0;i<txs.length;i++){ var t=txs[i]; totals[t.currency_code]=(totals[t.currency_code]||0)+signedMinor(t) }
  var keys=Object.keys(totals).sort();
  var box=$('tx-totals'); box.innerHTML='';
  if(keys.length){ for(var k=0;k<keys.length;k++){ var v=totals[keys[k]], cls2=v>0?'pos':(v<0?'neg':'zero'); var d=document.createElement('div'); d.className='total'; d.innerHTML='<span>'+esc(keys[k])+' outstanding</span><b class="'+cls2+'">'+esc(money(v,keys[k])||'')+'</b>'; box.appendChild(d) } }
  var cnt=$('tx-count'); if(cnt){ cnt.textContent=(txs.length===1?'1 entry':txs.length+' entries') }
  renderTxList();
  renderSpend(txs);
}
/* One arithmetic for every surface, so no two views can disagree about the same row: a debt adds to
   what is owed, a repayment reduces it, and an offset row already carries its own signed value because
   netting writes both directions negative. The rule itself lives in src/money.ts — the page keeps its
   own copy because it ships as a template literal, and test/money.test.ts lifts this function and holds
   it to the shared rule. A repayment is identified by its KIND or by a negative amount, because the page
   posts repayments positive while the CSV import stores them negative. */
function signedMinor(t){
  var a=Math.abs(Number(t.amount_minor)||0);
  return (t.entry_kind==='payment'||Number(t.amount_minor)<0)?-a:a;
}
/* ---------------- maximum payment (only the Record a payment page) ----------------
   The most that can be repaid is what the debtor still owes the creditor, so the cap is the ledger's
   own number rather than a form-side guess: the signedMinor() sum of the rows between those two
   people, per currency, floored at zero. A settled pair reads 0 and its Max button stays disabled,
   and because the sum is the same arithmetic the ledger and the Balances view use, no two surfaces
   can disagree about what is still owed. Archived rows never move a balance, so they are skipped. */
var payLimitMax={}, payLimitSeq=0;
function payLimitNote(){ return '<span class="hint" id="p-limits-note">' }
async function payLimits(){
  var box=$('p-limits-list'); if(!box){ return }
  var d=Number(($('p-debtor')||{}).value||0), c=Number(($('p-creditor')||{}).value||0);
  if(!d||!c||d===c){
    payLimitMax={};
    box.innerHTML='<span class="hint">'+(d&&c?'The two people must be different.':'Choose who repaid and who was owed, and the most they can pay appears here.')+'</span>';
    return;
  }
  var seq=++payLimitSeq;
  box.innerHTML='<span class="hint">Checking what is owed…</span>';
  var r=await call('/transactions');
  if(seq!==payLimitSeq){ return }
  if(!r.ok){ payLimitMax={}; box.innerHTML='<span class="hint">'+esc(r.error)+'</span>'; return }
  var txs=(r.data&&r.data.transactions)||[], owe={}, i, t;
  for(i=0;i<txs.length;i++){
    t=txs[i];
    /* A row names the creditor (who is owed) and the debtor (who owes); payments are stored the same
       way and signedMinor() already flips them negative. payer_person_id/payee_person_id exist only
       on split *inputs* and never on a stored row, so matching on them silently matched nothing. */
    if(t.is_deleted||Number(t.creditor_person_id)!==c||Number(t.debtor_person_id)!==d){ continue }
    owe[t.currency_code]=(owe[t.currency_code]||0)+signedMinor(t);
  }
  var out='', top=0, codes=[];
  for(i=0;i<currencies.length;i++){
    var cu=currencies[i];
    var code=String((typeof cu==='string'?cu:(cu&&(cu.code||cu.currency_code)))||'');
    if(!code){ continue }
    codes.push(code);
  }
  payLimitMax={};
  for(i=0;i<codes.length;i++){
    var m=Math.max(0,owe[codes[i]]||0); if(m>top){ top=m }
    payLimitMax[codes[i]]=m;
    out+='<span class="pill'+(m>0?'':' zero')+'"><b>'+esc(money(m,codes[i]))+'</b><button class="mini ghost" type="button" data-pl-max="'+esc(codes[i])+'"'+(m>0?'':' disabled aria-disabled="true"')+'>Max</button></span>';
  }
  box.innerHTML=(out||'<span class="hint">No currencies yet.</span>')
    +payLimitNote()+(top>0
      ? '“Max” fills the amount with everything still owed in that currency.'
      : 'Nothing is outstanding this way round — if money really moved, use Swap people.')+'</span>';
}
function applyMaxPayment(code){
  var m=Number(payLimitMax[code]||0); if(!(m>0)){ return }
  if($('p-currency')){ $('p-currency').value=code }
  if($('p-amount')){ $('p-amount').value=(m/100).toFixed(2); $('p-amount').focus() }
  toast(money(m,code)+' filled in — everything still owed in '+code);
}
/* ---------------- ranking ---------------- */
var rankingCurrency='', rankingRows=null, rankingRequestId=0;
async function loadRanking(){
  var box=$('ranking-list'); if(!box){return}
  var requestId=++rankingRequestId;
  rankingRows=null;
  box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(requestId!==rankingRequestId||selectedTab!=='ranking'){return}
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  rankingRows=(r.data&&r.data.transactions)||[];
  renderRanking(rankingRows);
}
function renderRanking(rows){
  var pills=$('ranking-currencies'), box=$('ranking-list'); if(!pills||!box){return}
  var active=[], i;
  for(i=0;i<currencies.length;i++){ if(!currencies[i].is_archived){active.push(currencies[i])} }
  if(!rankingCurrency||!active.some(function(c){return c.code===rankingCurrency})){ rankingCurrency=((active.filter(function(c){return c.is_default})[0])||active[0]||{}).code||'' }
  var currency=rankingCurrency;
  pills.innerHTML='';
  for(i=0;i<active.length;i++){
    var c=active[i], pressed=c.code===currency;
    pills.innerHTML+='<button type="button" data-ranking-currency="'+esc(c.code)+'" aria-pressed="'+(pressed?'true':'false')+'">'+esc(c.code)+'</button>';
  }
  if(!currency){ box.innerHTML='<div class="empty">No active currencies.</div>'; return }
  var balances=netsByCurrency(rows)[currency]||{}, ranked=[], id;
  for(id in balances){ if(balances.hasOwnProperty(id)){
    var person=null;
    for(i=0;i<people.length;i++){ if(people[i].id===Number(id)){person=people[i];break} }
    if(person&&!person.is_archived&&balances[id]<0){ ranked.push({person:person,balance_minor:balances[id]}) }
  } }
  ranked.sort(function(a,b){ return a.balance_minor-b.balance_minor||String(a.person.display_name).localeCompare(String(b.person.display_name))||Number(a.person.id)-Number(b.person.id) });
  if(!ranked.length){
    /* The selected currency has no debtor. */
    box.innerHTML='<div class="empty">No one owes money in '+esc(currency)+'.</div>'; return;
  }
  var max=Math.abs(ranked[0].balance_minor), html='';
  for(i=0;i<ranked.length;i++){
    var row=ranked[i], pct=Math.max(6,Math.round(Math.abs(row.balance_minor)*100/max));
    html+='<button class="ranking-row" type="button" data-person="'+row.person.id+'" aria-haspopup="dialog">'+
      '<span class="ranking-row-main"><span class="ranking-row-identity"><span class="ranking-row-rank">#'+(i+1)+'</span>'+(row.person.emoji?'<span class="ranking-row-avatar" aria-hidden="true">'+esc(row.person.emoji)+'</span>':'')+'<span class="ranking-row-name">'+esc(row.person.display_name)+'</span></span><span class="ranking-row-amount">owes '+esc(money(Math.abs(row.balance_minor),currency))+'</span></span>'+
      '<span class="ranking-bar" aria-hidden="true"><span class="ranking-bar-fill" style="width:'+pct+'%"></span></span></button>';
  }
  box.innerHTML=html;
}
function selectRankingCurrency(code){ rankingCurrency=code; if(rankingRows!==null){renderRanking(rankingRows)} }
function renderTxList(){
  var list=$('tx-list'); if(!list){return}
  list.innerHTML='';
  var txs=txCache||[], pager=$('tx-pager');
  var pages=Math.max(1,Math.ceil(txs.length/TXPAGE));
  if(txPage>pages){ txPage=pages } if(txPage<1){ txPage=1 }
  if(!txs.length){ list.innerHTML='<div class="empty">🗒️ No transactions yet. Add the first one above.</div>'; if(pager){pager.hidden=true} return }
  var from=(txPage-1)*TXPAGE, slice=txs.slice(from,from+TXPAGE);
  for(var j=0;j<slice.length;j++){ list.appendChild(txRow(slice[j])) }
  if(!pager){return}
  if(pages<=1){ pager.hidden=true; return }
  pager.hidden=false;
  $('tx-pager-info').textContent='Page '+txPage+' of '+pages+' · showing '+(from+1)+'–'+(from+slice.length)+' of '+txs.length;
  $('tx-prev').disabled=(txPage<=1); $('tx-next').disabled=(txPage>=pages);
}
function txGo(delta){
  txPage=txPage+delta; renderTxList();
  var l=$('tx-list'); if(l&&l.scrollIntoView){ l.scrollIntoView({block:'nearest'}) }
}
async function delTx(id,btn){
  if(!confirm('Delete this transaction? It stays restorable in the audit log.')){return}
  busy(btn,true);
  var r=await call('/transactions/'+id,{method:'DELETE'});
  busy(btn,false);
  if(!r.ok){ toast(r.error,true); return }
  toast('Transaction deleted'); loadLedger();
}
/* ---------------- review before writing ----------------
   Both writes (a ledger entry and a split) pass through one review sheet. It shows the
   least it can: who moved what to whom, the amount in the ledger's own colours, and one
   plain sentence. Nothing reaches the API until Confirm is pressed - Back, Escape and a
   backdrop tap all leave the form exactly as it was. */
var reviewAction=null, reviewBusy=false, reviewOpener=null, reviewCountdown=0;
function reviewRows(items){
  var html='';
  for(var i=0;i<items.length;i++){ if(items[i][1]){ html+='<div class="k">'+esc(items[i][0])+'</div><div class="v">'+items[i][1]+'</div>' } }
  return html?'<div class="rf-rows">'+html+'</div>':'';
}
function reviewWho(id,strong){
  var n=esc(name(id));
  return strong?('<span class="rf-who">'+n+'</span>'):n;
}
function txReview(rows){
  var one=rows[0], pay=one.entry_kind==='payment';
  var debtor=name(one.debtor_person_id), creditor=name(one.creditor_person_id);
  var body='<div class="rf-head">'+(pay
      ? (reviewWho(one.debtor_person_id)+' <span class="rf-v">repaid</span> '+reviewWho(one.creditor_person_id))
      : (reviewWho(one.creditor_person_id)+' <span class="rf-v">paid for</span> '+reviewWho(one.debtor_person_id)))+'</div>'+
    '<div class="rf-amt '+(pay?'neg':'pos')+'">'+esc(signedMoney(pay?-one.amount_minor:one.amount_minor,one.currency_code))+'</div>'+
    '<p class="rf-why">'+(pay
      ? ('Money going back, so '+esc(debtor)+' owes less to '+esc(creditor)+'.')
      : (esc(debtor)+' owes this to '+esc(creditor)+' from now on.'))+'</p>'+
    reviewRows([['What',esc(one.topic)],['Category',esc(one.category)],['Date',esc(one.occurred_on)],['Note',one.notes?esc(one.notes):'']]);
  return { title: pay?'Review repayment':'Review new debt', icon: pay?'📥':'💳',
    confirm: pay?'Confirm repayment':'Confirm debt', body: body };
}
function splitReview(d){
  var ids=d.participant_person_ids.slice(0).sort(function(a,b){return a-b});
  var alloc=allocate(d.amount_minor,ids), owed=0, chips='', debts=0;
  for(var i=0;i<alloc.length;i++){ var a=alloc[i], payer=a.person_id===d.payer_person_id;
    if(payer){ chips+='<span class="chip payer">'+esc(name(a.person_id))+' · paid the bill</span>' }
    else { owed+=a.amount_minor; debts++; chips+='<span class="chip">'+esc(name(a.person_id))+' · '+esc(money(a.amount_minor,d.currency_code))+'</span>' }
  }
  var payer=esc(name(d.payer_person_id));
  var body='<div class="rf-head">'+reviewWho(d.payer_person_id)+' <span class="rf-v">paid</span> '+esc(money(d.amount_minor,d.currency_code))+' for '+ids.length+' people</div>'+
    '<div class="rf-amt pos">'+esc(signedMoney(owed,d.currency_code))+'</div>'+
    '<p class="rf-why">'+debts+(debts===1?' debt':' debts')+' will be created - each share is listed below.</p>'+
    '<div class="rf-chips">'+chips+'</div>'+
    reviewRows([['What',esc(d.topic)],['Category',esc(d.category)],['Date',esc(d.occurred_on)]]);
  return { title:'Review split', icon:'✂️', confirm:'Confirm split', body: body };
}
function openReview(build,action,btn){
  var m=$('review-modal');
  if(!m){ action(); return }   /* never block a write if the sheet's markup is missing */
  reviewAction=action; reviewBusy=false; reviewOpener=(btn&&btn.focus)?btn:(document.activeElement||null);
  var t=$('rv-title'), c=$('rv-confirm');
  if(t){ t.textContent=build.title }
  $('rv-body').innerHTML=build.body;
  var countdown=++reviewCountdown;
  if(c){
    c.disabled=true;
    c.innerHTML='<span aria-hidden="true">'+esc(build.icon)+'</span> Review (2)';
    setTimeout(function(){
      if(countdown===reviewCountdown&&!m.hidden&&c){ c.innerHTML='<span aria-hidden="true">'+esc(build.icon)+'</span> Review (1)' }
    },1000);
    setTimeout(function(){
      if(countdown===reviewCountdown&&!m.hidden&&c){ c.innerHTML='<span aria-hidden="true">'+esc(build.icon)+'</span> '+esc(build.confirm); c.disabled=false }
    },2000);
  }
  m.hidden=false;
  var back=$('rv-back'); if(back&&back.focus){ try{ back.focus() }catch(err){} }
}
function closeReview(){
  var m=$('review-modal'); if(!m||m.hidden){return}
  m.hidden=true; reviewAction=null; reviewBusy=false; reviewCountdown++;
  /* backing out of the sheet must not leave a receipt link armed for whatever is typed next */
  logReceiptId=null;
  if(reviewOpener&&reviewOpener.focus){ try{ reviewOpener.focus() }catch(err){} }
  reviewOpener=null;
}
async function confirmReview(){
  var m=$('review-modal'); if(!m||m.hidden||reviewBusy||!reviewAction){return}
  var btn=$('rv-confirm'), act=reviewAction, label=btn?btn.innerHTML:'';
  reviewBusy=true;
  if(btn){ btn.disabled=true; btn.innerHTML='<span aria-hidden="true">⏳</span> Saving…' }
  try{ await act() }catch(err){}
  if(btn){ btn.disabled=false; btn.innerHTML=label }
  reviewBusy=false;
  closeReview();
}
/* One form definition per writing page. Each page writes exactly one kind of entry, so the kind is
   baked into the page rather than picked from a dropdown — a new-debt page can only ever create
   a debt, and a repayment page can only ever create a repayment. */
var TX_FORM={date:'t-date',topic:'t-topic',category:'t-category',creditor:'t-creditor',debtor:'t-debtor',amount:'t-amount',currency:'t-currency',notes:'t-notes',err:'t-err',add:'t-add'};
var PAY_FORM={date:'p-date',topic:'p-topic',category:'p-category',creditor:'p-creditor',debtor:'p-debtor',amount:'p-amount',currency:'p-currency',notes:'p-notes',err:'p-err',add:'p-add'};
async function addTx(kind, F){
  var btn=$(F.add); var err=$(F.err); err.textContent='';
  clearTxInvalid(F);
  var rows=[{occurred_on:$(F.date).value,entry_kind:kind,topic:$(F.topic).value.trim(),
    category:$(F.category).value.trim(),creditor_person_id:Number($(F.creditor).value),
    debtor_person_id:Number($(F.debtor).value),amount_minor:toMinor($(F.amount).value),
    currency_code:$(F.currency).value,notes:$(F.notes).value.trim()}];
  var problem=validateRows(rows);
  if(problem){ markTxInvalid(F,rows[0]); err.textContent=problem; return }
  /* nothing is written until the review sheet is confirmed */
  openReview(txReview(rows), function(){ return postRows(rows,btn,err) }, btn);
}
function clearTxInvalid(F){
  $(F.amount).removeAttribute('aria-invalid'); $(F.topic).removeAttribute('aria-invalid');
}
function markTxInvalid(F,row){
  if(!row.amount_minor){ $(F.amount).setAttribute('aria-invalid','true') }
  if(!row.topic){ $(F.topic).setAttribute('aria-invalid','true') }
}
function validateRows(rows){
  if(!rows.length){return 'Nothing to add.'}
  if(rows.length===1){ var one=rows[0];
    if(!one.topic||!one.category){return 'Topic and category are required.'}
    if(!one.amount_minor){return 'Enter a positive amount.'}
    if(one.creditor_person_id===one.debtor_person_id){return 'Creditor and debtor must differ.'}
  }
  return '';
}
async function postRows(rows,btn,err){
  busy(btn,true);
  var r=(rows.length===1)
    ? await call('/transactions',{method:'POST',body:rows[0]})
    : await call('/batches',{method:'POST',headers:{'idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},body:{rows:rows}});
  busy(btn,false);
  if(!r.ok){ err.textContent=r.error; toast(r.error,true); return false }
  var doneMsg=rows.length===1?'Transaction added':(rows.length+' transactions added');
  if(r.data&&r.data.netted_pairs){ doneMsg+=' · '+r.data.netted_pairs+' reciprocal balance'+(r.data.netted_pairs===1?'':'s')+' netted' }
  toast(doneMsg);
  $('t-amount').value=''; $('t-topic').value=''; $('t-category').value='Other'; $('t-notes').value='';
  var loggedReceipt=logReceiptId; logReceiptId=null;
  if(loggedReceipt&&r.data&&r.data.transaction){ linkReceiptTransaction(loggedReceipt,r.data.transaction.id) }
  loadLedger(); return true;
}
/* ---------------- balances ---------------- */
async function loadBalances(){
  var box=$('balance-people'); box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ box.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  var txs=(r.data&&r.data.transactions)||[], counts={};
  for(var i=0;i<txs.length;i++){ var t=txs[i]; if(t.is_deleted){continue}
    counts[t.creditor_person_id]=(counts[t.creditor_person_id]||0)+1;
    counts[t.debtor_person_id]=(counts[t.debtor_person_id]||0)+1;
  }
  box.innerHTML='';
  /* The row answers where this person stands, per currency, without opening the drawer. The default
     currency leads and the rest trail in smaller type, so a long SGD tail never competes with VND. */
  var nets=netsByCurrency(txs), netCodes=Object.keys(nets).sort();
  var defaultCode=((currencies.filter(function(c){return c.is_default})[0])||currencies[0]||{}).code||netCodes[0]||'';
  var order=people.slice().sort(function(a,b){ return (a.is_archived?1:0)-(b.is_archived?1:0) || String(a.display_name).localeCompare(String(b.display_name)) });
  if(!order.length){ box.innerHTML='<div class="empty">No people yet — add them in Settings.</div>'; return }
  for(var j=0;j<order.length;j++){ var p=order[j], count=counts[p.id]||0;
    var el=document.createElement('button'); el.type='button';
    el.className='person-card'+(p.is_archived?' archived':''); el.setAttribute('data-person',p.id); el.setAttribute('aria-haspopup','dialog');
    var cells=[];
    for(var nc=0;nc<netCodes.length;nc++){ var ncCode=netCodes[nc], ncNet=(nets[ncCode]&&nets[ncCode][p.id])||0;
      if(ncNet){ cells.push({code:ncCode,net_minor:ncNet}) } }
    cells.sort(function(a,b){ return (b.code===defaultCode?1:0)-(a.code===defaultCode?1:0)||String(a.code).localeCompare(String(b.code)) });
    var netsHtml='';
    for(var nci=0;nci<cells.length;nci++){ var cell=cells[nci];
      netsHtml+='<span class="p-net '+(cell.net_minor>0?'pos':'neg')+(nci?' sub':'')+'">'+esc((cell.net_minor>0?'+':'−')+money(Math.abs(cell.net_minor),cell.code))+'</span>';
    }
    el.innerHTML='<span class="p-chev" aria-hidden="true">›</span>'+
      '<span class="p-main"><span class="who">'+esc(p.display_name)+(p.is_archived?' <span class="chip">archived</span>':'')+'</span>'+
      '<span class="meta">'+count+' record'+(count===1?'':'s')+'</span>'+
      '</span>'+
      '<span class="p-nets">'+(netsHtml||'<span class="p-settled">settled</span>')+'</span>';
    box.appendChild(el);
  }
  renderSettle(txs);
  var ob=$('offset-list'); ob.innerHTML='<div class="empty">Loading…</div>';
  var o=await call('/offset-suggestions');
  if(!o.ok){ ob.innerHTML='<div class="err">'+esc(o.error)+'</div>'; return }
  var sug=(o.data&&o.data.suggestions)||[];
  ob.innerHTML='';
  /* nothing to offset means the whole offsets card is noise: it is only shown when it has a row */
  var oc=$('offset-card'); if(oc){ oc.hidden=!sug.length }
  if(!sug.length){ ob.innerHTML=''; return }
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
function initials(n){ var parts=String(n==null?'':n).trim().split(/\\s+/); if(!parts[0]){return '?'} var out=parts[0].slice(0,1); if(parts.length>1){ out=out+parts[parts.length-1].slice(0,1) } return out.toUpperCase() }
function signedMoney(v,code){ if(!v){return '—'} return (v>0?'+':'−')+money(Math.abs(v),code) }
function netPhrase(v,who){ return v>0?('owed to '+who):(v<0?('owed by '+who):'settled up') }
function netChip(v,code,who){
  /* the amount is its own span so a long one can drop to its own line; widowed words inside a
     nowrap amount made billion-đồng chips overflow their card at phone width. */
  var cls=v>0?'pos':(v<0?'neg':''), amt=v?((v>0?'+':'−')+money(Math.abs(v),code)):'';
  return (amt?'<span class="amt '+cls+'">'+esc(amt)+'</span> ':'')+'<span class="say">'+esc(netPhrase(v,who))+'</span>';
}
function kpi(label,value,cls){
  /* a tile holding a billion-đồng figure spans the row, so the number is never split mid-group */
  var wide=String(value).length>16?' wide':'';
  return '<div class="kpi'+wide+'"><div class="k-label">'+esc(label)+'</div><div class="k-value '+(cls||'')+'">'+esc(value)+'</div></div>' }
function recRow(t,me,withPerson){
  /* Inside a relationship the counterparty is already the heading, so the row only says what kind of
     record it is: a debt one of them paid, or a repayment. Green came to this person, red left.
     The analytics cards have no such heading, so there every row names both people outright: a bare
     "they paid" leaves the reader unable to tell who "they" is. */
  var kind=t.entry_kind==='payment'?'repayment':(t.entry_kind==='offset'?'offset':'debt');
  var mine=t.direction==='paid_for'||t.direction==='settled_out';
  var meName=me||'this person';
  var other=t.counterparty||'someone';
  var label;
  if(withPerson){
    if(t.direction==='paid_for'){ label=meName+' paid for '+other }
    else if(t.direction==='covered_for_them'){ label=other+' paid for '+meName }
    else if(t.direction==='settled_in'){ label=other+' paid '+meName+' back' }
    else { label=meName+' paid '+other+' back' }
  } else {
    label=(mine?meName:other)+(t.direction==='paid_for'||t.direction==='covered_for_them'?' paid':' paid back');
  }
  var cls=(t.direction==='covered_for_them'||t.direction==='settled_in')?'pos':'neg';
  var arch=(t.is_deleted===1);
  return '<div class="rec'+(arch?' is-arch':'')+'"><span class="r-main"><span class="r-head"><span class="r-topic">'+esc(t.topic)+'</span>'+(arch?'<span class="tag-arch">archived</span>':'')+'</span>'+
    '<span class="r-meta">'+esc(t.occurred_on)+' · '+esc(kind)+(t.category?' · '+esc(t.category):'')+' · '+esc(label)+'</span></span>'+
    '<span class="r-amt '+cls+'">'+esc(money(Math.abs(t.amount_minor),t.currency_code))+'</span>'+
    (arch?'<span class="r-act"><button class="mini ghost" type="button" data-txrestore="'+t.id+'">↩ Restore</button></span>':'')+'</div>';
}
function pairLine(pr,me){
  var owesMe=pr.net_minor>0, meOwes=pr.net_minor<0;
  var line=owesMe?(pr.counterparty+' owes '+me):(meOwes?(me+' owes '+pr.counterparty):(pr.counterparty+' — settled up'));
  var amt=(owesMe||meOwes)?' <span class="amt '+(owesMe?'pos':'neg')+'">'+esc(money(Math.abs(pr.net_minor),pr.currency_code))+'</span>':'';
  return '<span class="who">'+esc(line)+amt+'</span>';
}

function togglePair(key){
  var el=$('pm-pair-'+key); if(!el){return}
  el.hidden=!el.hidden;
  var head=document.querySelector('[data-pair="'+key+'"]');
  if(head){ head.setAttribute('aria-expanded',String(!el.hidden)) }
}
function toggleAnalytics(key){
  var el=$('pm-analytics-'+key); if(!el){return}
  el.hidden=!el.hidden;
  var head=document.querySelector('[data-analytics="'+key+'"]');
  if(head){ head.setAttribute('aria-expanded',String(!el.hidden)) }
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
function pmSides(inLabel,inAmt,inCls,outLabel,outAmt,outCls,code,compact){
  /* green is money coming to this person, red is money leaving them; the same pair drives every
     row, so a reader needs one habit, not a legend. Inside a relationship a zero side is noise and
     drops out; in the summary both sides stay, because "owed minus owes" is the whole point. */
  function side(label,amt,cls){
    return '<div class="pm-side"><span class="s-label">'+label+'</span>'+
      '<span class="amt '+((amt?cls:'zero'))+'">'+esc(money(amt,code))+'</span></div>';
  }
  if(compact){
    var out=[];
    if(inAmt){ out.push(side(inLabel,inAmt,inCls)) }
    if(outAmt){ out.push(side(outLabel,outAmt,outCls)) }
    if(!out.length){ return '<div class="pm-sides pm-sides-in"><p class="meta">Nothing outstanding here any more.</p></div>' }
    return '<div class="pm-sides pm-sides-in">'+out.join('')+'</div>';
  }
  return '<div class="pm-sides">'+side(inLabel,inAmt,inCls)+side(outLabel,outAmt,outCls)+'</div>';
}
function personHistory(rows){
  var byCurrency={}, codes=[];
  for(var i=0;i<rows.length;i++){
    var row=rows[i]; if(!row||Number(row.is_deleted)){continue}
    var code=String(row.currency_code||'');
    if(!byCurrency[code]){ byCurrency[code]=[]; codes.push(code) }
    byCurrency[code].push(row);
  }
  codes.sort();
  var groups=[];
  for(var c=0;c<codes.length;c++){
    var list=byCurrency[codes[c]];
    list.sort(function(a,b){ if(a.occurred_on===b.occurred_on){ return Number(a.id)-Number(b.id) } return a.occurred_on<b.occurred_on?-1:1 });
    var running=0, entries=[];
    for(var j=0;j<list.length;j++){
      var record=list[j], amount=Math.abs(Number(record.amount_minor)||0), impact=0;
      if(record.direction==='paid_for'||record.direction==='settled_out'){ impact=amount }
      else if(record.direction==='covered_for_them'||record.direction==='settled_in'){ impact=-amount }
      running+=impact;
      entries.push({record:record,amount_minor:impact,running_minor:running});
    }
    groups.push({currency_code:codes[c],net_minor:running,rows:entries});
  }
  return groups;
}
function historyKind(record){
  if(record.entry_kind==='offset'){ return 'Offset' }
  if(record.entry_kind==='payment'){ return 'Payment' }
  return 'Bill share';
}
function historyDetail(record,meName){
  if(record.entry_kind==='offset'){ return meName+' and '+((record.counterparty)||'someone')+' netted' }
  var other=record.counterparty||'someone';
  if(record.direction==='paid_for'){ return meName+' paid · '+other+"'s share" }
  if(record.direction==='covered_for_them'){ return other+' paid · '+meName+"'s share" }
  if(record.direction==='settled_in'){ return other+' paid '+meName+' back' }
  return meName+' paid '+other+' back';
}
function renderPerson(){
  var d=pmData||{}, p=d.person||{}, body=$('pm-body'), title=$('pm-title');
  if(title){ title.textContent=((p.emoji?p.emoji+' ':'')+(p.display_name||'Person'))+(p.is_archived?' (archived)':'') }
  var totals=d.totals||[], records=d.records||{}, html='';
  var meName=p.display_name||'this person';
  /* Lead with the group-wide payment plan. Direct pair balances remain useful evidence, but are not
     necessarily the payment this person needs to make after the whole group is settled together. */
  var allPairs=d.counterparties||[];
  for(var c=0;c<totals.length;c++){ var t=totals[c];
    /* One line per payment the plan asks for. A person the plan sends to two creditors gets two
       lines with their own amounts — a single "Pay 29.55 to Ww and Bj" names a total that is not
       any payment, and the exact amount for each creditor is what the drawer is for. */
    var legs=t.net_minor?settleLegs(t.currency_code,p.id):[], partnerNames=[];
    if(legs.length){
      for(var q=0;q<legs.length;q++){ var leg=legs[q];
        html+='<div class="pm-why"><div class="pm-why-top"><span class="who">'+
          (t.net_minor>0?'Receive ':'Pay ')+'<span class="amt '+(t.net_minor>0?'pos':'neg')+'">'+
          esc(trimMoney(money(leg.amount_minor,t.currency_code)))+'</span>'+
          (t.net_minor>0?' from ':' to ')+esc(name(leg.id))+
          '</span></div></div>';
      }
    } else {
      /* no plan line reaching this person: fall back to the aggregate, and say plainly that the
         card above is where the payment comes from rather than inventing a counterparty */
      var partners=settlePartners(t.currency_code,p.id);
      for(var w=0;w<partners.length;w++){ partnerNames.push(name(partners[w])) }
      var amountText=esc(trimMoney(money(Math.abs(t.net_minor),t.currency_code)));
      var act=(t.net_minor>0?'Receive ':'Pay ')+'<span class="amt '+(t.net_minor>0?'pos':'neg')+'">'+amountText+'</span>';
      var dir=t.net_minor?((t.net_minor>0?' from ':' to ')+esc(partnerNames.length?partnerNames.join(' and '):'Settle Up')):'';
      html+='<div class="pm-why"><div class="pm-why-top"><span class="who">'+
        (t.net_minor?act+dir:'No payment needed')+
        '</span></div>'+
        (!t.net_minor&&allPairs.length?'<p class="pm-why-explanation">The direct records below cancel out inside the group, so no payment is needed.</p>':'')+
        '</div>';
    }
  }
  function analyticsAmounts(field,cls){
    var out=[];
    for(var a=0;a<totals.length;a++){ var at=totals[a]; out.push('<span class="pm-analytics-amount '+cls+'">'+esc(money(at[field]||0,at.currency_code))+'</span>') }
    return out.join('');
  }
  html+='<p class="meta">'+(records.active||0)+' active record'+((records.active===1)?'':'s')+((records.archived||0)?' · '+records.archived+' archived':'')+'</p>';
  var pairs=d.counterparties||[];
  var bk=d.breakdown||{};
  /* Every relationship expands into the rows that produced it. This reads the full per-person
     history rather than the 25-row Recent activity window, so a repayment from weeks ago is never
     silently missing from the row that reports it. */
  var history=[].concat(bk.paid_for||[],bk.covered_for_them||[],bk.settlements||[]);
  function recsForPair(pr){
    var out=[];
    for(var i=0;i<history.length;i++){ var r0=history[i];
      if(r0.counterparty_id===pr.counterparty_id&&r0.currency_code===pr.currency_code){ out.push(r0) } }
    out.sort(function(a,b){ if(a.occurred_on===b.occurred_on){ return b.id-a.id } return a.occurred_on<b.occurred_on?1:-1 });
    return out;
  }
  var legacyFoldStart=html.length;
  html+='<details class="pm-more"><summary>Original balances</summary><p class="pm-ledger-trail-hint">Direct records between people. Not always a payment you owe.</p><section class="pm-relations">';
  if(!pairs.length){ html+='<div class="empty pm-relations-empty">Nothing outstanding with anyone yet.</div>' }
  for(var q=0;q<pairs.length;q++){ var pr=pairs[q]; var key=pr.currency_code+'-'+pr.counterparty_id;
    var pairOwedTo=Math.max((pr.paid_for_minor||0)-(pr.settled_in_minor||0),0);
    var pairOwes=Math.max((pr.covered_minor||0)-(pr.settled_out_minor||0),0);
    var recs=recsForPair(pr);
    var detail=pmSides('Still owed to '+esc(meName),pairOwedTo,'pos',esc(meName)+' still owes',pairOwes,'neg',pr.currency_code,true)+
      (recs.length?recs.map(function(r0){ return recRow(r0,meName) }).join(''):'<div class="empty">No records for this pair.</div>');
    html+='<div class="pair"><button class="pair-head" type="button" data-pair="'+esc(key)+'" aria-expanded="false">'+
      '<span class="p-main">'+pairLine(pr,meName)+
      '<span class="meta">'+pr.records+' record'+(pr.records===1?'':'s')+(pr.archived_records?' · '+pr.archived_records+' archived':'')+'</span></span>'+
      '<span class="p-caret" aria-hidden="true"></span></button>'+
      '<div class="pair-detail" id="pm-pair-'+esc(key)+'" hidden>'+detail+'</div></div>';
  }
  html+='</section></details>';
  /* Analytics is deliberately after the relationship answer: these are lifetime activity totals,
     not a second way of reading the current net. settled_in means repayments received by this person. */
  function analyticsCard(key,label,field,cls,rows,empty){
    var n=rows.length, plural=n===1?'':'s';
    var detail=n?rows.map(function(r0){ return recRow(r0,meName,true) }).join(''):'<div class="empty">'+esc(empty)+'</div>';
    return '<div class="analytics-item '+cls+'"><button class="pm-analytics-card" type="button" data-analytics="'+key+'" aria-expanded="false">'+
      '<span class="pm-analytics-main"><span class="pm-analytics-label">'+esc(label)+'</span><span class="pm-analytics-count">'+n+' record'+plural+'</span></span>'+
      '<span class="pm-analytics-amounts">'+analyticsAmounts(field,cls==='in'?'pos':'neg')+'</span><span class="p-caret" aria-hidden="true"></span></button>'+
      '<div class="analytics-detail" id="pm-analytics-'+key+'" hidden>'+detail+'</div></div>';
  }
  var expenses=bk.covered_for_them||[], paidFor=bk.paid_for||[], paidBack=(bk.settlements||[]).filter(function(r0){ return r0.direction==='settled_in' });
  html+='<details class="pm-more"><summary>Activity</summary><section class="pm-analytics"><div class="pm-analytics-grid">'+
    analyticsCard('expenses','Their expenses','covered_for_them_minor','out',expenses,'Nothing was paid for them yet.')+
    analyticsCard('paid-for','What they paid for','paid_for_minor','in',paidFor,'They have not paid for anyone yet.')+
    analyticsCard('paid-back','They were paid for','settled_in_minor','in',paidBack,'Nobody has paid them back yet.')+
    '</div></section></details>';
  /* «Original balances» and «Activity» are hidden for now: the dated Full history below answers
     the same question in one place, and two extra folds above it only push it off the screen.
     The markup is still built, so flipping this one flag restores both folds untouched. */
  var SHOW_PM_LEGACY_FOLDS=false;
  if(!SHOW_PM_LEGACY_FOLDS){ html=html.slice(0,legacyFoldStart) }
  var fullHistory=personHistory(d.history||[]);
  html+='<section class="pm-full-history"><h3 class="mt-16">Full history</h3>';
  if(!fullHistory.length){ html+='<div class="empty">No active records for this person.</div>' }
  for(var h=0;h<fullHistory.length;h++){
    var group=fullHistory[h], historyRows='';
    for(var hr=0;hr<group.rows.length;hr++){
      var entry=group.rows[hr], record=entry.record;
      var amountCls=entry.amount_minor>0?'pos':(entry.amount_minor<0?'neg':'');
      historyRows+='<tr><td class="pm-history-date">'+esc(record.occurred_on)+'</td>'+
        '<td class="pm-history-detail"><span class="pm-history-kind">'+esc(historyKind(record))+'</span>'+
        '<span class="pm-history-event">'+esc(historyDetail(record,meName))+'</span>'+
        (record.topic?'<span class="pm-history-note">'+esc(record.topic)+'</span>':'')+'</td>'+
        '<td class="num pm-history-amount '+amountCls+'">'+esc(signedMoney(entry.amount_minor,group.currency_code))+'</td>'+
        '<td class="num pm-history-balance">'+esc(signedMoney(entry.running_minor,group.currency_code))+'</td></tr>';
    }
    html+='<section class="pm-history-group"><h4 class="pm-history-heading">'+
      '<span class="pm-history-currency">'+esc(group.currency_code)+' · '+group.rows.length+' record'+(group.rows.length===1?'':'s')+'</span>'+
      '<span class="pm-history-order">Oldest → newest</span>'+
      '<b class="pm-history-net '+(group.net_minor>0?'pos':(group.net_minor<0?'neg':''))+'">'+esc(signedMoney(group.net_minor,group.currency_code))+'</b></h4>'+
      '<div class="pm-history-scroll"><table class="pm-history-table"><thead><tr><th scope="col">Date</th><th scope="col">Detail</th><th scope="col" class="num">Amount</th><th scope="col" class="num">Balance</th></tr></thead><tbody>'+historyRows+'</tbody></table></div></section>';
  }
  html+='</section>';
  var sug=d.suggestions||[];
  if(sug.length){ html+='<h3 class="mt-16">Offset these</h3>';
    for(var s=0;s<sug.length;s++){ var g=sug[s];
      html+='<div class="row"><div><div class="who">'+esc(g.counterparty)+' ↔ '+esc((p.emoji?p.emoji+' ':'')+(p.display_name||''))+'</div><div class="meta">offsettable '+esc(money(g.offset_amount_minor,g.currency_code))+'</div></div>'+
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
  var archivedTx=data.archived_transactions||[];
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
    /* The log is read-only: restoring writes a NEW 'restore' row, it never edits this one. Offer the button
       only while the row is still archived, so it can never fire a no-op against something already restored. */
    var canRestore=(e.entity_type==='transaction'&&archivedTx.indexOf(Number(e.entity_id))>=0);
    d.innerHTML='<summary>'+esc(auditSummaryText(e))+' · '+esc(e.entity_type)+' #'+esc(e.entity_id)+' <span class="chip">'+esc(when)+'</span></summary>'+
      (canRestore?'<div class="btns flush mt-10"><button class="mini ghost" type="button" data-txrestore="'+String(e.entity_id)+'">↩ Restore this entry</button></div>':'')+
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
      '<div class="btns flush"><a class="mini ghost link-plain" href="'+api+'/backups/'+e.sequence+'" download>Download</a>'+
      '<button class="mini ghost" type="button" data-restore="'+e.sequence+'">Restore</button></div>';
    list.appendChild(row);
  }
}
/* Theme: read and written on this device only, keyed like the digest's seen-marker. The head script has
   already applied the saved choice before the first paint; these helpers only exist for a later tap. */
function themeChoice(){ try{ return localStorage.getItem('tfw_theme')==='dark'?'dark':'light' }catch(e){ return 'light' } }
function setTheme(t){
  t=(t==='dark')?'dark':'light';
  try{ localStorage.setItem('tfw_theme',t) }catch(e){}
  document.documentElement.setAttribute('data-theme',t);
  var m=document.querySelector('meta[name="theme-color"]');
  if(m){ m.setAttribute('content',t==='dark'?'#0b0b0d':'#f4f4f5') }
  toast(t==='dark'?'Dark theme':'Light theme');
}
function renderSettings(){
  var pbox=$('s-people'); pbox.innerHTML='';
  for(var i=0;i<people.length;i++){var p=people[i];
    var el=document.createElement('div'); el.className='row';
    el.innerHTML='<div class="p-block"><div class="who">'+(p.emoji?esc(p.emoji)+' ':'')+esc(p.display_name)+'</div><div class="meta">'+(p.is_archived?'archived':'active')+'</div>'+
      '<div class="emoji-edit"><input class="emoji-input" type="text" maxlength="16" value="'+esc(p.emoji||'')+'" placeholder="🦊" aria-label="Emoji for '+esc(p.display_name)+'" data-emoji-input="'+p.id+'"><button class="mini ghost" type="button" data-emoji-save="'+p.id+'">Save emoji</button></div></div>'+
      '<div class="btns flush"><button class="mini ghost" type="button" data-ren="'+p.id+'">Rename</button>'+
      '<button class="mini '+(p.is_archived?'':'danger')+'" type="button" data-arch="'+p.id+':'+(p.is_archived?'restore':'archive')+'">'+(p.is_archived?'Restore':'Archive')+'</button></div>';
    pbox.appendChild(el);
  }
  var cbox=$('s-currencies'); cbox.innerHTML='';
  for(var j=0;j<currencies.length;j++){var c=currencies[j];
    var cel=document.createElement('div'); cel.className='row';
    cel.innerHTML='<div class="row-main"><div class="who">'+esc(c.code)+(c.is_default?' <span class="chip">default</span>':'')+'</div><div class="meta">'+(c.is_archived?'archived':'active')+'</div></div>'+
      '<div class="btns flush">'+(c.is_default?'':'<button class="mini ghost" type="button" data-def="'+c.id+'">Set default</button>')+
      '<button class="mini '+(c.is_archived?'':'danger')+'" type="button" data-carch="'+c.id+':'+(c.is_archived?'restore':'archive')+'">'+(c.is_archived?'Restore':'Archive')+'</button></div>';
    cbox.appendChild(cel);
  }
  $('s-name').value=(me&&me.name)||'';
  if($('s-theme')){ $('s-theme').value=themeChoice(); $('s-theme').onchange=function(){ setTheme(this.value) } }
  if($('s-auto-offset')){ $('s-auto-offset').checked=!((settings&&settings.auto_offset)===0) }
  renderBackups();
  renderTelegram();
}
/* ---------------- telegram notifications ----------------
   The connected-chat list is the whole state of the feature: the connect button mints a single-use
   link, and the chat list is read straight off the workspace state. Nothing here writes a ledger row.
   Keep this region free of backticks and of the template-literal interpolation marker. */
var telegramLink=null;
function telegramLinkHtml(p){
  var command=(p&&p.command)||'', url=(p&&p.url)||'', group=(p&&p.group_command)||'';
  return '<div class="row"><div><div class="who">Send <b>'+esc(command)+'</b> to the bot</div>'+
    '<div class="meta">Single use, expires in ten minutes.</div>'+
    (group?('<div class="meta">In a group: add the bot to the group first, then send <b>'+esc(group)+'</b> there — Telegram only passes on a group command that names the bot, and only a group administrator can connect it.</div>'):'')+
    '</div>'+
    '<div class="btns flush">'+(url?('<a class="mini ghost link-plain" href="'+esc(url)+'" target="_blank" rel="noopener">Open Telegram</a>'):'')+
    '<button class="mini ghost" type="button" data-tg-copy="1">Copy command</button></div></div>';
}
function renderTelegram(){
  var box=$('s-tg-status'); if(!box){return}
  var on=!!(telegram&&telegram.configured), list=(telegram&&telegram.connections)||[];
  box.innerHTML='';
  if(!on){ box.innerHTML='<span class="err">Telegram notifications are not configured on this deployment.</span>' }
  else if(!list.length){ box.innerHTML='<span class="meta">No chat is connected yet.</span>' }
  var pair=$('s-tg-pair'); if(pair){ pair.disabled=!on }
  var out=$('s-tg-out'); if(out){ out.innerHTML=telegramLink?telegramLinkHtml(telegramLink):'' }
  var rows=$('s-tg-list'); if(!rows){return}
  rows.innerHTML='';
  for(var i=0;i<list.length;i++){var c=list[i];
    var el=document.createElement('div'); el.className='row';
    el.innerHTML='<div><div class="who">'+esc(c.chat_title||'Telegram chat')+' <span class="chip">'+esc(c.chat_type||'chat')+'</span></div>'+
      '<div class="meta">'+(c.enabled?'Notifications on':'Notifications off')+
      (c.last_error?(' &middot; <span class="err">'+esc(c.last_error)+'</span>'):'')+
      ' &middot; connected '+stamp(c.created_at)+'</div></div>'+
      '<div class="btns flush"><button class="mini ghost" type="button" data-tg-toggle="'+c.id+':'+(c.enabled?'off':'on')+'">'+(c.enabled?'Disable':'Enable')+'</button>'+
      '<button class="mini danger" type="button" data-tg-remove="'+c.id+'">Disconnect</button></div>';
    rows.appendChild(el);
  }
}
async function telegramPair(){
  var btn=$('s-tg-pair'); if(btn){ busy(btn,true) }
  var r=await call('/telegram/pair',{method:'POST'});
  if(btn){ busy(btn,false) }
  if(!r.ok){ toast(r.error||'Could not create a connect link',true); return }
  telegramLink=(r.data&&r.data.pairing)||null;
  renderTelegram();
  toast('Connect link ready — it lasts ten minutes');
}
async function telegramList(){
  var r=await call('/telegram'); if(!r.ok||!r.data){return}
  telegram=r.data; renderTelegram();
}
async function telegramAction(id,action){
  var path='/telegram/connections/'+id;
  var r=(action==='remove')?await call(path,{method:'DELETE'}):await call(path,{method:'PATCH',body:{enabled:action==='on'}});
  if(!r.ok){ toast(r.error||'Could not update this chat',true); return }
  await telegramList();
  toast(action==='remove'?'Chat disconnected':(action==='on'?'Notifications on':'Notifications off'));
}
function telegramClick(ev){
  var node=ev.target, t=(node&&node.closest)?node.closest('[data-tg-toggle],[data-tg-remove]'):null;
  if(!t){return}
  var remove=t.getAttribute('data-tg-remove');
  if(remove){ if(confirm('Disconnect this chat? It stops receiving notifications for this workspace.')){ telegramAction(Number(remove),'remove') } return }
  var spec=(t.getAttribute('data-tg-toggle')||'').split(':');
  telegramAction(Number(spec[0]),spec[1]==='on'?'on':'off');
}
function telegramCopy(){
  var command=(telegramLink&&telegramLink.command)||''; if(!command){return}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(command).then(function(){toast('Command copied')},function(){toast(command)});
    return;
  }
  toast(command);
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
  out.innerHTML='<div class="totals mt-10"><div class="total"><span>Bill</span><b>'+esc(money(d.amount_minor,d.currency_code))+'</b></div>'+
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
  openReview(splitReview(d), function(){ return postSplit(d,btn,err) }, btn);
}
async function postSplit(d,btn,err){
  busy(btn,true);
  var r=await call('/splits',{method:'POST',headers:{'idempotency-key':'ui-'+Date.now()+'-'+Math.random().toString(36).slice(2)},body:d});
  busy(btn,false);
  if(!r.ok){ err.textContent=r.error; toast(r.error,true); return }
  var txs=(r.data&&r.data.transactions)||[], owed=(r.data&&r.data.debt_amount_minor)||0;
  toast(txs.length+(txs.length===1?' debt':' debts')+' added');
  $('sp-amount').value=''; $('sp-topic').value=''; $('sp-category').value='Other';
  renderSplit();
  var out=$('sp-out');
  if(out){ out.innerHTML='<div class="hint">Split added: '+txs.length+' debt(s) totalling '+esc(money(owed,d.currency_code))+', now in Transactions.</div>'+
    txs.map(function(t){return '<div class="split-sum"><div><div class="who">'+esc(name(t.debtor_person_id))+' owes '+esc(name(t.creditor_person_id))+'</div><div class="paid">'+esc(t.topic)+' · '+esc(t.occurred_on)+'</div></div><div class="share">'+esc(money(t.amount_minor,t.currency_code))+'</div></div>'}).join('') }
  loadLedger(); loadRecentSplits();
}
function renderRecentSplits(rows){
  var box=$('recent-splits');
  var sc=$('splits-count'); if(sc){ var live=0; for(var z=0;z<rows.length;z++){ if(rows[z].entry_kind==='split'&&!rows[z].is_deleted){live++} } sc.textContent=(live===1?'1 row':live+' rows') }
  if(!box){return}
  var groups={}, order=[];
  for(var i=0;i<rows.length;i++){ var t=rows[i];
    if(t.entry_kind!=='split'||t.is_deleted){continue}
    var key=t.import_group_id||('split-row-'+t.id), group=groups[key];
    if(!group){ group={topic:t.topic,category:t.category,occurred_on:t.occurred_on,currency_code:t.currency_code,payer_id:t.creditor_person_id,debtor_ids:[],amount_minor:0,latest_id:t.id}; groups[key]=group; order.push(group) }
    group.amount_minor+=Number(t.amount_minor)||0; group.debtor_ids.push(t.debtor_person_id); group.latest_id=Math.max(group.latest_id,t.id);
  }
  order.sort(function(a,b){ return String(b.occurred_on).localeCompare(String(a.occurred_on))||b.latest_id-a.latest_id });
  if(!order.length){box.innerHTML='<div class="empty">No active splits yet.</div>';return}
  var html='', shown=order.slice(0,5);
  for(var j=0;j<shown.length;j++){ var g=shown[j], participants=[];
    for(var k=0;k<g.debtor_ids.length;k++){ participants.push(name(g.debtor_ids[k])) }
    html+='<div class="recent-split"><div class="row-main"><div class="who">'+esc(g.topic)+' <span class="chip split">split</span></div><div class="meta">'+esc(g.occurred_on)+' · '+esc(name(g.payer_id))+' paid · '+esc(participants.join(', '))+' share'+(participants.length===1?'s':'')+'</div></div><div class="amt pos">'+esc(money(g.amount_minor,g.currency_code))+'</div></div>';
  }
  box.innerHTML=html+(order.length>shown.length?'<div class="hint">Showing the latest 5 active splits.</div>':'');
}
var recentSplitsRequestId=0;
async function loadRecentSplits(){
  var box=$('recent-splits'); if(!box){return}
  var requestId=++recentSplitsRequestId; box.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(requestId!==recentSplitsRequestId||selectedTab!=='split'){return}
  if(!r.ok){box.innerHTML='<div class="err">'+esc(r.error)+'</div>';return}
  renderRecentSplits((r.data&&r.data.transactions)||[]);
}
/* A tracker, not an importer: the two columns are the state the user set, and nothing here
   creates transactions. A card carries its notes and a few attachments (photos live in a
   private R2 bucket and are fetched through the capability route). */
function receiptCard(r){
  var atts=r.attachments||[], i, thumbs='';
  for(i=0;i<atts.length;i++){
    var label=esc(atts[i].label||'Receipt photo');
    thumbs+='<span class="att"><a href="'+api+'/receipts/'+r.id+'/attachments/'+atts[i].id+'" target="_blank" rel="noopener noreferrer" title="'+label+'"><img src="'+api+'/receipts/'+r.id+'/attachments/'+atts[i].id+'" alt="'+label+'" loading="lazy" decoding="async"></a></span>';
  }
  var when=r.is_added?('Added '+stamp(r.added_at||r.updated_at)):('Captured '+stamp(r.created_at));
  var count=r.attachment_count||0;
  var meta=[when,count?(count+(count===1?' photo':' photos')):''].filter(Boolean).join(' · ');
  /* the badge is the point of the link: a card that is not in the ledger yet says so */
  var badge=r.transaction_id?('<span class="chip">&#128279; entry #'+r.transaction_id+'</span>'):'<span class="chip">not logged</span>';
  var acts='<button class="mini" type="button" data-rec-action="toggle" data-rec-id="'+r.id+'"><span aria-hidden="true">'+(r.is_added?'↩️':'✅')+'</span> '+(r.is_added?'Not added yet':'Mark added')+'</button>'
    +'<button class="mini ghost" type="button" data-rec-action="edit" data-rec-id="'+r.id+'"><span aria-hidden="true">✏️</span> Edit</button>'
    +'<button class="mini ghost" type="button" data-rec-action="delete" data-rec-id="'+r.id+'" aria-label="Delete receipt"><span aria-hidden="true">🗑️</span></button>';
  return '<div class="rec-card"><div class="rec-main">'
    +'<div class="rec-title">'+esc(r.title||'Untitled receipt')+'</div>'
    +(r.note?('<div class="rec-note">'+esc(r.note)+'</div>'):'')
    +(thumbs?('<div class="rec-atts">'+thumbs+'</div>'):'')
    +'<div class="rec-meta">'+badge+(meta?(' &middot; '+esc(meta)):'')+'</div>'
    +'<div class="rec-acts">'+acts+'</div></div></div>';
}
function renderReceipts(){
  var added=[], open=[], i;
  for(i=0;i<receipts.length;i++){ (receipts[i].is_added?added:open).push(receipts[i]) }
  var a=$('rec-added'), o=$('rec-open'); if(!a||!o){return}
  $('rec-added-count').textContent=added.length; $('rec-open-count').textContent=open.length;
  a.innerHTML=added.length?added.map(receiptCard).join(''):'<div class="empty">Nothing added yet — move a card across once it is in Transactions.</div>';
  o.innerHTML=open.length?open.map(receiptCard).join(''):'<div class="empty">Every receipt is entered 🎉</div>';
}
async function refreshReceipts(){
  var state=await call('');
  if(!state.ok){ toast(state.error,true); return }
  receipts=state.data.receipts||[]; renderReceipts();
}
function renderReceiptPhotos(id){
  var box=$('rec-photos'); if(!box){return}
  if(!id){
    /* A receipt that has not been saved yet keeps its picked photos here, shown as previews, and uploads them
       the moment the receipt exists. Nothing is written while the sheet is open, so backing out changes nothing. */
    if(!pendingPhotos.length){ box.innerHTML='<p class="hint">No photos yet &mdash; use <b>Add photos</b> below; a new receipt uploads them when you save.</p>'; return }
    var po='', j;
    for(j=0;j<pendingPhotos.length;j++){
      var plabel=esc(pendingPhotos[j].name||'New photo');
      po+='<button class="att" type="button" data-att-open="'+pendingUrls[j]+'" data-att-kind="pending" data-att-idx="'+j+'" aria-label="See this photo" title="'+plabel+'"><img src="'+pendingUrls[j]+'" alt="'+plabel+'"></button>';
    }
    box.innerHTML=po; return;
  }
  var r=null, i, atts, out='', k;
  for(i=0;i<receipts.length;i++){ if(receipts[i].id===id){ r=receipts[i] } }
  atts=r&&r.attachments?r.attachments:[];
  if(!atts.length){ box.innerHTML='<p class="hint">No photos yet &mdash; use <b>Add photos</b> below to attach them.</p>'; return }
  for(k=0;k<atts.length;k++){
    var label=esc(atts[k].label||'Receipt photo');
    out+='<button class="att" type="button" data-att-open="'+api+'/receipts/'+id+'/attachments/'+atts[k].id+'" data-att-kind="saved" data-rec-id="'+id+'" data-att-id="'+atts[k].id+'" aria-label="See this photo" title="'+label+'"><img src="'+api+'/receipts/'+id+'/attachments/'+atts[k].id+'" alt="'+label+'" loading="lazy" decoding="async"></button>';
  }
  box.innerHTML=out;
}
async function uploadReceiptFiles(id,files){
  if(!id||!files||!files.length){return}
  var added=0, skipped=0, i;
  for(i=0;i<files.length;i++){
    var file=files[i];
    if(files.length>1){ toast('Uploading '+(i+1)+' of '+files.length+'…') }
    var up=await call('/receipts/'+id+'/attachments?label='+encodeURIComponent(String(file.name||'').slice(0,120)),
      {method:'POST',raw:true,body:file,headers:{'content-type':file.type||'application/octet-stream'}});
    if(up.ok){ added+=1 } else { skipped+=1; toast(up.error,true) }
  }
  await refreshReceipts();
  renderReceiptPhotos(id);
  if(added&&!skipped){ toast(added===1?'Photo attached':(added+' photos attached')) }
  else if(added&&skipped){ toast(added+' attached · '+skipped+' skipped',true) }
  else if(skipped&&!added){ toast('Nothing was attached',true) }
}
async function detachAttachment(id,attachmentId,btn){
  if(!id||!attachmentId){return}
  if(btn){ if(btn.disabled){return} btn.disabled=true }
  try{
    var gone=await call('/receipts/'+id+'/attachments/'+attachmentId,{method:'DELETE'});
    if(!gone.ok){ toast(gone.error,true); return }
    await refreshReceipts(); toast('Attachment removed');
  } finally { if(btn){ btn.disabled=false } }
}
async function receiptAction(action,id,btn){
  var r=null, i;
  for(i=0;i<receipts.length;i++){ if(receipts[i].id===id){ r=receipts[i] } }
  if(action==='edit'){ openReceiptForm(id); return }
  if(action==='detach'){ await detachAttachment(id,Number(btn&&btn.getAttribute?btn.getAttribute('data-att-id'):0),btn); renderReceiptPhotos(id); return }
  if(!r){ toast('That receipt is no longer in the list.',true); return }
  busy(btn,true);
  try{
    if(action==='toggle'){
      var flip=await call('/receipts/'+id,{method:'PATCH',body:{is_added:!r.is_added}});
      if(!flip.ok){ toast(flip.error,true); return }
      await refreshReceipts();
      toast(flip.data.receipt&&flip.data.receipt.is_added?'Marked as added — nothing was written':'Moved back to Not added');
      return;
    }
    if(action==='delete'){
      var gone=await call('/receipts/'+id,{method:'DELETE'});
      if(!gone.ok){ toast(gone.error,true); return }
      await refreshReceipts(); toast('Receipt removed from the backlog');
      return;
    }
  } finally { busy(btn,false) }
}
var recEditing=null;
var pendingPhotos=[], pendingUrls=[];
var recView=null, recViewImg=null, recViewWhat=null;
function openRecView(src,what){ if(!recView||!recViewImg){return} recViewImg.setAttribute('src',src); recViewWhat=what; recView.hidden=false }
function closeRecView(){ if(!recView){return} recView.hidden=true; recViewWhat=null; if(recViewImg){ recViewImg.removeAttribute('src') } }
function clearPending(){ var i; for(i=0;i<pendingUrls.length;i++){ try{ URL.revokeObjectURL(pendingUrls[i]) }catch(e){} } pendingPhotos=[]; pendingUrls=[]; }
function openReceiptForm(id){
  var r=null, i;
  if(id){ for(i=0;i<receipts.length;i++){ if(receipts[i].id===id){ r=receipts[i] } } }
  if(id&&!r){ toast('That receipt is no longer in the list.',true); return }
  clearPending();
  recEditing=r;
  var titled=$('rec-modal-title');
  if(titled){ titled.textContent=r?'Edit receipt':'New receipt' }
  $('rec-title').value=r?(r.title||''):'';
  $('rec-note').value=r?(r.note||''):'';
  $('rec-state').checked=!!(r&&r.is_added);
  renderReceiptPhotos(id);
  renderReceiptLog(id);
  $('rec-modal').hidden=false;
  try{ $('rec-title').focus() }catch(e){}
}
function closeReceiptForm(){
  var box=$('rec-modal'); if(box){ box.hidden=true }
  recEditing=null;
  clearPending();
}
async function saveReceipt(){
  var btn=$('rec-save'); if(!btn){return}
  var id=recEditing?recEditing.id:null;
  var payload={title:$('rec-title').value, note:$('rec-note').value, is_added:$('rec-state').checked};
  if(!String(payload.title||'').trim()){ toast('Give the receipt a short title so you can spot it later',true); try{$('rec-title').focus()}catch(e){} return }
  busy(btn,true);
  try{
    var saved=await call(id?('/receipts/'+id):'/receipts',{method:id?'PATCH':'POST',body:payload});
    if(!saved.ok){ toast(saved.error,true); return }
    var row=saved.data.receipt||null;
    var queued=pendingPhotos.slice();
    await refreshReceipts();
    closeReceiptForm();
    toast(row&&row.is_added?'Receipt saved in Added':'Receipt saved in Not added');
    if(queued.length&&row){ uploadReceiptFiles(row.id,queued) }
  } finally { busy(btn,false) }
}
function wireReceipts(){
  var add=$('rec-new'), close=$('rec-close'), save=$('rec-save'), pick=$('rec-files'), log=$('rec-log'); recView=$('rec-view'); recViewImg=$('rec-view-img');
  if(add){ add.addEventListener('click',function(){ openReceiptForm(null) }) }
  /* The sheet owns the ledger link: a saved card can be logged (or unlinked) from here, and an
     unsaved one is told to save first, because there is no card id to point a row at yet. */
  if(log){ log.addEventListener('click',function(){
    if(!recEditing){ toast('Save the card first — then it can be logged',true); return }
    if(recEditing.transaction_id){ unlinkReceipt(recEditing.id,log); return }
    startReceiptLog(recEditing.id);
  }) }
  if(close){ close.addEventListener('click',closeReceiptForm) }
  if(save){ save.addEventListener('click',saveReceipt) }
  /* The label opens the picker itself — a scripted click on a hidden input is refused by mobile browsers — so a
     change event only has to resolve the receipt the sheet already has open. The value is cleared after the files
     are snapshotted, otherwise choosing the same photo twice in a row fires no change event at all. */
  if(pick){ pick.addEventListener('change',function(){
    var files=[].slice.call(pick.files||[]); pick.value='';
    if(!files.length){ return }
    if(recEditing){ uploadReceiptFiles(recEditing.id,files); return }
    var room=6-pendingPhotos.length, i;
    for(i=0;i<files.length;i++){
      if(i>=room){ toast('Up to six photos per receipt',true); break }
      pendingPhotos.push(files[i]);
      try{ pendingUrls.push(URL.createObjectURL(files[i])) }catch(e){ pendingUrls.push('') }
    }
    renderReceiptPhotos(null);
    toast(pendingPhotos.length+(pendingPhotos.length===1?' photo ready — it uploads when you save':' photos ready — they upload when you save'));
  }) }
  /* A tile is just an image; tapping it opens this viewer, and the viewer is where a photo comes off. */
  var rvClose=$('rec-view-close'); if(rvClose){ rvClose.addEventListener('click',closeRecView) }
  if(recView){ recView.addEventListener('click',function(ev){ if(ev.target===recView){ closeRecView() } }) }
  document.addEventListener('keydown',function(ev){
    if(ev.key==='Escape'&&recView&&!recView.hidden){ ev.stopPropagation(); ev.preventDefault(); closeRecView() }
  },true);
  var rvRemove=$('rec-view-remove');
  if(rvRemove){ rvRemove.addEventListener('click',async function(){
    var what=recViewWhat; if(!what){ closeRecView(); return }
    if(what.kind==='pending'){
      if(pendingUrls[what.idx]){ try{ URL.revokeObjectURL(pendingUrls[what.idx]) }catch(e){} }
      pendingPhotos.splice(what.idx,1); pendingUrls.splice(what.idx,1);
      closeRecView(); renderReceiptPhotos(null); toast('Photo taken off'); return;
    }
    busy(rvRemove,true);
    try{ await detachAttachment(what.receiptId,what.attId,null); closeRecView(); renderReceiptPhotos(what.receiptId) }
    finally { busy(rvRemove,false) }
  }) }
  var modal=$('rec-modal');
  if(modal){ modal.addEventListener('click',function(ev){ if(ev.target===modal){ closeReceiptForm() } }) }
  renderReceipts();
}
wireReceipts();
/* ---------------- who pays whom ---------------- */
/* Greedy settlement: hand the biggest debt to the biggest credit until every balance is zero. That
   takes at most one payment per person, and applying the whole plan clears everyone - the suite
   lifts this function and asserts exactly that, because a plausible-looking plan that leaves a
   remainder is worse than no plan at all. */
function settlePlan(nets){
  var debt=[], cred=[], out=[], i;
  for(i=0;i<nets.length;i++){
    if(nets[i].net_minor<0){ debt.push({id:nets[i].id,amt:-nets[i].net_minor}) }
    else if(nets[i].net_minor>0){ cred.push({id:nets[i].id,amt:nets[i].net_minor}) }
  }
  debt.sort(function(a,b){ return b.amt-a.amt||a.id-b.id });
  cred.sort(function(a,b){ return b.amt-a.amt||a.id-b.id });
  var d=0, c=0;
  while(d<debt.length&&c<cred.length){
    var pay=Math.min(debt[d].amt,cred[c].amt);
    if(pay>0){ out.push({from_person_id:debt[d].id,to_person_id:cred[c].id,amount_minor:pay}) }
    debt[d].amt=debt[d].amt-pay; cred[c].amt=cred[c].amt-pay;
    if(debt[d].amt<=0){ d=d+1 }
    if(cred[c].amt<=0){ c=c+1 }
  }
  return out;
}
/* A row is signed from the creditor's side through signedMinor(), the same helper the ledger tile and
   the person cards use, so all three views of one row agree by construction. Archived rows never
   move a balance, which is why the skip sits here rather than in each caller. */
function netsByCurrency(rows){
  var out={}, i, t, by, sd;
  for(i=0;i<rows.length;i++){ t=rows[i]; if(t.is_deleted){continue}
    sd=signedMinor(t);
    by=out[t.currency_code]||(out[t.currency_code]={});
    by[t.creditor_person_id]=(by[t.creditor_person_id]||0)+sd;
    by[t.debtor_person_id]=(by[t.debtor_person_id]||0)-sd;
  }
  return out;
}
function settlePlanFor(rows,code){
  var by=netsByCurrency(rows)[code]||{}, nets=[], k;
  for(k in by){ if(by.hasOwnProperty(k)&&by[k]!==0){ nets.push({id:Number(k),net_minor:by[k]}) } }
  return settlePlan(nets);
}
/* A person's drawer has to say who the payment is with, and only the plan knows that. renderSettle
   fills this index on every balances load; it is display-only and never feeds a write. One person
   can sit on several plan lines (a debtor paying two creditors), so this keeps every partner
   instead of the last one written. */
var settleIndex=null;
function settleAdd(code,id,other,amount){
  var key=code+':'+id, e=settleIndex[key]||(settleIndex[key]={others:[],legs:[]});
  if(e.others.indexOf(other)<0){ e.others.push(other) }
  var amt=Math.abs(Number(amount)||0), i, found=false;
  for(i=0;i<e.legs.length;i++){ if(e.legs[i].id===other){ e.legs[i].amount_minor+=amt; found=true } }
  if(!found){ e.legs.push({id:other,amount_minor:amt}) }
}
function settlePartners(code,id){
  var e=settleIndex&&settleIndex[code+':'+id];
  return e?e.others:[];
}
/* The plan can route one person to several creditors. Each leg is its own payment with its own
   amount; naming them together with "and" and a summed total states a figure nobody has to pay. */
function settleLegs(code,id){
  var e=settleIndex&&settleIndex[code+':'+id];
  return e?e.legs.slice().sort(function(a,b){ return b.amount_minor-a.amount_minor||a.id-b.id }):[];
}
function renderSettle(rows){
  var box=$('settle-list'); if(!box){return}
  var by=netsByCurrency(rows), codes=Object.keys(by).sort(), html='', c, i, k;
  settleIndex={};
  for(c=0;c<codes.length;c++){
    var code=codes[c], plan=settlePlanFor(rows,code), owed=0;
    for(k=0;k<plan.length;k++){ owed+=plan[k].amount_minor }
    if(!plan.length){ continue }
    html+='<div class="chart-head"><b>'+esc(code)+'</b><span class="hint">'+esc(money(owed,code))+' owed</span></div>';
    for(i=0;i<plan.length;i++){
      var p=plan[i];
      settleAdd(code,p.from_person_id,p.to_person_id,p.amount_minor);
      settleAdd(code,p.to_person_id,p.from_person_id,p.amount_minor);
      html+='<div class="settle-row"><span class="settle-names">'+esc(name(p.from_person_id))+'<span class="settle-arrow" aria-hidden="true">→</span>'+esc(name(p.to_person_id))+'</span>'+
        '<span class="settle-amt">'+esc(money(p.amount_minor,code))+'</span>'+
        '<button class="settle-btn" type="button" data-settle="'+p.from_person_id+':'+p.to_person_id+':'+esc(code)+':'+p.amount_minor+'">Record</button></div>';
    }
  }
  box.innerHTML=html||'<div class="empty">Everyone is square — nothing to settle.</div>';
}
/* Recording a plan line goes through the ordinary entry form and its review sheet, so the plan
   never writes anything itself: the payer confirms it like any other repayment. */
function startSettlePayment(from,to,code,minor){
  showTab('pay');
  if($('p-creditor')){ $('p-creditor').value=String(to) }
  if($('p-debtor')){ $('p-debtor').value=String(from) }
  if($('p-currency')){ $('p-currency').value=code }
  if($('p-amount')){ $('p-amount').value=(minor/100).toFixed(2) }
  if($('p-topic')){ $('p-topic').value='Payment' }
  if($('p-category')){ $('p-category').value='Other' }
  toast('Check it, then Record payment — the review sheet confirms it');
  addTx('payment',PAY_FORM);
}
/* ---------------- spend by day ---------------- */
/* Spending is money fronted for the group. A repayment gives money back, and a netting offset is a
   contra pair that already cancels the rows it offsets, so neither one is spending. */
function spendByDay(rows){
  var out={}, i, t, by;
  for(i=0;i<rows.length;i++){ t=rows[i];
    if(t.is_deleted||t.entry_kind==='payment'||t.entry_kind==='offset'){ continue }
    if(!(t.amount_minor>0)){ continue }
    by=out[t.currency_code]||(out[t.currency_code]={});
    by[t.occurred_on]=(by[t.occurred_on]||0)+t.amount_minor;
  }
  return out;
}
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDay(value){
  var parts=String(value==null?'':value).split('-');
  if(parts.length<3){ return String(value==null?'':value) }
  return (MONTHS[Number(parts[1])-1]||parts[1])+' '+Number(parts[2]);
}
function renderSpend(rows){
  var box=$('spend-chart'); if(!box){return}
  var by=spendByDay(rows), codes=Object.keys(by).sort(), html='', c, i;
  for(c=0;c<codes.length;c++){
    var code=codes[c], days=Object.keys(by[code]).sort(), max=0, total=0, peak='';
    for(i=0;i<days.length;i++){ var v=by[code][days[i]]; total+=v; if(v>max){ max=v; peak=days[i] } }
    var bars='';
    for(i=0;i<days.length;i++){
      var amount=by[code][days[i]], pct=max?Math.round(amount*100/max):0;
      bars+='<div class="col" title="'+esc(shortDay(days[i])+' · '+money(amount,code))+'">'+
        '<div class="track"><div class="fill" style="height:'+(pct<4?4:pct)+'%"></div></div>'+
        (days.length<=16?('<span class="day">'+esc(shortDay(days[i]))+'</span>'):'')+'</div>';
    }
    html+='<div class="chart"><div class="chart-head"><b>'+esc(code)+'</b><span class="hint">'+esc(money(total,code))+' over '+days.length+(days.length===1?' day':' days')+'</span></div>'+
      '<div class="bars">'+bars+'</div>'+
      '<p class="hint">Biggest day: '+esc(shortDay(peak))+' · '+esc(money(max,code))+'</p></div>';
  }
  box.innerHTML=html||'<div class="empty">Nothing has been spent yet.</div>';
}
/* ---------------- since your last visit ----------------
   One shared link means the trail records what changed and never who changed it, so every line
   here is deliberately agentless: "3 entries were added", never "WW added 3 entries". */
var digestSeen='', digestNewest='';
function seenStorageKey(){ return 'tfw_seen_'+((me&&me.id)||0) }
function readSeen(){ try{ return localStorage.getItem(seenStorageKey())||'' }catch(e){ return '' } }
function writeSeen(value){ try{ localStorage.setItem(seenStorageKey(),value) }catch(e){} }
function agoWords(iso){
  var then=Date.parse(iso); if(!then){ return 'earlier' }
  var mins=Math.floor((Date.now()-then)/60000);
  if(mins<2){ return 'just now' }
  if(mins<60){ return mins+' minutes ago' }
  var hours=Math.floor(mins/60);
  if(hours<24){ return hours===1?'an hour ago':hours+' hours ago' }
  var days=Math.floor(hours/24);
  return days===1?'yesterday':days+' days ago';
}
var DIGEST_NOUNS={transaction:['entry','entries'],person:['person','people'],currency:['currency','currencies'],receipt:['receipt card','receipt cards'],receipt_attachment:['photo','photos']};
var DIGEST_VERBS={create:'added',update:'edited',archive:'removed',delete:'removed',restore:'restored'};
function digestPhrases(rows){
  var counts={}, i, key;
  for(i=0;i<rows.length;i++){ key=rows[i].entity_type+'|'+rows[i].action; counts[key]=(counts[key]||0)+1 }
  var out=[];
  for(key in counts){ if(!counts.hasOwnProperty(key)){ continue }
    var parts=key.split('|'), entity=parts[0], action=parts[1], n=counts[key];
    if(entity==='workspace_settings'){ out.push(n===1?'the settings were changed':'the settings were changed '+n+' times'); continue }
    if(entity==='workspace'){ out.push(n===1?'the trip details were changed':'the trip details were changed '+n+' times'); continue }
    if(entity==='workspace_backup'){ out.push(n===1?'a backup was taken':(n+' backups were taken')); continue }
    var noun=DIGEST_NOUNS[entity]; if(!noun){ continue }
    var verb=DIGEST_VERBS[action]||'changed';
    out.push(n===1?('1 '+noun[0]+' was '+verb):(n+' '+noun[1]+' were '+verb));
  }
  return out;
}
/* read is decided by the bell, not by the page load: the dot stays lit until the panel is opened. */
var digestRows=0, digestReady=false;
function digestBox(){ return $('digest') }
function digestIsOpen(){ var d=digestBox(); return !!(d&&!d.hidden) }
function bellDot(){ var d=$('bell-dot'); if(!d){ return } d.hidden=!digestReady||digestRows<1||digestIsOpen() }
function placeDigest(){
  var d=digestBox(), h=document.querySelector('header'); if(!d||!h){ return }
  d.style.top=Math.round(h.getBoundingClientRect().bottom+8)+'px';
}
function markDigestRead(){ if(digestNewest){ writeSeen(digestNewest) } digestRows=0; bellDot() }
function openDigest(){
  var d=digestBox(); if(!d){ return }
  placeDigest(); d.hidden=false;
  var b=$('bell'); if(b){ b.setAttribute('aria-expanded','true') }
  bellDot();
}
function closeDigest(){
  var d=digestBox(); if(!d||d.hidden){ return }
  d.hidden=true;
  var b=$('bell'); if(b){ b.setAttribute('aria-expanded','false') }
  markDigestRead();
}
function renderDigest(rows,seen,fresh){
  var box=digestBox(); if(!box){ return }
  var phrases=digestPhrases(rows), items='', i;
  for(i=0;i<phrases.length;i++){ items+='<li>'+esc(phrases[i])+'</li>' }
  box.innerHTML='<div class="dg-head"><h2><span aria-hidden="true">🕐</span> Since your last visit</h2><span class="chip">'+esc(fresh?'just now':agoWords(seen))+'</span></div>'
    +(items?'<ul class="dg-list">'+items+'</ul>':'<p class="hint">Nothing new — the last changes were already in your digest.</p>')
    +'<div class="btns"><button id="dg-open" class="mini ghost" type="button" data-dg="open">Open the audit log</button><button id="dg-dismiss" class="mini ghost" type="button" data-dg="dismiss">Close</button></div>';
}
async function loadDigest(){
  var box=digestBox(); if(!box||!me){ return }
  var seen=readSeen();
  /* first look on this device: start the clock instead of opening with a wall of old history */
  if(!seen){ writeSeen(new Date().toISOString()); digestReady=true; digestRows=0; renderDigest([],'',true); bellDot(); return }
  var r=await call('/audit?since='+encodeURIComponent(seen)+'&limit=500');
  var rows=r.ok?((r.data&&r.data.audit)||[]):[];
  digestSeen=seen; digestReady=true; digestRows=r.ok?rows.length:0;
  if(rows.length){ digestNewest=rows[0].occurred_at||digestNewest }
  renderDigest(rows,seen,false);
  bellDot();
}
/* ---------------- logging a receipt card in the ledger ---------------- */
var logReceiptId=null;
function renderReceiptLog(id){
  var state=$('rec-log-state'), btn=$('rec-log'); if(!state||!btn){ return }
  var r=null, i;
  if(id){ for(i=0;i<receipts.length;i++){ if(receipts[i].id===id){ r=receipts[i] } } }
  if(!r){ btn.hidden=true; state.textContent='Save the card first — then it can be logged.'; return }
  btn.hidden=false;
  if(r.transaction_id){ state.textContent='Logged as entry #'+r.transaction_id+'.'; btn.innerHTML='<span aria-hidden="true">&#128279;</span> Unlink from the entry' }
  else { state.textContent='Not entered yet. Logging it opens the Create debt page with this title filled in, and the card moves across to Added when that entry saves.'; btn.innerHTML='<span aria-hidden="true">&#129534;</span> Log this in Transactions' }
}
function startReceiptLog(id){
  var r=null, i;
  for(i=0;i<receipts.length;i++){ if(receipts[i].id===id){ r=receipts[i] } }
  if(!r){ toast('That receipt is no longer in the list.',true); return }
  logReceiptId=r.id;
  closeReceiptForm();
  showTab('add');
  if($('t-topic')){ $('t-topic').value=r.title||'' }
  if($('t-notes')){ $('t-notes').value=r.note||'' }
  toast('Enter the amount — the card links to this entry when it saves');
}
async function linkReceiptTransaction(id,transactionId){
  var r=await call('/receipts/'+id+'/link',{method:'POST',body:{transaction_id:transactionId}});
  if(!r.ok){ toast('Saved, but the receipt was not linked: '+r.error,true); return }
  await refreshReceipts(); toast('Receipt linked to the entry');
}
async function unlinkReceipt(id,btn){
  busy(btn,true);
  try{
    var r=await call('/receipts/'+id+'/link',{method:'DELETE'});
    if(!r.ok){ toast(r.error,true); return }
    await refreshReceipts(); renderReceiptLog(id); toast('Unlinked — the card can be logged again');
  } finally { busy(btn,false) }
}
/* ---------------- wiring ---------------- */
document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'){ if(digestIsOpen()){ closeDigest() } else if($('review-modal')&&!$('review-modal').hidden){ closeReview() } else if($('rec-modal')&&!$('rec-modal').hidden){ closeReceiptForm() } else { closePerson() } } });
function openPersonFromElement(el){
  var pcard=el&&el.closest?el.closest('[data-person]'):null;
  if(!pcard){return false}
  openPerson(Number(pcard.getAttribute('data-person')));
  return true;
}
document.addEventListener('click',async function(ev){
  /* Every row action carries its id in a data attribute and several of them wrap the icon in a span, so a tap on
     the glyph itself must resolve to the button that owns it - read the attribute from the nearest ancestor. */
  var src=ev.target; var t=(src&&src.closest)?(src.closest('[data-del],[data-off],[data-emoji-save],[data-ren],[data-arch],[data-def],[data-rec-action],[data-att-open],[data-settle],[data-dg],[data-txrestore],[data-ranking-currency]')||src):src;
  if(!t||!t.getAttribute){return}
  var rankingCurrencyButton=t.getAttribute('data-ranking-currency'); if(rankingCurrencyButton){ selectRankingCurrency(rankingCurrencyButton); return }
  var recAct=t.getAttribute('data-rec-action'); if(recAct){ receiptAction(recAct,Number(t.getAttribute('data-rec-id')),t); return }
  var aOpen=t.getAttribute('data-att-open');
  if(aOpen){
    if(t.getAttribute('data-att-kind')==='pending'){ openRecView(aOpen,{kind:'pending',idx:Number(t.getAttribute('data-att-idx'))}) }
    else { openRecView(aOpen,{kind:'saved',receiptId:Number(t.getAttribute('data-rec-id')),attId:Number(t.getAttribute('data-att-id'))}) }
    return
  }
  var del=t.getAttribute('data-del'); if(del){ delTx(Number(del),t); return }
  var ure=t.getAttribute('data-txrestore'); if(ure){
    var uid=Number(ure); if(t.disabled){return} t.disabled=true;
    var ur=await call('/transactions/'+uid+'/restore',{method:'POST'});
    t.disabled=false;
    if(!ur.ok){ toast(ur.error||'Could not restore this entry',true); return }
    toast('Entry restored');
    await loadLedger();
    loadBalances();
    if(pmOpenId){ openPerson(pmOpenId) }
    var al=$('audit-list'); if(al&&al.offsetParent){ loadAudit() }
    return;
  }
  var off=t.getAttribute('data-off'); if(off){ var parts=off.split(':'); doOffset(Number(parts[0]),Number(parts[1]),parts[2],t); return }
  var settle=t.getAttribute('data-settle'); if(settle){ var sp=settle.split(':'); startSettlePayment(Number(sp[0]),Number(sp[1]),sp[2],Number(sp[3])); return }
  var dg=t.getAttribute('data-dg'); if(dg){
    if(dg==='open'){ closeDigest(); showTab('audit'); return }
    closeDigest(); return;
  }
  var emo=t.getAttribute('data-emoji-save'); if(emo){
    var eid=Number(emo); var ebox=document.querySelector('[data-emoji-input="'+eid+'"]');
    var er=await call('/people/'+eid,{method:'PATCH',body:{emoji:ebox?ebox.value.trim():''}});
    if(!er.ok){toast(er.error,true)}else{await loadState(); renderSettings(); renderParty(); renderSplit(); toast(ebox&&ebox.value.trim()?'Emoji saved':'Emoji cleared')}
    return;
  }
  var ren=t.getAttribute('data-ren'); if(ren){
    var id=Number(ren); var current=bareName(id); var next=prompt('Rename person',current);
    if(next&&next.trim()&&next.trim()!==current){ var r=await call('/people/'+id,{method:'PATCH',body:{display_name:next.trim()}}); if(!r.ok){toast(r.error,true)}else{await loadState(); renderSettings(); renderParty(); renderSplit(); toast('Renamed')} }
    return;
  }
  var arch=t.getAttribute('data-arch'); if(arch){ var ap=arch.split(':'); var ar=await call('/people/'+ap[0]+'/'+ap[1],{method:'POST'}); if(!ar.ok){toast(ar.error,true)}else{await loadState();renderSettings();renderParty();renderSplit();toast('Updated')} return }
  var def=t.getAttribute('data-def'); if(def){ var dr=await call('/currencies/'+def,{method:'PATCH',body:{is_default:true}}); if(!dr.ok){toast(dr.error,true)}else{await loadState();renderSettings();toast('Default currency updated')} return }
  if(ev.target.id==='review-modal'){ closeReview(); return }
  if(ev.target.id==='person-modal'){ closePerson(); return }
  var pclose=ev.target.closest?ev.target.closest('#pm-close'):null; if(pclose){ closePerson(); return }
  if(openPersonFromElement(ev.target)){return}
  var pairHead=ev.target.closest?ev.target.closest('[data-pair]'):null; if(pairHead){ togglePair(pairHead.getAttribute('data-pair')); return }
  var analyticsHead=ev.target.closest?ev.target.closest('[data-analytics]'):null; if(analyticsHead){ toggleAnalytics(analyticsHead.getAttribute('data-analytics')); return }
  var carch=t.getAttribute('data-carch'); if(carch){ var cp=carch.split(':'); var cr=await call('/currencies/'+cp[0]+'/'+cp[1],{method:'POST'}); if(!cr.ok){toast(cr.error,true)}else{await loadState();renderSettings();toast('Updated')} return }
});
function init(){
  window.onerror=function(msg){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+msg; b.hidden=false} return false };
  window.addEventListener('unhandledrejection',function(ev){ var b=$('banner'); if(b){b.textContent='Something went wrong: '+(ev.reason&&ev.reason.message?ev.reason.message:ev.reason); b.hidden=false} });
  TABS.forEach(function(tab){ var b=$('tab-'+tab); if(b){ b.onclick=function(e){ if(e&&e.preventDefault){e.preventDefault()} showTab(tab); if(tab==='pay'){ payLimits() } } } });
  if($('t-add')){ $('t-add').onclick=function(){ addTx('debt',TX_FORM) } }
  if($('p-add')){ $('p-add').onclick=function(){ addTx('payment',PAY_FORM) } }
  [TX_FORM,PAY_FORM].forEach(function(F){
    [F.amount,F.topic].forEach(function(id){ var field=$(id); if(field){ field.addEventListener('input',function(){ this.removeAttribute('aria-invalid') }) } });
  });
  if($('p-swap')){ $('p-swap').onclick=function(){ var a=$('p-creditor'),b=$('p-debtor'); var tmp=a.value; a.value=b.value; b.value=tmp } }
  if($('p-debtor')){ $('p-debtor').onchange=payLimits }
  if($('p-creditor')){ $('p-creditor').onchange=payLimits }
  if($('p-swap')){ $('p-swap').onclick=function(){ var a=$('p-creditor'),b=$('p-debtor'); var tmp=a.value; a.value=b.value; b.value=tmp; payLimits() } }
  if($('p-limits')){ $('p-limits').onclick=function(ev){ var t=ev.target, b=(t&&t.closest)?t.closest('[data-pl-max]'):null; if(!b||b.disabled){ return } applyMaxPayment(b.getAttribute('data-pl-max')) } }
  payLimits();
  if($('nav-open')){ $('nav-open').onclick=openNav }
  if($('nav-close')){ $('nav-close').onclick=closeNav }
  if($('nav-backdrop')){ $('nav-backdrop').onclick=closeNav }
  document.addEventListener('keydown',function(e){ if((e.key==='Escape'||e.keyCode===27)&&navIsOpen()){ closeNav() } });
  if($('tx-prev')){ $('tx-prev').onclick=function(){ txGo(-1) } }
  if($('tx-next')){ $('tx-next').onclick=function(){ txGo(1) } }
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
  if($('rv-back')){ $('rv-back').onclick=function(){ closeReview() } }
  if($('rv-close')){ $('rv-close').onclick=function(){ closeReview() } }
  if($('rv-confirm')){ $('rv-confirm').onclick=confirmReview }
  if($('t-swap')){ $('t-swap').onclick=function(){ var a=$('t-creditor'),b=$('t-debtor'); var tmp=a.value; a.value=b.value; b.value=tmp } }
  if($('ai-copy')){ $('ai-copy').onclick=async function(){ var txt=$('ai-prompt').textContent; try{ await navigator.clipboard.writeText(txt); toast('Instructions copied') }catch(e){ try{ var range=document.createRange(); range.selectNodeContents($('ai-prompt')); var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); toast('Press Ctrl/Cmd+C to copy') }catch(e2){ toast('Copy failed - select the instructions and copy them',true) } } } }
  if($('csv-preview')){ $('csv-preview').onclick=previewImport }
  if($('csv-commit')){ $('csv-commit').onclick=commitImport; $('csv-commit').disabled=true }
  if($('csv-template')){ $('csv-template').onclick=function(){ var head='occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes\\n'; var sample=today()+',debt,Dinner,Food,'+(people[0]?people[0].display_name:'Ada')+','+(people[1]?people[1].display_name:'Lin')+',12.50,'+((currencies[0]&&currencies[0].code)||'USD')+',\\n'; var url='data:text/csv;charset=utf-8,'+encodeURIComponent(head+sample); var a=document.createElement('a'); a.href=url; a.download='transactions-template.csv'; a.click() } }
  if($('s-save-backup-every')){ $('s-save-backup-every').onclick=async function(){ var every=Number($('s-backup-every').value); if(!isFinite(every)||Math.round(every)!==every||every<5||every>10000){ toast('Back up every 5 to 10000 transactions',true); return } var r=await call('',{method:'PATCH',body:{settings:{backup_every:every}}}); if(!r.ok){ toast(r.error||'Could not save the backup interval',true); return } await loadState(); renderSettings(); toast('Backups will run every '+every+' transactions') } }
  if($('s-backup-now')){ $('s-backup-now').onclick=async function(){ var btn=$('s-backup-now'); btn.disabled=true; var r=await call('/backups',{method:'POST'}); btn.disabled=false; if(!r.ok){ toast(r.error||'Could not write a backup',true); return } await loadState(); renderSettings(); toast('Backup #'+r.data.backup.sequence+' written ('+r.data.backup.rows+' transactions)') } }
  if($('s-backup-list')){ $('s-backup-list').onclick=async function(ev){ var t=ev.target; var seq=t&&t.getAttribute?t.getAttribute('data-restore'):null; if(!seq){return} if(!confirm('Restore backup #'+seq+' into a new workspace? This workspace is left untouched.')){return} t.disabled=true; var r=await call('/backups/'+seq+'/restore',{method:'POST'}); t.disabled=false; var out=$('s-restore-out'); if(!r.ok){ toast(r.error||'Could not restore this backup',true); return } var link=location.origin+r.data.workspace_url; out.innerHTML='Restored into a new workspace: <b>'+r.data.restored.transactions+'</b> transactions, '+r.data.restored.people+' people'+(r.data.restored.skipped_transactions?(' · '+r.data.restored.skipped_transactions+' rows skipped'):'')+'.<br>Open or share: <a href="'+r.data.workspace_url+'">'+esc(link)+'</a>'; toast('Restored into a new workspace') } }
  if($('s-add-person')){ $('s-add-person').onclick=async function(){ var v=$('s-person').value.trim(); if(!v){return} var emoji=''; var parts=v.split(/\\s+/); if(parts.length>1){ var last=parts[parts.length-1]; if(last.length<=16&&!/[\\p{L}\\p{N}]/u.test(last)){ emoji=last; v=parts.slice(0,-1).join(' ') } } var r=await call('/people',{method:'POST',body:{display_name:v,emoji:emoji}}); if(!r.ok){toast(r.error,true);return} $('s-person').value=''; await loadState(); renderSettings(); renderParty(); toast(emoji?('Person added with '+emoji):'Person added') } }
  if($('s-tg-pair')){ $('s-tg-pair').onclick=function(){ telegramPair() } }
  if($('s-tg-list')){ $('s-tg-list').addEventListener('click',telegramClick) }
  if($('s-tg-out')){ $('s-tg-out').addEventListener('click',function(ev){ var t=ev.target&&ev.target.closest?ev.target.closest('[data-tg-copy]'):null; if(t){ telegramCopy() } }) }
  if($('s-add-cur')){ $('s-add-cur').onclick=async function(){ var v=$('s-cur').value.trim().toUpperCase(); if(!v){return} var r=await call('/currencies',{method:'POST',body:{code:v,is_default:false}}); if(!r.ok){toast(r.error,true);return} $('s-cur').value=''; await loadState(); renderSettings(); renderParty(); toast('Currency added') } }
  if($('c-copy')){ $('c-copy').onclick=async function(){ try{ await navigator.clipboard.writeText(location.origin+location.pathname); toast('Link copied') }catch(e){ toast('Copy failed — long-press the address bar instead',true) } } }
  if($('bell')){ $('bell').onclick=function(){ if(digestIsOpen()){ closeDigest() } else { openDigest() } } }
  window.addEventListener('resize',function(){ if(digestIsOpen()){ placeDigest() } });
  /* a tap anywhere else puts the panel away, the same way the drawer behaves */
  document.addEventListener('click',function(ev){
    if(!digestIsOpen()){ return }
    var d=digestBox(), b=$('bell');
    if(d&&d.contains(ev.target)){ return }
    if(b&&b.contains(ev.target)){ return }
    closeDigest();
  });
  window.addEventListener('hashchange',function(){ var h=(location.hash||'#ledger').slice(1); if(TABS.indexOf(h)>=0&&$('tab-'+h)){ showTab(h) } });
  var start=(location.hash||'#ledger').slice(1); if(TABS.indexOf(start)<0){start='ledger'}
  showTab(start);
  loadState().then(function(ok){ if(ok){ renderParty(); renderSplit(); loadDigest() } });
  /* Installed to a home screen the app opens without browser chrome. The worker caches nothing,
     so a reload always gets the current build. */
  if(navigator.serviceWorker){ try{ var swp=navigator.serviceWorker.register('sw.js'); if(swp&&swp.catch){ swp.catch(function(){}) } }catch(e){} }
}
function renderParty(){
  var cs=$('t-creditor'), ds=$('t-debtor'), cur=$('t-currency');
  if(!cs||!ds||!cur){return}
  var keepC=cs.value, keepD=ds.value;
  var ps=$('sp-payer'), keepP=ps?ps.value:'';
  cs.innerHTML=''; ds.innerHTML='';
  for(var i=0;i<people.length;i++){ if(people[i].is_archived){continue}
    var shown=(people[i].emoji?people[i].emoji+' ':'')+people[i].display_name;
    var o1=document.createElement('option'); o1.value=people[i].id; o1.textContent=shown; cs.appendChild(o1);
    var o2=document.createElement('option'); o2.value=people[i].id; o2.textContent=shown; ds.appendChild(o2);
  }
  if(keepC){cs.value=keepC} if(keepD){ds.value=keepD}
  if(cs.options.length>1&&cs.value===ds.value){ ds.value=cs.options[1].value }
  if(ps){
    ps.innerHTML='';
    for(var k=0;k<people.length;k++){ if(people[k].is_archived){continue}
      var op=document.createElement('option'); op.value=people[k].id;
      op.textContent=(people[k].emoji?people[k].emoji+' ':'')+people[k].display_name; ps.appendChild(op);
    }
    if(keepP){ ps.value=keepP }
    if(!ps.value&&ps.options.length){ ps.value=ps.options[0].value }
  }
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
  return `You convert trip receipts into reviewed CSV rows for a shared expense ledger. You must use a two-stage workflow. Never write to any app or claim that an import happened.

STAGE 1 — review only
Your first response must be Markdown only. Do not output CSV in Stage 1, including in code fences.

First, extract and show these Markdown tables:
1. **Receipt summary**: merchant, receipt date, currency, payer, Receipt grand total, and any unreadable/missing detail.
2. **Item allocation**: every receipt item, item amount, ordered/benefiting people, allocation method, and each allocated share. State clearly when an assignment is assumed.
3. **Charges and reconciliation**: subtotal, discount, tax, service charge, tip, delivery fee, other adjustments, Unallocated adjustment, and final grand total.
4. **Proposed ledger rows**: date, creditor, debtor, amount, topic, and notes.

Rules for Stage 1:
- Receipt grand total must be the amount actually charged on the receipt, not merely the visible items subtotal.
- The sum of all item allocations plus explicit charges/adjustments must equal the receipt grand total exactly. If it does not, show the difference as **Unallocated adjustment** and ask who should bear it; never silently make the payer absorb tax, service, tip, delivery, rounding, or an omitted charge.
- The sum of proposed ledger-row amounts must be reconciled to the shared portion of that final total. State who bears any personal/non-shared amount and why.
- Ask the user to check who paid, who ordered or benefited from each item, the allocation method, all taxes/service/tips/discounts, and the grand-total reconciliation.
- End with exactly this question: **Confirm this allocation? Reply CONFIRM CSV to receive the final CSV, or describe corrections.**

STAGE 2 — only after explicit confirmation
Only when the user explicitly replies "CONFIRM CSV" after seeing the Stage 1 review, re-check all names, currencies, arithmetic, and the grand-total reconciliation. Then reply with:
1. A short Markdown **Verification** list stating the receipt grand total, allocated total, difference (must be 0.00), and number of ledger rows.
2. A single fenced CSV block containing only the final CSV. No prose after the block.

First line inside the final CSV block must be exactly this header:
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
  const peopleResult = await db.prepare('SELECT id, display_name, emoji, is_archived FROM workspace_people WHERE workspace_id = ? ORDER BY is_archived, id').bind(workspaceId).all<Row>();
  const currencyResult = await db.prepare('SELECT id, code, is_default, is_archived FROM workspace_currencies WHERE workspace_id = ? ORDER BY is_archived, is_default DESC, id').bind(workspaceId).all<Row>();
  const people = peopleResult.results ?? [];
  const currencies = currencyResult.results ?? [];
  const initial = JSON.stringify({ people, currencies });
  const livePeople = people.filter((p) => !p.is_archived);
  const liveCurrencies = currencies.filter((c) => !c.is_archived);
  const personOption = (p: (typeof livePeople)[number], picked: boolean) => `<option value="${p.id}"${picked ? ' selected' : ''}>${esc(p.emoji ? p.emoji + ' ' + p.display_name : p.display_name)}</option>`;
  const personOptions = livePeople.map((p) => personOption(p, false)).join('');
  /* Whoever paid is preselected as the creditor and the next person as the debtor, so the two
     selectors never open on the same name - that state failed validation with "Creditor and debtor
     must differ." and read as "I cannot create a debt". */
  const creditorOptions = livePeople.map((p, i) => personOption(p, i === 0)).join('');
  const debtorOptions = livePeople.map((p, i) => personOption(p, i === 1)).join('');
  const currencyOptions = liveCurrencies.map((c) => `<option value="${esc(c.code)}"${c.is_default ? ' selected' : ''}>${esc(c.code)}</option>`).join('');
  const personChecks = livePeople.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" checked><span>${esc(p.emoji ? p.emoji + ' ' + p.display_name : p.display_name)}</span></label>`).join('');
  const settingsRow = await db.prepare('SELECT timezone FROM workspace_settings WHERE workspace_id = ?').bind(workspaceId).first<{ timezone: string }>();
  const tz = settingsRow?.timezone && isValidTimeZone(settingsRow.timezone) ? settingsRow.timezone : DEFAULT_TIME_ZONE;
  const { date: dateToday, clock: clockNow } = zonedParts(tz);
  const tzOptions = ZONES.map((zone) => `<option value="${zone}"${zone === tz ? ' selected' : ''}>${zone}</option>`).join('');
  const todayServer = dateToday;
  const aiCodes = liveCurrencies.map((c) => c.code);
  const aiDefault = (liveCurrencies.find((c) => c.is_default) ?? liveCurrencies[0])?.code ?? 'USD';
  const aiPrompt = aiInstructions({ names: livePeople.map((p) => (p.emoji ? p.emoji + ' ' + p.display_name : p.display_name)), codes: aiCodes, defaultCode: aiDefault, tz, today: todayServer });
  return page(name, `<script>window.__initial=${initial};</script>`, `
<main>
<header>
  <div class="head">
    <div>
      <h1>${esc(name)}</h1>
      <p class="sub">Shared with everyone on the trip · every change is audited</p>
    </div>
    <div class="head-acts">
      <button id="bell" class="mini ghost bell" type="button" aria-expanded="false" aria-controls="digest" aria-label="What changed since your last visit" title="Since your last visit"><span aria-hidden="true">🔔</span><span id="bell-dot" class="dot" hidden></span></button>
      <button id="c-copy" class="mini ghost" type="button">Copy link</button>
    </div>
  </div>
  <div class="navbar">
    <button id="nav-open" class="hamburger" type="button" aria-expanded="false" aria-controls="nav-drawer"><span aria-hidden="true">☰</span> Menu</button>
    <span id="nav-now" class="nav-now">📒 Transactions</span>
  </div>
</header>
<div id="nav-backdrop" class="drawer-backdrop"></div>
<aside id="nav-drawer" class="drawer" aria-label="Sections">
  <div class="drawer-head">
    <span class="drawer-title">Go to</span>
    <button id="nav-close" class="mini ghost" type="button" aria-label="Close menu">✕</button>
  </div>
  <nav role="tablist" aria-label="Sections">
    <span class="nav-group">Write</span>
    <button id="tab-add" role="tab" aria-selected="false" type="button"><span aria-hidden="true">➕</span> Create debt</button>
    <button id="tab-pay" role="tab" aria-selected="false" type="button"><span aria-hidden="true">↩️</span> Record a payment</button>
    <button id="tab-split" role="tab" aria-selected="false" type="button"><span aria-hidden="true">✂️</span> Split a bill</button>
    <span class="nav-group">Read</span>
    <button id="tab-ledger" role="tab" aria-selected="true" type="button"><span aria-hidden="true">📒</span> Transactions</button>
    <button id="tab-balances" role="tab" aria-selected="false" type="button"><span aria-hidden="true">⚖️</span> Balances</button>
    <button id="tab-ranking" role="tab" aria-selected="false" type="button"><span aria-hidden="true">🏆</span> Ranking</button>
    <button id="tab-receipts" role="tab" aria-selected="false" type="button"><span aria-hidden="true">🧾</span> Receipts</button>
    <span class="nav-group">Workshop</span>
    <button id="tab-tools" role="tab" aria-selected="false" type="button"><span aria-hidden="true">📥</span> Bulk &amp; import</button>
    <button id="tab-audit" role="tab" aria-selected="false" type="button"><span aria-hidden="true">🕐</span> Audit</button>
    <button id="tab-settings" role="tab" aria-selected="false" type="button"><span aria-hidden="true">⚙️</span> Setup</button>
  </nav>
</aside>
<div id="banner" class="err" hidden></div>
<div id="digest" class="card" hidden role="region" aria-label="Since your last visit"></div>

<section id="ledger">
  <details class="card fold">
    <summary><h2><span aria-hidden="true">📈</span> Spend by day</h2><span class="fold-count" id="spend-count"></span></summary>
    <div class="fold-body">
      <p class="hint">What was fronted each day — money coming back (a repayment) and netting offsets are not spending. Grouped per currency, so nothing is summed across currencies.</p>
      <div id="spend-chart"><div class="empty">Loading…</div></div>
    </div>
  </details>
  <details class="card fold">
    <summary><h2><span aria-hidden="true">📒</span> Transactions</h2><span class="fold-count" id="tx-count"></span></summary>
    <div class="fold-body">
      <p class="hint">Green <b>+</b> is a debt someone owes the payer · red <b>−</b> is a repayment coming back.</p>
      <div id="tx-totals" class="totals"></div>
      <div id="tx-list"><div class="empty">Loading…</div></div>
      <div id="tx-pager" class="pager" hidden><button id="tx-prev" class="ghost" type="button">‹ Prev</button><span id="tx-pager-info" class="pager-info"></span><button id="tx-next" class="ghost" type="button">Next ›</button></div>
    </div>
  </details>
  <details class="card fold">
    <summary><h2><span aria-hidden="true">🕘</span> Recent splits</h2><span class="fold-count" id="splits-count"></span></summary>
    <div class="fold-body">
      <p class="hint">Latest active split records. The amount is the debt created for the payer; deleted split records stay out of this list.</p>
      <div id="recent-splits" aria-live="polite"><div class="empty">Loading…</div></div>
    </div>
  </details>
</section>

<section id="add" hidden>
  <div class="card">
    <h2><span aria-hidden="true">➕</span> Create debt</h2>
    <p class="hint" id="t-direction">One person paid for the group, and this page only ever records that direction: whoever paid is owed by whoever it was for. Recording money handed back is the separate <b>Record a payment</b> page.</p>
    <div class="grid three">
      <div class="field"><label for="t-amount">Amount</label><input id="t-amount" type="text" inputmode="decimal" placeholder="12.50" autocomplete="off"></div>
      <div class="field"><label for="t-currency">Currency</label><select id="t-currency">${currencyOptions}</select></div>
      <div class="field"><label for="t-date">Date</label><input id="t-date" type="text" value="${dateToday}" readonly aria-readonly="true"><div class="hint">Today in ${esc(tz)} &middot; ${esc(clockNow)}</div></div>
    </div>
    <div class="grid">
      <div class="field"><label for="t-creditor" id="t-creditor-label"><span aria-hidden="true">💳</span> Paid by (is owed)</label><select id="t-creditor">${creditorOptions}</select></div>
      <div class="field"><label for="t-debtor" id="t-debtor-label"><span aria-hidden="true">🧾</span> For (owes)</label><select id="t-debtor">${debtorOptions}</select></div>
    </div>
    <div class="swap"><button id="t-swap" type="button">↔️ Swap people</button></div>
    <div class="grid">
      <div class="field"><label for="t-topic">What for</label><input id="t-topic" placeholder="Dinner" autocomplete="off"></div>
      <div class="field"><label for="t-category">Category</label><select id="t-category"><option value="Other" selected>&#128230; Other</option><option value="Food">&#127828; Food</option><option value="Transport">&#128663; Transport</option><option value="Shopping">&#128717;&#65039; Shopping</option></select></div>
    </div>
    <div class="field"><label for="t-notes">Notes (optional)</label><input id="t-notes" autocomplete="off"></div>
    <button id="t-add" type="button"><span aria-hidden="true">✅</span> Create debt</button>
    <div id="t-err" class="err"></div>
  </div>
</section>

<section id="pay" hidden>
  <div class="card">
    <h2><span aria-hidden="true">↩️</span> Record a payment</h2>
    <p class="hint" id="p-direction">Someone handed money back, and this page only ever records that direction: the person who paid reduces what they owe the person they paid. New spending is the separate <b>Create debt</b> page.</p>
    <div class="grid three">
      <div class="field"><label for="p-amount">Amount</label><input id="p-amount" type="text" inputmode="decimal" placeholder="12.50" autocomplete="off"></div>
      <div class="field"><label for="p-currency">Currency</label><select id="p-currency">${currencyOptions}</select></div>
      <div class="field"><label for="p-date">Date</label><input id="p-date" type="text" value="${dateToday}" readonly aria-readonly="true"><div class="hint">Today in ${esc(tz)} &middot; ${esc(clockNow)}</div></div>
    </div>
    <div class="grid">
      <div class="field"><label for="p-debtor" id="p-debtor-label"><span aria-hidden="true">📤</span> Repaid by (who owed it)</label><select id="p-debtor">${debtorOptions}</select></div>
      <div class="field"><label for="p-creditor" id="p-creditor-label"><span aria-hidden="true">📥</span> Repaid to (was owed)</label><select id="p-creditor">${creditorOptions}</select></div>
    </div>
    <div class="swap"><button id="p-swap" type="button">↔️ Swap people</button></div>
    <div id="p-limits" class="limits" aria-live="polite">
      <h3><span aria-hidden="true">💸</span> Maximum payment</h3>
      <div class="pill-row" id="p-limits-list"><span class="hint">Choose who repaid and who was owed, and the most they can pay appears here.</span></div>
    </div>
    <div class="grid">
      <div class="field"><label for="p-topic">What for</label><input id="p-topic" value="Payment" placeholder="Settle up" autocomplete="off"></div>
      <div class="field"><label for="p-category">Category</label><select id="p-category"><option value="Other" selected>&#128230; Other</option><option value="Food">&#127828; Food</option><option value="Transport">&#128663; Transport</option><option value="Shopping">&#128717;&#65039; Shopping</option></select></div>
    </div>
    <div class="field"><label for="p-notes">Notes (optional)</label><input id="p-notes" autocomplete="off"></div>
    <button id="p-add" type="button"><span aria-hidden="true">✅</span> Record payment</button>
    <div id="p-err" class="err"></div>
  </div>
</section>

<section id="ranking" hidden>
  <div class="card"><h2><span aria-hidden="true">🏆</span> Who owes most</h2><p class="hint">Outstanding balances only. Choose a currency to compare like with like; this view never changes the records.</p><div id="ranking-currencies" class="ranking-currencies" role="group" aria-label="Ranking currency"></div><div id="ranking-list" class="ranking-list"><div class="empty">Loading…</div></div></div>
</section>

<section id="split" hidden>
  <div class="card">
    <h2><span aria-hidden="true">✂️</span> Split an expense</h2>
    <p class="hint">One person pays the bill. Everyone ticked shares it equally: each other person's share is recorded as a debt to whoever paid.</p>
    <div class="grid">
      <div class="field"><label for="sp-topic">What for</label><input id="sp-topic" placeholder="Dinner" autocomplete="off"></div>
      <div class="field"><label for="sp-category">Category</label><select id="sp-category"><option value="Other" selected>&#128230; Other</option><option value="Food">&#127828; Food</option><option value="Transport">&#128663; Transport</option><option value="Shopping">&#128717;&#65039; Shopping</option></select></div>
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
        <button id="sp-all" class="mini ghost" type="button"><span aria-hidden="true">👥</span> Everyone</button>
        <button id="sp-none" class="mini ghost" type="button"><span aria-hidden="true">🚫</span> Nobody</button>
        <span id="sp-count" class="hint"></span>
      </div>
      <div class="people" id="sp-people" role="group" aria-labelledby="sp-people-label">${personChecks}</div>
    </div>
    <div class="btns">
      <button id="sp-preview" class="ghost" type="button"><span aria-hidden="true">🔍</span> Preview shares</button>
      <button id="sp-commit" type="button"><span aria-hidden="true">✅</span> Add split</button>
    </div>
    <div id="sp-err" class="err"></div>
    <div id="sp-out"></div>
  </div>
</section>

<section id="balances" hidden>
  <div class="card"><h2 class="bal-label">Settle Up</h2><p class="bal-legend">Fewest transfers that clear the group. Tap Record to log one.</p><div id="settle-list"><div class="empty">Loading…</div></div></div>
  <div class="card"><h2 class="bal-label">People</h2><p class="bal-legend">Amounts are what the group owes each person. Negative means they owe the group.</p><div id="balance-people"><div class="empty">Loading…</div></div></div>
  <div class="card" id="offset-card" hidden><h2><span aria-hidden="true">🤝</span> Offset balances</h2><p class="hint">Reciprocal balances are netted automatically as soon as an entry creates them. Anything listed here is what is still left to offset by hand.</p><div id="offset-list"><div class="empty">Loading…</div></div>
    <p class="hint">Offsetting records a repayment pair that clears equal amounts in both directions.</p></div>
</section>

<section id="tools" hidden>
  <div class="card">
    <h2><span aria-hidden="true">📥</span> Import CSV</h2>
    <p class="hint">Header must be: occurred_on, entry_kind, topic, category, creditor, debtor, amount, currency, notes</p>
    <div class="field"><textarea id="csv" class="mono" placeholder="occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes"></textarea></div>
    <div class="btns">
      <button id="csv-template" class="ghost" type="button"><span aria-hidden="true">📄</span> Template</button>
      <button id="csv-preview" class="ghost" type="button"><span aria-hidden="true">🔍</span> Preview</button>
      <button id="csv-commit" type="button"><span aria-hidden="true">✅</span> Import</button>
    </div>
    <div id="csv-result"></div>
  </div>
  <div class="card">
    <h2><span aria-hidden="true">🧾</span> Turn a receipt into a CSV</h2>
    <p class="hint">Copy these instructions into ChatGPT, Claude or Gemini as the system message, then send the receipt text or photo. First review its Markdown allocation tables and grand-total reconciliation. Only after you reply <b>CONFIRM CSV</b>, paste its verified final CSV into the box above.</p>
    <div class="field"><pre id="ai-prompt">${esc(aiPrompt)}</pre></div>
    <div class="btns">
      <button id="ai-copy" type="button"><span aria-hidden="true">📋</span> Copy instructions</button>
    </div>
  </div>
</section>

<section id="receipts" hidden>
  <div class="card"><h2><span aria-hidden="true">🧾</span> Receipts backlog</h2>
    <p class="sub">Your own checklist of receipt photos and what each one was for. A card holds its notes and a few photos &mdash; move it across to <b>Added</b> once you have entered it in Transactions. Nothing here writes transactions by itself.</p>
    <div class="btns">
      <button type="button" id="rec-new"><span aria-hidden="true">&#10133;</span> New receipt</button>
    </div>
  </div>
  <div class="rec-board">
    <div class="rec-col">
      <div class="rec-head"><h3><span aria-hidden="true">📥</span> Not added <span class="count" id="rec-open-count">0</span></h3><p class="hint">Receipts still to be entered.</p></div>
      <div class="rec-list" id="rec-open"><div class="empty">Loading&hellip;</div></div>
    </div>
    <div class="rec-col">
      <div class="rec-head"><h3><span aria-hidden="true">✅</span> Added <span class="count" id="rec-added-count">0</span></h3><p class="hint">Already recorded in Transactions.</p></div>
      <div class="rec-list" id="rec-added"><div class="empty">Loading&hellip;</div></div>
    </div>
  </div>
</section>

<section id="audit" hidden>
  <div class="card"><h2><span aria-hidden="true">🕵️</span> Audit log</h2>
    <p class="hint">Newest first · before/after snapshots · nothing is ever erased, only archived — filter for "Archived or deleted" to find removed entries.</p>
    <div class="filter-bar">
      <label class="hint stack">Entity
        <select id="au-entity">
          <option value="">All entities</option>
          <option value="transaction">Transactions</option>
          <option value="person">People</option>
          <option value="currency">Currencies</option>
          <option value="workspace_settings">Settings</option>
          <option value="workspace">Workspace</option>
        </select>
      </label>
      <label class="hint stack">Action
        <select id="au-action">
          <option value="">All actions</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="archive">Archived</option>
          <option value="restore">Restored</option>
          <option value="delete">Deleted</option>
          <option value="archive,delete">Archived or deleted</option>
        </select>
      </label>
      <label class="hint stack">Search
        <input id="au-q" type="search" placeholder="topic, person, notes…">
      </label>
      <div class="btns flush"><button id="au-apply" type="button"><span aria-hidden="true">✅</span> Apply</button><button id="au-clear" class="ghost" type="button"><span aria-hidden="true">🧹</span> Clear</button></div>
    </div>
    <div id="au-summary" class="hint"></div>
    <div id="audit-list"><div class="empty">Loading…</div></div>
  </div>
</section>

<section id="settings" hidden>
  <div class="card"><h2><span aria-hidden="true">🧳</span> Trip</h2>
    <label class="hint stack">Theme
      <select id="s-theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <div class="hint">Saved on this device only — a shared trip link can look different on someone else's phone.</div>
    <div class="inline"><div class="field flush"><label>Trip name</label><input id="s-name" readonly></div></div>
    <div class="btns"><button class="ghost" type="button" id="s-rename" onclick="(function(){var v=prompt('Trip name',document.getElementById('s-name').value);if(v&&v.trim()){fetch(location.pathname.replace(/\\/+$/,'')+'/api',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:v.trim()})}).then(function(){location.reload()})}})()"><span aria-hidden="true">✏️</span> Rename trip</button></div>
  </div>
  <div class="card"><h2><span aria-hidden="true">🕒</span> Time zone</h2>
    <p class="hint">Transactions are dated in this zone. The date fields are read-only and always show today's date here.</p>
    <div class="inline"><div class="field flush"><label for="s-tz">Zone</label><select id="s-tz">${tzOptions}</select></div><button id="s-save-tz" type="button"><span aria-hidden="true">💾</span> Save</button></div>
    <div id="s-tz-err" class="err"></div>
  </div>
  <div class="card"><h2><span aria-hidden="true">♻️</span> Automatic netting</h2>
    <p class="hint">When two people owe each other in the same currency, the overlapping amount is offset automatically with the entry that creates the overlap. Each netting is written as an audited offset, so the trail still shows both original debts.</p>
    <label class="check" for="s-auto-offset"><input type="checkbox" id="s-auto-offset"> Offset reciprocal balances automatically</label>
    <div class="btns mt-8"><button id="s-save-auto-offset" type="button"><span aria-hidden="true">✅</span> Save</button></div>
  </div>
  <div class="card"><h2><span aria-hidden="true">💾</span> Backups</h2>
    <p class="hint">Once this workspace has added the set number of transactions since the last snapshot, the whole workspace &mdash; people, currencies, settings and every transaction &mdash; is exported automatically and kept privately. Restoring writes it into a <b>new</b> workspace, so nothing here is ever overwritten. The newest ${KEEP_BACKUPS} snapshots are kept; older ones roll off.</p>
    <div id="s-backup-status" class="meta"></div>
    <div class="inline mt-10"><div class="field flush"><label for="s-backup-every">Back up every (transactions)</label><input id="s-backup-every" type="number" min="5" max="10000" step="1" inputmode="numeric"></div><button id="s-save-backup-every" type="button"><span aria-hidden="true">💾</span> Save</button></div>
    <div class="btns mt-8"><button class="ghost" type="button" id="s-backup-now"><span aria-hidden="true">💾</span> Back up now</button></div>
    <div id="s-backup-list" class="mt-12"></div>
    <div id="s-restore-out" class="meta mt-10"></div>
  </div>
  <div class="card"><h2><span aria-hidden="true">🔔</span> Telegram notifications</h2>
    <p class="hint">Connect a Telegram chat and it receives one short, anonymous message when this workspace changes — an entry was added, an import was committed, a repayment came back, the settings changed. Messages never name anyone, and a connected chat can never change a record. One chat can follow several trips; one trip can have several chats.</p>
    <div id="s-tg-status" class="meta"></div>
    <div class="btns mt-10"><button class="ghost" type="button" id="s-tg-pair"><span aria-hidden="true">🔔</span> Connect Telegram chat</button></div>
    <div id="s-tg-out" class="mt-12"></div>
    <div id="s-tg-list" class="mt-12"></div>
    <p class="hint mt-10">For a group: add the bot to the group first, then press Connect and send the command from the group as an administrator.</p>
    <p class="hint mt-10">To stop the messages later, send /disconnect in that chat (in a group, an administrator has to send it) — or press Disconnect on the connection in the list above.</p>
  </div>
  <div class="card"><h2><span aria-hidden="true">🧑‍🤝‍🧑</span> People</h2><div id="s-people"></div>
    <div class="inline"><div class="field flush"><label>Add person</label><input id="s-person" autocomplete="off"></div><button id="s-add-person" type="button">Add</button></div>
  </div>
  <div class="card"><h2>Currencies</h2><div id="s-currencies"></div>
    <div class="inline"><div class="field flush"><label>Add currency (3-letter code)</label><input id="s-cur" maxlength="3" autocomplete="off"></div><button id="s-add-cur" type="button">Add</button></div>
  </div>
</section>
<div id="review-modal" class="modal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rv-title">
    <div class="dlg-head"><h2 id="rv-title">Review</h2><button class="mini ghost" type="button" id="rv-close">Close</button></div>
    <div id="rv-body"></div>
    <div class="btns">
      <button class="ghost" type="button" id="rv-back"><span aria-hidden="true">&#8592;</span> Back to edit</button>
      <button type="button" id="rv-confirm"><span aria-hidden="true">&#9989;</span> Confirm</button>
    </div>
  </div>
</div>
<div id="rec-modal" class="modal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rec-modal-title">
    <div class="dlg-head"><h2 id="rec-modal-title">New receipt</h2><button class="mini ghost" type="button" id="rec-close">Close</button></div>
    <div class="field"><label for="rec-title">What is it?</label><input id="rec-title" type="text" maxlength="120" placeholder="Big C groceries"></div>
    <div class="field"><label for="rec-note">Notes</label><textarea id="rec-note" rows="3" maxlength="2000" placeholder="Who paid, what it covered, anything to remember"></textarea></div>
    <div class="field"><label>Photos</label><div id="rec-photos" class="rec-atts"></div>
      <div class="btns">
        <input id="rec-files" class="vh" type="file" accept="image/*" multiple>
        <label class="ghost" for="rec-files"><span aria-hidden="true">&#128206;</span> Add photos</label>
      </div>
      <p class="hint">Pick from your photo library &mdash; up to six. On a receipt you have not saved yet they upload when you save. Tap a photo to see it larger, or to take it off.</p></div>
    <div class="field"><label class="check"><input type="checkbox" id="rec-state"> <span>Already added to Transactions</span></label></div>
    <div class="field"><label>Entry</label>
      <div id="rec-log-state" class="hint"></div>
      <div class="btns"><button type="button" id="rec-log" class="ghost"><span aria-hidden="true">&#129534;</span> Log this in Transactions</button></div>
    </div>
    <div class="btns"><button type="button" id="rec-save"><span aria-hidden="true">&#128190;</span> Save receipt</button></div>
  </div>
</div>
<div id="rec-view" hidden>
  <img id="rec-view-img" alt="Receipt photo">
  <div class="btns">
    <button type="button" id="rec-view-remove" class="danger"><span aria-hidden="true">&#128465;</span> Remove photo</button>
    <button type="button" id="rec-view-close" class="ghost">Close</button>
  </div>
</div>
<div id="person-modal" class="modal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pm-title">
    <div class="dlg-head"><h2 id="pm-title">Person</h2><button class="mini ghost" type="button" id="pm-close">Close</button></div>
    <div id="pm-body"><div class="empty">Loading…</div></div>
  </div>
</div>
</main>`, APP_SCRIPT, 'manifest.webmanifest');
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
