import{a as h,j as s}from"./data-RANujcqJ.js";import{g as w,B as j,d as y}from"./index-8wsGsjRs.js";import{w as A}from"./BoardPage-bvSQ_Ulk.js";import"./react-OjxCA_oU.js";import"./runtimeStore-o7rQzcPS.js";const E=["id","type","title","status","confidence","tags","source","createdAt","updatedAt"],k=["id","type","source","target","label","directed","confidence","weight"];function S(e){const t=String(e);return/[",\r\n]/.test(t)?`"${t.replaceAll('"','""')}"`:t}function b(e){return e.map(t=>t.map(S).join(",")).join(`\r
`)}function B(e){const t=b([E,...e.nodes.map(o=>[o.id,o.type,o.title,o.status,o.confidence,o.tags.join(" "),o.provenance.source??"",o.createdAt,o.updatedAt])]),n=b([k,...e.edges.map(o=>[o.id,o.type,o.source.nodeId,o.target.nodeId,o.label,o.directed,o.confidence,o.weight])]);return{nodes:t,edges:n}}function g(e,t){const n=e.nodes.find(o=>o.id===t);return n===void 0?t:n.title||`${n.type} ${n.id}`}function l(e){return e.replaceAll("|","\\|").replaceAll(`
`," ")}function C(e){const t=[`# ${e.board.title||"Untitled board"}`,"",`_Exported ${e.exportedAt} — ${String(e.nodes.length)} nodes, ${String(e.edges.length)} connections._`,"","## Nodes","","| Title | Type | Confidence | Tags | Source |","| --- | --- | --- | --- | --- |"];for(const n of e.nodes)t.push(`| ${l(n.title||n.id)} | ${l(n.type)} | ${n.confidence} | ${l(n.tags.join(", "))} | ${l(n.provenance.source??"")} |`);t.push("","## Connections",""),e.edges.length===0&&t.push("_No connections._");for(const n of e.edges){const o=n.directed?"→":"↔",c=n.label||n.type;t.push(`- ${l(g(e,n.source.nodeId))} ${o} ${l(g(e,n.target.nodeId))} — ${l(c)} (${n.confidence})`)}return`${t.join(`
`)}
`}function p(e){return`"${e.replaceAll("\\","\\\\").replaceAll('"','\\"')}"`}function N(e){const t=["digraph board {","  rankdir=LR;"];for(const n of e.nodes)t.push(`  ${p(n.id)} [label=${p(n.title||n.type)}, tooltip=${p(n.type)}];`);for(const n of e.edges){const o=[`label=${p(n.label||n.type)}`];n.directed||o.push("dir=none"),t.push(`  ${p(n.source.nodeId)} -> ${p(n.target.nodeId)} [${o.join(", ")}];`)}return t.push("}"),`${t.join(`
`)}
`}function a(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function I(e,t={}){const n=e.board.title||"Untitled investigation",o=new Map;for(const r of e.nodes)o.set(r.type,(o.get(r.type)??0)+1);const c=t.canvasImage===void 0||t.canvasImage===null?"":`<figure class="cover"><img alt="Canvas overview" src="${a(t.canvasImage)}" /><figcaption>Canvas overview</figcaption></figure>`,f=t.summary===void 0||t.summary===""?"":`<section><h2>Summary</h2><p>${a(t.summary)}</p></section>`,m=e.nodes.map(r=>`<article class="finding">
      <h3>${a(r.title||r.id)}</h3>
      <p class="meta">${a(r.type)} · confidence ${a(r.confidence)}${r.tags.length>0?` · ${a(r.tags.join(", "))}`:""}</p>
      ${r.provenance.source===null?"":`<p class="src">${a(r.provenance.source)}</p>`}
    </article>`).join(`
`),$=e.edges.map(r=>`<li>${a(g(e,r.source.nodeId))} ${r.directed?"→":"↔"} ${a(g(e,r.target.nodeId))} — ${a(r.label||r.type)} <em>(${a(r.confidence)})</em></li>`).join(`
`);return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${a(n)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 46rem; padding: 3rem 1.5rem; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; color: #16181d; }
  h1 { font-size: 2rem; margin: 0 0 .25rem; }
  .meta { color: #5b6270; font-size: .85rem; margin: .15rem 0; }
  .cover img { width: 100%; border: 1px solid #d8dbe2; border-radius: .5rem; }
  .finding { border-top: 1px solid #e5e7eb; padding: .75rem 0; break-inside: avoid; }
  .src { word-break: break-all; font-size: .85rem; color: #3c4657; }
  ul { padding-left: 1.1rem; }
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    .finding, li, figure { break-inside: avoid; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 9pt; }
  }
</style>
</head>
<body>
<header>
  <h1>${a(n)}</h1>
  <p class="meta">Exported ${a(e.exportedAt)} · ${String(e.nodes.length)} nodes · ${String(e.edges.length)} connections</p>
  <p class="meta">${a([...o.entries()].map(([r,u])=>`${r}: ${String(u)}`).join(" · "))}</p>
</header>
${c}
${f}
<section><h2>Findings</h2>
${m}
</section>
<section><h2>Relationships</h2>
${e.edges.length===0?'<p class="meta">No connections recorded.</p>':`<ul>${$}</ul>`}
</section>
</body>
</html>
`}const R=["json","csv","markdown","graph","report","png"],L={json:"Board archive (.raven.json)",csv:"Nodes + edges (.csv)",markdown:"Notes (.md)",graph:"Graph (.dot)",report:"Investigation report (.html, printable)",png:"Canvas image (.png)"};function U(e){const t=e.replaceAll(/[^\p{L}\p{N} ._-]/gu,"").trim();return t===""?"board":t}function d(e,t){const n=URL.createObjectURL(e),o=document.createElement("a");o.href=n,o.download=t,o.click(),URL.revokeObjectURL(n)}async function v(e){return e===null?null:await new Promise(t=>{e.toBlob(n=>{t(n)},"image/png")})}async function T(e){if(e===null)return null;const t=new Uint8Array(await e.arrayBuffer());let n="";for(const o of t)n+=String.fromCodePoint(o);return`data:image/png;base64,${btoa(n)}`}async function _(e){const t=U(e.archive.board.title);switch(e.format){case"json":return d(new Blob([A(e.archive)],{type:"application/json"}),`${t}.raven.json`),`${t}.raven.json`;case"csv":{const{nodes:n,edges:o}=B(e.archive);return d(new Blob([n],{type:"text/csv"}),`${t}.nodes.csv`),d(new Blob([o],{type:"text/csv"}),`${t}.edges.csv`),`${t}.nodes.csv`}case"markdown":return d(new Blob([C(e.archive)],{type:"text/markdown"}),`${t}.md`),`${t}.md`;case"graph":return d(new Blob([N(e.archive)],{type:"text/vnd.graphviz"}),`${t}.dot`),`${t}.dot`;case"report":{const n=await T(await v(e.canvas??null)),o=I(e.archive,{canvasImage:n,summary:e.summary});return d(new Blob([o],{type:"text/html"}),`${t}.report.html`),`${t}.report.html`}case"png":{const n=await v(e.canvas??null);return n===null?null:(d(n,`${t}.png`),`${t}.png`)}}}function P({open:e,onOpenChange:t,buildArchive:n,canvas:o}){const[c,f]=h.useState("json"),[m,$]=h.useState(""),[r,u]=h.useState(null);async function x(){try{if(await _({archive:n(),format:c,canvas:o?.()??null,summary:m.trim()===""?void 0:m.trim()})===null){u("The canvas image is not available on this device");return}u(null),t(!1)}catch(i){u(i instanceof Error?i.message:"The export failed")}}return s.jsxs(w,{open:e,onOpenChange:t,title:"Export",description:"Everything is generated on this device; nothing is uploaded",footer:s.jsxs(s.Fragment,{children:[s.jsx(y,{variant:"secondary",onClick:()=>t(!1),children:"Cancel"}),s.jsx(y,{"data-testid":"export-run",onClick:()=>void x(),children:"Export"})]}),children:[r!==null?s.jsx(j,{kind:"danger",title:"Nothing was exported",children:r}):null,s.jsxs("label",{className:"nx-stack",children:[s.jsx("span",{children:"Format"}),s.jsx("select",{"data-testid":"export-format",value:c,onChange:i=>f(i.target.value),children:R.map(i=>s.jsx("option",{value:i,children:L[i]},i))})]}),c==="report"?s.jsxs("label",{className:"nx-stack",children:[s.jsx("span",{children:"Summary (optional)"}),s.jsx("textarea",{"data-testid":"export-summary",rows:3,value:m,onChange:i=>$(i.target.value)})]}):null]})}export{P as ExportDialog};
