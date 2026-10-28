// ==========================================================
// Zyntra Actions — the AI can DO things for you inside the app.
// When someone asks ("switch to light mode", "make my avatar wear a red
// hoodie", "create a skill for…", "open my dashboard", "rename this chat"),
// the AI ends its reply with an action block. This file runs it, and shows
// a card: ✓ what was done, or ✕ the specific reason it couldn't.
// Safety: actions only run when the person's own message asked for
// something, at most 4 per reply, and risky ones need a click to confirm.
// ==========================================================
(function(){
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const Z = () => window.ZyntraCreations || {};
const S = () => window.ZyntraSkills || {};
const loggedIn = () => typeof isLoggedIn === "function" && isLoggedIn();
const fail = reason => ({ ok: false, message: reason });
const done = message => ({ ok: true, message });

function norm(s){ return String(s || "").toLowerCase().trim(); }
function fuzzyFind(list, query, keyFn){
  const q = norm(query); if(!q) return null;
  return list.find(x => norm(keyFn(x)) === q) || list.find(x => norm(keyFn(x)).includes(q)) || list.find(x => q.includes(norm(keyFn(x))) && norm(keyFn(x)).length > 2) || null;
}

// ----------------------------------------------------------
// The actions the AI may use
// ----------------------------------------------------------
const TOOL_ALIASES = { chat: "chat", "ai chat": "chat", image: "image", "image generator": "image", images: "image", codex: "codex", code: "codex", agent: "agent", "agent mode": "agent", data: "data", "data analysis": "data", voice: "voice", jarvis: "voice", "zyntra jarvis": "voice", business: "business", "business tools": "business" };
const PAGE_ALIASES = { discover: "discover", dashboard: "dashboard", "creator dashboard": "dashboard", skills: "skills", settings: "settings", pricing: "pricing", plans: "pricing", upgrade: "pricing", profile: "profile", avatar: "avatar", shortcuts: "shortcuts", "keyboard shortcuts": "shortcuts", memory: "memory", personalization: "personalization" };

const ACTIONS = {
  open_tool: {
    help: 'open a tool — {"action":"open_tool","tool":"chat|image|codex|agent|data|voice|business"}',
    run: a => {
      const t = TOOL_ALIASES[norm(a.tool)];
      if(!t) return fail("I don't know a tool called “" + (a.tool || "") + "”. The tools are AI Chat, Image Generator, Codex, Agent Mode, Data Analysis, Zyntra Jarvis (voice) and Business Tools.");
      if(t === "agent" && typeof planAtLeast === "function" && !planAtLeast("starter")) return fail("Agent Mode needs the Starter plan or above — you're on " + (typeof planDisplayName === "function" ? planDisplayName(currentPlanKey()) : "Free") + ". I can open the plans page if you'd like.");
      openTool(t); return done("Opened " + (a.tool || t));
    }
  },
  new_chat: { help: '{"action":"new_chat"}', run: () => { $("newChatBtn").click(); return done("Started a new chat"); } },
  set_theme: {
    help: 'switch light/dark mode — {"action":"set_theme","mode":"light|dark"}',
    run: a => {
      const m = norm(a.mode); if(m !== "light" && m !== "dark") return fail("I can set the theme to light or dark.");
      applyTheme(m === "light"); return done("Switched to " + m + " mode");
    }
  },
  set_avatar: {
    help: 'change the player\'s Roblox-style avatar outfit — {"action":"set_avatar","outfit":"red hoodie, blue jeans, sunglasses"} (colours + hoodie/jacket/tee, jeans/shorts, shoes, glasses/sunglasses/cap/crown/headphones, hair colour/style, skin tone)',
    run: a => {
      if(!Z().parseOutfit) return fail("The avatar editor isn't loaded yet — try again in a moment.");
      const r = Z().parseOutfit(String(a.outfit || ""), Z().getAvatar());
      if(!r.changes.length) return fail("I couldn't find any outfit parts in “" + (a.outfit || "") + "”. Try things like “green hoodie, black shorts, a crown”.");
      Z().saveAvatar(r.avatar); return done("Avatar updated: " + r.changes.join(", "));
    }
  },
  set_name: {
    help: 'set the display name Zyntra uses — {"action":"set_name","name":"Moin"}',
    run: a => {
      const n = String(a.name || "").trim().slice(0, 30); if(!n) return fail("Tell me the name you'd like me to use.");
      const p = getProfile(); p.nickname = n; localStorage.setItem("zyntra-profile", JSON.stringify(p));
      if(typeof pushLocalToCloud === "function") try{ pushLocalToCloud(); }catch(e){}
      return done("I'll call you " + n + " from now on");
    }
  },
  remember: {
    help: 'save a fact about the user to memory — {"action":"remember","fact":"..."}',
    run: a => {
      const f = String(a.fact || "").trim(); if(!f) return fail("What should I remember?");
      const before = getMemories().length; addMemories([f]);
      if(getMemories().length === before) return fail("Memory didn't save it — it's full for your plan, already saved, or memory is switched off in Plugins.");
      return done("Saved to memory: “" + f.slice(0, 80) + "”");
    }
  },
  open_page: {
    help: 'open a page or window — {"action":"open_page","page":"discover|dashboard|skills|settings|pricing|profile|avatar|shortcuts"}',
    run: a => {
      const p = PAGE_ALIASES[norm(a.page)];
      if(!p) return fail("I can open: Discover, the Creator dashboard, Skills, Settings, Pricing, your Profile, Avatar editor and Keyboard shortcuts.");
      if((p === "dashboard" || p === "avatar") && !loggedIn()) return fail("You need to sign in first to use the " + p + ".");
      if(p === "discover") Z().openDiscover();
      else if(p === "dashboard") Z().openDashboard();
      else if(p === "skills") S().openSkillsSettings();
      else if(p === "settings"){ openModal("profileModal"); renderProfileModal(); switchSettingsSection("general"); }
      else if(p === "personalization"){ openModal("profileModal"); renderProfileModal(); switchSettingsSection("personalization"); }
      else if(p === "pricing"){ openModal("pricingModal"); if(typeof applyPlanToUI === "function") applyPlanToUI(getCachedPlan()); navigateToRoute("plans"); }
      else if(p === "profile"){ if(!loggedIn()) return fail("Sign in first to see your profile."); openProfileViewModal(); }
      else if(p === "avatar") Z().openAvatarModal();
      else if(p === "shortcuts") openShortcutsSheet();
      else if(p === "memory"){ openModal("profileModal"); renderProfileModal(); switchSettingsSection("personalization"); }
      return done("Opened " + a.page);
    }
  },
  search_chats: {
    help: 'search the user\'s chats — {"action":"search_chats","query":"..."}',
    run: a => { openSearchChatsModal(); const i = $("searchChatsInput"); if(i){ i.value = String(a.query || ""); renderSearchChatsList(i.value); } return done("Searched your chats for “" + (a.query || "") + "”"); }
  },
  open_creation: {
    help: 'open one of the user\'s published apps/games by title — {"action":"open_creation","title":"..."}',
    run: async a => {
      if(!loggedIn()) return fail("Sign in to open your published creations.");
      let items = []; try{ items = (await Z().apiGet({ action: "mine" }, true)).items || []; }catch(e){ return fail("I couldn't load your creations right now."); }
      if(!items.length) return fail("You haven't published anything yet. Build something in Codex and press Publish.");
      const it = fuzzyFind(items, a.title, x => x.title);
      if(!it) return fail("I couldn't find a creation called “" + (a.title || "") + "”. Yours are: " + items.map(x => x.title).join(", ") + ".");
      Z().openGamePage(it.slug); return done("Opened “" + it.title + "”");
    }
  },
  create_skill: {
    help: 'create a custom skill — {"action":"create_skill","name":"...","description":"Use when ...","triggers":["word",...],"instructions":"step-by-step guidance (at least a few sentences)"}',
    run: a => {
      if(!S().addCustom) return fail("Skills aren't loaded yet — try again in a moment.");
      const r = S().addCustom({ name: a.name, description: a.description, triggers: a.triggers, instructions: a.instructions, tools: a.tools });
      return r.ok ? done("Created the skill “" + r.name + "” — find it in Settings → Skills") : fail(r.reason);
    }
  },
  set_skill: {
    help: 'turn a skill on/off — {"action":"set_skill","name":"...","enabled":true|false}',
    run: a => { const r = S().setEnabled ? S().setEnabled(a.name, a.enabled !== false) : { ok: false, reason: "Skills aren't loaded." }; return r.ok ? done((a.enabled === false ? "Turned off" : "Turned on") + " the skill “" + r.name + "”") : fail(r.reason); }
  },
  set_plugin: {
    help: 'turn a plugin on/off — {"action":"set_plugin","name":"web search|memory|google|github|slack|…","enabled":true|false}',
    run: a => {
      const def = fuzzyFind(PLUGIN_DEFS, a.name, p => p.title) || PLUGIN_DEFS.find(p => norm(p.key).includes(norm(a.name)) || norm(p.slug || "").includes(norm(a.name)));
      if(!def) return fail("I couldn't find a plugin called “" + (a.name || "") + "”. Available: " + PLUGIN_DEFS.map(p => p.title).join(", ") + ".");
      const plugins = getPlugins(); plugins[def.key] = a.enabled !== false; savePlugins(plugins);
      return done((a.enabled === false ? "Turned off " : "Turned on ") + def.title);
    }
  },
  rename_chat: {
    help: 'rename the current chat — {"action":"rename_chat","title":"..."}',
    run: a => {
      const t = String(a.title || "").trim().slice(0, 80); if(!t) return fail("What should the chat be called?");
      const list = getSessions(), s = list.find(x => x.id === currentSessionId);
      if(!s) return fail("This chat hasn't been saved yet — send a message first, then I can rename it.");
      s.title = t; saveSessions(list); return done("Renamed the chat to “" + t + "”");
    }
  },
  pin_chat: {
    help: 'pin/unpin the current chat — {"action":"pin_chat","pinned":true|false}',
    run: a => {
      const list = getSessions(), s = list.find(x => x.id === currentSessionId);
      if(!s) return fail("This chat hasn't been saved yet — send a message first, then I can pin it.");
      s.pinned = a.pinned !== false; saveSessions(list); return done(s.pinned ? "Pinned this chat" : "Unpinned this chat");
    }
  },
  publish_chat: {
    risky: true, label: "Publish this chat",
    help: 'publish the current chat as a link (the user confirms) — {"action":"publish_chat"}',
    run: () => { if(!loggedIn()) return fail("Sign in first to publish a chat."); if(!currentSessionId) return fail("There's nothing to publish yet — send a message first."); publishChatSession(currentSessionId); return done("Opened the publish window — confirm to publish"); }
  },
  delete_chat: {
    risky: true, label: "Delete this chat",
    help: 'delete the current chat (the user confirms) — {"action":"delete_chat"}',
    run: () => { const b = $("deleteChatBtn"); if(!currentSessionId || !b) return fail("There's no saved chat to delete here."); b.click(); return done("Asked you to confirm deleting this chat"); }
  }
};

function catalogText(){
  return Object.keys(ACTIONS).map(k => "- " + k + ": " + ACTIONS[k].help).join("\n");
}

// does the person's own message ask for an app action? (stops web pages or
// documents that were read during the reply from triggering anything)
const ASK = /\b(change|set|turn|switch|enable|disable|open|go to|take me|show me|create|make|add|delete|remove|pin|unpin|rename|publish|save|remember|search|find|use|apply|update|wear|put on|start|new chat|upgrade|call me|my name|dark|light)\b/i;
function userAsked(){
  try{
    for(let i = chatHistory.length - 1; i >= 0; i--) if(chatHistory[i].role === "user") return ASK.test(String(chatHistory[i].content || ""));
  }catch(e){}
  return false;
}

// ----------------------------------------------------------
// Parse + run
// ----------------------------------------------------------
const FENCE = /```zyntra-action\s*([\s\S]*?)```/g;
function extract(text){
  const out = []; let m; FENCE.lastIndex = 0;
  while((m = FENCE.exec(text)) !== null){
    try{
      const j = JSON.parse(m[1].trim());
      (Array.isArray(j) ? j : [j]).forEach(x => { if(x && typeof x === "object" && x.action) out.push(x); });
    }catch(e){ out.push({ action: "__bad__" }); }
  }
  return out;
}
function strip(text){ return String(text || "").replace(/```zyntra-action[\s\S]*?(```|$)/g, "").replace(/\n{3,}/g, "\n\n").trimEnd(); }

function card(container, ok, title, detail, extraBtn){
  const row = document.createElement("div");
  row.className = "ac-card " + (ok ? "ok" : "bad");
  row.innerHTML = `<span class="ac-ic">${ok ? "✓" : "✕"}</span><div class="ac-txt"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div>`;
  if(extraBtn){ const b = document.createElement("button"); b.type = "button"; b.className = "cr-btn cr-btn-ghost ac-btn"; b.textContent = extraBtn.label; b.onclick = extraBtn.onClick; row.appendChild(b); }
  container.appendChild(row);
  return row;
}

async function runOne(a, box){
  const def = ACTIONS[a.action];
  if(!def){
    card(box, false, "I can't do that one from here", a.action === "__bad__" ? "I tried to run an action but it wasn't written correctly." : "“" + a.action + "” isn't something I can do inside Zyntra yet.");
    return;
  }
  if(def.risky){
    const row = card(box, true, def.label, "This needs your OK.", { label: "Review & confirm", onClick: async () => { const r = await def.run(a); row.remove(); card(box, r.ok, r.ok ? def.label : "Couldn't do that", r.message); } });
    row.className = "ac-card ask"; row.querySelector(".ac-ic").textContent = "?";
    return;
  }
  let r; try{ r = await def.run(a); }catch(e){ r = fail("Something unexpected went wrong (" + (e && e.message ? e.message : "error") + ")."); }
  if(r.ok) card(box, true, r.message);
  else {
    const upgrade = /plan|upgrade|starter|limit/i.test(r.message);
    card(box, false, "Couldn't do that", r.message, upgrade ? { label: "See plans", onClick: () => ACTIONS.open_page.run({ page: "pricing" }) } : null);
  }
}

// called after a reply finishes
async function process(container, fullText){
  const blocks = extract(fullText);
  if(!blocks.length || !container) return;
  const box = document.createElement("div"); box.className = "ac-box"; container.appendChild(box);
  if(!userAsked()){ return; }                                   // the person didn't ask for an action → ignore silently
  for(const a of blocks.slice(0, 4)) await runOne(a, box);
}

window.ZyntraActions = { process, strip, extract, catalogText, ACTIONS, userAsked };
})();
