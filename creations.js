// ==========================================================
// Zyntra Creations — a small Roblox-style platform for apps & games.
//   • Publish (new / update) with a details page: title, description,
//     genre, icon, banner, "publish as me or as a project"
//   • Discover tiles with 👍/👎 approval + play counts
//   • A page for every creation, played in a safe sandbox with the
//     player's progress saved automatically
//   • A creator dashboard and a blocky Roblox-style avatar
// Loaded after script.js (uses its helpers: activeAuth, openModal, …).
// ==========================================================
(function(){
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GENRES = ["Action", "Adventure", "Arcade", "Puzzle", "Racing", "Strategy", "Simulation", "Role-play", "Education", "Creative", "Tools", "Website", "Other"];
const GENRE_EMOJI = { Action: "⚔️", Adventure: "🗺️", Arcade: "🕹️", Puzzle: "🧩", Racing: "🏎️", Strategy: "♟️", Simulation: "🏗️", "Role-play": "🧑‍🎤", Education: "📚", Creative: "🎨", Tools: "🛠️", Website: "🌐", Other: "✨" };

function fmtNum(n){
    n = n || 0;
    if(n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if(n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
}
function approval(it){
    const t = (it.likes || 0) + (it.dislikes || 0);
    return t ? Math.round((it.likes / t) * 100) : null;
}
function timeAgo(iso){
    const t = Date.parse(iso); if(!t) return "";
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if(s < 60) return "just now";
    if(s < 3600) return Math.round(s / 60) + " min ago";
    if(s < 86400) return Math.round(s / 3600) + " h ago";
    if(s < 86400 * 30) return Math.round(s / 86400) + " d ago";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function hashHue(str){ let h = 0; for(let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h % 360; }

// icon HTML: the creator's picture, or a colourful default
function iconHTML(it, cls){
    if(it.iconUrl) return `<div class="${cls}"><img src="${esc(it.iconUrl)}" alt="" loading="lazy"></div>`;
    const h = hashHue(it.title || "x");
    return `<div class="${cls} cr-icon-default" style="background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 50) % 360} 70% 40%));"><span>${GENRE_EMOJI[it.genre] || "✨"}</span></div>`;
}

async function authHeaders(required){
    const u = (typeof activeAuth === "function") ? activeAuth().currentUser : null;
    if(!u){ if(required) throw new Error("Sign in first."); return {}; }
    return { Authorization: "Bearer " + await u.getIdToken() };
}
async function apiGet(params, needAuth){
    const headers = await authHeaders(needAuth).catch(e => { throw e; });
    const res = await fetch("/api/publish?" + new URLSearchParams(params), { headers });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
    return data;
}
async function apiPost(body, needAuth, extra){
    const headers = Object.assign({ "Content-Type": "application/json" }, await authHeaders(needAuth));
    const res = await fetch("/api/publish", Object.assign({ method: "POST", headers, body: JSON.stringify(body) }, extra || {}));
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
    return data;
}
const signedIn = () => (typeof isLoggedIn === "function") && isLoggedIn() && !!activeAuth().currentUser;
const toast = m => (typeof showToast === "function" ? showToast(m) : alert(m));

// ==========================================================
// Avatar — a blocky Roblox-style character
// ==========================================================
const AVATAR_DEFAULT = { skin: "#f2c9a0", hair: "short", hairColor: "#3b2415", face: "smile", shirt: "tee", shirtColor: "#1e88e5", pants: "jeans", pantsColor: "#37474f", shoes: "#212121", accessory: "none", accColor: "#e53935" };
const SKIN_TONES = ["#f9d5b8", "#f2c9a0", "#e0ac7d", "#c68a5a", "#8d5a3b", "#5c3a24"];
const HAIR_COLORS = ["#1b1b1f", "#3b2415", "#6b3e1d", "#b5651d", "#d8b25a", "#e8e2d0", "#c0392b", "#2563eb", "#7c3aed", "#ec4899"];
const CLOTH_COLORS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#5e35b1", "#d81b60", "#212121", "#f5f5f5", "#6d4c41", "#78909c"];
const AVATAR_OPTIONS = {
    hair: ["short", "spiky", "long", "bun", "none"],
    face: ["smile", "cool", "wink", "wow"],
    shirt: ["tee", "hoodie", "jacket"],
    pants: ["jeans", "shorts"],
    accessory: ["none", "glasses", "sunglasses", "cap", "headphones", "crown"]
};

// Self-contained on purpose: it is copied (as source text) into every
// game's sandbox, so it must not use anything from outside itself.
function zyAvatarSVG(a, size){
    a = a || {};
    var D = { skin: "#f2c9a0", hair: "short", hairColor: "#3b2415", face: "smile", shirt: "tee", shirtColor: "#1e88e5", pants: "jeans", pantsColor: "#37474f", shoes: "#212121", accessory: "none", accColor: "#e53935" };
    for(var k in D) if(a[k] == null) a[k] = D[k];
    function dk(hex, amt){
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if(!m) return hex;
        var n = parseInt(m[1], 16), r = Math.max(0, (n >> 16) - amt), g = Math.max(0, ((n >> 8) & 255) - amt), b = Math.max(0, (n & 255) - amt);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    function R(x, y, w, h, rx, fill){ return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="' + fill + '" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/>'; }
    var s = "";
    var sh = a.shirtColor, shd = dk(sh, 38), skin = a.skin;
    // hood goes behind the head
    if(a.shirt === "hoodie") s += R(34, 56, 52, 18, 9, shd);
    // legs
    if(a.pants === "shorts"){
        s += R(32, 124, 27, 66, 5, skin) + R(61, 124, 27, 66, 5, skin);
        s += R(32, 124, 27, 34, 5, a.pantsColor) + R(61, 124, 27, 34, 5, a.pantsColor);
    } else {
        s += R(32, 124, 27, 66, 5, a.pantsColor) + R(61, 124, 27, 66, 5, a.pantsColor);
    }
    s += R(30, 186, 31, 17, 6, a.shoes) + R(59, 186, 31, 17, 6, a.shoes);
    // arms
    if(a.shirt === "tee"){
        s += R(10, 64, 20, 58, 8, skin) + R(90, 64, 20, 58, 8, skin);
        s += R(10, 64, 20, 26, 8, sh) + R(90, 64, 20, 26, 8, sh);
    } else {
        s += R(10, 64, 20, 60, 8, sh) + R(90, 64, 20, 60, 8, sh);
        s += R(11, 112, 18, 12, 5, skin) + R(91, 112, 18, 12, 5, skin);
    }
    // torso
    s += R(30, 64, 60, 62, 8, sh);
    if(a.shirt === "hoodie"){
        s += R(44, 100, 32, 18, 6, shd);
        s += '<rect x="52" y="70" width="3" height="16" rx="1.5" fill="' + dk(sh, 90) + '"/><rect x="65" y="70" width="3" height="16" rx="1.5" fill="' + dk(sh, 90) + '"/>';
    } else if(a.shirt === "jacket"){
        s += '<rect x="58.5" y="64" width="3" height="62" fill="' + shd + '"/>';
        s += '<polygon points="46,64 58,64 58,78" fill="' + shd + '"/><polygon points="74,64 62,64 62,78" fill="' + shd + '"/>';
        s += R(36, 100, 18, 14, 4, shd) + R(66, 100, 18, 14, 4, shd);
    } else {
        s += '<path d="M50 64 Q60 76 70 64 Z" fill="' + skin + '"/>';
    }
    // neck + head
    s += R(52, 56, 16, 12, 3, skin);
    s += R(34, 6, 52, 52, 12, skin);
    // face
    var ink = "#1c1c24";
    if(a.face === "cool"){
        s += '<rect x="42" y="31" width="14" height="4" rx="2" fill="' + ink + '"/><rect x="64" y="31" width="14" height="4" rx="2" fill="' + ink + '"/>';
        s += '<path d="M50 46 Q62 51 72 43" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    } else if(a.face === "wink"){
        s += '<rect x="44" y="27" width="7" height="10" rx="3" fill="' + ink + '"/><path d="M66 33 Q71 29 76 33" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
        s += '<path d="M48 44 Q60 55 72 44" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    } else if(a.face === "wow"){
        s += '<rect x="43" y="25" width="9" height="13" rx="4" fill="' + ink + '"/><rect x="68" y="25" width="9" height="13" rx="4" fill="' + ink + '"/>';
        s += '<ellipse cx="60" cy="48" rx="6" ry="7" fill="' + ink + '"/>';
    } else {
        s += '<rect x="44" y="27" width="7" height="10" rx="3" fill="' + ink + '"/><rect x="69" y="27" width="7" height="10" rx="3" fill="' + ink + '"/>';
        s += '<path d="M48 44 Q60 55 72 44" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    }
    // hair
    var hc = a.hairColor;
    if(a.hair === "short") s += R(32, 3, 56, 22, 11, hc) + R(32, 18, 7, 16, 3, hc) + R(81, 18, 7, 16, 3, hc);
    else if(a.hair === "spiky") s += '<polygon points="32,24 35,0 46,16 54,-4 62,16 72,-4 78,16 86,0 88,24" fill="' + hc + '" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/>' + R(32, 18, 7, 14, 3, hc) + R(81, 18, 7, 14, 3, hc);
    else if(a.hair === "long") s += R(32, 3, 56, 22, 11, hc) + R(28, 14, 11, 52, 5, hc) + R(81, 14, 11, 52, 5, hc);
    else if(a.hair === "bun") s += R(32, 3, 56, 22, 11, hc) + '<circle cx="60" cy="0" r="12" fill="' + hc + '" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/>';
    // accessory
    var ac = a.accessory;
    if(ac === "glasses") s += '<rect x="39" y="24" width="19" height="15" rx="4" fill="rgba(190,225,255,.35)" stroke="#222" stroke-width="2.5"/><rect x="62" y="24" width="19" height="15" rx="4" fill="rgba(190,225,255,.35)" stroke="#222" stroke-width="2.5"/><line x1="58" y1="30" x2="62" y2="30" stroke="#222" stroke-width="2.5"/>';
    else if(ac === "sunglasses") s += '<rect x="38" y="24" width="21" height="15" rx="4" fill="#15151b"/><rect x="61" y="24" width="21" height="15" rx="4" fill="#15151b"/><line x1="59" y1="29" x2="61" y2="29" stroke="#15151b" stroke-width="3"/>';
    else if(ac === "cap") s += R(32, -2, 56, 20, 10, a.accColor) + R(30, 12, 74, 7, 3, dk(a.accColor, 30));
    else if(ac === "headphones") s += '<path d="M33 34 Q60 -18 87 34" stroke="#2c2c34" stroke-width="7" fill="none"/>' + R(26, 28, 11, 24, 5, "#2c2c34") + R(83, 28, 11, 24, 5, "#2c2c34");
    else if(ac === "crown") s += '<polygon points="34,8 38,-10 49,2 60,-12 71,2 82,-10 86,8" fill="#f5c518" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>';
    var w = size || 160, h = Math.round(w * 232 / 120);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -16 120 232" width="' + w + '" height="' + h + '">' + s + '</svg>';
}

// ---- outfit parser: "red hoodie, blue jeans, white sneakers and a cap" ----
const COLOR_WORDS = {
    red: "#e53935", orange: "#fb8c00", yellow: "#fdd835", green: "#43a047", teal: "#00897b", cyan: "#00acc1", blue: "#1e88e5", navy: "#1a2a6c",
    purple: "#5e35b1", violet: "#7e57c2", pink: "#ec407a", magenta: "#d81b60", black: "#212121", white: "#f5f5f5", gray: "#78909c", grey: "#78909c",
    brown: "#6d4c41", gold: "#f5c518", maroon: "#7f1d1d", beige: "#d7c4a3", lime: "#9ccc65", silver: "#b0bec5"
};
const SKIN_WORDS = { pale: 0, fair: 0, light: 1, tan: 2, tanned: 2, brown: 3, dark: 4, deep: 5 };
function parseOutfit(text, current){
    const a = Object.assign({}, AVATAR_DEFAULT, current || {});
    const changes = [];
    const words = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
    const colorNear = (i, span) => {
        for(let k = 1; k <= span; k++){ const w = words[i - k]; if(w && COLOR_WORDS[w]) return COLOR_WORDS[w]; }
        for(let k = 1; k <= 2; k++){ const w = words[i + k]; if(w && COLOR_WORDS[w]) return COLOR_WORDS[w]; }
        return null;
    };
    words.forEach((w, i) => {
        let c;
        if(["hoodie", "sweater", "sweatshirt"].includes(w)){ a.shirt = "hoodie"; if(c = colorNear(i, 3)) a.shirtColor = c; changes.push("hoodie"); }
        else if(["jacket", "coat", "blazer"].includes(w)){ a.shirt = "jacket"; if(c = colorNear(i, 3)) a.shirtColor = c; changes.push("jacket"); }
        else if(["tshirt", "t-shirt", "tee", "shirt", "top"].includes(w)){ a.shirt = "tee"; if(c = colorNear(i, 3)) a.shirtColor = c; changes.push("t-shirt"); }
        else if(["jeans", "pants", "trousers", "joggers", "leggings"].includes(w)){ a.pants = "jeans"; if(c = colorNear(i, 3)) a.pantsColor = c; changes.push("pants"); }
        else if(["shorts"].includes(w)){ a.pants = "shorts"; if(c = colorNear(i, 3)) a.pantsColor = c; changes.push("shorts"); }
        else if(["shoes", "sneakers", "boots", "trainers"].includes(w)){ if(c = colorNear(i, 3)) a.shoes = c; changes.push("shoes"); }
        else if(w === "hair"){ if(c = colorNear(i, 2)) a.hairColor = c; changes.push("hair"); }
        else if(["glasses", "specs"].includes(w)){ a.accessory = "glasses"; changes.push("glasses"); }
        else if(["sunglasses", "shades"].includes(w)){ a.accessory = "sunglasses"; changes.push("sunglasses"); }
        else if(["cap", "hat", "beanie"].includes(w)){ a.accessory = "cap"; if(c = colorNear(i, 2)) a.accColor = c; changes.push("cap"); }
        else if(["headphones", "headset"].includes(w)){ a.accessory = "headphones"; changes.push("headphones"); }
        else if(["crown", "king", "queen"].includes(w)){ a.accessory = "crown"; changes.push("crown"); }
        else if(["spiky"].includes(w)){ a.hair = "spiky"; changes.push("spiky hair"); }
        else if(["bun", "ponytail"].includes(w)){ a.hair = "bun"; changes.push("bun"); }
        else if(["long"].includes(w) && (words[i + 1] === "hair" || words[i + 2] === "hair")){ a.hair = "long"; changes.push("long hair"); }
        else if(["bald", "shaved"].includes(w)){ a.hair = "none"; changes.push("bald"); }
        else if(["smile", "smiling", "happy"].includes(w)){ a.face = "smile"; changes.push("smile"); }
        else if(["cool", "chill"].includes(w)){ a.face = "cool"; changes.push("cool face"); }
        else if(["wink", "winking"].includes(w)){ a.face = "wink"; changes.push("wink"); }
        else if(["surprised", "shocked", "wow"].includes(w)){ a.face = "wow"; changes.push("surprised face"); }
        else if(w === "skin" && words[i - 1] && SKIN_WORDS[words[i - 1]] != null){ a.skin = SKIN_TONES[SKIN_WORDS[words[i - 1]]]; changes.push("skin tone"); }
    });
    return { avatar: a, changes: Array.from(new Set(changes)) };
}

function getAvatar(){
    try{ return Object.assign({}, AVATAR_DEFAULT, JSON.parse(localStorage.getItem("zyntra-avatar") || "null") || {}); }
    catch(e){ return Object.assign({}, AVATAR_DEFAULT); }
}
function saveAvatar(a){
    localStorage.setItem("zyntra-avatar", JSON.stringify(a));
    try{
        const ref = (typeof zyntraUserDocRef === "function") ? zyntraUserDocRef() : null;
        if(ref) ref.set({ avatar: a }, { merge: true }).catch(() => {});
    }catch(e){}
}

// ==========================================================
// The game bridge: runs INSIDE every sandboxed app/game.
//  • gives it a working localStorage that is saved for the player
//  • exposes window.Zyntra (player, avatar, save/load)
// ==========================================================
function zyBridgeMain(INIT, avatarFn){
    var store = {};
    try{ store = JSON.parse(INIT.store || "{}") || {}; }catch(e){ store = {}; }
    var dirty = false, timer = null;
    function flush(){
        if(!dirty) return;
        dirty = false;
        try{ parent.postMessage({ zyntra: 1, type: "save", store: JSON.stringify(store) }, "*"); }catch(e){}
    }
    function sched(){ dirty = true; clearTimeout(timer); timer = setTimeout(flush, 500); }
    function makeStorage(persist, data){
        var api = {
            getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v){ data[String(k)] = String(v); if(persist) sched(); },
            removeItem: function(k){ delete data[String(k)]; if(persist) sched(); },
            clear: function(){ for(var k in data) delete data[k]; if(persist) sched(); },
            key: function(i){ return Object.keys(data)[i] || null; }
        };
        Object.defineProperty(api, "length", { get: function(){ return Object.keys(data).length; } });
        return api;
    }
    try{
        Object.defineProperty(window, "localStorage", { value: makeStorage(true, store), configurable: true });
        Object.defineProperty(window, "sessionStorage", { value: makeStorage(false, {}), configurable: true });
    }catch(e){}
    var errSent = 0;
    function reportErr(msg){ if(errSent++ < 3){ try{ parent.postMessage({ zyntra: 1, type: "error", message: String(msg).slice(0, 300) }, "*"); }catch(e){} } }
    addEventListener("error", function(e){ reportErr((e.message || "Script error") + (e.lineno ? " (line " + e.lineno + ")" : "")); });
    addEventListener("unhandledrejection", function(e){ reportErr("Promise error: " + (e.reason && e.reason.message || e.reason)); });
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function(){ if(document.hidden) flush(); });
    addEventListener("message", function(e){ if(e.data && e.data.zyntra && e.data.type === "flush") flush(); });
    var avatar = INIT.avatar || {};
    window.Zyntra = {
        version: 1,
        gameId: INIT.gameId || "",
        player: INIT.player || { name: "Guest", guest: true },
        avatar: avatar,
        avatarSVG: function(size){ return avatarFn(JSON.parse(JSON.stringify(avatar)), size || 160); },
        avatarImage: function(size){
            return new Promise(function(resolve){
                var img = new Image();
                img.onload = function(){ resolve(img); };
                img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avatarFn(JSON.parse(JSON.stringify(avatar)), size || 160));
            });
        },
        save: function(obj){ store.__zyntra_save = JSON.stringify(obj); sched(); },
        load: function(){ try{ return JSON.parse(store.__zyntra_save); }catch(e){ return null; } }
    };
}

// Zyntra Game Kit — a tiny Roblox-style 3D engine on top of Three.js (r128).
// The AI describes a world with a few friendly calls; the kit supplies the
// colours, lighting, physics, collisions, character, camera, controls, HUD,
// lives, levels and win/lose screens — so games are always colourful,
// grounded and playable. Self-contained: injected as source text.
function zgKit(){
"use strict";
if(window.ZG) return;

var THEMES = {
  grass:  { sky: 0x8fd3ff, fog: 0xcdeeff, ground: 0x6cd16c, accents: [0xff6b6b, 0xffd93d, 0x6bcbff, 0xc77dff, 0xff9f43], clouds: true },
  candy:  { sky: 0xffc4ea, fog: 0xffd9f2, ground: 0xffc857, accents: [0xff7ab6, 0x7affc9, 0x7ab6ff, 0xffe27a, 0xc79bff], clouds: true },
  lava:   { sky: 0x3b1020, fog: 0x4a1a2a, ground: 0x4a3640, accents: [0xff8a3d, 0xffc857, 0xb26bff, 0xf15bb5, 0x00bbf9], embers: true },
  space:  { sky: 0x080b2e, fog: 0x0d1250, ground: 0x2c3170, accents: [0x00f5d4, 0xfee440, 0xf15bb5, 0x9b5de5, 0x00bbf9], stars: true },
  ice:    { sky: 0xbfe6ff, fog: 0xdaf3ff, ground: 0xa9e3f5, accents: [0x7fd8ff, 0xffffff, 0xa0c4ff, 0xbdb2ff, 0x9bf6ff], clouds: true },
  desert: { sky: 0xffd7a0, fog: 0xffe8c8, ground: 0xf2c777, accents: [0xe76f51, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x5fa8d3], clouds: true },
  night:  { sky: 0x111b3d, fog: 0x18265a, ground: 0x2f6b43, accents: [0xffd166, 0x06d6a0, 0x118ab2, 0xef476f, 0xc77dff], stars: true },
  ocean:  { sky: 0x7fdcff, fog: 0xc2f0ff, ground: 0xf0cf7a, accents: [0xff6f61, 0xffd166, 0x06d6a0, 0xffffff, 0x9d4edd], clouds: true }
};

function toColor(c, fallback){
  if(c == null) return fallback;
  if(typeof c === 'number') return c;
  try{ return new THREE.Color(c).getHex(); }catch(e){ return fallback; }
}

// ---------- tiny sound effects (WebAudio) ----------
var actx = null, muted = false;
function beep(f, d, type, vol, slide){
  if(muted) return;
  try{
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if(slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
  }catch(e){}
}
var SFX = {
  coin: function(){ beep(880, 0.09, 'square', 0.08); setTimeout(function(){ beep(1320, 0.12, 'square', 0.08); }, 70); },
  jump: function(){ beep(300, 0.16, 'sine', 0.12, 640); },
  hurt: function(){ beep(220, 0.3, 'sawtooth', 0.14, 70); },
  stomp: function(){ beep(180, 0.12, 'square', 0.12, 420); },
  win: function(){ [523, 659, 784, 1046].forEach(function(f, i){ setTimeout(function(){ beep(f, 0.18, 'triangle', 0.12); }, i * 130); }); },
  check: function(){ beep(660, 0.12, 'triangle', 0.1); setTimeout(function(){ beep(990, 0.14, 'triangle', 0.1); }, 90); }
};

// ---------- the game ----------
function run(cfg){
  if(typeof THREE === 'undefined'){ document.body.innerHTML = '<p style="font:18px sans-serif;padding:20px">3D engine failed to load. Check your internet and reload.</p>'; return; }
  cfg = cfg || {};
  var theme = THEMES[cfg.theme] || THEMES.grass;
  var title = String(cfg.title || 'My 3D Game');
  var maxLives = cfg.lives == null ? 3 : cfg.lives;
  var levelFns = cfg.levels && cfg.levels.length ? cfg.levels : [cfg.build || function(g){ g.platform(0, 0, 0, 20, 20); g.goal(0, -8); }];
  var goalText = cfg.goalText || 'Reach the golden flag!';
  var bestKey = 'zg-best-' + title.replace(/\W+/g, '').toLowerCase();
  var best = +(localStorage.getItem(bestKey) || 0);

  // ----- DOM -----
  var css = document.createElement('style');
  css.textContent = "html,body{margin:0;height:100%;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none;font-family:'Fredoka','Baloo 2',system-ui,sans-serif}" +
    "canvas.zg-canvas{display:block;position:fixed;inset:0}" +
    ".zg-hud{position:fixed;top:10px;left:10px;right:10px;display:flex;gap:8px;flex-wrap:wrap;pointer-events:none;color:#fff;font-weight:700}" +
    ".zg-pill{background:rgba(15,20,50,.6);padding:6px 14px;border-radius:99px;font-size:16px;box-shadow:0 3px 0 rgba(0,0,0,.25);backdrop-filter:blur(4px)}" +
    ".zg-pill.zg-flash{animation:zgflash .5s}@keyframes zgflash{50%{background:#e53935;transform:scale(1.15)}}" +
    ".zg-spacer{flex:1}.zg-mute{pointer-events:auto;cursor:pointer;border:0;color:#fff;font-size:16px}" +
    ".zg-toast{position:fixed;left:50%;top:70px;transform:translateX(-50%);padding:10px 20px;border-radius:99px;background:rgba(15,20,50,.75);color:#fff;font-weight:700;font-size:18px;opacity:0;transition:opacity .25s;pointer-events:none}.zg-toast.on{opacity:1}" +
    ".zg-joy{position:fixed;left:22px;bottom:26px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.45);display:none}.zg-knob{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.75)}" +
    ".zg-jump{position:fixed;right:26px;bottom:34px;width:88px;height:88px;border-radius:50%;border:3px solid #fff;background:rgba(255,90,130,.85);color:#fff;font:700 16px system-ui;display:none;box-shadow:0 5px 0 rgba(0,0,0,.25)}" +
    ".zg-menu{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.12),rgba(10,20,60,.72));color:#fff;text-align:center;padding:20px}" +
    ".zg-menu h1{margin:0;font-size:clamp(34px,7vw,58px);text-shadow:0 5px 0 rgba(0,0,0,.3);letter-spacing:.02em}.zg-menu p{margin:0;max-width:440px;font-size:17px;line-height:1.4}" +
    ".zg-menu button{margin-top:6px;padding:14px 46px;border:0;border-radius:18px;background:linear-gradient(#4ade80,#22c55e);color:#052e16;font:700 24px system-ui;cursor:pointer;box-shadow:0 6px 0 #15803d}.zg-menu button:active{transform:translateY(3px);box-shadow:0 3px 0 #15803d}" +
    ".zg-big{font-size:46px}";
  document.head.appendChild(css);
  var hud = document.createElement('div'); hud.className = 'zg-hud';
  hud.innerHTML = '<span class="zg-pill" id="zg-coins"></span><span class="zg-pill" id="zg-lives"></span><span class="zg-pill" id="zg-level"></span><span class="zg-pill" id="zg-time" style="display:none"></span><span class="zg-spacer"></span><button class="zg-pill zg-mute" id="zg-mute">🔊</button>';
  document.body.appendChild(hud);
  var toastEl = document.createElement('div'); toastEl.className = 'zg-toast'; document.body.appendChild(toastEl);
  var joyEl = document.createElement('div'); joyEl.className = 'zg-joy'; joyEl.innerHTML = '<div class="zg-knob"></div>'; document.body.appendChild(joyEl);
  var jumpEl = document.createElement('button'); jumpEl.className = 'zg-jump'; jumpEl.textContent = 'JUMP'; document.body.appendChild(jumpEl);
  var menu = document.createElement('div'); menu.className = 'zg-menu'; document.body.appendChild(menu);
  var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  function showMenu(h, p1, p2, btn){
    menu.innerHTML = '<h1>' + h + '</h1>' + (p1 ? '<p>' + p1 + '</p>' : '') + (p2 ? '<p>' + p2 + '</p>' : '') + '<button id="zg-go">' + btn + '</button>';
    menu.style.display = 'flex';
    menu.querySelector('#zg-go').onclick = function(){ menu.style.display = 'none'; if(btnAction) btnAction(); };
  }
  var btnAction = null;
  var toastT = null;
  function toast(t){ toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function(){ toastEl.classList.remove('on'); }, 2200); }
  document.getElementById('zg-mute').onclick = function(){ muted = !muted; this.textContent = muted ? '🔇' : '🔊'; };

  // ----- three.js -----
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = 'zg-canvas';
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, 70, 260);
  var camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xffffff, theme.stars ? 0x5566aa : 0x88aacc, theme.stars ? 0.6 : 0.62));
  var sun = new THREE.DirectionalLight(0xffffff, theme.stars ? 0.5 : 0.7);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  var sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.far = 220;
  scene.add(sun); scene.add(sun.target);

  var palette = theme.accents, palI = 0;
  function nextColor(){ return palette[(palI++) % palette.length]; }

  // ----- level state -----
  var levelGroup, solids, coins, enemies, hazards, checkpoints, goalObj, updaters, decor;
  var spawn, lastCheckpoint, levelIndex = 0, score = 0, lives = maxLives, coinsGot = 0, coinsTotal = 0;
  var playing = false, tStart = 0, levelTime = 0, timeLimit = cfg.time || 0, won = false;
  var hero, heroParts, p = { x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, face: 0, jumps: 0, invul: 0, ride: null };
  var HALF = 0.42, HEIGHT = 1.9, GRAV = 40, JUMP_V = 15.5, MAXJ = cfg.doubleJump ? 2 : 1, SPEED = cfg.speed || 11;
  var particles = [];

  function newLevelGroup(){
    if(levelGroup) scene.remove(levelGroup);
    levelGroup = new THREE.Group(); scene.add(levelGroup);
    solids = []; coins = []; enemies = []; hazards = []; checkpoints = []; updaters = []; decor = []; goalObj = null; palI = 0;
  }

  function mat(c){ return new THREE.MeshLambertMaterial({ color: c, flatShading: true }); }
  function outline(mesh){
    var e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
    mesh.add(e);
  }

  // highest solid top under a point (so decor/coins sit on something real)
  function surfaceY(x, z, maxY){
    var best = null;
    for(var i = 0; i < solids.length; i++){
      var s = solids[i];
      if(s.kind === 'wall' && false) continue;
      if(Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2){
        var top = s.y + s.h / 2;
        if(maxY != null && top > maxY) continue;
        if(best === null || top > best) best = top;
      }
    }
    return best === null ? 0 : best;
  }

  // ----- the building API the AI uses -----
  var g = {
    theme: cfg.theme || 'grass',
    colors: palette,
    // platform(x, top, z, width, depth, {color, h, moving:{axis,range,speed}, ice, bounce})
    platform: function(x, top, z, w, d, o){
      o = o || {}; var h = o.h || 1.2, col = toColor(o.color, nextColor());
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(col));
      m.position.set(x, top - h / 2, z); m.castShadow = true; m.receiveShadow = true; outline(m); levelGroup.add(m);
      var s = { mesh: m, x: x, y: top - h / 2, z: z, w: w, h: h, d: d, base: { x: x, y: top - h / 2, z: z }, move: o.moving || null, phase: Math.random() * 6, ice: !!o.ice, bounce: !!o.bounce, kind: 'platform' };
      if(o.bounce){ m.material = mat(0xffe14d); }
      solids.push(s); return s;
    },
    // ground(size, {color}) — a big floor with its top at height 0
    ground: function(size, o){
      o = o || {}; size = size || 80; var s = g.platform(0, 0, 0, size, size, { color: toColor(o.color, theme.ground), h: 3 }); s.kind = 'ground';
      var grid = new THREE.GridHelper(size, Math.round(size / 4), 0x000000, 0x000000); grid.material.transparent = true; grid.material.opacity = 0.14; grid.position.y = 0.03; levelGroup.add(grid);
      return s;
    },
    // wall(x, bottom, z, w, height, d)
    wall: function(x, bottom, z, w, hgt, d, color){
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat(toColor(color, nextColor())));
      m.position.set(x, bottom + hgt / 2, z); m.castShadow = true; m.receiveShadow = true; outline(m); levelGroup.add(m);
      var s = { mesh: m, x: x, y: bottom + hgt / 2, z: z, w: w, h: hgt, d: d, base: { x: x, y: bottom + hgt / 2, z: z }, move: null, kind: 'wall' }; solids.push(s); return s;
    },
    // stairs(x, bottom, z, steps, {dir:'z-'|'z+'|'x+'|'x-', width, rise, run})
    stairs: function(x, bottom, z, steps, o){
      o = o || {}; var rise = o.rise || 0.7, run = o.run || 2.2, wd = o.width || 6, dir = o.dir || 'z-';
      for(var i = 0; i < steps; i++){
        var dx = dir === 'x+' ? i * run : dir === 'x-' ? -i * run : 0, dz = dir === 'z+' ? i * run : dir === 'z-' ? -i * run : 0;
        var alongX = dir[0] === 'x';
        g.platform(x + dx, bottom + rise * (i + 1), z + dz, alongX ? run : wd, alongX ? wd : run, { color: o.color, h: rise });
      }
    },
    // coin(x, z, [y]) — rests on whatever is below it
    coin: function(x, z, y){
      var by = y != null ? y : surfaceY(x, z) + 1.4;
      var c = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 20), new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x805f00 }));
      c.rotation.x = Math.PI / 2; c.position.set(x, by, z); c.castShadow = true; levelGroup.add(c);
      coins.push({ mesh: c, x: x, y: by, z: z, got: false }); coinsTotal++; return c;
    },
    coins: function(list){ list.forEach(function(a){ g.coin(a[0], a[1], a[2]); }); },
    // coinRow(x, z, count, dx, dz)
    coinRow: function(x, z, n, dx, dz){ for(var i = 0; i < n; i++) g.coin(x + (dx || 0) * i, z + (dz || 0) * i); },
    checkpoint: function(x, z){
      var y = surfaceY(x, z), grp = new THREE.Group();
      var pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), mat(0xffffff)); pole.position.y = 1.6;
      var cloth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.08), mat(0x38bdf8)); cloth.position.set(0.7, 2.7, 0);
      grp.add(pole, cloth); grp.position.set(x, y, z); levelGroup.add(grp);
      checkpoints.push({ x: x, y: y, z: z, cloth: cloth, on: false });
    },
    spawn: function(x, z, y){ spawn = { x: x, y: (y != null ? y : surfaceY(x, z)) + 0.2, z: z }; lastCheckpoint = spawn; },
    goal: function(x, z){
      var y = surfaceY(x, z), grp = new THREE.Group();
      var pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.5, 0.3), mat(0xffffff)); pole.position.y = 2.75;
      var cloth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 0.1), new THREE.MeshLambertMaterial({ color: 0xffc400, emissive: 0x805000 })); cloth.position.set(1.1, 4.7, 0);
      var base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, 0.5, 20), mat(0xffd54a)); base.position.y = 0.25;
      grp.add(pole, cloth, base); grp.position.set(x, y, z); levelGroup.add(grp);
      goalObj = { x: x, y: y, z: z, cloth: cloth };
    },
    // lava(x, z, w, d) — touching it costs a life
    lava: function(x, z, w, d, y){
      var by = y != null ? y : 0.05;
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), new THREE.MeshLambertMaterial({ color: 0xff5722, emissive: 0xcc3300 }));
      m.position.set(x, by, z); levelGroup.add(m);
      hazards.push({ x: x, y: by, z: z, w: w, d: d, h: 0.5, mesh: m, t: Math.random() * 6 });
    },
    // enemy(x, z, {type:'patrol'|'chase', range, speed, color}) — jump on its head to defeat it
    enemy: function(x, z, o){
      o = o || {}; var y = surfaceY(x, z), col = toColor(o.color, 0xef4444);
      var grp = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), mat(col)); body.position.y = 0.75; body.castShadow = true; outline(body);
      var eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff }), pupM = new THREE.MeshBasicMaterial({ color: 0x111111 });
      [-0.35, 0.35].forEach(function(ex){
        var e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.1), eyeM); e.position.set(ex, 1.0, 0.76);
        var pu = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.25, 0.1), pupM); pu.position.set(ex, 0.98, 0.82); grp.add(e, pu);
      });
      var brow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.1), pupM); brow.position.set(0, 1.35, 0.78); grp.add(brow);
      grp.add(body); grp.position.set(x, y, z); levelGroup.add(grp);
      enemies.push({ grp: grp, x: x, y: y, z: z, bx: x, bz: z, type: o.type || 'patrol', range: o.range || 5, speed: o.speed || 3, axis: o.axis || 'x', phase: Math.random() * 6, alive: true, squash: 0, hp: 1 });
    },
    // decor — always sits on the ground / platform beneath it
    tree: function(x, z, s){
      s = s || 1; var y = surfaceY(x, z), grp = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 2.2 * s, 0.7 * s), mat(0x8b5a2b)); trunk.position.y = 1.1 * s;
      var top1 = new THREE.Mesh(new THREE.BoxGeometry(3 * s, 2 * s, 3 * s), mat(theme.stars ? 0x2e8b57 : 0x3ecf6a)); top1.position.y = 3 * s;
      var top2 = new THREE.Mesh(new THREE.BoxGeometry(2 * s, 1.6 * s, 2 * s), mat(theme.stars ? 0x3aa66a : 0x58e07f)); top2.position.y = 4.6 * s;
      [trunk, top1, top2].forEach(function(m){ m.castShadow = true; grp.add(m); }); grp.position.set(x, y, z); levelGroup.add(grp);
    },
    rock: function(x, z, s){
      s = s || 1; var y = surfaceY(x, z), m = new THREE.Mesh(new THREE.BoxGeometry(1.6 * s, 1.1 * s, 1.3 * s), mat(0x9aa5b1));
      m.position.set(x, y + 0.55 * s, z); m.rotation.y = Math.random() * 3; m.castShadow = true; levelGroup.add(m);
    },
    house: function(x, z, w, d, color){
      w = w || 6; d = d || 6; var y = surfaceY(x, z), grp = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), mat(toColor(color, nextColor()))); body.position.y = 2;
      var roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4), mat(0xc0392b)); roof.position.y = 5.2; roof.rotation.y = Math.PI / 4;
      var door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), mat(0x6d4c41)); door.position.set(0, 1.1, d / 2 + 0.03);
      [body, roof].forEach(function(m){ m.castShadow = true; }); grp.add(body, roof, door); grp.position.set(x, y, z); levelGroup.add(grp);
      return g.wall(x, y, z, w, 4, d, color) && null;
    },
    flower: function(x, z){
      var y = surfaceY(x, z), grp = new THREE.Group();
      var stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), mat(0x2ecc71)); stem.position.y = 0.35;
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.45), mat(nextColor())); head.position.y = 0.75;
      grp.add(stem, head); grp.position.set(x, y, z); levelGroup.add(grp);
    },
    cloud: function(x, y, z){
      var grp = new THREE.Group(), cm = new THREE.MeshLambertMaterial({ color: 0xffffff });
      [[0, 0, 0, 5, 1.6, 3], [2, 0.7, 0, 3, 1.4, 2.4], [-2, 0.5, 0.4, 3, 1.2, 2.2]].forEach(function(a){ var m = new THREE.Mesh(new THREE.BoxGeometry(a[3], a[4], a[5]), cm); m.position.set(a[0], a[1], a[2]); grp.add(m); });
      grp.position.set(x, y, z); levelGroup.add(grp); updaters.push(function(dt){ grp.position.x += dt * 0.6; if(grp.position.x > 140) grp.position.x = -140; });
    },
    // trees/clouds/flowers scattered for you: scenery(areaSize)
    scenery: function(area){
      area = area || 60;
      for(var i = 0; i < 14; i++){
        var a = Math.random() * 6.28, r = area * (0.55 + Math.random() * 0.5);
        g.tree(Math.cos(a) * r, Math.sin(a) * r, 0.9 + Math.random() * 0.6);
      }
      for(var j = 0; j < 8; j++) g.cloud((Math.random() - 0.5) * 220, 38 + Math.random() * 24, (Math.random() - 0.5) * 220);
    },
    // box(x, bottom, z, w, h, d, color, {solid:true}) — any custom block
    box: function(x, bottom, z, w, hgt, d, color, o){
      o = o || {};
      if(o.solid !== false) return g.wall(x, bottom, z, w, hgt, d, color);
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat(toColor(color, nextColor()))); m.position.set(x, bottom + hgt / 2, z); m.castShadow = true; levelGroup.add(m); return m;
    },
    add: function(obj){ levelGroup.add(obj); return obj; },
    surfaceY: surfaceY,
    toast: toast,
    addScore: function(n){ score += n; },
    onUpdate: function(fn){ updaters.push(fn); },
    player: p,
    get coinsCollected(){ return coinsGot; },
    get coinsTotal(){ return coinsTotal; },
    get score(){ return score; }
  };

  // ----- the blocky Roblox-style hero (uses the player's own avatar when published) -----
  function makeHero(){
    var av = (window.Zyntra && Zyntra.avatar) || cfg.hero || {};
    var skin = av.skin || '#f2c9a0', shirt = av.shirtColor || '#3b82f6', pants = av.pantsColor || '#374151', shoes = av.shoes || '#1f2937', hair = av.hairColor || '#3b2415';
    function box(w, h, d, c, x, y, z){ var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.set(x, y, z); m.castShadow = true; return m; }
    var grp = new THREE.Group();
    grp.add(box(1, 1, 1, skin, 0, 3.0, 0)); grp.add(box(1.06, 0.3, 1.06, hair, 0, 3.58, 0));
    grp.add(box(0.14, 0.16, 0.05, 0x111111, -0.22, 3.1, 0.52)); grp.add(box(0.14, 0.16, 0.05, 0x111111, 0.22, 3.1, 0.52));
    grp.add(box(0.5, 0.08, 0.05, 0x7a3b2e, 0, 2.8, 0.52));
    grp.add(box(1.5, 1.6, 0.8, shirt, 0, 1.7, 0));
    var aL = new THREE.Group(), aR = new THREE.Group(), lL = new THREE.Group(), lR = new THREE.Group();
    aL.position.set(-1.0, 2.4, 0); aR.position.set(1.0, 2.4, 0); lL.position.set(-0.38, 0.95, 0); lR.position.set(0.38, 0.95, 0);
    aL.add(box(0.5, 1.5, 0.5, skin, 0, -0.65, 0)); aR.add(box(0.5, 1.5, 0.5, skin, 0, -0.65, 0));
    lL.add(box(0.7, 1.0, 0.7, pants, 0, -0.5, 0)); lR.add(box(0.7, 1.0, 0.7, pants, 0, -0.5, 0));
    lL.add(box(0.74, 0.3, 0.8, shoes, 0, -0.9, 0.05)); lR.add(box(0.74, 0.3, 0.8, shoes, 0, -0.9, 0.05));
    grp.add(aL, aR, lL, lR); grp.scale.setScalar(0.62);
    heroParts = { aL: aL, aR: aR, lL: lL, lR: lR };
    return grp;
  }
  hero = makeHero(); scene.add(hero);

  // ----- backdrop: stars / embers -----
  var backdrop = new THREE.Group(); scene.add(backdrop);
  if(theme.stars){
    var sg = new THREE.BufferGeometry(), sp = [];
    for(var si = 0; si < 400; si++){ var a1 = Math.random() * 6.28, a2 = Math.acos(Math.random() * 0.9 + 0.05), r2 = 220; sp.push(Math.cos(a1) * Math.sin(a2) * r2, Math.cos(a2) * r2, Math.sin(a1) * Math.sin(a2) * r2); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    backdrop.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, fog: false })));
  }
  if(!theme.stars){ // a sun
    var sunMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false })); sunMesh.position.set(120, 140, -180); backdrop.add(sunMesh);
  }

  // ----- level loading -----
  function loadLevel(i){
    levelIndex = i;
    newLevelGroup(); coinsGot = 0; coinsTotal = 0; spawn = { x: 0, y: 2, z: 0 }; lastCheckpoint = null;
    levelFns[i](g);
    if(!lastCheckpoint) lastCheckpoint = spawn;
    respawn(true);
    document.getElementById('zg-level').textContent = levelFns.length > 1 ? 'Level ' + (i + 1) + '/' + levelFns.length : '';
    document.getElementById('zg-level').style.display = levelFns.length > 1 ? '' : 'none';
    tStart = performance.now(); levelTime = 0;
    paintHud();
  }
  function respawn(full){
    var c = lastCheckpoint || spawn;
    p.x = c.x; p.y = c.y + 0.1; p.z = c.z; p.vx = p.vy = p.vz = 0; p.invul = full ? 0 : 1.2; p.jumps = 0;
  }
  function paintHud(){
    document.getElementById('zg-coins').textContent = '🪙 ' + coinsGot + (coinsTotal ? ' / ' + coinsTotal : '') + (score ? '  ·  ⭐ ' + score : '');
    document.getElementById('zg-lives').textContent = maxLives ? '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, maxLives - lives)) : '';
    var te = document.getElementById('zg-time');
    if(timeLimit){ te.style.display = ''; te.textContent = '⏱ ' + Math.max(0, Math.ceil(timeLimit - levelTime)) + 's'; }
    else if(playing){ te.style.display = ''; te.textContent = '⏱ ' + levelTime.toFixed(1) + 's'; }
  }
  function flashHud(){ var el = document.getElementById('zg-lives'); el.classList.remove('zg-flash'); void el.offsetWidth; el.classList.add('zg-flash'); }

  // ----- particles -----
  function burst(x, y, z, color, n){
    for(var i = 0; i < (n || 10); i++){
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: color })); m.position.set(x, y, z);
      scene.add(m); particles.push({ m: m, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 8 + 2, vz: (Math.random() - 0.5) * 8, life: 0.7 });
    }
  }

  // ----- input -----
  var keys = {}, joy = { x: 0, y: 0 }, jumpQueued = false;
  addEventListener('keydown', function(e){ keys[e.code] = true; if(e.code === 'Space'){ jumpQueued = true; e.preventDefault(); } });
  addEventListener('keyup', function(e){ keys[e.code] = false; });
  if(isTouch){ joyEl.style.display = 'block'; jumpEl.style.display = 'block'; }
  var knob = joyEl.firstChild, joyId = null;
  function joyMove(t){
    var r = joyEl.getBoundingClientRect(), dx = t.clientX - (r.left + 60), dy = t.clientY - (r.top + 60), len = Math.min(50, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
    joy.x = Math.cos(a) * len / 50; joy.y = Math.sin(a) * len / 50; knob.style.left = (35 + Math.cos(a) * len) + 'px'; knob.style.top = (35 + Math.sin(a) * len) + 'px';
  }
  joyEl.addEventListener('touchstart', function(e){ joyId = e.changedTouches[0].identifier; joyMove(e.changedTouches[0]); e.preventDefault(); }, { passive: false });
  joyEl.addEventListener('touchmove', function(e){ for(var i = 0; i < e.changedTouches.length; i++) if(e.changedTouches[i].identifier === joyId) joyMove(e.changedTouches[i]); e.preventDefault(); }, { passive: false });
  function joyEnd(e){ for(var i = 0; i < e.changedTouches.length; i++) if(e.changedTouches[i].identifier === joyId){ joyId = null; joy.x = joy.y = 0; knob.style.left = '35px'; knob.style.top = '35px'; } }
  joyEl.addEventListener('touchend', joyEnd); joyEl.addEventListener('touchcancel', joyEnd);
  jumpEl.addEventListener('touchstart', function(e){ jumpQueued = true; e.preventDefault(); }, { passive: false });
  jumpEl.addEventListener('mousedown', function(){ jumpQueued = true; });
  var camYaw = 0, camPitch = 0.4, camDist = 12, look = null;
  renderer.domElement.addEventListener('pointerdown', function(e){ look = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', function(){ look = null; });
  addEventListener('pointermove', function(e){ if(!look) return; camYaw -= (e.clientX - look.x) * 0.006; camPitch = Math.max(0.05, Math.min(1.3, camPitch + (e.clientY - look.y) * 0.004)); look = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('wheel', function(e){ camDist = Math.max(6, Math.min(24, camDist + e.deltaY * 0.01)); }, { passive: true });

  // ----- physics -----
  function overlaps(s){
    return Math.abs(p.x - s.x) < HALF + s.w / 2 && Math.abs(p.z - s.z) < HALF + s.d / 2 && p.y < s.y + s.h / 2 && p.y + HEIGHT > s.y - s.h / 2;
  }
  function hurt(why){
    if(p.invul > 0 || !playing) return;
    lives--; SFX.hurt(); flashHud(); paintHud();
    if(maxLives && lives <= 0){ gameOver(why); return; }
    respawn(false);
  }
  function step(dt){
    levelTime = (performance.now() - tStart) / 1000;
    if(timeLimit && levelTime >= timeLimit){ gameOver("Time's up!"); return; }
    if(p.invul > 0) p.invul -= dt;
    var ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
    var iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
    var len = Math.hypot(ix, iz); if(len > 1){ ix /= len; iz /= len; }
    var sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    var wx = (ix * cos + iz * sin) * SPEED, wz = (-ix * sin + iz * cos) * SPEED;
    var slide = p.ride && p.ride.ice ? 1.5 : 12;
    p.vx += (wx - p.vx) * Math.min(1, dt * slide); p.vz += (wz - p.vz) * Math.min(1, dt * slide);
    if(Math.hypot(wx, wz) > 0.5) p.face = Math.atan2(wx, wz);
    if(jumpQueued && (p.grounded || p.jumps < MAXJ)){ p.vy = JUMP_V; p.jumps = p.grounded ? 1 : p.jumps + 1; p.grounded = false; SFX.jump(); }
    jumpQueued = false;
    p.vy -= GRAV * dt;
    // moving platforms (and carry the rider)
    var now = performance.now() / 1000;
    for(var i = 0; i < solids.length; i++){
      var s = solids[i];
      if(s.move){
        var off = Math.sin(now * (s.move.speed || 1) + s.phase) * (s.move.range || 5), ax = s.move.axis || 'x';
        var nx = s.base.x + (ax === 'x' ? off : 0), ny = s.base.y + (ax === 'y' ? off : 0), nz = s.base.z + (ax === 'z' ? off : 0);
        if(p.ride === s){ p.x += nx - s.x; p.y += ny - s.y; p.z += nz - s.z; }
        s.x = nx; s.y = ny; s.z = nz; s.mesh.position.set(nx, ny, nz);
      }
    }
    p.x += p.vx * dt; for(i = 0; i < solids.length; i++){ s = solids[i]; if(overlaps(s)){ p.x = p.vx > 0 ? s.x - s.w / 2 - HALF : s.x + s.w / 2 + HALF; p.vx = 0; } }
    p.z += p.vz * dt; for(i = 0; i < solids.length; i++){ s = solids[i]; if(overlaps(s)){ p.z = p.vz > 0 ? s.z - s.d / 2 - HALF : s.z + s.d / 2 + HALF; p.vz = 0; } }
    p.y += p.vy * dt; p.grounded = false; p.ride = null;
    for(i = 0; i < solids.length; i++){
      s = solids[i];
      if(overlaps(s)){
        if(p.vy <= 0){ p.y = s.y + s.h / 2; p.grounded = true; p.ride = s; p.jumps = 0; if(s.bounce){ p.vy = JUMP_V * 1.5; p.grounded = false; SFX.jump(); continue; } }
        else p.y = s.y - s.h / 2 - HEIGHT;
        p.vy = 0;
      }
    }
    if(p.y < -30) hurt('You fell!');
    // hazards
    for(i = 0; i < hazards.length; i++){
      var h = hazards[i]; h.t += dt; h.mesh.material.emissiveIntensity = 0.7 + Math.sin(h.t * 4) * 0.3;
      if(Math.abs(p.x - h.x) < HALF + h.w / 2 && Math.abs(p.z - h.z) < HALF + h.d / 2 && p.y < h.y + h.h / 2 && p.y + HEIGHT > h.y - h.h / 2) hurt('You touched lava!');
    }
    // checkpoints
    for(i = 0; i < checkpoints.length; i++){
      var c = checkpoints[i];
      if(!c.on && Math.hypot(p.x - c.x, p.z - c.z) < 2.6 && Math.abs(p.y - c.y) < 3){ c.on = true; c.cloth.material.color.setHex(0x22c55e); lastCheckpoint = { x: c.x, y: c.y + 0.2, z: c.z }; SFX.check(); toast('Checkpoint saved! 🚩'); }
    }
    // coins
    for(i = 0; i < coins.length; i++){
      var co = coins[i]; if(co.got) continue;
      co.mesh.rotation.z += dt * 3; co.mesh.position.y = co.y + Math.sin(now * 3 + i) * 0.15;
      if(Math.hypot(p.x - co.x, p.z - co.z) < 1.2 && Math.abs(p.y + 1.1 - co.y) < 1.9){
        co.got = true; co.mesh.visible = false; coinsGot++; score += 10; SFX.coin(); burst(co.x, co.y, co.z, 0xffd23f, 8); paintHud();
        if(typeof cfg.onCoin === 'function') cfg.onCoin(g, coinsGot, coinsTotal);
      }
    }
    // enemies
    for(i = 0; i < enemies.length; i++){
      var e = enemies[i];
      if(!e.alive){ e.squash += dt * 6; e.grp.scale.y = Math.max(0.05, 1 - e.squash); if(e.squash > 1) e.grp.visible = false; continue; }
      if(e.type === 'chase'){
        var dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
        if(dist < (e.range || 14) && dist > 0.1){ e.x += dx / dist * e.speed * dt; e.z += dz / dist * e.speed * dt; e.grp.rotation.y = Math.atan2(dx, dz); }
      } else {
        var o2 = Math.sin(now * (e.speed / Math.max(2, e.range)) + e.phase) * e.range;
        var px0 = e.x, pz0 = e.z;
        e.x = e.bx + (e.axis === 'x' ? o2 : 0); e.z = e.bz + (e.axis === 'z' ? o2 : 0);
        if(e.x !== px0 || e.z !== pz0) e.grp.rotation.y = Math.atan2(e.x - px0, e.z - pz0);
      }
      e.y = surfaceY(e.x, e.z); e.grp.position.set(e.x, e.y + Math.abs(Math.sin(now * 4 + i)) * 0.15, e.z);
      if(Math.abs(p.x - e.x) < HALF + 0.8 && Math.abs(p.z - e.z) < HALF + 0.8 && p.y < e.y + 1.6 && p.y + HEIGHT > e.y){
        if(p.vy < -2 && p.y > e.y + 0.9){ e.alive = false; p.vy = 13; score += 25; SFX.stomp(); burst(e.x, e.y + 1, e.z, 0xff6b6b, 12); paintHud(); }
        else hurt('An enemy got you!');
      }
    }
    for(i = 0; i < updaters.length; i++) updaters[i](dt, p, g);
    if(goalObj && Math.hypot(p.x - goalObj.x, p.z - goalObj.z) < 2.6 && Math.abs(p.y - goalObj.y) < 3.5) levelDone();
    paintHud();
  }

  function levelDone(){
    if(!playing) return;
    SFX.win(); burst(goalObj.x, goalObj.y + 3, goalObj.z, 0xffd23f, 30);
    if(levelIndex + 1 < levelFns.length){
      playing = false;
      score += 50;
      btnAction = function(){ loadLevel(levelIndex + 1); playing = true; tStart = performance.now(); };
      showMenu('⭐ Level complete!', 'Coins: ' + coinsGot + ' / ' + coinsTotal, 'Next up: level ' + (levelIndex + 2), 'Next level ▶');
      return;
    }
    playing = false; won = true; score += 100 + coinsGot * 5;
    var total = Math.round(score);
    var isBest = total > best; if(isBest){ best = total; try{ localStorage.setItem(bestKey, String(total)); }catch(e){} }
    btnAction = function(){ restart(); };
    showMenu('🎉 You win!', 'Score: <b>' + total + '</b>' + (isBest ? ' — new best!' : ' · best ' + best), 'Time: ' + levelTime.toFixed(1) + 's · Coins ' + coinsGot + '/' + coinsTotal, '↻ Play again');
  }
  function gameOver(why){
    playing = false;
    btnAction = function(){ restart(); };
    showMenu('💥 ' + (why || 'Game over'), 'Score: ' + Math.round(score), 'Best: ' + best, '↻ Try again');
  }
  function restart(){ score = 0; lives = maxLives; won = false; palI = 0; loadLevel(0); playing = true; tStart = performance.now(); }

  btnAction = function(){ restart(); };
  showMenu(title, goalText, isTouch ? 'Left stick to move · JUMP button · drag the right side to look' : 'WASD / arrows to move · Space to jump · drag to look around', '▶ Play');

  // ----- loop -----
  var last = performance.now(), walk = 0;
  loadLevel(0);
  function frame(now){
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if(playing) step(dt);
    for(var i = particles.length - 1; i >= 0; i--){
      var q = particles[i]; q.life -= dt; q.vy -= 20 * dt; q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
      if(q.life <= 0){ scene.remove(q.m); particles.splice(i, 1); }
    }
    hero.position.set(p.x, p.y, p.z);
    hero.visible = !(p.invul > 0 && Math.floor(now / 90) % 2 === 0);
    hero.rotation.y += (((p.face - hero.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 14);
    var moving = Math.hypot(p.vx, p.vz) > 1 && p.grounded;
    walk += dt * (moving ? 11 : 0);
    var sw = moving ? Math.sin(walk) * 0.9 : 0;
    heroParts.lL.rotation.x = sw; heroParts.lR.rotation.x = -sw; heroParts.aL.rotation.x = -sw; heroParts.aR.rotation.x = sw;
    if(!p.grounded){ heroParts.aL.rotation.x = heroParts.aR.rotation.x = -2.4; }
    var cx = p.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, cy = p.y + 2 + Math.sin(camPitch) * camDist, cz = p.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    var k = Math.min(1, dt * 8);
    camera.position.x += (cx - camera.position.x) * k; camera.position.y += (cy - camera.position.y) * k; camera.position.z += (cz - camera.position.z) * k;
    camera.lookAt(p.x, p.y + 1.6, p.z);
    sun.position.set(p.x + 30, p.y + 60, p.z + 20); sun.target.position.set(p.x, p.y, p.z);
    backdrop.position.set(camera.position.x, 0, camera.position.z);
    if(goalObj) goalObj.cloth.rotation.y = Math.sin(now / 300) * 0.35;
    renderer.render(scene, camera);
  }
  addEventListener('resize', function(){ renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  camera.position.set(0, 10, 14);
  requestAnimationFrame(frame);
  window.ZG._state = { p: p, g: g, get lives(){ return lives; }, get coins(){ return coinsGot; }, get playing(){ return playing; }, get level(){ return levelIndex; }, get solids(){ return solids; }, get enemies(){ return enemies; } };
  return g;
}

window.ZG = { run: run, themes: Object.keys(THEMES), version: 1 };
}


const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; font-src data: https:; img-src data: blob: https:; media-src data: blob: https:; connect-src https: wss:; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";

// Wraps the creator's HTML with our security policy + the bridge.
function buildGameSrcdoc(html, init){
    const json = JSON.stringify(init).replace(/</g, "\\u003c");
    const kitTag = /\bZG\.run\s*\(/.test(html) ? `<script>(${zgKit.toString()})();<\/script>` : "";
    const inject = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>(${zyBridgeMain.toString()})(${json}, ${zyAvatarSVG.toString()});<\/script>${kitTag}`;
    if(/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + inject);
    if(/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + "<head>" + inject + "</head>");
    return inject + html;
}
const SANDBOX_ATTR = "allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-popups-to-escape-sandbox";

function playerInfo(){
    if(!signedIn()) return { name: "Guest", guest: true };
    const email = localStorage.getItem("zyntra-user") || "";
    let prof = {}; try{ prof = (typeof getProfile === "function") ? getProfile() : {}; }catch(e){}
    return { name: prof.nickname || prof.fullName || email.split("@")[0] || "Player", handle: "@" + (email.split("@")[0] || "player"), guest: false };
}

// Frames we are talking to (so we only trust messages from our own iframes)
const frames = new Map();
function registerFrame(iframe, onSave, onError){
    const attach = () => { if(iframe.contentWindow) frames.set(iframe.contentWindow, { onSave, onError }); };
    iframe.addEventListener("load", attach);
    attach();
}
window.addEventListener("message", e => {
    const f = frames.get(e.source);
    if(!f || !e.data || e.data.zyntra !== 1) return;
    if(e.data.type === "save" && typeof e.data.store === "string" && e.data.store.length < 120000) f.onSave(e.data.store);
    if(e.data.type === "error" && f.onError) f.onError(String(e.data.message || "").slice(0, 300));
});
function flushFrame(iframe){
    try{ iframe.contentWindow.postMessage({ zyntra: 1, type: "flush" }, "*"); }catch(e){}
}

// expose what the other parts of this file (and script.js) need
const Z = window.ZyntraCreations = { GENRES, GENRE_EMOJI };
Object.assign(Z, { esc, fmtNum, approval, timeAgo, iconHTML, apiGet, apiPost, signedIn, toast, zyAvatarSVG, AVATAR_DEFAULT, AVATAR_OPTIONS, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, parseOutfit, getAvatar, saveAvatar, buildGameSrcdoc, SANDBOX_ATTR, playerInfo, registerFrame, flushFrame, hashHue });

// ==========================================================
// Views (created once, so index.html barely changes)
// ==========================================================
function ensureViews(){
    if($("gameView")) return;
    const anchor = $("discoverView");
    if(!anchor) return;
    const game = document.createElement("div");
    game.className = "page-view"; game.id = "gameView";
    const creator = document.createElement("div");
    creator.className = "page-view"; creator.id = "creatorView";
    anchor.parentNode.insertBefore(game, anchor.nextSibling);
    anchor.parentNode.insertBefore(creator, game.nextSibling);
}

let pushRecentLater = null;
let gameCleanup = null;      // flushes saves + removes listeners when leaving a game page
function leaveGamePage(){ if(gameCleanup){ try{ gameCleanup(); }catch(e){} gameCleanup = null; } }

function go(slug, id){
    if(typeof navigateToRoute === "function") navigateToRoute(slug, id);
}
function openView(name, navTool){
    leaveGamePage();
    if(typeof showPageView === "function") showPageView(name);
    if(navTool && typeof setActiveNav === "function") setActiveNav(navTool);
    if(typeof closeSidebarMobile === "function") closeSidebarMobile();
    $("sidebar") && window.scrollTo && window.scrollTo(0, 0);
}

// ==========================================================
// Discover  →  Apps & Games  |  Chats
// ==========================================================
let discoverTab = "creations";
let discoverState = { sort: "popular", genre: "all", q: "" };
let discoverItems = [];

function tileBadges(it){
    const now = Date.now(), created = Date.parse(it.createdAt) || 0, updated = Date.parse(it.updatedAt) || 0;
    if(now - created < 7 * 864e5) return `<span class="cr-badge-pill cr-bp-new">NEW</span>`;
    if(it.version > 1 && now - updated < 7 * 864e5) return `<span class="cr-badge-pill cr-bp-upd">UPDATED</span>`;
    return "";
}
function crownFor(it){
    return it.creatorPlan === "ultra" ? `<span class="cr-crown" title="Ultra creator">👑</span>` : it.creatorPlan === "pro" ? `<span class="cr-crown" title="Pro creator">⭐</span>` : "";
}
function tileHTML(it){
    const a = approval(it);
    return `<a class="cr-tile" href="/play/${esc(it.slug)}" data-slug="${esc(it.slug)}">
        <div class="cr-tile-iconwrap">${iconHTML(it, "cr-tile-icon")}${tileBadges(it)}<span class="cr-tile-play">▶</span></div>
        <p class="cr-tile-title">${esc(it.title)}</p>
        <p class="cr-tile-stats"><span title="Approval">👍 ${a == null ? "—" : a + "%"}</span><span title="Plays">👥 ${fmtNum(it.plays)}</span></p>
        <p class="cr-tile-by">${it.kind === "game" ? "🎮" : "📱"} ${esc(it.creatorName || it.creatorHandle)} ${crownFor(it)}</p>
    </a>`;
}

function setupDiscover(){
    const view = $("discoverView");
    if(!view || $("crDiscoverTabs")) return;
    const oldList = $("discoverList");
    const blurb = view.querySelector("p[style]");
    if(blurb) blurb.textContent = "Apps and games made by people with Zyntra — play, rate, and make your own.";

    const wrap = document.createElement("div");
    wrap.innerHTML = `
        <div class="cr-tabs" id="crDiscoverTabs">
            <button type="button" class="cr-tab active" data-tab="creations">🎮 Apps &amp; Games</button>
            <button type="button" class="cr-tab" data-tab="chats">💬 Chats</button>
            <span class="cr-tabs-spacer"></span>
            <button type="button" class="cr-btn cr-btn-ghost" id="crOpenDashboard">📊 Creator dashboard</button>
            <button type="button" class="cr-btn cr-btn-primary" id="crCreateNew">＋ Create</button>
        </div>
        <div id="crDiscoverCreations">
            <div class="cr-search-row">
                <input type="search" id="crSearch" class="cr-search" placeholder="Search games and apps…" autocomplete="off">
                <div class="cr-sorts" id="crSorts">
                    <button type="button" data-sort="popular" class="active">🔥 Popular</button>
                    <button type="button" data-sort="top">⭐ Top rated</button>
                    <button type="button" data-sort="new">🆕 New</button>
                </div>
            </div>
            <div class="cr-genres" id="crGenres"></div>
            <div id="crRows"></div>
        </div>`;
    view.insertBefore(wrap, oldList);
    const genres = $("crGenres");
    genres.innerHTML = ["all"].concat(GENRES).map(g => `<button type="button" data-genre="${esc(g)}" class="${g === "all" ? "active" : ""}">${g === "all" ? "All" : (GENRE_EMOJI[g] || "") + " " + esc(g)}</button>`).join("");

    wrap.querySelectorAll(".cr-tab").forEach(b => b.addEventListener("click", () => switchDiscoverTab(b.dataset.tab)));
    $("crSorts").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; discoverState.sort = b.dataset.sort; $("crSorts").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); loadCreations(); });
    genres.addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; discoverState.genre = b.dataset.genre; genres.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); loadCreations(); });
    let t = null;
    $("crSearch").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { discoverState.q = e.target.value.trim(); loadCreations(); }, 250); });
    $("crOpenDashboard").addEventListener("click", () => openDashboard());
    $("crCreateNew").addEventListener("click", () => startCreating());
    $("crRows").addEventListener("click", e => {
        const a = e.target.closest("a.cr-tile");
        if(a){ e.preventDefault(); openGamePage(a.dataset.slug); }
    });
}

function switchDiscoverTab(tab){
    discoverTab = tab;
    document.querySelectorAll("#crDiscoverTabs .cr-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $("crDiscoverCreations").style.display = tab === "creations" ? "" : "none";
    $("discoverList").style.display = tab === "chats" ? "" : "none";
    if(tab === "creations") loadCreations(); else origLoadChats && origLoadChats();
}

async function loadCreations(){
    const rows = $("crRows");
    if(!rows) return;
    rows.innerHTML = `<div class="cr-skel-hero"></div><div class="cr-row-scroll">${"<div class=\"cr-skel-tile\"><div></div><i></i><i></i></div>".repeat(7)}</div>`;
    try{
        const params = { action: "list", sort: discoverState.sort };
        if(discoverState.genre !== "all") params.genre = discoverState.genre;
        if(discoverState.q) params.q = discoverState.q;
        const data = await apiGet(params);
        discoverItems = data.items || [];
        if(!discoverItems.length){
            rows.innerHTML = `<div class="cr-empty-big"><div class="cr-empty-emoji">🎮</div><h3>${discoverState.q || discoverState.genre !== "all" ? "Nothing matches that yet" : "No games here yet — be the first!"}</h3><p>Build an app or a game with Codex, press <b>Publish</b> and it shows up right here.</p><button type="button" class="cr-btn cr-btn-primary" id="crEmptyCreate">Make something</button></div>`;
            $("crEmptyCreate")?.addEventListener("click", () => startCreating());
            return;
        }
        const filtered = discoverState.q || discoverState.genre !== "all";
        if(filtered){
            rows.innerHTML = `<div class="cr-grid">${discoverItems.map(tileHTML).join("")}</div>`;
            return;
        }
        const score = it => { const n = it.likes + it.dislikes; return (it.likes + 1) / (n + 2); };
        const popular = discoverItems.slice().sort((a, b) => b.plays - a.plays);
        const top = discoverItems.slice().sort((a, b) => score(b) - score(a));
        const fresh = discoverItems.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const hero = heroHTML(popular[0]);
        const recents = getRecents().map(s => discoverItems.find(i => i.slug === s)).filter(Boolean);
        const jump = recents.length ? `<section class="cr-row"><h3 class="cr-row-title">▶ Jump back in</h3><div class="cr-row-scroll">${recents.map(tileHTML).join("")}</div></section>` : "";
        const row = (title, list) => `<section class="cr-row"><h3 class="cr-row-title">${title}</h3><div class="cr-row-scroll">${list.slice(0, 20).map(tileHTML).join("")}</div></section>`;
        const order = discoverState.sort === "top" ? [["⭐ Top rated", top], ["🔥 Popular", popular], ["🆕 New & updated", fresh]]
            : discoverState.sort === "new" ? [["🆕 New & updated", fresh], ["🔥 Popular", popular], ["⭐ Top rated", top]]
            : [["🔥 Popular", popular], ["⭐ Top rated", top], ["🆕 New & updated", fresh]];
        rows.innerHTML = hero + jump + order.map(([t, l]) => row(t, l)).join("");
        rows.querySelector("#crHeroPlay")?.addEventListener("click", e => { e.preventDefault(); openGamePage(e.currentTarget.dataset.slug, { autoplay: true }); });
    }catch(err){
        rows.innerHTML = `<p class="cr-empty">${esc(err.message)}</p>`;
    }
}

// ---------- recently played ("Jump back in") ----------
function getRecents(){ try{ return JSON.parse(localStorage.getItem("zyntra-recent-plays") || "[]"); }catch(e){ return []; } }
function pushRecent(slug){
    try{ const r = getRecents().filter(s => s !== slug); r.unshift(slug); localStorage.setItem("zyntra-recent-plays", JSON.stringify(r.slice(0, 12))); }catch(e){}
}
function heroHTML(it){
    if(!it) return "";
    const a = approval(it), h = hashHue(it.title || "x");
    return `<section class="cr-hero" style="--hue:${h}">
        <div class="cr-hero-glow"></div>
        <a class="cr-hero-icon" href="/play/${esc(it.slug)}" data-slug="${esc(it.slug)}">${iconHTML(it, "cr-hero-icon-inner")}</a>
        <div class="cr-hero-info">
            <span class="cr-hero-kicker">🔥 Trending now</span>
            <h2>${esc(it.title)}</h2>
            <p class="cr-hero-by">${it.kind === "game" ? "🎮 Game" : "📱 App"} · by ${esc(it.creatorName || it.creatorHandle)} ${crownFor(it)}</p>
            <p class="cr-hero-desc">${esc((it.description || "").slice(0, 120)) || "Tap play and see what it's about."}</p>
            <div class="cr-hero-stats"><span>👍 ${a == null ? "—" : a + "%"}</span><span>👥 ${fmtNum(it.plays)} plays</span><span>${GENRE_EMOJI[it.genre] || ""} ${esc(it.genre)}</span></div>
            <button type="button" class="cr-play-btn cr-hero-btn" id="crHeroPlay" data-slug="${esc(it.slug)}">▶ Play now</button>
        </div>
    </section>`;
}

let origLoadChats = null;
function hookDiscover(){
    ensureViews();
    setupDiscover();
    if(typeof window.loadDiscoverList === "function" && !origLoadChats){
        origLoadChats = window.loadDiscoverList;
        window.loadDiscoverList = function(){
            setupDiscover();
            if(discoverTab === "chats") return origLoadChats();
            $("discoverList").style.display = "none";
            return loadCreations();
        };
    }
}

// ==========================================================
// A creation's page (like a Roblox experience page)
// ==========================================================
const REPORT_REASONS = ["Not safe for kids", "Scary or violent", "Unkind or hateful", "Asks for personal information", "Copy of someone else's work", "Broken or spam", "Something else"];

async function openGamePage(slug, opts){
    ensureViews();
    openView("game", "discover");
    go("play", slug);
    document.title = "Zyntra AI — Play";
    const view = $("gameView");
    view.innerHTML = `<div class="cr-game"><div class="cr-skel-head"><div class="cr-skel-icon"></div><div class="cr-skel-lines"><i></i><i></i><i></i></div></div></div>`;
    let data;
    try{
        data = await apiGet({ action: "get", slug, html: "1" }, false);
    }catch(err){
        view.innerHTML = `<div class="cr-empty-big"><div class="cr-empty-emoji">🔍</div><h3>${esc(err.message)}</h3><button type="button" class="cr-btn cr-btn-primary" id="crBackDiscover">Back to Discover</button></div>`;
        $("crBackDiscover").onclick = () => openDiscover();
        return;
    }
    renderGamePage(view, data, slug, opts && opts.autoplay);
}

function renderGamePage(view, data, slug, autoplay){
    const it = data.item;
    let myVote = data.myVote || 0, likes = it.likes, dislikes = it.dislikes;
    document.title = `${it.title} — Zyntra AI`;
    pushRecentLater = slug;
    const by = it.projectName ? `${esc(it.creatorName)} <span class="cr-dim">· in</span> 📁 ${esc(it.projectName)}` : esc(it.creatorName || it.creatorHandle);
    view.innerHTML = `
        <div class="cr-game cr-enter" style="--hue:${hashHue(it.title || "x")}">
            <div class="cr-ambient"></div>
            <div class="cr-game-top">
                <button type="button" class="cr-btn cr-btn-ghost" id="crBack">← Discover</button>
                <span class="cr-tabs-spacer"></span>
                <button type="button" class="cr-btn cr-btn-ghost" id="crShare">🔗 Share</button>
                <button type="button" class="cr-btn cr-btn-ghost" id="crReport">⚑ Report</button>
            </div>
            ${it.bannerUrl ? `<div class="cr-banner"><img src="${esc(it.bannerUrl)}" alt=""></div>` : ""}
            <div class="cr-game-head">
                ${iconHTML(it, "cr-game-icon")}
                <div class="cr-game-info">
                    <h1 class="cr-game-title">${esc(it.title)}</h1>
                    <p class="cr-game-by">${it.kind === "game" ? "🎮 Game" : "📱 App"} by <b>${by}</b> ${crownFor(it)} <span class="cr-dim">${esc(it.creatorHandle)}</span></p>
                    <div class="cr-chips"><span class="cr-chip">${GENRE_EMOJI[it.genre] || ""} ${esc(it.genre)}</span>${(it.tags || []).map(t => `<span class="cr-chip cr-chip-soft">#${esc(t)}</span>`).join("")}</div>
                </div>
            </div>
            <div class="cr-game-actions">
                <button type="button" class="cr-play-btn" id="crPlay">▶ Play</button>
                <div class="cr-rate" id="crRate">
                    <button type="button" class="cr-rate-btn" data-v="1" title="I like this">👍</button>
                    <div class="cr-rate-mid"><div class="cr-rate-bar"><div class="cr-rate-fill" id="crRateFill"></div></div><div class="cr-rate-text" id="crRateText"></div></div>
                    <button type="button" class="cr-rate-btn" data-v="-1" title="Not for me">👎</button>
                </div>
                <div class="cr-stat"><b>${fmtNum(it.plays)}</b><span>plays</span></div>
                <div class="cr-stat"><b>v${it.version}</b><span>${esc(timeAgo(it.updatedAt))}</span></div>
            </div>
            ${data.isOwner ? `<div class="cr-owner-bar">✏️ This is yours. <button type="button" class="cr-link" id="crEditDetails">Edit details</button> · <button type="button" class="cr-link" id="crDash">Open dashboard</button></div>` : ""}
            <div class="cr-stage" id="crStage" style="display:none;"></div>
            <div class="cr-game-body">
                <div class="cr-game-main">
                    <h3>About</h3>
                    <p class="cr-desc">${it.description ? esc(it.description).replace(/\n/g, "<br>") : "<span class='cr-dim'>The creator hasn't added a description yet.</span>"}</p>
                    <h3>What's new</h3>
                    <ul class="cr-changelog">${(it.changelog || []).slice(0, 6).map(c => `<li><b>v${c.v}</b> <span class="cr-dim">${esc(timeAgo(c.at))}</span> — ${esc(c.note)}</li>`).join("") || "<li class='cr-dim'>No updates yet.</li>"}</ul>
                </div>
                <aside class="cr-game-side">
                    <div class="cr-side-card">
                        <h4>🧑‍🎤 Your character</h4>
                        <div class="cr-side-avatar" id="crSideAvatar"></div>
                        <button type="button" class="cr-btn cr-btn-ghost" id="crEditAvatar">Customize</button>
                    </div>
                    <div class="cr-side-card cr-side-make">
                        <h4>✨ Make your own</h4>
                        <p>Love this ${it.kind === "game" ? "game" : "app"}? Tell Zyntra what you want and it builds one for you — you can learn how it works as you go.</p>
                        <button type="button" class="cr-btn cr-btn-primary" id="crMakeLike">Make one like this</button>
                    </div>
                </aside>
            </div>
        </div>`;

    $("crSideAvatar").innerHTML = zyAvatarSVG(getAvatar(), 110);
    function paintRating(){
        const t = likes + dislikes, pct = t ? Math.round(likes / t * 100) : 0;
        $("crRateFill").style.width = (t ? pct : 0) + "%";
        $("crRateText").textContent = t ? `${pct}% · ${fmtNum(t)} vote${t === 1 ? "" : "s"}` : "No ratings yet";
        view.querySelectorAll(".cr-rate-btn").forEach(b => b.classList.toggle("active", +b.dataset.v === myVote));
    }
    paintRating();

    $("crBack").onclick = () => openDiscover();
    $("crShare").onclick = async () => {
        const url = `${location.origin}/play/${slug}`;
        try{
            if(navigator.share){ await navigator.share({ title: it.title, text: `Play ${it.title} on Zyntra AI`, url }); return; }
        }catch(e){ if(e && e.name === "AbortError") return; }
        try{ await navigator.clipboard.writeText(url); toast("Link copied 🔗"); }catch(e){ prompt("Copy this link:", url); }
    };
    $("crReport").onclick = () => openReportDialog(slug);
    $("crEditAvatar").onclick = () => openAvatarModal(() => { $("crSideAvatar").innerHTML = zyAvatarSVG(getAvatar(), 110); });
    $("crMakeLike").onclick = () => startCreating(`Make a ${it.kind === "game" ? "game" : "app"} like "${it.title}"${it.genre ? " (" + it.genre.toLowerCase() + ")" : ""} — but with my own twist. Explain how it works as you build it so I can learn.`);
    $("crEditDetails")?.addEventListener("click", () => openDetailsModal({ mode: "edit", slug, item: it }));
    $("crDash")?.addEventListener("click", () => openDashboard());

    view.querySelectorAll(".cr-rate-btn").forEach(b => b.addEventListener("click", async () => {
        if(!signedIn()){ toast("Sign in to rate this 👍"); return; }
        const v = +b.dataset.v === myVote ? 0 : +b.dataset.v;
        try{
            const r = await apiPost({ action: "rate", slug, value: v }, true);
            likes = r.likes; dislikes = r.dislikes; myVote = r.myVote; paintRating();
            b.classList.remove("cr-pop"); void b.offsetWidth; b.classList.add("cr-pop");
        }catch(err){ toast(err.message); }
    }));

    // ---- Play ----
    $("crPlay").onclick = () => startPlaying(view, slug, it, data.html || "");
    if(autoplay || new URLSearchParams(location.search).get("autoplay") === "1") $("crPlay").click();
}

async function startPlaying(view, slug, it, html){
    const stage = $("crStage");
    const playBtn = $("crPlay");
    if(!html){ toast("This creation has no content yet."); return; }
    playBtn.disabled = true; playBtn.textContent = "Loading…";

    // saved progress
    let store = "";
    try{
        if(signedIn()) store = (await apiPost({ action: "load", slug }, true)).store || "";
        else store = localStorage.getItem("zyntra-guest-save:" + slug) || "";
    }catch(e){ store = ""; }

    const player = playerInfo();
    const doc = buildGameSrcdoc(html, { gameId: slug, store, player, avatar: getAvatar() });

    stage.style.display = "";
    stage.innerHTML = `
        <div class="cr-stage-bar">
            <span class="cr-stage-title">${GENRE_EMOJI[it.genre] || "🎮"} ${esc(it.title)}</span>
            <span class="cr-saved" id="crSaved"></span>
            <span class="cr-tabs-spacer"></span>
            <button type="button" class="cr-btn cr-btn-ghost" id="crFull">⛶ Fullscreen</button>
            <button type="button" class="cr-btn cr-btn-ghost" id="crStop">✕ Leave</button>
        </div>
        <div class="cr-frame-wrap"><iframe class="cr-frame" sandbox="${SANDBOX_ATTR}" allow="fullscreen; gamepad; autoplay; clipboard-write"></iframe></div>`;
    const iframe = stage.querySelector("iframe");
    let lastStore = store, saveTimer = null;
    const persist = (s, keepalive) => {
        lastStore = s;
        if(signedIn()){
            authHeaders(true).then(h => fetch("/api/publish", { method: "POST", keepalive: !!keepalive, headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify({ action: "save", slug, store: s }) }))
                .then(r => { if(r.ok){ const el = $("crSaved"); if(el){ el.textContent = "✓ Progress saved"; clearTimeout(saveTimer); saveTimer = setTimeout(() => { el.textContent = ""; }, 2500); } } })
                .catch(() => {});
        } else {
            try{ localStorage.setItem("zyntra-guest-save:" + slug, s); const el = $("crSaved"); if(el) el.textContent = "✓ Saved on this device"; }catch(e){}
        }
    };
    registerFrame(iframe, s => persist(s, false));
    iframe.srcdoc = doc;
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
    playBtn.disabled = false; playBtn.textContent = "▶ Playing";
    pushRecent(slug);

    // count the play once per day per device
    try{
        const key = "zyntra-played:" + slug, today = new Date().toISOString().slice(0, 10);
        if(localStorage.getItem(key) !== today){ localStorage.setItem(key, today); apiPost({ action: "play", slug }, false).catch(() => {}); }
    }catch(e){}

    $("crFull").onclick = () => { (iframe.requestFullscreen || iframe.webkitRequestFullscreen || (() => toast("Fullscreen isn't supported here."))).call(iframe); };
    const stop = () => {
        flushFrame(iframe);
        stage.style.display = "none"; stage.innerHTML = "";
        playBtn.textContent = "▶ Play";
    };
    $("crStop").onclick = stop;
    gameCleanup = () => { flushFrame(iframe); };   // leaving the page: ask the game to save now
}

function openDiscover(){
    leaveGamePage();
    openView("discover", "discover");
    go("discover");
    window.loadDiscoverList && window.loadDiscoverList();
}

function startCreating(prefill){
    leaveGamePage();
    if(typeof openTool === "function") openTool("codex");
    if(prefill){
        const input = $("userInput");
        if(input){ input.value = prefill; input.focus(); }
    }
}

// ---------- report ----------
function openReportDialog(slug){
    if(!signedIn()){ toast("Sign in to report something."); return; }
    document.querySelector(".cr-overlay.cr-report")?.remove();
    const ov = document.createElement("div");
    ov.className = "cr-overlay cr-report";
    ov.innerHTML = `<div class="cr-modal cr-modal-sm">
        <div class="cr-modal-head"><h3>Report this</h3><button type="button" class="cr-x">✕</button></div>
        <p class="cr-dim" style="margin:0 0 12px;">Tell us what's wrong. Too many reports hide it automatically until it's checked.</p>
        <select id="crReason" class="cr-input">${REPORT_REASONS.map(r => `<option>${esc(r)}</option>`).join("")}</select>
        <div class="cr-modal-foot"><button type="button" class="cr-btn cr-btn-ghost" id="crReportCancel">Cancel</button><button type="button" class="cr-btn cr-btn-primary" id="crReportSend">Send report</button></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector(".cr-x").onclick = close; $("crReportCancel").onclick = close;
    ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });
    $("crReportSend").onclick = async () => {
        try{ await apiPost({ action: "report", slug, reason: $("crReason").value }, true); toast("Thanks — we'll take a look 🙏"); close(); }
        catch(err){ toast(err.message); }
    };
}

// ==========================================================
// Publishing
// ==========================================================
const PUBLISH_MAP_KEY = "zyntra-publish-map";
function getPublishMap(){ try{ return JSON.parse(localStorage.getItem(PUBLISH_MAP_KEY) || "{}"); }catch(e){ return {}; } }
function setPublishMap(m){ localStorage.setItem(PUBLISH_MAP_KEY, JSON.stringify(m)); }
function publishedForSession(){ const id = (typeof currentSessionId !== "undefined") ? currentSessionId : null; return id ? (getPublishMap()[id] || null) : null; }

function guessKind(code){ return /<canvas|keydown|requestAnimationFrame|\bscore\b|game over|lives|level/i.test(code) ? "game" : "app"; }
function guessGenre(code, kind){
    const c = code.toLowerCase();
    if(/quiz|learn|lesson|flashcard|spelling|math/.test(c)) return "Education";
    if(/puzzle|match|sudoku|2048|tile|maze/.test(c)) return "Puzzle";
    if(/race|racing|car|lap/.test(c)) return "Racing";
    if(/avatar|character|outfit|wardrobe|pet/.test(c)) return "Role-play";
    if(/shoot|enemy|boss|attack|health/.test(c)) return "Action";
    if(kind === "game") return "Arcade";
    if(/portfolio|landing|website|<nav/.test(c)) return "Website";
    return "Tools";
}

// ---------- images ----------
function fileToDataUrl(file, w, h, maxBytes){
    return new Promise((resolve, reject) => {
        if(!/^image\//.test(file.type)) return reject(new Error("Please choose a picture (PNG, JPG or WebP)."));
        const fr = new FileReader();
        fr.onerror = () => reject(new Error("Couldn't read that file."));
        fr.onload = () => {
            const im = new Image();
            im.onerror = () => reject(new Error("Couldn't open that picture."));
            im.onload = () => {
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d");
                x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
                const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
                const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
                x.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
                let q = 0.9, url = c.toDataURL("image/jpeg", q);
                while(Math.floor((url.length - 23) * 3 / 4) > maxBytes && q > 0.3){ q -= 0.1; url = c.toDataURL("image/jpeg", q); }
                if(Math.floor((url.length - 23) * 3 / 4) > maxBytes) return reject(new Error("That picture is too detailed — try a simpler one."));
                resolve(url);
            };
            im.src = fr.result;
        };
        fr.readAsDataURL(file);
    });
}

// ---------- chooser: what do you want to publish? ----------
function startPublish(code){
    if(!signedIn()){ toast("Sign in to publish."); if(typeof openModal === "function") try{ resetSigninModalUI && resetSigninModalUI(); openModal("signinModal"); }catch(e){} return; }
    document.querySelector(".cr-overlay.cr-chooser")?.remove();
    const pub = publishedForSession();
    const ov = document.createElement("div");
    ov.className = "cr-overlay cr-chooser";
    ov.innerHTML = `<div class="cr-modal">
        <div class="cr-modal-head"><h3>Publish</h3><button type="button" class="cr-x">✕</button></div>
        <p class="cr-dim" style="margin:0 0 16px;">What would you like to share?</p>
        <div class="cr-choice-grid">
            <button type="button" class="cr-choice" id="crChoiceApp">
                <span class="cr-choice-emoji">🎮</span>
                <b>${pub ? "Update your app / game" : "Publish as app or game"}</b>
                <span>${pub ? `“${esc(pub.title)}” is live — push your changes (v${(pub.version || 1) + 1}).` : "Gets its own page in Discover with ratings, play counts and saved progress."}</span>
            </button>
            <button type="button" class="cr-choice" id="crChoiceChat">
                <span class="cr-choice-emoji">💬</span>
                <b>Publish this chat</b>
                <span>Share the whole conversation as a link, or show it in Discover → Chats.</span>
            </button>
        </div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector(".cr-x").onclick = close;
    ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });
    $("crChoiceApp").onclick = () => { close(); openDetailsModal({ mode: "publish", code }); };
    $("crChoiceChat").onclick = () => {
        close();
        if(typeof closeModal === "function") closeModal("codePreviewModal");
        document.getElementById("shareChatBtn")?.click();
    };
}

// ---------- details page (publish / update / edit) ----------
async function openDetailsModal(opts){
    document.querySelector(".cr-overlay.cr-details")?.remove();
    const mode = opts.mode; // publish | edit
    const code = opts.code || "";
    const pub = mode === "publish" ? publishedForSession() : null;
    let item = opts.item || null;       // when editing
    let existingSlug = mode === "edit" ? opts.slug : (pub ? pub.slug : null);

    // updating: load the current details so the form starts filled in
    if(mode === "publish" && existingSlug && !item){
        try{ item = (await apiGet({ action: "get", slug: existingSlug }, false)).item; }
        catch(e){ item = null; existingSlug = null; }
    }
    // not tied to this chat yet, but they have creations → offer to update one
    let myCreations = [];
    if(mode === "publish" && !existingSlug){
        try{ myCreations = (await apiGet({ action: "mine" }, true)).items || []; }catch(e){}
    }

    const kind0 = item ? item.kind : guessKind(code);
    const titleMatch = code.match(/<title>([^<]*)<\/title>/i);
    const state = {
        title: item ? item.title : (titleMatch ? titleMatch[1].trim().slice(0, 60) : ""),
        description: item ? item.description : "",
        genre: item ? item.genre : guessGenre(code, kind0),
        kind: kind0,
        tags: item ? (item.tags || []).join(", ") : "",
        listed: item ? item.listed : true,
        projectId: "",
        iconDataUrl: "", bannerDataUrl: "", removeIcon: false, removeBanner: false,
        iconPreview: item ? item.iconUrl : "", bannerPreview: item ? item.bannerUrl : ""
    };
    const projects = (typeof getProjects === "function" ? getProjects() : []) || [];
    const plan = (typeof currentPlanKey === "function") ? currentPlanKey() : "free";
    const canProject = plan !== "free" && plan !== "guest";
    const nick = playerInfo();
    const isUpdate = !!existingSlug && mode === "publish";

    const ov = document.createElement("div");
    ov.className = "cr-overlay cr-details";
    ov.innerHTML = `<div class="cr-modal cr-modal-lg" role="dialog" aria-modal="true">
        <div class="cr-modal-head"><h3>${mode === "edit" ? "Edit details" : isUpdate ? "Update your creation" : "Publish your creation"}</h3><button type="button" class="cr-x">✕</button></div>
        <div class="cr-form" id="crForm">
            ${mode === "publish" && !existingSlug && myCreations.length ? `
            <label class="cr-label">What are you doing?</label>
            <div class="cr-seg" id="crTarget"><button type="button" class="active" data-t="new">New creation</button><button type="button" data-t="update">Update one I already published</button></div>
            <select id="crUpdateSlug" class="cr-input" style="display:none;margin-top:8px;">${myCreations.map(c => `<option value="${esc(c.slug)}">${esc(c.title)} (v${c.version})</option>`).join("")}</select>` : ""}

            <div class="cr-form-grid">
                <div class="cr-img-col">
                    <label class="cr-label">Icon</label>
                    <div class="cr-icon-pick" id="crIconPick" title="Click to choose a picture"></div>
                    <div class="cr-img-actions"><button type="button" class="cr-link" id="crIconBtn">Upload</button><button type="button" class="cr-link" id="crIconRemove">Remove</button></div>
                    <input type="file" id="crIconFile" accept="image/*" hidden>
                </div>
                <div class="cr-fields">
                    <label class="cr-label" for="crTitle">Title</label>
                    <input id="crTitle" class="cr-input" maxlength="60" placeholder="e.g. Space Runner">
                    <label class="cr-label" for="crDesc">Description</label>
                    <textarea id="crDesc" class="cr-input" rows="3" maxlength="600" placeholder="What is it? How do you play or use it?"></textarea>
                </div>
            </div>

            <div class="cr-form-row">
                <div><label class="cr-label">Type</label>
                    <div class="cr-seg" id="crKind"><button type="button" data-k="game">🎮 Game</button><button type="button" data-k="app">📱 App</button></div></div>
                <div><label class="cr-label" for="crGenre">Genre</label>
                    <select id="crGenre" class="cr-input">${GENRES.map(g => `<option value="${esc(g)}">${(GENRE_EMOJI[g] || "") + " " + esc(g)}</option>`).join("")}</select></div>
            </div>
            <label class="cr-label" for="crTags">Tags <span class="cr-dim">(up to 5, comma separated)</span></label>
            <input id="crTags" class="cr-input" placeholder="space, fast, high-score">

            <label class="cr-label">Banner <span class="cr-dim">(optional, wide picture on your page)</span></label>
            <div class="cr-banner-pick" id="crBannerPick"></div>
            <div class="cr-img-actions"><button type="button" class="cr-link" id="crBannerBtn">Upload</button><button type="button" class="cr-link" id="crBannerRemove">Remove</button></div>
            <input type="file" id="crBannerFile" accept="image/*" hidden>

            <label class="cr-label">Publish as</label>
            <select id="crAs" class="cr-input">
                <option value="">👤 Me — ${esc(nick.name)} ${esc(nick.handle || "")}</option>
                ${projects.map(p => `<option value="${esc(p.id)}">📁 Project: ${esc(p.name)}</option>`).join("")}
            </select>
            ${canProject ? "" : `<p class="cr-hint" id="crProjectLock">🔒 Publishing under a project needs the <b>Starter</b> plan or above. Everyone can publish as themselves.</p>`}

            ${isUpdate || (mode === "publish" && myCreations.length) ? `<label class="cr-label" for="crNote">What's new? <span class="cr-dim">(shown on the page)</span></label><input id="crNote" class="cr-input" maxlength="200" placeholder="e.g. Added a new level and fixed the jump bug">` : ""}

            <label class="cr-check"><input type="checkbox" id="crListed"> Show it in <b>Discover</b> so everyone can find it <span class="cr-dim">(off = only people with the link)</span></label>
            ${mode === "publish" ? `<label class="cr-check"><input type="checkbox" id="crSafe"> I made this with Zyntra, it's safe for all ages (nothing scary, hateful or adult, and it doesn't ask for personal info), and I'm happy for anyone to play it.</label>` : ""}
            <p class="cr-hint">Your page shows your name and handle (not your email address).</p>
        </div>
        <div class="cr-modal-foot">
            <button type="button" class="cr-btn cr-btn-ghost" id="crCancel">Cancel</button>
            <button type="button" class="cr-btn cr-btn-primary" id="crSubmit">${mode === "edit" ? "Save changes" : isUpdate ? "Update ✓" : "Publish 🚀"}</button>
        </div></div>`;
    document.body.appendChild(ov);

    const q = id => ov.querySelector("#" + id);
    q("crTitle").value = state.title; q("crDesc").value = state.description; q("crGenre").value = state.genre; q("crTags").value = state.tags; q("crListed").checked = state.listed;
    const paintKind = () => q("crKind").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.k === state.kind));
    paintKind();
    q("crKind").addEventListener("click", e => { const b = e.target.closest("button"); if(b){ state.kind = b.dataset.k; paintKind(); } });

    const paintIcon = () => {
        const src = state.iconDataUrl || (!state.removeIcon && state.iconPreview) || "";
        const fake = { title: q("crTitle").value || "Untitled", genre: q("crGenre").value, iconUrl: src };
        q("crIconPick").innerHTML = iconHTML(fake, "cr-icon-big");
    };
    const paintBanner = () => {
        const src = state.bannerDataUrl || (!state.removeBanner && state.bannerPreview) || "";
        q("crBannerPick").innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<span class="cr-dim">No banner</span>`;
    };
    paintIcon(); paintBanner();
    q("crTitle").addEventListener("input", () => { if(!state.iconDataUrl && !state.iconPreview) paintIcon(); });
    q("crGenre").addEventListener("change", () => { if(!state.iconDataUrl && !state.iconPreview) paintIcon(); });
    const pickFile = (btnId, fileId, w, h, bytes, set) => {
        const open = () => q(fileId).click();
        q(btnId).onclick = open;
        q(fileId).onchange = async e => {
            const f = e.target.files[0]; e.target.value = ""; if(!f) return;
            try{ set(await fileToDataUrl(f, w, h, bytes)); }catch(err){ toast(err.message); }
        };
        return open;
    };
    const openIcon = pickFile("crIconBtn", "crIconFile", 256, 256, 55 * 1024, d => { state.iconDataUrl = d; state.removeIcon = false; paintIcon(); });
    q("crIconPick").onclick = openIcon;
    q("crIconRemove").onclick = () => { state.iconDataUrl = ""; state.removeIcon = true; state.iconPreview = ""; paintIcon(); };
    pickFile("crBannerBtn", "crBannerFile", 640, 360, 140 * 1024, d => { state.bannerDataUrl = d; state.removeBanner = false; paintBanner(); });
    q("crBannerRemove").onclick = () => { state.bannerDataUrl = ""; state.removeBanner = true; state.bannerPreview = ""; paintBanner(); };

    // project publishing is Starter+
    q("crAs").addEventListener("change", e => {
        if(e.target.value && !canProject){
            e.target.value = "";
            if(typeof showFeatureLockedModal === "function") showFeatureLockedModal("projectPublish");
            else toast("Publishing under a project needs the Starter plan or above.");
        }
    });

    if(q("crTarget")){
        q("crTarget").addEventListener("click", async e => {
            const b = e.target.closest("button"); if(!b) return;
            q("crTarget").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
            q("crUpdateSlug").style.display = b.dataset.t === "update" ? "" : "none";
            if(b.dataset.t === "update"){
                const c = myCreations.find(m => m.slug === q("crUpdateSlug").value);
                if(c){ q("crTitle").value = c.title; q("crDesc").value = c.description || ""; q("crGenre").value = c.genre; }
            }
        });
        q("crUpdateSlug").addEventListener("change", () => {
            const c = myCreations.find(m => m.slug === q("crUpdateSlug").value);
            if(c){ q("crTitle").value = c.title; q("crDesc").value = c.description || ""; q("crGenre").value = c.genre; state.kind = c.kind; paintKind(); }
        });
    }

    const close = () => ov.remove();
    ov.querySelector(".cr-x").onclick = close; q("crCancel").onclick = close;
    ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });

    q("crSubmit").onclick = async () => {
        const title = q("crTitle").value.trim();
        if(!title){ toast("Give it a title first."); q("crTitle").focus(); return; }
        if(mode === "publish" && !q("crSafe").checked){ toast("Please tick the safety box to publish."); return; }
        const body = {
            title, description: q("crDesc").value.trim(), genre: q("crGenre").value, kind: state.kind, tags: q("crTags").value,
            listed: q("crListed").checked, projectId: q("crAs").value,
            creatorName: nick.name && !nick.guest ? nick.name : undefined
        };
        if(state.iconDataUrl) body.iconDataUrl = state.iconDataUrl; else if(state.removeIcon) body.removeIcon = true;
        if(state.bannerDataUrl) body.bannerDataUrl = state.bannerDataUrl; else if(state.removeBanner) body.removeBanner = true;

        const btn = q("crSubmit"); const label = btn.textContent;
        btn.disabled = true; btn.textContent = mode === "edit" ? "Saving…" : "Publishing…";
        try{
            if(mode === "edit"){
                await apiPost(Object.assign({ action: "update-details", slug: existingSlug }, body), true);
                toast("Saved ✓");
                close();
                if($("gameView")?.classList.contains("active")) openGamePage(existingSlug);
                else if($("creatorView")?.classList.contains("active")) openDashboard();
                return;
            }
            let slugToUpdate = existingSlug;
            if(q("crTarget") && q("crTarget").querySelector(".active").dataset.t === "update") slugToUpdate = q("crUpdateSlug").value;
            const payload = Object.assign({ action: "publish", html: code, safeConfirmed: true, changelog: q("crNote") ? q("crNote").value.trim() : "" }, body);
            if(slugToUpdate) payload.existingSlug = slugToUpdate;
            const r = await apiPost(payload, true);
            // remember which chat this creation belongs to, so the AI + the
            // Publish button know "this is an update"
            const sid = (typeof currentSessionId !== "undefined") ? currentSessionId : null;
            if(sid){ const m = getPublishMap(); m[sid] = { slug: r.slug, title, version: r.version, kind: state.kind }; setPublishMap(m); }
            document.querySelectorAll(".code-preview-publish").forEach(refreshPublishButton);
            showPublished(ov, r, title);
        }catch(err){
            toast(err.message || "Couldn't publish. Please try again.");
            btn.disabled = false; btn.textContent = label;
        }
    };
}

function confetti(host){
    const colors = ["#7c5cff", "#ec4899", "#22d3ee", "#fdd835", "#43a047", "#fb8c00"];
    const box = document.createElement("div");
    box.className = "cr-confetti";
    for(let i = 0; i < 46; i++){
        const p = document.createElement("i");
        p.style.left = Math.random() * 100 + "%";
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = (Math.random() * 0.5) + "s";
        p.style.animationDuration = (1.4 + Math.random() * 1.2) + "s";
        p.style.transform = "rotate(" + Math.round(Math.random() * 360) + "deg)";
        box.appendChild(p);
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 3200);
}

function showPublished(ov, r, title){
    confetti(ov);
    const url = `${location.origin}/play/${r.slug}`;
    ov.querySelector(".cr-modal").innerHTML = `
        <div class="cr-done">
            <div class="cr-done-emoji">${r.updated ? "🔄" : "🎉"}</div>
            <h3>${r.updated ? `Updated to v${r.version}!` : "It's live!"}</h3>
            <p><b>${esc(title)}</b> ${r.updated ? "now has your latest changes — everyone who opens it gets the new version." : "is published. Share the link, and people can play it, rate it and find it in Discover."}</p>
            <div class="cr-linkbox"><span>${esc(url)}</span><button type="button" class="cr-link" id="crCopyLink">📋 Copy</button></div>
            <div class="cr-modal-foot" style="justify-content:center;">
                <button type="button" class="cr-btn cr-btn-ghost" id="crOpenDash">📊 Dashboard</button>
                <button type="button" class="cr-btn cr-btn-primary" id="crOpenPage">Open page →</button>
            </div></div>`;
    ov.querySelector("#crCopyLink").onclick = () => { navigator.clipboard.writeText(url).then(() => toast("Link copied 🔗")).catch(() => prompt("Copy this link:", url)); };
    ov.querySelector("#crOpenPage").onclick = () => { ov.remove(); if(typeof closeModal === "function") closeModal("codePreviewModal"); openGamePage(r.slug); };
    ov.querySelector("#crOpenDash").onclick = () => { ov.remove(); if(typeof closeModal === "function") closeModal("codePreviewModal"); openDashboard(); };
}

// keeps the Codex preview's Publish button honest: "Update" once published
function refreshPublishButton(btn){
    if(!btn) return;
    const pub = publishedForSession();
    const span = btn.querySelector("span");
    if(span) span.textContent = pub ? "Update" : "Publish";
    btn.title = pub ? `Update “${pub.title}” (v${(pub.version || 1) + 1})` : "Publish to Discover";
}

// ==========================================================
// Creator dashboard
// ==========================================================
async function openDashboard(tab){
    ensureViews();
    openView("creator", "discover");
    go("dashboard");
    document.title = "Creator dashboard — Zyntra AI";
    const view = $("creatorView");
    if(!signedIn()){
        view.innerHTML = `<div class="cr-empty-big"><div class="cr-empty-emoji">🔐</div><h3>Sign in to see your creator dashboard</h3><p>Your published apps and games, their plays and ratings, and your avatar live here.</p><button type="button" class="cr-btn cr-btn-primary" id="crDashSignin">Sign in</button></div>`;
        $("crDashSignin").onclick = () => { try{ resetSigninModalUI && resetSigninModalUI(); openModal("signinModal"); }catch(e){} };
        return;
    }
    view.innerHTML = `
        <div class="cr-dash">
            <div class="cr-game-top">
                <button type="button" class="cr-btn cr-btn-ghost" id="crDashBack">← Discover</button>
                <h2 class="cr-dash-title">📊 Creator dashboard</h2>
                <span class="cr-tabs-spacer"></span>
                <button type="button" class="cr-btn cr-btn-primary" id="crDashCreate">＋ Create new</button>
            </div>
            <div class="cr-tabs" id="crDashTabs"><button type="button" class="cr-tab active" data-tab="creations">My creations</button><button type="button" class="cr-tab" data-tab="avatar">🧑‍🎤 My avatar</button></div>
            <div id="crDashBody"><p class="cr-empty">Loading…</p></div>
        </div>`;
    $("crDashBack").onclick = () => openDiscover();
    $("crDashCreate").onclick = () => startCreating();
    const show = t => {
        $("crDashTabs").querySelectorAll(".cr-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
        if(t === "avatar") renderAvatarEditor($("crDashBody"), null); else loadMine();
    };
    $("crDashTabs").addEventListener("click", e => { const b = e.target.closest(".cr-tab"); if(b) show(b.dataset.tab); });
    show(tab || "creations");
}

async function loadMine(){
    const body = $("crDashBody");
    try{
        const { items } = await apiGet({ action: "mine" }, true);
        if(!items.length){
            body.innerHTML = `<div class="cr-empty-big"><div class="cr-empty-emoji">🚀</div><h3>You haven't published anything yet</h3><p>Ask Codex to build an app or a game, press <b>Publish</b>, and it will show up here with its plays and ratings.</p><button type="button" class="cr-btn cr-btn-primary" id="crDashFirst">Build my first one</button></div>`;
            $("crDashFirst").onclick = () => startCreating();
            return;
        }
        const plays = items.reduce((n, i) => n + i.plays, 0), likes = items.reduce((n, i) => n + i.likes, 0), dis = items.reduce((n, i) => n + i.dislikes, 0);
        body.innerHTML = `
            <div class="cr-stats">
                <div class="cr-stat-card"><b data-count="${items.length}">${items.length}</b><span>creations</span></div>
                <div class="cr-stat-card"><b data-count="${plays}">${fmtNum(plays)}</b><span>total plays</span></div>
                <div class="cr-stat-card"><b data-count="${likes}">${fmtNum(likes)}</b><span>👍 likes</span></div>
                <div class="cr-stat-card"><b>${likes + dis ? Math.round(likes / (likes + dis) * 100) + "%" : "—"}</b><span>approval</span></div>
            </div>
            <div class="cr-mine">${items.map(it => {
                const a = approval(it);
                const status = it.hidden ? `<span class="cr-badge cr-badge-bad">Under review</span>` : it.listed ? `<span class="cr-badge cr-badge-ok">Live in Discover</span>` : `<span class="cr-badge">Link only</span>`;
                return `<div class="cr-mine-row" data-slug="${esc(it.slug)}">
                    ${iconHTML(it, "cr-mine-icon")}
                    <div class="cr-ring" style="--p:${a == null ? 0 : a}" title="Approval"><span>${a == null ? "—" : a + "%"}</span></div>
                    <div class="cr-mine-info">
                        <p class="cr-mine-title">${esc(it.title)} <span class="cr-dim">· ${it.kind === "game" ? "Game" : "App"} · v${it.version}</span></p>
                        <p class="cr-mine-meta">${status} <span>👥 ${fmtNum(it.plays)}</span> <span>👍 ${a == null ? "—" : a + "%"}</span> <span class="cr-dim">updated ${esc(timeAgo(it.updatedAt))}</span>${it.projectName ? ` <span class="cr-dim">· 📁 ${esc(it.projectName)}</span>` : ""}</p>
                    </div>
                    <div class="cr-mine-actions">
                        <button type="button" class="cr-btn cr-btn-ghost" data-act="open">Open</button>
                        <button type="button" class="cr-btn cr-btn-ghost" data-act="edit">Edit details</button>
                        <button type="button" class="cr-btn cr-btn-ghost" data-act="update">Update</button>
                        <button type="button" class="cr-btn cr-btn-ghost" data-act="list">${it.listed ? "Hide from Discover" : "Show in Discover"}</button>
                        <button type="button" class="cr-btn cr-btn-danger" data-act="delete">Delete</button>
                    </div></div>`;
            }).join("")}</div>`;
        body.querySelectorAll("b[data-count]").forEach(el => {
            const end = +el.dataset.count; if(!end) return;
            const t0 = performance.now();
            const tick = now => { const k = Math.min(1, (now - t0) / 700); el.textContent = fmtNum(Math.round(end * (1 - Math.pow(1 - k, 3)))); if(k < 1) requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
        });
        body.querySelector(".cr-mine").addEventListener("click", async e => {
            const b = e.target.closest("button[data-act]"); if(!b) return;
            const row = b.closest(".cr-mine-row"), slug = row.dataset.slug, it = items.find(i => i.slug === slug);
            const act = b.dataset.act;
            try{
                if(act === "open") openGamePage(slug);
                else if(act === "edit") openDetailsModal({ mode: "edit", slug, item: it });
                else if(act === "update"){
                    const map = getPublishMap(); const sid = Object.keys(map).find(k => map[k].slug === slug);
                    if(sid && typeof openSessionById === "function" && openSessionById(sid)){ toast(`Ask Codex for your changes, then press Update — it knows “${it.title}” is live.`); }
                    else { startCreating(); toast("Build the new version in Codex, press Publish, and choose “Update one I already published”."); }
                }
                else if(act === "list"){ await apiPost({ action: "set-listed", slug, listed: !it.listed }, true); loadMine(); }
                else if(act === "delete"){
                    if(!confirm(`Delete “${it.title}”? Its page, ratings and everyone's saved progress will stop working.`)) return;
                    await apiPost({ action: "delete", slug }, true);
                    const m = getPublishMap(); Object.keys(m).forEach(k => { if(m[k].slug === slug) delete m[k]; }); setPublishMap(m);
                    toast("Deleted"); loadMine();
                }
            }catch(err){ toast(err.message); }
        });
    }catch(err){
        body.innerHTML = `<p class="cr-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Avatar editor
// ==========================================================
function renderAvatarEditor(container, onSaved){
    let a = getAvatar();
    const sw = (list, key, cur) => list.map(c => `<button type="button" class="cr-sw${c === cur ? " active" : ""}" data-key="${key}" data-val="${c}" style="background:${c}" title="${c}"></button>`).join("");
    const chips = (list, key, cur) => list.map(v => `<button type="button" class="cr-pill${v === cur ? " active" : ""}" data-key="${key}" data-val="${v}">${v}</button>`).join("");
    function paint(){
        container.innerHTML = `
            <div class="cr-avatar-ed">
                <div class="cr-avatar-stage"><div class="cr-avatar-pre">${zyAvatarSVG(a, 190)}</div>
                    <div class="cr-avatar-btns"><button type="button" class="cr-btn cr-btn-ghost" id="avRandom">🎲 Random</button><button type="button" class="cr-btn cr-btn-ghost" id="avReset">Reset</button></div></div>
                <div class="cr-avatar-controls">
                    <label class="cr-label">Tell Zyntra what to wear</label>
                    <div class="cr-say"><input id="avSay" class="cr-input" placeholder="e.g. red hoodie, blue jeans, white sneakers and sunglasses"><button type="button" class="cr-btn cr-btn-primary" id="avSayGo">Change</button></div>
                    <p class="cr-hint" id="avSayMsg">Try colours with clothes, hair, glasses, a cap, a crown…</p>
                    <label class="cr-label">Skin</label><div class="cr-sws">${sw(SKIN_TONES, "skin", a.skin)}</div>
                    <label class="cr-label">Hair</label><div class="cr-pills">${chips(AVATAR_OPTIONS.hair, "hair", a.hair)}</div><div class="cr-sws">${sw(HAIR_COLORS, "hairColor", a.hairColor)}</div>
                    <label class="cr-label">Face</label><div class="cr-pills">${chips(AVATAR_OPTIONS.face, "face", a.face)}</div>
                    <label class="cr-label">Top</label><div class="cr-pills">${chips(AVATAR_OPTIONS.shirt, "shirt", a.shirt)}</div><div class="cr-sws">${sw(CLOTH_COLORS, "shirtColor", a.shirtColor)}</div>
                    <label class="cr-label">Bottoms</label><div class="cr-pills">${chips(AVATAR_OPTIONS.pants, "pants", a.pants)}</div><div class="cr-sws">${sw(CLOTH_COLORS, "pantsColor", a.pantsColor)}</div>
                    <label class="cr-label">Shoes</label><div class="cr-sws">${sw(CLOTH_COLORS, "shoes", a.shoes)}</div>
                    <label class="cr-label">Accessory</label><div class="cr-pills">${chips(AVATAR_OPTIONS.accessory, "accessory", a.accessory)}</div>
                    ${a.accessory === "cap" ? `<div class="cr-sws">${sw(CLOTH_COLORS, "accColor", a.accColor)}</div>` : ""}
                </div>
            </div>
            <div class="cr-modal-foot"><button type="button" class="cr-btn cr-btn-primary" id="avSave">Save my avatar</button></div>`;
        container.querySelectorAll("[data-key]").forEach(b => b.addEventListener("click", () => { a[b.dataset.key] = b.dataset.val; paint(); }));
        const say = () => {
            const txt = container.querySelector("#avSay").value.trim(); if(!txt) return;
            const r = parseOutfit(txt, a);
            if(!r.changes.length){ container.querySelector("#avSayMsg").textContent = "I didn't catch an outfit part — try “green hoodie”, “black shorts”, “crown”…"; return; }
            a = r.avatar; paint();
            container.querySelector("#avSayMsg").textContent = "Changed: " + r.changes.join(", ") + " ✓";
        };
        container.querySelector("#avSayGo").onclick = say;
        container.querySelector("#avSay").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); say(); } });
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        container.querySelector("#avRandom").onclick = () => {
            a = { skin: pick(SKIN_TONES), hair: pick(AVATAR_OPTIONS.hair), hairColor: pick(HAIR_COLORS), face: pick(AVATAR_OPTIONS.face), shirt: pick(AVATAR_OPTIONS.shirt), shirtColor: pick(CLOTH_COLORS), pants: pick(AVATAR_OPTIONS.pants), pantsColor: pick(CLOTH_COLORS), shoes: pick(CLOTH_COLORS), accessory: pick(AVATAR_OPTIONS.accessory), accColor: pick(CLOTH_COLORS) };
            paint();
        };
        container.querySelector("#avReset").onclick = () => { a = Object.assign({}, AVATAR_DEFAULT); paint(); };
        container.querySelector("#avSave").onclick = () => { saveAvatar(a); toast("Avatar saved 🧑‍🎤"); if(onSaved) onSaved(a); };
    }
    paint();
}
function openAvatarModal(onSaved){
    document.querySelector(".cr-overlay.cr-avatar")?.remove();
    const ov = document.createElement("div");
    ov.className = "cr-overlay cr-avatar";
    ov.innerHTML = `<div class="cr-modal cr-modal-lg"><div class="cr-modal-head"><h3>🧑‍🎤 My avatar</h3><button type="button" class="cr-x">✕</button></div><div id="crAvatarHost"></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector(".cr-x").onclick = close;
    ov.addEventListener("mousedown", e => { if(e.target === ov) close(); });
    renderAvatarEditor(ov.querySelector("#crAvatarHost"), a => { if(onSaved) onSaved(a); close(); });
}

// ==========================================================
// Hooks used by script.js (Codex, router, preview)
// ==========================================================
// A creator's draft test: same sandbox + saving as a published game, but
// the saves stay on this device under "preview".
function showFixBar(message){
    const modal = document.getElementById("codePreviewModal");
    if(!modal) return;
    let bar = modal.querySelector(".cr-fixbar");
    if(bar){ bar.querySelector("span").textContent = "⚠ The game hit an error: " + message; bar.dataset.msg = message; return; }
    bar = document.createElement("div");
    bar.className = "cr-fixbar"; bar.dataset.msg = message;
    bar.innerHTML = `<span></span><button type="button" class="cr-btn cr-btn-primary">🛠 Fix it with AI</button><button type="button" class="cr-x" title="Dismiss">✕</button>`;
    bar.querySelector("span").textContent = "⚠ The game hit an error: " + message;
    (modal.querySelector(".modal-box") || modal).appendChild(bar);
    bar.querySelector(".cr-x").onclick = () => bar.remove();
    bar.querySelector(".cr-btn").onclick = () => {
        const msg = bar.dataset.msg;
        bar.remove();
        if(typeof closeModal === "function") closeModal("codePreviewModal");
        if(typeof sendChatMessage === "function"){
            sendChatMessage("The game you made crashed with this error: \"" + msg + "\". Please find the bug and send the complete corrected file. Keep everything that already works, and make sure the game is colourful, has real logic, and is playable.");
        }
    };
}
function previewDoc(code, iframe){
    let store = ""; try{ store = localStorage.getItem("zyntra-preview-save") || ""; }catch(e){}
    document.querySelector("#codePreviewModal .cr-fixbar")?.remove();
    if(iframe) registerFrame(iframe, s => { try{ localStorage.setItem("zyntra-preview-save", s); }catch(e){} }, showFixBar);
    return buildGameSrcdoc(code, { gameId: "preview", store, player: playerInfo(), avatar: getAvatar() });
}
function openInNewTab(code){
    const inner = previewDoc(code, null).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const wrapper = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview</title><style>html,body{margin:0;height:100%;background:#000}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe sandbox="${SANDBOX_ATTR}" allow="fullscreen; gamepad; autoplay" srcdoc="${inner}"></iframe></body></html>`;
    const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}

// ==========================================================
// Instructions added to every Codex request (not stored in the chat), so
// they are always current: the platform kit, the 3D-first rules, and — if
// this chat's app is already live — the "this is an update" note.
// ==========================================================
const CODEX_PLATFORM_NOTE = `

ZYNTRA PLATFORM — apps and games you build can be published to Zyntra Discover, where they run in a safe sandbox with a built-in player system. You can rely on:
- localStorage works normally and is saved automatically for each player of a published game (progress, scores, settings) — use it for saves and keep the data small (under 100KB). Never build your own login or call outside servers just to save progress.
- window.Zyntra may exist (always guard it: if(window.Zyntra){...}): Zyntra.player.name (display name, "Guest" when signed out); Zyntra.avatar (the player's blocky character settings: skin, hairColor, shirtColor, pantsColor, shoes, accessory…); Zyntra.avatarSVG(size) returns an SVG string of the player's character you can place in innerHTML; Zyntra.avatarImage(size) returns a Promise of an Image you can draw on a canvas. Zyntra.save(obj) / Zyntra.load() are optional helpers for one save object.
- It's a place where kids play and learn: nothing scary, violent, hateful or adult, no ads, no pop-ups asking for personal information.

CHARACTER GAMES (Roblox-style): when the user wants a game with a character, avatar, hero, pet or outfit, show a blocky character. Put the outfit in ONE config object at the top of the script so that when the user later says "change his clothes to a green hoodie" you only change that config and regenerate the whole file; when it fits, add an in-game wardrobe with a few colour/outfit choices saved to localStorage.

LEARNING: if the user sounds like a beginner or a child, add two or three plain, friendly sentences after the code explaining how one part works and suggest one fun thing they could ask you to change next — so they learn to make their own.`;

const CODEX_3D_RULES = `

3D FIRST — Zyntra games should feel like Roblox, so build GAMES IN 3D by default. Use 3D for anything with a character, a world to move through, obstacle courses (obbies), parkour, adventure, exploring, racing, shooters, survival, tycoons, simulators, escapes and runners. Stay 2D only when the user asks for 2D or the game is naturally flat (card/board/word/quiz/puzzle games, Snake, Tetris, Pong, 2048, tic-tac-toe, chess, clickers). A vague "make me a game" means a colourful 3D obby/adventure.

USE THE ZYNTRA GAME KIT FOR 3D. It is a ready-made Roblox-style engine: colourful themes, lighting, shadows, a blocky character (wearing the player's own avatar), third-person camera, keyboard + touch controls, gravity, jumping, collisions, moving platforms, enemies, coins, checkpoints, lives, levels, HUD, sounds and win/lose screens. Everything it places sits on the ground — nothing floats. DO NOT write your own physics, camera, controls, HUD or menus, and do not define ZG yourself (Zyntra injects it). Your job is to design great levels, rules and theme.
Page skeleton (the whole file): <!DOCTYPE html><html><head><meta charset="utf-8"><title>Game name</title></head><body><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script> ZG.run({...}); </script></body></html>
ZG.run({ title:'Candy Island', theme:'candy', lives:3, time:0, doubleJump:false, speed:11, goalText:'Collect the coins and reach the flag!', levels:[ function(g){ ...build level 1... }, function(g){ ...level 2... } ] })
Themes: grass, candy, lava, space, ice, desert, night, ocean (pick one that fits; it sets sky, fog, ground and bright platform colours). Use 2–4 levels that get harder. "time" is a countdown in seconds (0 = none).
Level builders (y = the height of the TOP surface; the ground top is 0; x/z are the floor position; -z is "forward"):
g.ground(size)  big floor at height 0 (optional; leave it out for floating-island levels, then everything must be reachable by jumping)
g.spawn(x,z)  where the player starts (put it on the ground/a platform; defaults to 0,0)
g.platform(x, top, z, width, depth, {color, h, moving:{axis:'x'|'y'|'z', range:5, speed:1}, ice:true, bounce:true})
g.stairs(x, bottom, z, steps, {dir:'z-', width:6})   g.wall(x, bottom, z, w, height, d, color)   g.box(x, bottom, z, w, h, d, color, {solid:true})
g.coin(x,z)  g.coinRow(x,z,count,dx,dz)  g.coins([[x,z],[x,z]])  — coins rest on whatever is below them
g.checkpoint(x,z)  g.goal(x,z) — the golden flag that finishes the level (put it on a platform, at the end)
g.lava(x,z,w,d) — costs a life   g.enemy(x,z,{type:'patrol'|'chase', range:6, axis:'x'|'z', speed:3, color}) — jump on its head to defeat it; touching its side hurts
Decor (always grounded): g.tree(x,z,scale) g.rock(x,z) g.house(x,z,w,d,color) g.flower(x,z) g.cloud(x,y,z) g.scenery(area) (scatters trees + clouds)
Extras: g.onUpdate(function(dt, player, g){ ... }) for custom rules; g.add(threeObject) to add your own THREE meshes; g.addScore(n); g.toast('text'); g.surfaceY(x,z); g.player.{x,y,z}; g.coinsCollected / g.coinsTotal.
LEVEL DESIGN RULES: the player jumps about 3 units high and about 6 units across — keep platform gaps ≤ 6 and each step up ≤ 2.5. Build a clear path of platforms from spawn to the goal, with coins along the way that guide the player, a checkpoint in the middle of long levels, and a different challenge in each level (moving platforms, lava gaps, patrolling enemies, stairs, bouncy pads, ice). Make levels big enough to be fun (15–40 platforms/objects) and bright (use several colours; the kit picks theme colours for you if you omit them). Add g.scenery() for a lively world.
Example level: function(g){ g.ground(50); g.spawn(0,8); g.scenery(40); g.platform(0,0,-14,6,6); g.coinRow(0,-14,3,0,2); g.platform(6,1.5,-22,5,5,{moving:{axis:'x',range:5}}); g.lava(0,-18,16,5); g.platform(-5,3,-30,5,5); g.checkpoint(-5,-30); g.enemy(0,2,{axis:'x',range:6}); g.platform(0,4.5,-38,9,9); g.goal(0,-38); }
If you add your own THREE code, use only r128 features (no ES modules, no addons, no CapsuleGeometry).`;

// does this request call for a 3D game? (3D by default for real "worlds"; 2D for flat classics)
function wants3D(text){
    const t = (text || "").toLowerCase();
    if(/\b2\s?-?d\b|top-?down|side-?scroll|pixel art|\bflat\b/.test(t)) return false;
    if(/\b3\s?-?d\b|three\.?js|roblox|minecraft|voxel|first[- ]person|third[- ]person|open[- ]world|\bfps\b/.test(t)) return true;
    const flat = /\b(snake|tetris|pong|2048|tic[- ]?tac[- ]?toe|chess|checkers|sudoku|wordle|hangman|quiz|trivia|flashcard|memory (match|game)|card game|solitaire|crossword|clicker|calculator|todo|to-do|landing page|portfolio|website|dashboard|tracker|planner)\b/.test(t);
    if(flat) return false;
    return /\b(game|obby|parkour|race|racing|adventure|shooter|runner|simulator|tycoon|survival|escape room|battle|fighting|explore|zombie|dragon|robot|space|city|island|jungle|castle|dungeon|kart|car|plane|fly|drive)\b/.test(t);
}

function codexRuntimeNote(lastUserText, hasThreeCode){
    let note = CODEX_PLATFORM_NOTE;
    if(hasThreeCode || wants3D(lastUserText)) note += CODEX_3D_RULES;
    const pub = publishedForSession();
    if(pub){
        note += `

THIS CHAT'S ${pub.kind === "game" ? "GAME" : "APP"} IS ALREADY PUBLISHED: "${pub.title}" is live on Zyntra Discover (currently version ${pub.version || 1}). Treat every follow-up request (change, fix, add a level, new outfit…) as an UPDATE to that same ${pub.kind === "game" ? "game" : "app"}: keep what already works, apply the requested change, and regenerate the ENTIRE file. After the code, remind the user in one short sentence to press the Update button in the preview to push this new version live for everyone.`;
    }
    return note;
}

// Returns the messages to send: the stored chat plus a fresh runtime note
// right after the leading system message(s). The stored chat isn't changed.
function withCodexRuntime(history){
    let lastUser = "";
    for(let i = history.length - 1; i >= 0; i--){ if(history[i].role === "user"){ lastUser = String(history[i].content || ""); break; } }
    const hasThree = history.some(m => m.role === "assistant" && /THREE\.WebGLRenderer|three\.min\.js|ZG\.run/.test(String(m.content || "")));
    const note = { role: "system", content: codexRuntimeNote(lastUser, hasThree) };
    let i = 0;
    while(i < history.length && history[i].role === "system") i++;
    return history.slice(0, i).concat([note], history.slice(i));
}
function codexContextNote(){ return ""; }

// ---------- router (called from script.js) ----------
function route(slug, sub){
    if(slug === "play" && sub){ openGamePage(sub); return true; }
    if(slug === "dashboard"){ openDashboard(); return true; }
    return false;
}

Object.assign(Z, { startPublish, previewDoc, openInNewTab, codexContextNote, withCodexRuntime, wants3D, codexRuntimeNote, refreshPublishButton, route, openDashboard, openGamePage, openAvatarModal, publishedForSession, hookDiscover, openDiscover, startCreating, openDetailsModal });

// wire up once the page is ready
hookDiscover();
document.addEventListener("click", e => {
    const t = e.target.closest("#accountMenuDashboard");
    if(t){ if(typeof toggleAccountMenu === "function") toggleAccountMenu(false); openDashboard(); }
});

})();
