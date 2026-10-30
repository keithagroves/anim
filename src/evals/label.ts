import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { startServer } from "../cli/server.js";
import { loadVideo } from "../cli/load.js";
import { allCriteria, loadRubric } from "./judge.js";
import { latestLabels, loadRun, type LabelRow } from "./harness.js";
import { appendJsonl, EVALS, ROOT } from "./util.js";

const body = (req: IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b)); });

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>anim · label</title><style>
*{box-sizing:border-box}body{margin:0;background:#05070d;color:#cfd6ee;font:14px/1.45 system-ui,sans-serif;display:grid;grid-template-columns:240px 1fr 400px;height:100vh}
#list{overflow:auto;border-right:1px solid #1c2544}#list div{padding:8px 12px;border-bottom:1px solid #111a33;cursor:pointer;font-size:13px}
#list div.sel{background:#1c2544}#list .done{color:#5fe3a8}#list .gate-fail{color:#ff8a95}
iframe{width:100%;height:100%;border:0}
#panel{overflow:auto;padding:14px 16px;border-left:1px solid #1c2544}
h2{font-size:15px;margin:0 0 6px}h3{font-size:13px;margin:16px 0 6px;color:#8b95b9;text-transform:uppercase;letter-spacing:.06em}
.crit{padding:8px 0;border-bottom:1px solid #111a33}.crit .q{font-size:13px;margin-bottom:6px}
.crit label{margin-right:12px;cursor:pointer}.hint{color:#6b7599;font-size:12px}
textarea{width:100%;min-height:70px;background:#0b1020;color:#e9edf9;border:1px solid #2d3a63;border-radius:8px;padding:8px;font:inherit}
button{background:#4f8cff;color:#fff;border:0;border-radius:8px;padding:8px 16px;font:inherit;cursor:pointer;margin:10px 8px 0 0}button.alt{background:#1c2544;border:1px solid #2d3a63}
.mono{font-family:ui-monospace,monospace;font-size:12px;color:#8b95b9;white-space:pre-wrap}
.j{font-size:12px;margin:4px 0}.pass{color:#5fe3a8}.fail{color:#ff8a95}.unc{color:#ffcf7a}
</style></head><body>
<div id="list"></div><div><iframe id="player"></iframe></div><div id="panel"></div>
<script>
let items=[],cur=-1;
const $=s=>document.querySelector(s);
async function loadList(){items=await (await fetch('/label/api/items')).json();
  $('#list').innerHTML=items.map((it,i)=>'<div data-i="'+i+'" class="'+(i===cur?'sel ':'')+(it.labeled?'done ':'')+(it.gate?'':'gate-fail')+'">'+(it.labeled?'✓ ':'')+it.case+' · t'+it.trial+(it.gate?'':' (gate ✖)')+'</div>').join('');
  document.querySelectorAll('#list div').forEach(d=>d.onclick=()=>open(+d.dataset.i));}
async function open(i){cur=i;await loadList();const it=await (await fetch('/label/api/item?i='+i)).json();
  $('#player').src='/?dir='+encodeURIComponent(it.dir)+'#t='+it.span.start;
  const v=it.label?it.label.verdicts:{};
  $('#panel').innerHTML='<h2>'+it.case+' · trial '+it.trial+'</h2><div class="hint">section '+it.section+' · '+it.span.start.toFixed(2)+'–'+it.span.end.toFixed(2)+'s · gate '+(it.gate?'pass':'FAIL')+' · output '+it.outputId+'</div>'+
  '<h3>Brief</h3><div>'+it.brief+'</div><h3>Narration</h3><div class="mono">'+it.narration+'</div><div class="hint">cues: '+it.cues+'</div>'+
  (it.errors.length?'<h3>Lint errors</h3><div class="mono">'+it.errors.join('\\n')+'</div>':'')+
  '<h3>Your label (judge hidden until saved)</h3>'+it.criteria.map(c=>'<div class="crit"><div class="q"><b>'+c.id+'</b>: '+c.question+'</div><label><input type="radio" name="'+c.id+'" value="pass" '+(v[c.id]===true?'checked':'')+'> pass</label><label><input type="radio" name="'+c.id+'" value="fail" '+(v[c.id]===false?'checked':'')+'> fail</label><div class="hint">fail = '+c.fail+'</div></div>').join('')+
  '<h3>Notes (what would you change?)</h3><textarea id="notes">'+(it.label?it.label.notes:'')+'</textarea><br><button id="save">Save label</button><button class="alt" id="reveal" '+(it.label?'':'disabled')+'>Reveal judge</button><button class="alt" id="next">Next unlabelled →</button><div id="judge"></div>';
  $('#save').onclick=async()=>{const verdicts={};for(const c of it.criteria){const x=document.querySelector('input[name="'+c.id+'"]:checked');if(x)verdicts[c.id]=x.value==='pass';}
    if(verdicts.overall===undefined){alert('Please at least label "overall".');return;}
    await fetch('/label/api/save',{method:'POST',body:JSON.stringify({i,verdicts,notes:$('#notes').value})});$('#reveal').disabled=false;await loadList();};
  $('#reveal').onclick=async()=>{const j=await (await fetch('/label/api/judge?i='+i)).json();
    $('#judge').innerHTML=Object.keys(j).length?Object.entries(j).map(([jid,r])=>'<h3>'+jid+'</h3>'+Object.entries(r.verdicts).map(([k,x])=>'<div class="j"><b>'+k+'</b> <span class="'+(x.uncertain?'unc':x.pass?'pass':'fail')+'">'+(x.pass?'pass':'fail')+(x.p!==null?' (p='+x.p+')':'')+(x.uncertain?' uncertain':'')+'</span>'+(x.critique?' · '+x.critique:'')+(x.pins||[]).map(p=>' <a href="#" class="pin" data-h="t='+p.at+(p.x!==undefined?'&x='+p.x+'&y='+p.y:'')+(p.w!==undefined?'&w='+p.w+'&h='+p.h:'')+'">📍 '+p.at+'s '+p.note+'</a>').join('')+'</div>').join('')).join(''):'<div class="hint">no judge verdicts for this output yet</div>';
    document.querySelectorAll('.pin').forEach(a=>a.onclick=(e)=>{e.preventDefault();$('#player').src='/?dir='+encodeURIComponent(it.dir)+'#'+a.dataset.h;});};
  $('#next').onclick=()=>{const n=items.findIndex((x,k)=>!x.labeled&&k!==i);if(n>=0)open(n);};}
loadList().then(()=>{const n=items.findIndex(x=>!x.labeled);open(n>=0?n:0);});
</script></body></html>`;

export async function startLabelServer(runId: string, port: number, labeler: string) {
  const rubric = loadRubric();
  const rowsNow = () => loadRun(runId).rows;
  const send = (res: any, type: string, b: string) => { res.writeHead(200, { "content-type": type, "cache-control": "no-store" }); res.end(b); };
  const srv = await startServer(ROOT, port, async (req, res, url) => {
    if (!url.pathname.startsWith("/label")) return false;
    const rows = rowsNow();
    const labels = latestLabels();
    if (url.pathname === "/label") { send(res, "text/html", HTML); return true; }
    if (url.pathname === "/label/api/items") {
      send(res, "application/json", JSON.stringify(rows.map((r) => ({ case: r.case, trial: r.trial, outputId: r.outputId, gate: r.metrics.gate, labeled: !!(r.outputId && labels.get(r.outputId)) }))));
      return true;
    }
    const i = Number(url.searchParams.get("i"));
    const r = rows[i];
    if (url.pathname === "/label/api/item" && r) {
      const s = loadVideo(join(ROOT, r.dir)).scenes.find((x) => x.id === r.scene)?.scene;
      const sp = s?.spans.find((x) => x.id === r.section) ?? { start: 0, end: 0, brief: "" };
      const words = (s?.words ?? []).filter((w) => w.start >= sp.start && w.start < sp.end);
      send(res, "application/json", JSON.stringify({
        case: r.case, trial: r.trial, section: r.section, dir: r.dir, outputId: r.outputId, gate: r.metrics.gate, errors: r.metrics.errorMessages,
        span: { start: sp.start, end: sp.end }, brief: sp.brief,
        narration: words.map((w) => w.text).join(" ").replace(/ ([.,!?;:])/g, "$1"),
        cues: Object.entries(s?.cues ?? {}).filter(([, t]) => t >= sp.start && t < sp.end).map(([k, t]) => `${k}@${t.toFixed(2)}s`).join(", "),
        criteria: allCriteria(rubric), label: r.outputId ? labels.get(r.outputId) ?? null : null,
      }));
      return true;
    }
    if (url.pathname === "/label/api/judge" && r) {
      // Only revealed after the human label exists, to avoid anchoring.
      const ok = r.outputId && labels.get(r.outputId);
      send(res, "application/json", JSON.stringify(ok ? r.judges : {}));
      return true;
    }
    if (url.pathname === "/label/api/save" && req.method === "POST") {
      const b = JSON.parse(await body(req));
      const row = rows[b.i];
      if (!row?.outputId) { res.writeHead(400).end("no output"); return true; }
      const label: LabelRow = { outputId: row.outputId, run: row.run, case: row.case, trial: row.trial, labeler, rubricVersion: rubric.version, verdicts: b.verdicts, notes: b.notes ?? "", ts: new Date().toISOString() };
      appendJsonl(join(EVALS, "labels", "labels.jsonl"), label);
      send(res, "application/json", "{}");
      return true;
    }
    return false;
  });
  return srv;
}
