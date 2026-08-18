const $ = s => document.querySelector(s);
let catalog = [];
let currentEntry = null;
let selectedCandidate = null;
let currentConversation = null;
let currentTopics = [];
let currentUserMessages = [];
let navMode = "toc";
let chatSearchHits=[];
let chatSearchIndex=-1;

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function inlineMd(s){
  s=esc(s);
  s=s.replace(/`([^`\n]+)`/g,"<code>$1</code>");
  s=s.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  s=s.replace(/\*([^*\n]+)\*/g,"<em>$1</em>");
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s;
}
function renderMarkdown(text){
  if(!text)return "";
  const blocks=[];
  text=String(text).replace(/```([^\n]*)\n([\s\S]*?)```/g,(_,lang,code)=>{
    const t=`@@CODE_${blocks.length}@@`; blocks.push(`<pre><code>${esc(code)}</code></pre>`); return t;
  });
  return text.split(/\n{2,}/).map(part=>{
    const m=part.match(/^@@CODE_(\d+)@@$/); if(m)return blocks[Number(m[1])];
    return `<p>${inlineMd(part).replace(/\n/g,"<br>")}</p>`;
  }).join("");
}
async function loadJSON(url){
  const r=await fetch(url,{cache:"no-store"}); if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
  return await r.json();
}
function activeNodes(conv){
  const mapping=conv.mapping||{}, current=conv.current_node;
  if(current&&mapping[current]){
    const ids=[],seen=new Set(); let id=current;
    while(id&&mapping[id]&&!seen.has(id)){seen.add(id);ids.push(id);id=mapping[id].parent;}
    ids.reverse(); return ids.map(id=>[id,mapping[id]]);
  }
  return Object.entries(mapping).filter(([,n])=>n&&n.message)
    .sort((a,b)=>((a[1].message?.create_time??0)-(b[1].message?.create_time??0)));
}
function buildAttachmentMap(indexData){
  const map={}; for(const [pointer,info] of Object.entries(indexData?.attachments||{})){if(info?.path)map[pointer]=info.path;} return map;
}
function renderParts(parts,attachmentMap,chatBase){
  let html="";
  for(const part of (parts||[])){
    if(typeof part==="string"){html+=renderMarkdown(part);continue;}
    if(!part||typeof part!=="object")continue;
    if(part.content_type==="image_asset_pointer"){
      const ptr=part.asset_pointer||"",rel=attachmentMap[ptr];
      html+=rel?`<img src="${esc(chatBase+"/"+rel)}" alt="attachment" loading="lazy">`:`<div class="missing">[Зображення не знайдено: ${esc(ptr)}]</div>`;
    }else if(part.content_type==="audio_transcription"&&part.text){html+=`<p>🎤 ${inlineMd(part.text)}</p>`;}
    else if(part.content_type==="audio_asset_pointer"){
      const rel=attachmentMap[part.asset_pointer||""]; if(rel)html+=`<audio controls src="${esc(chatBase+"/"+rel)}"></audio>`;
    }
  } return html;
}
function renderMessageContent(message,attachmentMap,chatBase){
  const c=message?.content||{},type=c.content_type;
  if(type==="text"||type==="multimodal_text")return renderParts(c.parts||[],attachmentMap,chatBase);
  if(type==="code")return `<pre><code>${esc(c.text||"")}</code></pre>`;
  if(type==="reasoning_recap")return `<details class="reasoning"><summary>Reasoning recap</summary>${renderMarkdown(c.content||"")}</details>`;
  if(type==="thoughts"){
    const txt=(c.thoughts||[]).map(x=>[x.summary,x.content].filter(Boolean).join("\n\n")).join("\n\n");
    return `<details class="reasoning"><summary>Thoughts</summary>${renderMarkdown(txt)}</details>`;
  }
  return "";
}

function shortenAtWordBoundary(text, target = 130, max = 150) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= max) {
    return clean;
  }

  let cut = Math.min(target, clean.length);

  while (
    cut < clean.length &&
    cut < max &&
    !/\s/.test(clean[cut])
  ) {
    cut++;
  }

  if (
    cut >= max &&
    !/\s/.test(clean[cut] || "")
  ) {
    cut = max;

    while (
      cut > 0 &&
      !/\s/.test(clean[cut])
    ) {
      cut--;
    }
  }

  return clean.slice(0, cut).trim() + "…";
}


function extractPlainText(message) {
  const content = message?.content || {};
  const type = content.content_type;

  if (
    type === "text" ||
    type === "multimodal_text"
  ) {
    const out = [];

    for (const part of (content.parts || [])) {
      if (typeof part === "string") {
        out.push(part);
        continue;
      }

      if (!part || typeof part !== "object") {
        continue;
      }

      if (
        part.content_type === "audio_transcription" &&
        part.text
      ) {
        out.push(part.text);
      }

      else if (
        part.content_type === "image_asset_pointer"
      ) {
        out.push("[зображення]");
      }

      else if (
        part.content_type === "audio_asset_pointer"
      ) {
        out.push("[аудіо]");
      }
    }

    return out
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (type === "code") {
    return content.text || "[код]";
  }

  return "";
}


function scrollToMessage(messageId) {
  if (!messageId) {
    $("#chatScroll").scrollTo({
      top: 0,
      behavior: "smooth"
    });

    return;
  }

  const el = document.getElementById(
    "msg-" + messageId
  );

  if (!el) {
    return;
  }

  document
    .querySelectorAll(".msg.nav-highlight")
    .forEach(x => {
      x.classList.remove("nav-highlight");
    });

  el.classList.add("nav-highlight");

  el.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  window.setTimeout(() => {
    el.classList.remove("nav-highlight");
  }, 1600);
}


function renderMiddleNavigation() {
  const list = $("#tocList");

  list.innerHTML = "";

  $("#tocTab").classList.toggle(
    "active",
    navMode === "toc"
  );

  $("#questionsTab").classList.toggle(
    "active",
    navMode === "questions"
  );

  if (!currentConversation) {
    list.innerHTML =
      '<div class="toc-empty">Оберіть чат.</div>';

    return;
  }

  if (navMode === "toc") {
    const topics =
      Array.isArray(currentTopics) &&
      currentTopics.length
        ? currentTopics
        : [
            {
              title: "Огляд чату",
              start_message_id: null
            }
          ];

    for (const topic of topics) {
      const button =
        document.createElement("button");

      button.className =
        "toc-link topic-link";

      button.textContent =
        topic.title || "Без назви";

      button.onclick = () => {
        scrollToMessage(
          topic.start_message_id || null
        );
      };

      list.appendChild(button);
    }

    return;
  }

  if (!currentUserMessages.length) {
    list.innerHTML =
      '<div class="toc-empty">' +
      'У цьому чаті немає user-повідомлень.' +
      '</div>';

    return;
  }

  currentUserMessages.forEach(
    (item, index) => {
      const button =
        document.createElement("button");

      button.className =
        "toc-link question-link";

      const shortText =
        shortenAtWordBoundary(
          item.text ||
          "[порожнє повідомлення]"
        );

      button.innerHTML =
        `<span class="question-index">` +
        `${index + 1}.</span>` +
        `${esc(shortText)}`;

      button.title =
        item.text || "";

      button.onclick = () => {
        scrollToMessage(
          item.messageId
        );
      };

      list.appendChild(button);
    }
  );
}


function rebuildUserMessageNavigation(nodes) {
  currentUserMessages = [];

  for (const [nodeId, node] of nodes) {
    const message = node?.message;

    if (!message) {
      continue;
    }

    if (
      (message.author?.role || "") !== "user"
    ) {
      continue;
    }

    const text =
      extractPlainText(message);

    currentUserMessages.push({
      messageId:
        message.id || nodeId,

      text:
        text ||
        "[вкладення або нетекстове повідомлення]"
    });
  }
}


function renderCatalog(){
  const q=($("#search").value||"").trim().toLowerCase(),list=$("#chatList"); list.innerHTML="";
  for(const item of catalog.filter(x=>(x.title||"").toLowerCase().includes(q))){
    const div=document.createElement("div"); div.className="chat-item"+(currentEntry?.id===item.id?" active":"");
    div.innerHTML=`${esc(item.title||"Без назви")}<span class="chat-date">${esc(item.date||"")}</span>`;
    div.onclick=()=>openChat(item); list.appendChild(div);
  }
}
async function reloadCatalog(){catalog=await loadJSON("../catalog.json?ts="+Date.now());renderCatalog();}

function isServiceMessage(m){
  const role=m?.author?.role||"";
  const type=m?.content?.content_type||"";
  if(["tool","system","developer"].includes(role)) return true;
  if(role==="assistant" && ["thoughts","reasoning_recap","tool_result","computer_initialize_state","computer_output","code_execution_output"].includes(type)) return true;
  if(role==="assistant"){
    const raw=extractPlainText(m);
    if(/^\s*(Thoughts|Reasoning recap)\s*$/i.test(raw)) return true;
    if(/^\s*\{[\s\S]*"(system\d+_search_query|search_query|response_length)"\s*:/i.test(raw)) return true;
  }
  return false;
}
function clearChatSearchHighlights(){
  const root=$("#messages");
  root.querySelectorAll("mark.chat-search-hit").forEach(x=>x.replaceWith(document.createTextNode(x.textContent)));
  root.normalize(); chatSearchHits=[]; chatSearchIndex=-1; $("#chatSearchCount").textContent="0 / 0";
}
function runChatSearch(){
  clearChatSearchHighlights();
  const q=$("#chatSearch").value.trim(); if(!q)return;
  const ql=q.toLocaleLowerCase(), root=$("#messages");
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[]; let n;
  while(n=w.nextNode()) if(n.nodeValue.trim() && !n.parentElement?.closest("mark.chat-search-hit, details.reasoning")) nodes.push(n);
  for(const node of nodes){
    const text=node.nodeValue, low=text.toLocaleLowerCase(); let from=0,pos=low.indexOf(ql),frag;
    if(pos<0)continue; frag=document.createDocumentFragment();
    while(pos>=0){
      if(pos>from)frag.appendChild(document.createTextNode(text.slice(from,pos)));
      const mark=document.createElement("mark"); mark.className="chat-search-hit"; mark.textContent=text.slice(pos,pos+q.length); frag.appendChild(mark);
      from=pos+q.length; pos=low.indexOf(ql,from);
    }
    if(from<text.length)frag.appendChild(document.createTextNode(text.slice(from)));
    node.replaceWith(frag);
  }
  chatSearchHits=[...root.querySelectorAll("mark.chat-search-hit")];
  if(chatSearchHits.length){chatSearchIndex=0;showChatSearchHit()}
}
function showChatSearchHit(){
  chatSearchHits.forEach(x=>x.classList.remove("current"));
  if(!chatSearchHits.length){$("#chatSearchCount").textContent="0 / 0";return}
  const x=chatSearchHits[chatSearchIndex]; x.classList.add("current");
  $("#chatSearchCount").textContent=`${chatSearchIndex+1} / ${chatSearchHits.length}`;
  x.scrollIntoView({behavior:"smooth",block:"center"});
}
function moveChatSearch(step){
  if(!chatSearchHits.length)runChatSearch();
  if(!chatSearchHits.length)return;
  chatSearchIndex=(chatSearchIndex+step+chatSearchHits.length)%chatSearchHits.length; showChatSearchHit();
}

async function openChat(item) {
  currentEntry = item;

  renderCatalog();

  const chatBase =
    `../${item.path}`;

  const [
    conv,
    attIndex,
    topics
  ] = await Promise.all([
    loadJSON(
      `${chatBase}/conversation.json`
    ),

    loadJSON(
      `${chatBase}/attachments-index.json`
    ).catch(
      () => ({attachments: {}})
    ),

    loadJSON(
      `${chatBase}/topics.json`
    ).catch(
      () => ([
        {
          title: "Огляд чату",
          start_message_id: null
        }
      ])
    )
  ]);

  currentConversation = conv;

  currentTopics =
    Array.isArray(topics)
      ? topics
      : [
          {
            title: "Огляд чату",
            start_message_id: null
          }
        ];

  const attachmentMap =
    buildAttachmentMap(attIndex);

  $("#title").textContent =
    conv.title ||
    item.title ||
    "Без назви";

  $("#meta").textContent =
    item.date || "";

  const box = $("#messages");

  box.classList.remove("empty");
  box.innerHTML = "";

  const nodes =
    activeNodes(conv);

  rebuildUserMessageNavigation(
    nodes
  );

  for (
    const [nodeId, node]
    of nodes
  ) {
    const m = node.message;

    if (!m) {
      continue;
    }

    if (isServiceMessage(m)) {
      continue;
    }

    const role =
      m.author?.role ||
      "unknown";

    const content =
      renderMessageContent(
        m,
        attachmentMap,
        chatBase
      );

    if (!content.trim()) {
      continue;
    }

    const div =
      document.createElement("div");

    div.className =
      `msg ${role}`;

    div.id =
      `msg-${m.id || nodeId}`;

    const roleLabel =
      role === "user"
        ? "Ви"
        : role === "assistant"
          ? "ChatGPT"
          : role;

    div.innerHTML =
      `<div class="bubble">` +
        `<div class="role">` +
          `${esc(roleLabel)}` +
        `</div>` +
        `<div class="content">` +
          `${content}` +
        `</div>` +
      `</div>`;

    box.appendChild(div);
  }

  renderMiddleNavigation();

  $("#chatSearch").value = "";
  clearChatSearchHighlights();

  $("#chatScroll").scrollTop = 0;

  history.replaceState(
    null,
    "",
    "#" + encodeURIComponent(item.id)
  );
}


$("#tocTab").onclick = () => {
  navMode = "toc";

  renderMiddleNavigation();
};


$("#questionsTab").onclick = () => {
  navMode = "questions";

  renderMiddleNavigation();
};



$("#chatSearch").addEventListener("input",runChatSearch);
$("#chatSearch").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();moveChatSearch(e.shiftKey?-1:1)}
});
$("#chatSearchPrev").onclick=()=>moveChatSearch(-1);
$("#chatSearchNext").onclick=()=>moveChatSearch(1);

$("#search").addEventListener("input",renderCatalog);

async function openImportModal(){
  selectedCandidate=null; $("#confirmImportBtn").disabled=true; $("#importStatus").className="import-status"; $("#importStatus").textContent="";
  $("#candidateList").innerHTML='<div class="meta" style="padding:18px">Читаю Downloads…</div>'; $("#importModal").classList.remove("hidden");
  try{
    const data=await loadJSON("/api/import-candidates?ts="+Date.now()); $("#downloadsPath").textContent=data.downloads||"";
    const box=$("#candidateList"); box.innerHTML="";
    if(!data.candidates.length){box.innerHTML='<div class="meta" style="padding:18px">Файлів *_conversations.json не знайдено.</div>';return;}
    data.candidates.forEach(c=>{
      const invalid=(c.missing&&c.missing.length)||c.error,row=document.createElement("div");
      row.className="candidate"+(invalid?" invalid":""); row.dataset.path=c.path;
      const details=invalid?`Не вистачає: ${esc((c.missing||[]).join(", "))}`:`${(c.volumes||[]).length} ZIP volume(s)${c.has_manifest?" · manifest є":""}`;
      row.innerHTML=`<div class="candidate-name">${esc(c.name)}</div><div class="candidate-meta">${details}</div>`;
      if(!invalid){row.onclick=()=>selectCandidate(row,c);row.ondblclick=()=>{selectCandidate(row,c);importSelectedCandidate();};}
      box.appendChild(row);
    });
  }catch(e){$("#importStatus").className="import-status error";$("#importStatus").textContent="Помилка: "+e.message;}
}
function selectCandidate(row,c){
  document.querySelectorAll(".candidate").forEach(x=>x.classList.remove("selected")); row.classList.add("selected"); selectedCandidate=c; $("#confirmImportBtn").disabled=false;
}
async function importSelectedCandidate(){
  if(!selectedCandidate)return; $("#confirmImportBtn").disabled=true; $("#importStatus").className="import-status"; $("#importStatus").textContent="Додаю архів…";
  try{
    const r=await fetch("/api/add-archive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:selectedCandidate.path})});
    const data=await r.json(); if(!r.ok||!data.ok)throw new Error(data.error||"Помилка імпорту");
    $("#importStatus").className="import-status ok"; $("#importStatus").textContent=data.message||"Архів додано.";
    await reloadCatalog(); const newId=data.added?.[0]?.id; if(newId){const entry=catalog.find(x=>x.id===newId);if(entry)await openChat(entry);}
    setTimeout(()=>$("#importModal").classList.add("hidden"),700);
  }catch(e){$("#importStatus").className="import-status error";$("#importStatus").textContent="Помилка: "+e.message;$("#confirmImportBtn").disabled=false;}
}
$("#addArchiveBtn").onclick=openImportModal;
$("#closeImportBtn").onclick=()=>$("#importModal").classList.add("hidden");
$("#cancelImportBtn").onclick=()=>$("#importModal").classList.add("hidden");
$("#confirmImportBtn").onclick=importSelectedCandidate;
$("#importModal").addEventListener("click",e=>{if(e.target===$("#importModal"))$("#importModal").classList.add("hidden");});

(async function init(){
  try{
    catalog=await loadJSON("../catalog.json");renderCatalog();
    const wanted=decodeURIComponent(location.hash.slice(1)),first=catalog.find(x=>x.id===wanted)||catalog[0];if(first)openChat(first);
  }catch(e){$("#messages").className="messages empty";$("#messages").textContent="Не вдалося завантажити catalog.json. Запускайте через view.py.";console.error(e);}
})();
