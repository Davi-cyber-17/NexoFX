const CUR={USD:"Dólar americano",EUR:"Euro",BRL:"Real brasileiro",GBP:"Libra esterlina",JPY:"Iene japonês",CAD:"Dólar canadense",AUD:"Dólar australiano",CHF:"Franco suíço",CNY:"Yuan chinês",MXN:"Peso mexicano"};
const PAIRS={usdBrl:{n:"USD / BRL",c:"BRL"},usdEur:{n:"USD / EUR",c:"EUR"},eurBrl:{n:"EUR / BRL",c:"BRL"}};
const API=["https://api.frankfurter.dev/v1","https://api.frankfurter.app"];
const $=id=>document.getElementById(id);
let rates={},history=[],chart=null,days=30,pair="usdBrl",showMA=false,rateDate="",alerts=[];

const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const S={days:30,pair:"usdBrl",ma:false,every:5,dec:4,...store.get("settings",{})};days=S.days;pair=S.pair;showMA=S.ma;
const num=(v,d=S.dec)=>Number.isFinite(v)?new Intl.NumberFormat("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):"—";
const fmt=(v,c,d=S.dec)=>Number.isFinite(v)?new Intl.NumberFormat("pt-BR",{style:"currency",currency:c,minimumFractionDigits:d,maximumFractionDigits:d}).format(v):"—";
const pct=v=>Number.isFinite(v)?`${v>=0?"+":""}${num(v,2)}%`:"—";
const day=s=>new Date(s+"T12:00:00").toLocaleDateString("pt-BR");
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const setChange=(el,v)=>{el.textContent=pct(v);el.classList.toggle("down",v<0)};
const rel=(a,b)=>(a-b)/b*100;

function errState(){
  const l=$("loading");l.className="loading err";l.style.display="flex";
  l.innerHTML='<svg class="i big"><use href="#i-alert"/></svg><b>Sem dados no momento</b><span>Não foi possível falar com a fonte de câmbio. Verifique sua conexão e tente de novo.</span><button class="ghost" id="retry">Tentar novamente</button>';
  $("retry").onclick=refresh;
}
$("theme").onclick=()=>{const t=document.documentElement.dataset.theme==="light"?"dark":"light";document.documentElement.dataset.theme=t;try{localStorage.setItem("theme",t)}catch{}$("sTheme").value=t;if(chart)drawChart()};
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove("show"),4000)}
function status(ok,text){$("sourceDot").classList.toggle("off",!ok);$("sourceText").textContent=text}

async function api(path){
  for(const base of API){
    try{const r=await fetch(base+path,{cache:"no-store"});if(r.ok)return await r.json()}catch(e){}
  }
  throw new Error("API indisponível");
}

async function loadCurrent(){
  try{
    const d=await api(`/latest?base=USD&symbols=${Object.keys(CUR).filter(c=>c!=="USD")}`);
    rates={USD:1,...d.rates};rateDate=d.date;
    store.set("rates",{rates,rateDate});status(true,"Dados online");
  }catch(e){
    const c=store.get("rates");if(!c)throw e;
    rates=c.rates;rateDate=c.rateDate;status(false,"Offline — último valor salvo");
  }
  const eurBrl=rates.BRL/rates.EUR;
  $("usdBrl").textContent=fmt(rates.BRL,"BRL");$("usdEur").textContent=num(rates.EUR);$("eurBrl").textContent=fmt(eurBrl,"BRL");
  $("compareBrl").textContent=fmt(rates.BRL,"BRL");$("compareEur").textContent=num(rates.EUR);$("compareEuroBrl").textContent=fmt(eurBrl,"BRL");
  document.querySelectorAll(".stamp").forEach(e=>e.textContent=`Ref. ${day(rateDate)} · consulta ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`);
  $("lastUpdate").textContent=`${day(rateDate)} (ref. BCE) · consultado às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`;
  updateConverter();sim();renderOthers();checkAlerts();
}

async function loadHistory(d=days){
  days=d;$("loading").className="loading";$("loading").style.display="flex";$("loading").innerHTML='<span class="spin"></span>Carregando dados...';
  const end=new Date(),start=new Date();start.setDate(end.getDate()-d);
  const key="hist"+d;
  try{
    let data;
    try{data=await api(`/${iso(start)}..${iso(end)}?base=USD&symbols=BRL,EUR`);store.set(key,data)}
    catch(e){data=store.get(key);if(!data)throw e}
    history=Object.entries(data.rates).sort().map(([date,r])=>({date,usdBrl:r.BRL,usdEur:r.EUR,eurBrl:r.BRL/r.EUR}));
    if(history.length<2)throw new Error("Histórico insuficiente");
    $("loading").style.display="none";
    drawChart();analyze();renderTable();
  }catch(e){
    errState();
    console.error(e);
  }
}

function ma(values,n=7){return values.map((_,i)=>i<n-1?null:values.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n)}

const cv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const cross={id:"cross",afterDraw(c){const a=c.tooltip?.getActiveElements?.();if(!a?.length)return;const x=a[0].element.x,{top,bottom}=c.chartArea,g=c.ctx;g.save();g.beginPath();g.moveTo(x,top);g.lineTo(x,bottom);g.lineWidth=1;g.strokeStyle=cv("--cyan");g.globalAlpha=.5;g.setLineDash([4,4]);g.stroke();g.restore()}};
function drawChart(){
  const ctx=$("chart").getContext("2d");if(chart)chart.destroy();
  const line=cv("--line"),g=ctx.createLinearGradient(0,0,0,300);g.addColorStop(0,line+"55");g.addColorStop(1,line+"00");
  const vals=history.map(x=>x[pair]),muted=cv("--muted"),grid=cv("--grid");
  const sets=[{label:PAIRS[pair].n,data:vals,borderColor:line,backgroundColor:g,borderWidth:2.2,fill:true,tension:.35,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:cv("--panel"),pointHoverBorderColor:line,pointHoverBorderWidth:2}];
  if(showMA)sets.push({label:"Média móvel (7)",data:ma(vals),borderColor:cv("--amber"),borderWidth:1.6,borderDash:[5,4],fill:false,tension:.35,pointRadius:0});
  chart=new Chart(ctx,{type:"line",data:{labels:history.map(x=>x.date.slice(8)+"/"+x.date.slice(5,7)),datasets:sets},plugins:[cross],options:{
    responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:"easeOutCubic"},interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:showMA,labels:{color:muted,boxWidth:12}},tooltip:{backgroundColor:cv("--tip"),titleColor:cv("--text"),bodyColor:cv("--text"),borderColor:cv("--border"),borderWidth:1,padding:10,displayColors:false,callbacks:{title:i=>day(history[i[0].dataIndex].date),label:c=>` ${c.dataset.label}: ${num(c.raw)}`}}},
    scales:{x:{grid:{color:grid},ticks:{color:muted,font:{size:11},maxTicksLimit:8},border:{display:false}},y:{grid:{color:grid},ticks:{color:muted,font:{size:11}},border:{display:false}}}}});
}

function analyze(){
  const first=history[0],last=history.at(-1),prev=history.at(-2);
  const vals=history.map(x=>x[pair]),min=Math.min(...vals),max=Math.max(...vals);
  const change=rel(last[pair],first[pair]),c=PAIRS[pair].c;
  $("periodChange").textContent=pct(change);$("periodChange").style.color=change<0?"var(--red)":"var(--green)";
  $("periodStatus").textContent=PAIRS[pair].n;$("periodLabel").textContent=`últimos ${days} dias`;
  const up=change>0.5,dn=change<-0.5,base=pair==="eurBrl"?"O euro":pair==="usdEur"?"O dólar (em euros)":"O dólar";
  $("trendTitle").textContent=up?`${PAIRS[pair].n} em alta`:dn?`${PAIRS[pair].n} em queda`:`${PAIRS[pair].n} estável`;
  $("trendText").textContent=up||dn?`${base} terminou ${pct(change)} ${up?"acima":"abaixo"} do primeiro ponto do período.`:`Variação de ${pct(change)}, dentro da margem de ±0,5%.`;
  $("rangeText").textContent=`Mínima ${num(min)} · Máxima ${num(max)} · Atual ${num(last[pair])}`;
  const r=vals.slice(1).map((v,i)=>rel(v,vals[i])),m=r.reduce((a,b)=>a+b,0)/r.length;
  const vol=Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/Math.max(1,r.length-1));
  $("volatilityText").textContent=`Desvio padrão diário de ${num(vol,3)}% — ${vol<.4?"baixa":vol<.8?"moderada":"alta"} oscilação.`;
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  $("avgText").textContent=`Média ${num(avg)} · o valor atual está ${pct(rel(last[pair],avg))} da média.`;
  indicators(vals);
  // variação diária nos cards (último fechamento vs anterior)
  setChange($("usdBrlChange"),rel(last.usdBrl,prev.usdBrl));setChange($("usdEurChange"),rel(last.usdEur,prev.usdEur));setChange($("eurBrlChange"),rel(last.eurBrl,prev.eurBrl));
  for(const [k,id] of [["usdBrl","compareBrlChange"],["usdEur","compareEurChange"],["eurBrl","compareEuroBrlChange"]])setChange($(id),rel(last[k],first[k]));
  // barras: posição do valor atual dentro da faixa do período
  for(const [k,id] of [["usdBrl","barBrl"],["usdEur","barEur"],["eurBrl","barEuroBrl"]]){
    const v=history.map(x=>x[k]),lo=Math.min(...v),hi=Math.max(...v);
    $(id).style.width=`${hi===lo?50:Math.max(4,(last[k]-lo)/(hi-lo)*100)}%`;
  }
}

function renderTable(){
  const rows=[...history].reverse();
  $("tbody").innerHTML=rows.map((x,i)=>{const p=rows[i+1];const ch=p?rel(x.usdBrl,p.usdBrl):NaN;
    return `<tr><td>${day(x.date)}</td><td>${num(x.usdBrl)}</td><td>${num(x.usdEur)}</td><td>${num(x.eurBrl)}</td><td class="${ch<0?"neg":"pos"}">${pct(ch)}</td></tr>`}).join("");
}
function exportCsv(rows=history,d=days){
  const head="data;USD/BRL;USD/EUR;EUR/BRL\n";
  const body=rows.map(x=>[x.date,x.usdBrl,x.usdEur,x.eurBrl.toFixed(4)].join(";").replace(/\./g,",").replace(/^(\d{4}),(\d{2}),(\d{2})/,"$1-$2-$3")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+head+body],{type:"text/csv"}));a.download=`nexo-fx-${d}d.csv`;a.click();URL.revokeObjectURL(a.href);
}

function updateConverter(){
  if(!rates.BRL)return;
  const a=Number($("amount").value)||0,f=$("from").value,t=$("to").value,res=a/rates[f]*rates[t];
  $("result").textContent=`${num(res,t==="JPY"?0:2)} ${t}`;
  $("multi").innerHTML=Object.keys(CUR).filter(c=>c!==f).map(c=>`<tr><td><b>${c}</b> <small>${CUR[c]}</small></td><td>${num(a/rates[f]*rates[c],c==="JPY"?0:2)}</td></tr>`).join("");
  $("rateLine").textContent=`1 ${f} = ${num(rates[t]/rates[f],4)} ${t}`;
}
function renderMatrix(){
  const ks=Object.keys(CUR);
  $("matrix").innerHTML="<thead><tr><th></th>"+ks.map(k=>`<th>${k}</th>`).join("")+"</tr></thead><tbody>"+ks.map(f=>`<tr><td><b>${f}</b></td>`+ks.map(t=>`<td>${f===t?"—":num(rates[t]/rates[f],t==="JPY"?2:4)}</td>`).join("")+"</tr>").join("")+"</tbody>";
}
function renderOthers(){renderMatrix();
  $("others").innerHTML=Object.keys(CUR).filter(c=>c!=="BRL").map(c=>`<div><span>${c}</span><small>${CUR[c]}</small><b>${fmt(rates.BRL/rates[c],"BRL",c==="JPY"?4:2)}</b></div>`).join("");
}

// ---- Alertas de preço (salvos no navegador)
function renderAlerts(){
  $("alertList").innerHTML=alerts.length?alerts.map((a,i)=>`<li class="${a.hit?"hit":""}"><span>${PAIRS[a.pair].n} ${a.dir==="above"?"≥":"≤"} <b>${num(a.value)}</b>${a.hit?" · atingido":""}</span><button data-i="${i}" aria-label="Remover alerta">✕</button></li>`).join(""):`<li class="empty">Nenhum alerta. Defina um valor e seja avisado quando a cotação chegar nele.</li>`;
}
function current(p){return p==="usdBrl"?rates.BRL:p==="usdEur"?rates.EUR:rates.BRL/rates.EUR}
function checkAlerts(){
  let changed=false;
  alerts.forEach(a=>{
    const v=current(a.pair),hit=a.dir==="above"?v>=a.value:v<=a.value;
    if(hit&&!a.hit){toast(`Alerta: ${PAIRS[a.pair].n} em ${num(v)}`);try{if(Notification.permission==="granted")new Notification("NEXO FX",{body:`${PAIRS[a.pair].n} chegou a ${num(v)}`})}catch{}}
    if(a.hit!==hit){a.hit=hit;changed=true}
  });
  if(changed)store.set("alerts",alerts);renderAlerts();
}

async function refresh(){
  const b=$("refresh");b.disabled=true;$("refreshLabel").textContent="Atualizando...";
  try{await loadCurrent();await loadHistory(days);toast("Cotações atualizadas.")}
  catch(e){toast("Sem conexão com a API de câmbio. Tente novamente em instantes.")}
  finally{b.disabled=false;$("refreshLabel").textContent="Atualizar"}
}

// ---- Eventos
document.querySelectorAll(".periods button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".periods button").forEach(x=>x.classList.remove("active"));b.classList.add("active");loadHistory(+b.dataset.days)});
$("pair").onchange=e=>{pair=e.target.value;if(history.length){drawChart();analyze()}};
$("ma").onchange=e=>{showMA=e.target.checked;if(history.length)drawChart()};
$("refresh").onclick=refresh;$("csv").onclick=()=>exportCsv();
["amount","from","to"].forEach(id=>$(id).addEventListener("input",updateConverter));
$("swap").onclick=()=>{const o=$("from").value;$("from").value=$("to").value;$("to").value=o;updateConverter()};
$("copy").onclick=()=>{navigator.clipboard?.writeText($("result").textContent).then(()=>toast("Resultado copiado."))};
$("alertForm").onsubmit=e=>{
  e.preventDefault();const v=parseFloat($("alertValue").value.replace(",","."));
  if(!(v>0)){toast("Informe um valor maior que zero.");return}
  alerts.push({pair:$("alertPair").value,dir:$("alertDir").value,value:v,hit:false});
  store.set("alerts",alerts);$("alertValue").value="";checkAlerts();
  try{if(Notification.permission==="default")Notification.requestPermission()}catch{}
};
$("alertList").onclick=e=>{const i=e.target.dataset.i;if(i!==undefined){alerts.splice(+i,1);store.set("alerts",alerts);renderAlerts()}};

// ---- Páginas (roteador por hash)
const VIEWS=["visao","mercados","analises","conversor","noticias","calendario","relatorios","config"];
const links=[...document.querySelectorAll(".side-nav a")];
let newsLoaded=false;
function route(){
  let k=location.hash.slice(1);if(!VIEWS.includes(k))k="visao";
  document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-"+k);
  links.forEach(l=>l.classList.toggle("active",l.hash==="#"+k));
  document.title=`${links.find(l=>l.hash==="#"+k).innerText.trim()} — NEXO FX`;
  scrollTo(0,0);
  if(k==="analises"&&history.length)drawChart();
  if(k==="noticias"&&!newsLoaded){newsLoaded=true;loadNews()}
}
addEventListener("hashchange",route);

// ---- Indicadores técnicos
function emaOf(v,n){const k=2/(n+1);return v.reduce((e,x,i)=>i?x*k+e*(1-k):x,v[0])}
function indicators(v){
  const n=v.length,last=v.at(-1),sma=p=>n>=p?v.slice(-p).reduce((a,b)=>a+b,0)/p:NaN;
  let rsi=NaN;
  if(n>14){let g=0,l=0;for(let i=n-14;i<n;i++){const d=v[i]-v[i-1];d>0?g+=d:l-=d}rsi=l===0?100:100-100/(1+g/l)}
  let bb=[NaN,NaN];
  if(n>=20){const w=v.slice(-20),m=w.reduce((a,b)=>a+b,0)/20,sd=Math.sqrt(w.reduce((s,x)=>s+(x-m)**2,0)/20);bb=[m-2*sd,m+2*sd]}
  const rs=Number.isFinite(rsi)?(rsi>70?"sobrecomprado":rsi<30?"sobrevendido":"neutro"):"poucos dados";
  const t=[["Média simples (7)",num(sma(7)),""],["Média simples (21)",num(sma(21)),n<21?"poucos dados":""],["Média exponencial (12)",num(emaOf(v,12)),""],["RSI (14)",Number.isFinite(rsi)?num(rsi,1):"—",rs],["Bollinger inferior (20)",num(bb[0]),n<20?"poucos dados":""],["Bollinger superior (20)",num(bb[1]),""],["Atual vs média 7",pct(rel(last,sma(7))),""]];
  $("ind").innerHTML=t.map(([a,b,c])=>`<div><small>${a}</small><b>${b}</b><em>${c}</em></div>`).join("");
}

// ---- Notícias
const FEEDS={ab:{n:"Agência Brasil",u:"https://agenciabrasil.ebc.com.br/rss/economia/feed.xml"},g1:{n:"g1 Economia",u:"https://g1.globo.com/rss/g1/economia/"}};
let feed="ab";
const stateHtml=(t,m,btn)=>`<div class="state"><svg class="i big"><use href="#i-alert"/></svg><b>${t}</b><span>${m}</span>${btn?'<button class="ghost" id="newsRetry">Tentar novamente</button>':""}</div>`;
async function loadNews(){
  const box=$("newsList");box.innerHTML='<div class="state"><span class="spin"></span><span>Carregando manchetes...</span></div>';
  const key="news"+feed;let items;
  try{
    const r=await fetch("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(FEEDS[feed].u));
    const d=await r.json();if(d.status!=="ok")throw new Error("feed");
    items=d.items.slice(0,12).map(i=>({t:i.title,l:i.link,d:i.pubDate}));store.set(key,items);
  }catch(e){items=store.get(key)}
  if(!items?.length){box.innerHTML=stateHtml("Notícias indisponíveis","Não foi possível carregar as manchetes agora. Você pode ler as fontes oficiais ao lado.",true);$("newsRetry").onclick=loadNews;return}
  box.innerHTML=items.map(i=>`<a href="${i.l}" target="_blank" rel="noopener noreferrer"><b>${i.t.replace(/</g,"&lt;")}</b><small>${FEEDS[feed].n} · ${i.d?new Date(i.d.replace(" ","T")).toLocaleDateString("pt-BR"):""}</small></a>`).join("");
}
$("newsTabs").onclick=e=>{const f=e.target.dataset.f;if(!f)return;feed=f;document.querySelectorAll("#newsTabs button").forEach(b=>b.classList.toggle("active",b.dataset.f===f));loadNews()};

// ---- Calendário econômico (eventos do próprio usuário)
let cal=new Date(),events=store.get("events",[]);cal.setDate(1);
const pad=n=>String(n).padStart(2,"0");
function renderCal(){
  const y=cal.getFullYear(),m=cal.getMonth(),first=new Date(y,m,1).getDay(),n=new Date(y,m+1,0).getDate(),today=iso(new Date());
  $("calTitle").textContent=cal.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  let h="DSTQQSS".split("").map(d=>`<b>${d}</b>`).join("")+"<i></i>".repeat(first);
  for(let d=1;d<=n;d++){const ds=`${y}-${pad(m+1)}-${pad(d)}`,ev=events.filter(e=>e.date===ds);
    h+=`<button class="day${ds===today?" today":""}" data-d="${ds}" aria-label="${d}${ev.length?`, ${ev.length} evento(s)`:""}">${d}${ev.length?`<span class="dot${ev.some(e=>e.impact==="alto")?" hi":""}"></span>`:""}</button>`}
  $("calGrid").innerHTML=h;
  const up=[...events].filter(e=>e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10);
  $("evList").innerHTML=up.length?up.map(e=>`<li><span><b>${day(e.date)}</b> · ${e.title} <em class="tag ${e.impact}">${e.type} · ${e.impact==="medio"?"médio":e.impact}</em></span><button data-e="${e.id}" aria-label="Remover evento">✕</button></li>`).join(""):'<li class="empty">Nenhum evento futuro. Escolha um dia no calendário e cadastre o primeiro.</li>';
}
$("calPrev").onclick=()=>{cal.setMonth(cal.getMonth()-1);renderCal()};$("calNext").onclick=()=>{cal.setMonth(cal.getMonth()+1);renderCal()};
$("calGrid").onclick=e=>{const d=e.target.closest(".day")?.dataset.d;if(d){$("evDate").value=d;$("evTitle").focus()}};
$("evForm").onsubmit=e=>{e.preventDefault();events.push({id:Date.now(),date:$("evDate").value,title:$("evTitle").value.trim(),type:$("evType").value,impact:$("evImpact").value});store.set("events",events);$("evTitle").value="";renderCal();toast("Evento adicionado.")};
$("evList").onclick=e=>{const id=e.target.dataset.e;if(id){events=events.filter(x=>x.id!=id);store.set("events",events);renderCal()}};

// ---- Relatórios
let rep=null;
function stats(rows,k){const v=rows.map(x=>x[k]),f=v[0],l=v.at(-1),r=v.slice(1).map((x,i)=>rel(x,v[i])),m=r.reduce((a,b)=>a+b,0)/r.length;
  return{f,l,ch:rel(l,f),min:Math.min(...v),max:Math.max(...v),avg:v.reduce((a,b)=>a+b,0)/v.length,vol:Math.sqrt(r.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,r.length-1))}}
async function genReport(){
  const d=+$("repDays").value,end=new Date(),start=new Date();start.setDate(end.getDate()-d);
  $("repGo").disabled=true;$("repOut").innerHTML='<div class="state"><span class="spin"></span><span>Gerando relatório...</span></div>';
  try{
    let data;try{data=await api(`/${iso(start)}..${iso(end)}?base=USD&symbols=BRL,EUR`)}catch(e){data=store.get("hist"+d);if(!data)throw e}
    const rows=Object.entries(data.rates).sort().map(([date,r])=>({date,usdBrl:r.BRL,usdEur:r.EUR,eurBrl:r.BRL/r.EUR}));
    if(rows.length<2)throw new Error("poucos dados");
    rep={d,rows,gen:new Date(),st:Object.fromEntries(Object.keys(PAIRS).map(k=>[k,stats(rows,k)]))};
    const line=(lbl,f)=>`<tr><td>${lbl}</td>${Object.keys(PAIRS).map(k=>`<td>${f(rep.st[k])}</td>`).join("")}</tr>`;
    $("repOut").innerHTML=`<h3>Relatório de câmbio — ${day(rows[0].date)} a ${day(rows.at(-1).date)}</h3><p class="hint">${rows.length} dias úteis · gerado em ${rep.gen.toLocaleString("pt-BR")} · fonte: Frankfurter (taxas de referência do BCE)</p><div class="table-wrap"><table><thead><tr><th></th>${Object.values(PAIRS).map(p=>`<th>${p.n}</th>`).join("")}</tr></thead><tbody>${line("Início",s=>num(s.f))}${line("Fim",s=>num(s.l))}${line("Variação",s=>`<span class="${s.ch<0?"neg":"pos"}">${pct(s.ch)}</span>`)}${line("Mínima",s=>num(s.min))}${line("Máxima",s=>num(s.max))}${line("Média",s=>num(s.avg))}${line("Volatilidade diária",s=>num(s.vol,3)+"%")}</tbody></table></div><p class="hint">Conteúdo informativo; não constitui recomendação financeira.</p>`;
    $("repBtns").hidden=false;
  }catch(e){$("repOut").innerHTML=stateHtml("Não foi possível gerar o relatório","Verifique sua conexão e tente novamente.");$("repBtns").hidden=true}
  finally{$("repGo").disabled=false}
}
$("repGo").onclick=genReport;
$("repPrint").onclick=()=>print();
$("repCsv").onclick=()=>rep&&exportCsv(rep.rows,rep.d);
$("repJson").onclick=()=>{if(!rep)return;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify({gerado:rep.gen,dias:rep.d,resumo:rep.st,dados:rep.rows},null,2)],{type:"application/json"}));a.download=`nexo-fx-${rep.d}d.json`;a.click();URL.revokeObjectURL(a.href)};
$("repCopy").onclick=()=>{if(!rep)return;const t=Object.entries(PAIRS).map(([k,p])=>`${p.n}: ${num(rep.st[k].f)} → ${num(rep.st[k].l)} (${pct(rep.st[k].ch)})`).join("\n");navigator.clipboard?.writeText(`NEXO FX — últimos ${rep.d} dias\n${t}`).then(()=>toast("Resumo copiado."))};

// ---- Configurações
let timer;
function schedule(){clearInterval(timer);$("everyText").textContent=S.every?`Atualiza a cada ${S.every} min`:"Atualização manual";
  if(S.every)timer=setInterval(()=>{if(!document.hidden)loadCurrent().then(()=>loadHistory(days)).catch(()=>{})},S.every*60000)}
function applyTheme(t){let v=t;if(t==="auto"){try{localStorage.removeItem("theme")}catch{}v=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}else{try{localStorage.setItem("theme",t)}catch{}}document.documentElement.dataset.theme=v;if(chart)drawChart()}
$("sTheme").value=localStorage.getItem("theme")||"auto";
$("sDays").value=S.days;$("sPair").value=S.pair;$("sEvery").value=S.every;$("sDec").value=S.dec;$("sMa").value=S.ma?"1":"0";
document.querySelectorAll(".prefs select").forEach(el=>el.onchange=()=>{
  S.days=+$("sDays").value;S.pair=$("sPair").value;S.every=+$("sEvery").value;S.dec=+$("sDec").value;S.ma=$("sMa").value==="1";
  store.set("settings",S);applyTheme($("sTheme").value);schedule();if(rates.BRL)loadCurrent().then(()=>history.length&&analyze()).catch(()=>{});toast("Preferências salvas.")});
$("wipe").onclick=()=>{if(confirm("Apagar alertas, conversões, eventos, cache e preferências deste navegador?")){try{localStorage.clear()}catch{}location.hash="";location.reload()}};

// ---- Ferramentas
$("png").onclick=()=>{if(!chart)return;const a=document.createElement("a");a.href=chart.toBase64Image();a.download=`grafico-${pair}-${days}d.png`;a.click()};
function sim(){
  if(!rates.BRL)return;
  const v=Number($("simValue").value)||0,c=$("simCur").value,i=Number($("simIof").value)||0,f=Number($("simFee").value)||0;
  const base=v/rates[c]*rates.BRL,fee=base*f/100,iof=(base+fee)*i/100,total=base+fee+iof;
  $("simTotal").textContent=fmt(total,"BRL",2);
  $("simInfo").textContent=`Câmbio ${fmt(base,"BRL",2)} + taxa ${fmt(fee,"BRL",2)} + IOF ${fmt(iof,"BRL",2)} · custo efetivo de ${num(v?total/v:0,4)} R$ por ${c}`;
}
["simValue","simCur","simIof","simFee"].forEach(id=>$(id).addEventListener("input",sim));
$("dateIn").max=iso(new Date());$("dateIn").min="1999-01-04";
$("dateGo").onclick=async()=>{
  const d=$("dateIn").value;if(!d){toast("Escolha uma data.");return}
  $("dateOut").innerHTML="<small>Consultando...</small>";
  try{
    const x=await api(`/${d}?base=USD&symbols=BRL,EUR`),b=x.rates.BRL,e=x.rates.EUR;
    $("dateOut").innerHTML=`<small>Cotação de ${day(x.date)}${x.date!==d?" (último dia útil disponível)":""}</small><strong>USD/BRL ${num(b)}</strong><small>USD/EUR ${num(e)} · EUR/BRL ${num(b/e)} · hoje o dólar está ${pct(rel(rates.BRL,b))} em relação a essa data</small>`;
  }catch(err){$("dateOut").innerHTML="<small>Não foi possível consultar essa data. Tente outra.</small>"}
};
let convs=store.get("convs",[]);
function renderConvs(){$("convList").innerHTML=convs.map((c,i)=>`<li><span>${c}</span><button data-c="${i}" aria-label="Remover">✕</button></li>`).join("")}
$("saveConv").onclick=()=>{convs.unshift(`${num(Number($("amount").value)||0,2)} ${$("from").value} → ${$("result").textContent}`);convs=convs.slice(0,5);store.set("convs",convs);renderConvs()};
$("convList").onclick=e=>{const i=e.target.dataset.c;if(i!==undefined){convs.splice(+i,1);store.set("convs",convs);renderConvs()}};

// ---- Início
Object.entries(CUR).forEach(([c,n])=>["from","to","simCur"].forEach(id=>{const el=$(id);if(el)el.add(new Option(`${c} — ${n}`,c))}));
$("from").value="USD";$("to").value="BRL";$("simCur").value="USD";renderConvs();renderCal();$("pair").value=pair;$("ma").checked=showMA;document.querySelectorAll(".periods button[data-days]").forEach(b=>b.classList.toggle("active",+b.dataset.days===days));
alerts=store.get("alerts",[]);renderAlerts();
route();
(async()=>{
  try{await loadCurrent();await loadHistory(days)}
  catch(e){$("lastUpdate").textContent="indisponível";errState();status(false,"Sem conexão")}
  setTimeout(()=>$("splash").classList.add("hide"),600);
  schedule();
})();

setTimeout(()=>$("splash").classList.add("hide"),8000);
