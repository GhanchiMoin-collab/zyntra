// ==========================================================
// Zyntra Skills — like Claude's Skills.
// A skill is a short instruction pack ("how to do X really well").
// Zyntra reads each request, loads the skills that fit (only those, so
// replies stay fast), and shows which ones it used. Built-in skills come
// ready-made; you can write your own, import a SKILL.md file, or ask the
// AI to draft one. Type "/" in the message box to pick one yourself.
// ==========================================================
(function(){
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = m => (typeof showToast === "function" ? showToast(m) : alert(m));
const Z = () => window.ZyntraCreations || {};

const LIMITS = { guest: 2, free: 3, starter: 10, pro: 25, ultra: 50 };   // custom skills per plan
const MAX_BODY = 9000, MAX_DESC = 300, MAX_TOTAL_INJECT = 14000;

// ----------------------------------------------------------
// Built-in skills
// `test(text, ctx, tool)` decides if the skill fits this request;
// `ctx` is the recent conversation (so follow-ups keep their skills).
// ----------------------------------------------------------
const GAME_WORDS = /\b(game|obby|parkour|platformer|arcade|shooter|racing|race|runner|survival|tycoon|simulator|adventure|battle|zombie|dragon|maze|escape room|puzzle game|quiz game|level|boss|enemy|enemies|coins?)\b/i;

const BUILTIN = [
  {
    id: "game-design", name: "Game Design Pro", icon: "🎯", tools: ["codex"],
    description: "Makes games actually fun: a clear goal, a rising difficulty curve, rewards, a tutorial and a win/lose loop.",
    test: (t, c) => GAME_WORDS.test(t) || (GAME_WORDS.test(c) && /\b(add|more|improve|better|fix|change|make)\b/i.test(t)),
    body: `Before writing code, silently plan the game (do not print the plan): the player's GOAL in one sentence, the core action (jump/dodge/collect/solve), 3 levels or waves that each introduce ONE new idea, the rewards (coins, stars, unlocks), and how the player wins and loses.
A game worth shipping has: a start screen with the goal and controls; a quick gentle first level that teaches by doing; difficulty that rises (new obstacle types, faster speed, tighter jumps, bigger enemies) — never random impossible spikes; clear feedback for every action (sound, particles, screen shake, score pop-ups, flashing when hurt); lives or checkpoints so failure is fair; a score and a saved best score; a boss or big finale on the last level; a win screen and a lose screen with Play Again.
Everything on screen must have a purpose and WORK: no decoration that looks interactive but does nothing, no empty menus, no placeholder text, no TODOs. Every rule you mention must be implemented. Theme everything consistently (colours, names, enemies, music mood) — "Candy Island", "Lava Temple", "Space Rescue" feel different from each other.
Never leave things floating without reason, never let the player get stuck, never make a level that cannot be finished. Mentally play level 1 through before answering and fix anything that would not work. After the code, write 2-3 friendly sentences: what the goal is, the controls, and one idea they could ask you to add next.`
  },
  {
    id: "game-3d-kit", name: "3D Game Builder (Roblox-style)", icon: "🧊", tools: ["codex"],
    description: "Builds colourful 3D games with the Zyntra Game Kit: a blocky character, camera that follows you, enemies, coins, levels.",
    test: (t, c) => (Z().wants3D && Z().wants3D(t)) || /\bZG\.run\b/.test(c),
    body: () => (Z().CODEX_3D_RULES || "").trim()
  },
  {
    id: "game-2d", name: "2D Game Builder", icon: "🕹️", tools: ["codex"],
    description: "Builds polished 2D canvas games with real physics, a scrolling camera that follows the player, parallax and particles.",
    test: (t, c) => {
      const w3 = Z().wants3D && Z().wants3D(t);
      if(/\bZG\.run\b/.test(c)) return false;
      return GAME_WORDS.test(t) && !w3 || /\b2\s?-?d\b|side-?scroll|pixel|snake|tetris|pong|breakout|flappy/i.test(t);
    },
    body: `Build 2D games on a full-window <canvas> (resize it with the window, devicePixelRatio aware) inside ONE html file. Use a fixed-timestep-safe loop: const dt = Math.min(0.033, (now-last)/1000).
PLATFORMER / RUNNER / ADVENTURE (the world is wider than the screen) — the SCREEN MUST MOVE WITH THE PLAYER:
  const cam = { x:0, y:0 }; each frame: cam.x += (player.x - W*0.4 - cam.x) * Math.min(1, dt*6); cam.x = Math.max(0, Math.min(levelWidth - W, cam.x)); same for y if the level is tall; draw the world with ctx.translate(-Math.round(cam.x), -Math.round(cam.y)).
  Parallax: draw 2–3 background layers (sky gradient, far hills, near hills/clouds) at cam.x * 0.2 / 0.45 / 0.7 so far layers move slower.
  Physics: vx accelerates toward input and gets friction; vy += gravity*dt; move X then resolve against solid rects, move Y then resolve (set onGround when landing); coyote time (0.1s) and jump buffering make it feel good; variable jump height (release = cut vy).
  Include: coins, 2–3 enemy types (walker, jumper, flyer) defeated by stomping, spikes/pits, moving platforms, checkpoints, a goal, 3 levels built from arrays of rects (not random), HUD, lives, particles, screen shake, WebAudio blips with a mute button.
TOP-DOWN / ARENA: smooth camera follow, enemy waves that grow, power-ups, a health bar, a boss every few waves.
PUZZLE / BOARD / CARD / CLASSIC (Snake, Tetris, 2048, Pong, Breakout, memory, tic-tac-toe, Wordle-like): implement the REAL rules exactly (Tetris: 7 pieces, rotation, line clears, levels; Snake: growth, wall/self collision, speed-up; 2048: merge rules once per move), keyboard + touch (swipe) controls, a pause button, animated feedback, high score in localStorage.
Make it beautiful: a cohesive bright palette, rounded shapes, soft shadows/glow, a nice Google Font, smooth easing/tweening on every UI change. Support touch (on-screen buttons) and keyboard; prevent page scroll; scale to any window size.`
  },
  {
    id: "character-creator", name: "Character & Avatar Creator", icon: "🧑‍🎤", tools: ["codex"],
    description: "Roblox-style blocky characters with outfits you can change by just asking — hair, clothes, accessories.",
    test: (t, c) => /\b(character|avatar|outfit|clothes|clothing|costume|skin|hair|hat|wardrobe|dress|hoodie|shirt|jeans|sneakers?)\b/i.test(t),
    body: `Characters are blocky, friendly and Roblox-like: a cube head with a simple face, a box torso, two arms and two legs (on pivot groups so they swing when walking), cheerful colours. Keep the OUTFIT in ONE config object at the top of the script (skin, hair style + colour, shirt style + colour, pants, shoes, accessory such as cap/glasses/crown/headphones) and build the character only from that object — so when the user later says "make him wear a red hoodie and a crown" you only edit the config and re-send the whole file. In 3D games the Zyntra Game Kit already draws the player in their own avatar; for other games use window.Zyntra.avatar / Zyntra.avatarSVG(size) when it exists. Offer a small in-game wardrobe (a panel of colour swatches and outfit buttons that updates the character live and saves to localStorage) whenever it fits the game.`
  },
  {
    id: "app-builder", name: "App & Tool Builder", icon: "📱", tools: ["codex"],
    description: "Builds real, useful apps: full create/edit/delete, saved data, validation, empty states and delightful details.",
    test: (t, c) => /\b(app|tool|tracker|planner|calculator|dashboard|to-?do|notes?|timer|converter|quiz|flashcards?|budget|habit|generator|manager|organizer|scheduler|booking|inventory|portal)\b/i.test(t) && !GAME_WORDS.test(t),
    body: `Build something people would keep using. Start from the data model (what are the items, what fields), then the full flow: create, view, edit, delete, search/filter/sort, import/export when useful. Save everything in localStorage so a refresh keeps it (guard JSON.parse with try/catch). Validate inputs with friendly inline messages; handle empty states with a helpful illustration/message and a button; add undo for deletes; keyboard shortcuts (Enter to add, Esc to close); responsive layout that works on a phone. Start with a little clearly-labelled sample content so it doesn't look empty. Every button must do something real. Polish: consistent spacing scale, one strong accent colour, subtle transitions, focus styles, accessible labels, light/dark friendly colours. Charts, if any, drawn with plain canvas/SVG. No external accounts, no fake network calls.`
  },
  {
    id: "website-designer", name: "Website Designer", icon: "🎨", tools: ["codex"],
    description: "Designer-grade websites and landing pages with real structure, typography, colour and motion.",
    test: (t, c) => /\b(website|web ?site|landing page|portfolio|homepage|home page|business site|restaurant site|blog|sales page|web page)\b/i.test(t),
    body: `Design like a thoughtful human designer, not a template. Choose a typeface pairing and a palette that fits the subject (a bakery, a law firm and a gaming clan must NOT look alike) and load fonts from Google Fonts. Pick a distinctive layout idea (asymmetric hero, big type, bento grid, split screen, horizontal scroller, sticky storytelling) instead of centered-hero-plus-three-cards. Real sections with real copy: hero with a clear promise and one main button, social proof, features/benefits with specifics, process/steps, pricing or offers, FAQ, contact form (front-end only), footer. Generous whitespace, 2–3 brand colours plus neutrals, high contrast text, large readable type, subtle scroll-reveal and hover motion, sticky nav, mobile-first responsive CSS (flex/grid, clamp()). Semantic HTML, alt text, aria labels. If specific facts (prices, hours, phone numbers, reviews) were not given, use clearly generic placeholders — never invent fake-looking real details.`
  },
  {
    id: "learn-to-code", name: "Learn With Me (teacher mode)", icon: "🎓", tools: ["*"],
    description: "Teaches step by step in simple words with examples and a little quiz — great for kids and beginners.",
    test: (t, c) => /\b(teach me|learn|explain( to me)?|how does|how do i|beginner|for kids|i'?m (a )?(kid|child|new)|step by step|eli5|tutorial|understand)\b/i.test(t),
    body: `Teach, don't just answer. Use simple words and short sentences; define each new term the first time. Go in small steps, each with a tiny example the learner can try. Use an everyday analogy for every big idea. When showing code, keep snippets short, comment the important lines, and explain what each part does in plain language. End with ONE small challenge ("try changing X so that Y") and, when it fits, a 3-question mini quiz with answers hidden below ("Answers:"). Be encouraging and never condescending. Offer the next step as a single question.`
  },
  {
    id: "study-coach", name: "Study Coach", icon: "📚", tools: ["chat"],
    description: "Turns any topic into clear notes, memory tricks, flashcards and practice questions.",
    test: (t, c) => /\b(study|exam|revision|revise|notes|flashcards?|summari[sz]e|chapter|syllabus|homework|assignment|test prep)\b/i.test(t),
    body: `Be a great study coach. Give: (1) a 5-line summary in plain words, (2) key terms with one-line definitions, (3) a memory trick (mnemonic, story or analogy) for the hardest idea, (4) 5 practice questions of rising difficulty with an answer key at the end, (5) a tiny 3-step revision plan. Use headings, short bullets and a table when comparing things. Ask which exam/level only if it truly changes the answer.`
  },
  {
    id: "writing-polish", name: "Writing Polish", icon: "✍️", tools: ["chat"],
    description: "Writes and rewrites clearly: strong openings, short sentences, the right tone, no fluff.",
    test: (t, c) => /\b(write|rewrite|draft|email|letter|essay|caption|bio|cover letter|speech|story|poem|proofread|improve (this|my) (text|writing))\b/i.test(t),
    body: `Write like a skilled human editor. Lead with the point; use concrete words over vague ones; cut filler ("very", "really", "in order to"); vary sentence length; match the audience and tone asked for (formal, friendly, funny, persuasive). For emails: clear subject, one purpose, a specific ask, polite close. For rewrites: keep the author's meaning and voice, fix grammar, and briefly list what you improved. Offer two short alternatives only when tone is a judgement call.`
  },
  {
    id: "code-reviewer", name: "Code Reviewer", icon: "🔍", tools: ["chat", "codex"],
    description: "Finds bugs, security problems and messy code, and shows the exact fixes.",
    test: (t, c) => /\b(review|debug|fix (this|my) (code|bug)|why (is|does) (this|my) code|bug|error|exception|refactor|optimi[sz]e)\b/i.test(t),
    body: `Review like a senior engineer. First find the actual cause of the bug (explain it in one or two plain sentences), then show the minimal fix as code. After that list other real problems in order of importance: bugs, security issues (injection, secrets, unsafe eval/innerHTML), performance traps, unclear naming, missing error handling. Don't invent problems; if the code is fine, say so. Keep the user's style. Provide a corrected full snippet when the change touches several lines.`
  }
];

// ----------------------------------------------------------
// Storage
// ----------------------------------------------------------
function readJSON(key, fallback){ try{ const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; }catch(e){ return fallback; } }
function getCustom(){ const a = readJSON("zyntra-skills", []); return Array.isArray(a) ? a : []; }
function getOff(){ const a = readJSON("zyntra-skills-off", []); return Array.isArray(a) ? a : []; }
function saveCustom(list){ localStorage.setItem("zyntra-skills", JSON.stringify(list)); syncCloud(); }
function saveOff(list){ localStorage.setItem("zyntra-skills-off", JSON.stringify(list)); syncCloud(); }
let syncTimer = null;
function syncCloud(){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    try{
      const ref = (typeof zyntraUserDocRef === "function") ? zyntraUserDocRef() : null;
      if(ref) ref.set({ skills: getCustom(), skillsOff: getOff() }, { merge: true }).catch(() => {});
    }catch(e){}
  }, 600);
}
function planKey(){ return (typeof currentPlanKey === "function") ? currentPlanKey() : "free"; }
function customLimit(){ return LIMITS[planKey()] || LIMITS.free; }

function allSkills(){
  const off = new Set(getOff());
  const b = BUILTIN.map(s => Object.assign({}, s, { builtin: true, enabled: !off.has(s.id) }));
  const c = getCustom().map(s => Object.assign({}, s, { builtin: false, enabled: s.enabled !== false }));
  return b.concat(c);
}
function bodyOf(s){ return typeof s.body === "function" ? s.body() : (s.body || s.instructions || ""); }
function slugOf(s){ return String(s.id || s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

// ----------------------------------------------------------
// Matching
// ----------------------------------------------------------
const STOP = new Set("the and for with that this from your when use used using make makes into about what have has are you can will not but all any how why who its it's their then than them they there here more most some very just also like over under only each other such own same too out our was were been being would could should may might one two".split(" "));
function keywordsOf(s){
  if(Array.isArray(s.triggers) && s.triggers.length) return s.triggers.map(x => String(x).toLowerCase().trim()).filter(Boolean);
  const words = (String(s.name) + " " + String(s.description || "")).toLowerCase().match(/[a-z][a-z0-9+#-]{3,}/g) || [];
  return Array.from(new Set(words.filter(w => !STOP.has(w)))).slice(0, 14);
}
function scoreCustom(s, text){
  const t = " " + text.toLowerCase() + " ";
  let score = 0;
  keywordsOf(s).forEach(k => {
    const re = new RegExp("(^|[^a-z0-9])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
    if(re.test(t)) score += (s.triggers && s.triggers.length) ? 2.2 : 1.1;
  });
  if(t.includes(" " + String(s.name).toLowerCase() + " ")) score += 3;
  return score;
}

function lastUserText(history){
  for(let i = history.length - 1; i >= 0; i--) if(history[i].role === "user") return String(history[i].content || "");
  return "";
}
function contextText(history){
  return history.filter(m => m.role !== "system").slice(-6).map(m => String(m.content || "").slice(0, 1500)).join("\n");
}

// returns { messages, used:[skill...] }
function inject(history, tool){
  tool = tool || "chat";
  const text = lastUserText(history);
  if(!text) return { messages: history, used: [] };
  const ctx = contextText(history);
  const skills = allSkills().filter(s => s.enabled);
  const out = [];
  let forced = null, cleaned = text;
  const m = /^\/([a-z0-9][a-z0-9-]*)\b\s*/i.exec(text.trim());
  if(m){
    forced = skills.find(s => slugOf(s) === m[1].toLowerCase() || s.id === m[1].toLowerCase());
    if(forced) cleaned = text.trim().slice(m[0].length) || text;
  }
  skills.forEach(s => {
    const appliesHere = !s.tools || s.tools.includes("*") || s.tools.includes(tool);
    if(!appliesHere && s !== forced) return;
    let score = 0;
    if(s === forced) score = 100;
    else if(s.builtin){ try{ if(s.test(text, ctx, tool)) score = 3; }catch(e){} }
    else score = scoreCustom(s, text);
    if(score >= 2) out.push({ s, score });
  });
  out.sort((a, b) => b.score - a.score);
  // game requests: design + the right engine skill together; otherwise the best 2–3
  const picked = out.slice(0, 4).map(x => x.s);
  if(!picked.length) return { messages: history, used: [] };

  let total = 0; const parts = [];
  for(const s of picked){
    const b = bodyOf(s);
    if(!b) continue;
    if(total + b.length > MAX_TOTAL_INJECT) continue;
    total += b.length;
    parts.push("### Skill: " + s.name + "\n" + b.trim());
  }
  if(!parts.length) return { messages: history, used: [] };
  const note = { role: "system", content: "ACTIVE SKILLS — Zyntra loaded these skills because they match this request. Follow them closely (they describe how to do this kind of work well), but never mention them unless asked.\n\n" + parts.join("\n\n") };

  let i = 0; while(i < history.length && history[i].role === "system") i++;
  const msgs = history.slice(0, i).concat([note], history.slice(i));
  if(forced && cleaned !== text){
    for(let j = msgs.length - 1; j >= 0; j--) if(msgs[j].role === "user"){ msgs[j] = Object.assign({}, msgs[j], { content: cleaned }); break; }
  }
  return { messages: msgs, used: picked };
}

// the "🧩 Used skills" chips under a reply
function addChip(container, used){
  if(!used || !used.length || !container) return;
  const row = document.createElement("div");
  row.className = "sk-chiprow";
  row.innerHTML = `<span class="sk-chip-label">🧩 Skills used</span>` + used.map(s => `<button type="button" class="sk-chip" data-id="${esc(s.id || slugOf(s))}" title="${esc(s.description || "")}">${esc(s.icon || "🧩")} ${esc(s.name)}</button>`).join("");
  row.addEventListener("click", e => { const b = e.target.closest(".sk-chip"); if(b){ openSkillsSettings(); } });
  container.appendChild(row);
}

// ----------------------------------------------------------
// Settings → Skills
// ----------------------------------------------------------
function openSkillsSettings(){
  try{ openModal("profileModal"); }catch(e){}
  if(typeof switchSettingsSection === "function") switchSettingsSection("skills");
}

function renderPanel(){
  const host = $("skillsPanelHost");
  if(!host) return;
  const list = allSkills();
  const custom = getCustom().length, limit = customLimit();
  host.innerHTML = `
    <p class="sk-sub">Skills teach Zyntra how to do specific jobs really well. Zyntra loads the right one automatically (you'll see a <b>🧩 Skills used</b> chip under replies) — or type <b>/</b> in the message box to pick one.</p>
    <div class="sk-actions">
      <button type="button" class="cr-btn cr-btn-primary" id="skNew">＋ Create skill</button>
      <button type="button" class="cr-btn cr-btn-ghost" id="skAi">✨ Draft with AI</button>
      <button type="button" class="cr-btn cr-btn-ghost" id="skImport">⬆ Upload SKILL.md</button>
      <input type="file" id="skFile" accept=".md,.txt,text/markdown,text/plain" multiple hidden>
      <span class="sk-count">${custom} / ${limit} custom skills</span>
    </div>
    <div class="sk-list">${list.map(s => `
      <div class="sk-card${s.enabled ? "" : " off"}" data-id="${esc(s.id)}" data-builtin="${s.builtin ? 1 : 0}">
        <div class="sk-icon">${esc(s.icon || "🧩")}</div>
        <div class="sk-info">
          <div class="sk-name">${esc(s.name)} <span class="sk-tag">${s.builtin ? "Built-in" : "Custom"}</span>${s.tools && !s.tools.includes("*") ? `<span class="sk-tag sk-tag-soft">${s.tools.includes("codex") && s.tools.length === 1 ? "Codex" : s.tools.join(", ")}</span>` : ""}</div>
          <div class="sk-desc">${esc(s.description || "")}</div>
          <div class="sk-links"><button type="button" class="cr-link" data-act="view">${s.builtin ? "View" : "Edit"}</button><button type="button" class="cr-link" data-act="export">Download .md</button>${s.builtin ? `<button type="button" class="cr-link" data-act="copy">Duplicate</button>` : `<button type="button" class="cr-link sk-del" data-act="delete">Delete</button>`}</div>
        </div>
        <label class="sk-switch" title="${s.enabled ? "On" : "Off"}"><input type="checkbox" data-act="toggle" ${s.enabled ? "checked" : ""}><span></span></label>
      </div>`).join("")}</div>`;

  $("skNew").onclick = () => openEditor();
  $("skAi").onclick = () => openAiDraft();
  $("skImport").onclick = () => $("skFile").click();
  $("skFile").onchange = async e => { for(const f of e.target.files) await importFile(f); e.target.value = ""; renderPanel(); };
  host.querySelector(".sk-list").addEventListener("click", e => {
    const card = e.target.closest(".sk-card"); if(!card) return;
    const id = card.dataset.id, s = list.find(x => x.id === id), act = (e.target.closest("[data-act]") || {}).dataset?.act;
    if(!s || !act) return;
    if(act === "view") openEditor(s);
    else if(act === "export") downloadSkill(s);
    else if(act === "copy") openEditor(Object.assign({}, s, { id: null, builtin: false, name: s.name + " (my copy)", instructions: bodyOf(s) }), true);
    else if(act === "delete"){ if(confirm("Delete the skill “" + s.name + "”?")){ saveCustom(getCustom().filter(x => x.id !== id)); renderPanel(); } }
  });
  host.querySelector(".sk-list").addEventListener("change", e => {
    if(e.target.dataset.act !== "toggle") return;
    const card = e.target.closest(".sk-card"), id = card.dataset.id, on = e.target.checked;
    if(card.dataset.builtin === "1"){
      const off = new Set(getOff()); if(on) off.delete(id); else off.add(id); saveOff(Array.from(off));
    } else {
      saveCustom(getCustom().map(x => x.id === id ? Object.assign({}, x, { enabled: on }) : x));
    }
    card.classList.toggle("off", !on);
  });
}

// ----- editor -----
function openEditor(skill, asNew){
  const isNew = !skill || asNew;
  const readOnly = skill && skill.builtin;
  if(isNew && getCustom().length >= customLimit()){
    if(typeof showFeatureLockedModal === "function" && planKey() !== "ultra") showFeatureLockedModal("skills");
    else toast("You've reached the custom skill limit for your plan.");
    return;
  }
  document.querySelector(".cr-overlay.sk-editor")?.remove();
  const s = skill || { name: "", description: "", triggers: [], tools: ["*"], instructions: "" };
  const body = readOnly ? bodyOf(s) : (s.instructions || "");
  const ov = document.createElement("div");
  ov.className = "cr-overlay sk-editor";
  ov.innerHTML = `<div class="cr-modal cr-modal-lg">
    <div class="cr-modal-head"><h3>${readOnly ? esc((s.icon || "🧩") + " " + s.name) : (isNew ? "Create a skill" : "Edit skill")}</h3><button type="button" class="cr-x">✕</button></div>
    ${readOnly ? `<p class="cr-dim">This is a built-in skill. You can read how it works and duplicate it to make your own version.</p>` : ""}
    <label class="cr-label">Name</label>
    <input class="cr-input" id="skName" maxlength="50" placeholder="e.g. Cricket Commentator" ${readOnly ? "readonly" : ""}>
    <label class="cr-label">When should Zyntra use it? <span class="cr-dim">(one or two sentences)</span></label>
    <textarea class="cr-input" id="skDesc" rows="2" maxlength="${MAX_DESC}" placeholder="Use when the user asks for live match commentary or cricket analysis." ${readOnly ? "readonly" : ""}></textarea>
    <label class="cr-label">Trigger words <span class="cr-dim">(optional, comma separated — helps it load at the right time)</span></label>
    <input class="cr-input" id="skTrig" placeholder="cricket, wicket, over, commentary" ${readOnly ? "readonly" : ""}>
    <label class="cr-label">Works in</label>
    <select class="cr-input" id="skTools" ${readOnly ? "disabled" : ""}><option value="*">Everywhere</option><option value="chat">AI Chat only</option><option value="codex">Codex only</option></select>
    <label class="cr-label">Instructions <span class="cr-dim">(what Zyntra should do, step by step)</span></label>
    <textarea class="cr-input sk-body" id="skBody" rows="12" maxlength="${MAX_BODY}" placeholder="Write it like you're training a new teammate: the goal, the steps, the style, examples of good output, and things to avoid." ${readOnly ? "readonly" : ""}></textarea>
    <div class="cr-modal-foot">
      ${readOnly ? `<button type="button" class="cr-btn cr-btn-ghost" id="skDup">Duplicate &amp; edit</button><button type="button" class="cr-btn cr-btn-primary" id="skClose">Close</button>`
        : `<button type="button" class="cr-btn cr-btn-ghost" id="skCancel">Cancel</button><button type="button" class="cr-btn cr-btn-primary" id="skSave">Save skill</button>`}
    </div></div>`;
  document.body.appendChild(ov);
  const q = id => ov.querySelector("#" + id);
  q("skName").value = s.name || ""; q("skDesc").value = s.description || ""; q("skTrig").value = (s.triggers || []).join(", ");
  q("skTools").value = (s.tools && s.tools.length === 1 && ["chat", "codex"].includes(s.tools[0])) ? s.tools[0] : "*";
  q("skBody").value = body;
  const close = () => ov.remove();
  ov.querySelector(".cr-x").onclick = close;
  ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });
  if(readOnly){
    q("skClose").onclick = close;
    q("skDup").onclick = () => { close(); openEditor(Object.assign({}, s, { id: null, builtin: false, name: s.name + " (my copy)", instructions: bodyOf(s) }), true); };
    return;
  }
  q("skCancel").onclick = close;
  q("skSave").onclick = () => {
    const name = q("skName").value.trim(), desc = q("skDesc").value.trim(), instr = q("skBody").value.trim();
    if(!name){ toast("Give the skill a name."); return; }
    if(!desc){ toast("Say when Zyntra should use it."); return; }
    if(instr.length < 20){ toast("Add some instructions (at least a sentence)."); return; }
    const rec = { id: (!isNew && s.id) ? s.id : "c-" + Date.now().toString(36), name, description: desc, instructions: instr,
      triggers: q("skTrig").value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 12),
      tools: [q("skTools").value], enabled: true, icon: s.icon || "🧩" };
    const list = getCustom();
    const idx = list.findIndex(x => x.id === rec.id);
    if(idx >= 0) list[idx] = rec; else list.push(rec);
    saveCustom(list); toast("Skill saved 🧩"); close(); renderPanel();
  };
}

// ----- import / export (Claude-style SKILL.md: frontmatter + body) -----
function slugFile(s){ return (slugOf(s) || "skill") + ".md"; }
function downloadSkill(s){
  const md = "---\nname: " + s.name + "\ndescription: " + String(s.description || "").replace(/\n/g, " ") + "\n" +
    (s.triggers && s.triggers.length ? "triggers: " + s.triggers.join(", ") + "\n" : "") + "---\n\n" + bodyOf(s).trim() + "\n";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" })); a.download = slugFile(s);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function parseSkillMd(text){
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.trim());
  let meta = {}, body = text.trim();
  if(m){
    body = m[2].trim();
    m[1].split("\n").forEach(line => { const kv = /^([a-zA-Z_-]+)\s*:\s*(.*)$/.exec(line); if(kv) meta[kv[1].toLowerCase()] = kv[2].trim(); });
  }
  const heading = /^#\s+(.+)$/m.exec(body);
  const name = (meta.name || (heading && heading[1]) || "").slice(0, 50);
  const desc = (meta.description || body.split("\n").find(l => l.trim() && !l.startsWith("#")) || "").slice(0, MAX_DESC);
  return { name, description: desc, instructions: body.slice(0, MAX_BODY), triggers: meta.triggers ? meta.triggers.split(",").map(x => x.trim()).filter(Boolean).slice(0, 12) : [] };
}
async function importFile(file){
  try{
    if(file.size > 60 * 1024){ toast("“" + file.name + "” is too big for a skill (60KB max)."); return; }
    const sk = parseSkillMd(await file.text());
    if(!sk.name || sk.instructions.length < 20){ toast("Couldn't find a name and instructions in “" + file.name + "”."); return; }
    if(getCustom().length >= customLimit()){ if(typeof showFeatureLockedModal === "function" && planKey() !== "ultra") showFeatureLockedModal("skills"); else toast("Custom skill limit reached."); return; }
    const list = getCustom(); list.push(Object.assign({ id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tools: ["*"], enabled: true, icon: "🧩" }, sk));
    saveCustom(list); toast("Added skill “" + sk.name + "” 🧩");
  }catch(e){ toast("Couldn't read that file."); }
}

// ----- draft a skill with the AI -----
function openAiDraft(){
  if(!(typeof isLoggedIn === "function" && isLoggedIn())){ toast("Sign in to draft skills with AI."); return; }
  document.querySelector(".cr-overlay.sk-ai")?.remove();
  const ov = document.createElement("div");
  ov.className = "cr-overlay sk-ai";
  ov.innerHTML = `<div class="cr-modal cr-modal-sm">
    <div class="cr-modal-head"><h3>✨ Draft a skill with AI</h3><button type="button" class="cr-x">✕</button></div>
    <p class="cr-dim">Describe what the skill should do in a sentence or two. Zyntra will write the instructions; you can edit them. (This uses one message.)</p>
    <textarea class="cr-input" id="skAiText" rows="4" maxlength="500" placeholder="e.g. Help me write funny, short Instagram captions for my cafe in a friendly tone."></textarea>
    <div class="cr-modal-foot"><button type="button" class="cr-btn cr-btn-ghost" id="skAiCancel">Cancel</button><button type="button" class="cr-btn cr-btn-primary" id="skAiGo">Draft it</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector(".cr-x").onclick = close; ov.querySelector("#skAiCancel").onclick = close;
  ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });
  ov.querySelector("#skAiGo").onclick = async () => {
    const idea = ov.querySelector("#skAiText").value.trim();
    if(idea.length < 8){ toast("Describe the skill a bit more."); return; }
    const btn = ov.querySelector("#skAiGo"); btn.disabled = true; btn.textContent = "Writing…";
    try{
      const res = await callChatAPI([
        { role: "system", content: "You write SKILLS for an AI assistant: short instruction packs. Reply with ONLY a JSON object, no markdown fences, with keys: name (max 40 chars), description (one or two sentences starting 'Use when…'), triggers (array of 5-10 lowercase keywords or short phrases that would appear in a request needing this skill), instructions (150-400 words of clear, specific, step-by-step guidance: goal, steps, style, what to avoid, and a short example of excellent output)." },
        { role: "user", content: idea }
      ], { lite: true });
      let txt = String(res.content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
      close();
      openEditor({ name: String(j.name || "").slice(0, 50), description: String(j.description || "").slice(0, MAX_DESC), triggers: Array.isArray(j.triggers) ? j.triggers.map(String).slice(0, 12) : [], tools: ["*"], instructions: String(j.instructions || "").slice(0, MAX_BODY) }, true);
    }catch(err){
      btn.disabled = false; btn.textContent = "Draft it";
      toast(err && err.message && /limit|plan/i.test(err.message) ? err.message : "Couldn't draft that. Try again or write it yourself.");
    }
  };
}

// ----------------------------------------------------------
// "/" picker in the message box
// ----------------------------------------------------------
let pop = null, popIndex = 0, popItems = [];
function hidePop(){ if(pop){ pop.remove(); pop = null; } }
function showPop(filter){
  const tool = (typeof activeChatTool !== "undefined") ? activeChatTool : "chat";
  popItems = allSkills().filter(s => s.enabled && (!s.tools || s.tools.includes("*") || s.tools.includes(tool)) && (slugOf(s).includes(filter) || s.name.toLowerCase().includes(filter)));
  if(!popItems.length){ hidePop(); return; }
  // names that START with what you typed come first
  popItems.sort((a, b) => (slugOf(b).startsWith(filter) ? 1 : 0) - (slugOf(a).startsWith(filter) ? 1 : 0));
  popIndex = Math.min(popIndex, popItems.length - 1);
  if(!pop){
    pop = document.createElement("div"); pop.className = "sk-pop";
    const bar = document.querySelector(".chat-input-bar") || document.body;
    bar.appendChild(pop);
  }
  pop.innerHTML = `<div class="sk-pop-title">Skills <span>↑↓ to move · Enter to pick · Esc to close</span></div>` + popItems.map((s, i) => `<button type="button" class="sk-pop-item${i === popIndex ? " active" : ""}" data-i="${i}"><span>${esc(s.icon || "🧩")}</span><b>/${esc(slugOf(s))}</b><em>${esc(s.description || "")}</em></button>`).join("");
  pop.querySelectorAll(".sk-pop-item").forEach(b => b.addEventListener("mousedown", e => { e.preventDefault(); pick(+b.dataset.i); }));
}
function pick(i){
  const s = popItems[i]; if(!s) return;
  const input = $("userInput"); input.value = "/" + slugOf(s) + " "; hidePop(); input.focus();
}
function setupSlash(){
  const input = $("userInput"); if(!input || input.dataset.skills) return;
  input.dataset.skills = "1";
  input.addEventListener("input", () => {
    const v = input.value;
    if(/^\/[a-z0-9-]*$/i.test(v)){ popIndex = 0; showPop(v.slice(1).toLowerCase()); } else hidePop();
  });
  input.addEventListener("keydown", e => {
    if(!pop) return;
    if(e.key === "ArrowDown"){ e.preventDefault(); popIndex = (popIndex + 1) % popItems.length; showPop(input.value.slice(1).toLowerCase()); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); popIndex = (popIndex - 1 + popItems.length) % popItems.length; showPop(input.value.slice(1).toLowerCase()); }
    else if(e.key === "Enter" || e.key === "Tab"){ e.preventDefault(); e.stopImmediatePropagation(); pick(popIndex); }
    else if(e.key === "Escape"){ hidePop(); }
  }, true);
  input.addEventListener("blur", () => setTimeout(hidePop, 120));
}

// ----------------------------------------------------------
// wiring
// ----------------------------------------------------------
function wire(){
  setupSlash();
  if(typeof window.switchSettingsSection === "function" && !window.switchSettingsSection.__skills){
    const orig = window.switchSettingsSection;
    window.switchSettingsSection = function(section){ orig(section); if(section === "skills") renderPanel(); };
    window.switchSettingsSection.__skills = true;
  }
}
wire();

window.ZyntraSkills = { inject, addChip, allSkills, renderPanel, openSkillsSettings, parseSkillMd, BUILTIN, slugOf, getCustom, scoreCustom };
})();
