// ===== ZYNTRA MOMENTS START =====
// ==========================================================
// Zyntra Moments — video sharing + creator channels.
// Loaded after script.js (uses its globals: activeAuth, openModal,
// showPageView, closeSidebarMobile). All data comes from /api/moments;
// nothing here is mocked and nothing is hard-coded as a statistic.
// ==========================================================
(function(){
"use strict";

const API = "/api/moments";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fmtNum(n){
    n = n || 0;
    if(n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if(n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
}
function fmtDur(s){ s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
function fmtWatch(sec){ const m = Math.round((sec || 0) / 60); return m >= 60 ? (Math.floor(m / 60) + " h " + (m % 60) + " min") : m + " min"; }
function timeAgo(ms){
    if(!ms) return "";
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if(s < 60) return "just now"; if(s < 3600) return Math.round(s / 60) + " min ago";
    if(s < 86400) return Math.round(s / 3600) + " h ago"; if(s < 86400 * 30) return Math.round(s / 86400) + " d ago";
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDay(k){ const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8))); return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }); }
const BADGE_EMOJI = { first_spark: "✨", million_club: "👑" };
const REASONS = { sexual: "Sexual or explicit content", exploitative: "Exploitative or inappropriate", graphic: "Graphic or disturbing", harassment: "Harassment or bullying", dangerous: "Dangerous or harmful", spam_scam: "Spam or scam", private_info: "Exposed passwords, keys or private info", copyright: "Copyright violation", other: "Something else" };

// ---------------- API ----------------
const user = () => (typeof activeAuth === "function" ? activeAuth().currentUser : null);
async function api(method, action, data){
    const headers = {}; const u = user();
    if(u) headers.Authorization = "Bearer " + await u.getIdToken();
    let url = API; const opt = { method, headers };
    if(method === "GET") url += "?" + new URLSearchParams(Object.assign({}, data || {}, { action }));
    else { headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(Object.assign({}, data || {}, { action })); }
    let res;
    try { res = await fetch(url, opt); } catch(e){ throw new Error("Network problem — check your connection and try again."); }
    const json = await res.json().catch(() => ({}));
    if(!res.ok) throw Object.assign(new Error(json.error || "Something went wrong."), { status: res.status });
    return json;
}
function needSignIn(){
    if(user()) return false;
    if(typeof resetSigninModalUI === "function") resetSigninModalUI();
    if(typeof openModal === "function") openModal("signinModal");
    return true;
}

// ---------------- state ----------------
let me = null, root = null, cleanup = null, renderToken = 0;
async function loadMe(force){
    if(!user()){ me = { guest: true, channel: null, prefs: {}, unread: 0, isAdmin: false, limits: { videoMb: 100, durationSec: 600, bugMb: 50 } }; return me; }
    if(me && !me.guest && !force) return me;
    try { me = await api("GET", "me"); } catch(e){ me = { guest: true, channel: null, prefs: {}, unread: 0, isAdmin: false, limits: { videoMb: 100, durationSec: 600, bugMb: 50 } }; }
    return me;
}
function ensureView(){
    if($("momentsView")) return;
    const anchor = $("discoverView"); if(!anchor) return;
    const v = document.createElement("div"); v.className = "page-view"; v.id = "momentsView";
    v.innerHTML = '<div class="mo-root" id="moRoot" aria-live="polite"></div>';
    anchor.parentNode.insertBefore(v, anchor.nextSibling);
}
function go(path){ if(location.pathname + location.search !== path) history.pushState({}, "", path); render(); window.scrollTo && window.scrollTo(0, 0); }
function setTitle(t){ document.title = (t ? t + " — " : "") + "Zyntra Moments"; }

// ---------------- small UI helpers ----------------
function dialog(title, body){
    const bg = document.createElement("div"); bg.className = "mo-dialog-bg";
    bg.innerHTML = `<div class="mo-dialog mo-form" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3 style="margin-top:0">${esc(title)}</h3>${body}</div>`;
    bg.addEventListener("click", e => { if(e.target === bg) bg.remove(); });
    bg.addEventListener("keydown", e => { if(e.key === "Escape") bg.remove(); });
    document.body.appendChild(bg);
    const f = bg.querySelector("input,select,textarea,button"); if(f) f.focus();
    return bg;
}
function toast(msg){ if(typeof showToast === "function") try { showToast(msg); return; } catch(e){} const t = document.createElement("div"); t.textContent = msg; t.setAttribute("role", "status"); t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:999px;z-index:9500"; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
const skeletons = n => '<div class="mo-grid">' + Array.from({ length: n }, () => '<div class="mo-skel"></div>').join("") + "</div>";
const emptyBox = (icon, msg) => `<div class="mo-empty"><div style="font-size:40px">${icon}</div><p>${esc(msg)}</p></div>`;
const avatar = (ch, cls) => ch && ch.avatarUrl ? `<img class="mo-av ${cls || ""}" src="${esc(ch.avatarUrl)}" alt="" loading="lazy">` : `<span class="mo-av ${cls || ""}" aria-hidden="true">${esc(((ch && (ch.name || ch.handle)) || "Z")[0].toUpperCase())}</span>`;
const badges = ch => (ch.badges || []).map(b => `<span title="${esc(b)}">${BADGE_EMOJI[b] || "🏅"}</span>`).join(" ");
function card(v){
    const ch = v.channel || {};
    return `<a class="mo-card" href="/moments/watch/${esc(v.id)}" data-go>
      <div class="mo-thumb"><img src="${esc(v.thumbUrl)}" alt="" loading="lazy"><span class="mo-dur">${fmtDur(v.durationSec)}</span></div>
      <div class="mo-meta">${avatar(ch)}<div><div class="mo-ttl">${esc(v.title)}</div>
      <div class="mo-sub">${esc(ch.name || "")} ${badges(ch)}</div>
      <div class="mo-sub">${fmtNum(v.verifiedViews)} verified views · ${timeAgo(v.publishedAt)}</div></div></div></a>`;
}
function setBusy(btn, busy, label){ if(!btn) return; btn.disabled = busy; if(label != null) btn.dataset.l = btn.dataset.l || btn.textContent; btn.textContent = busy ? (label || "…") : (btn.dataset.l || btn.textContent); }
function bind(sel, ev, fn){ root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn)); }
function chart(series, key, label){
    const vals = series.map(d => d[key] || 0); const max = Math.max(1, ...vals);
    const W = 560, H = 190, pad = 24, bw = (W - pad * 2) / vals.length;
    const bars = vals.map((v, i) => { const bh = Math.round((H - pad * 2) * v / max); return `<rect x="${(pad + i * bw + 1).toFixed(1)}" y="${H - pad - bh}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${v ? Math.max(bh, 1) : 0}" rx="2"><title>${fmtDay(series[i].day)}: ${v}</title></rect>`; }).join("");
    return `<svg class="mo-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, last ${vals.length} days">${bars}<text x="${pad}" y="${H - 6}">${fmtDay(series[0].day)}</text><text x="${W - pad}" y="${H - 6}" text-anchor="end">${fmtDay(series[series.length - 1].day)}</text><text x="${pad}" y="12">peak ${fmtNum(max)}</text></svg>`;
}

// ---------------- shell ----------------
function shell(inner){
    const ch = me && me.channel;
    root.innerHTML = `<header class="mo-top">
      <button class="mo-brand" data-go-home aria-label="Zyntra Moments home"><span>🎬</span><span class="g">Zyntra Moments</span></button>
      <form class="mo-search" role="search" id="moSearch"><input type="search" placeholder="Search videos and channels" aria-label="Search" maxlength="60" value="${esc(new URLSearchParams(location.search).get("q") || "")}"><button aria-label="Search">🔍</button></form>
      ${ch ? '<a class="mo-btn pri" href="/moments/upload" data-go>⬆ Upload</a><a class="mo-btn" href="/moments/studio" data-go>Studio</a>' : '<a class="mo-btn pri" href="/moments/create-channel" data-go>Create channel</a>'}
      <a class="mo-btn" href="/moments/notifications" data-go aria-label="Notifications">🔔${me && me.unread ? `<span class="mo-badge">${me.unread > 49 ? "50+" : me.unread}</span>` : ""}</a>
      <a class="mo-btn" href="/moments/bugs" data-go>🐞 Bug reports</a>
      ${me && me.isAdmin ? '<a class="mo-btn" href="/moments/admin" data-go>🛡 Admin</a>' : ""}
    </header><main id="moMain">${inner}</main>`;
    const f = $("moSearch");
    f.addEventListener("submit", e => { e.preventDefault(); const q = f.querySelector("input").value.trim(); go(q.length >= 2 ? "/moments?q=" + encodeURIComponent(q) : "/moments"); });
    root.querySelector("[data-go-home]").addEventListener("click", () => go("/moments"));
}
function guard(needChannel){
    if(!user()){ $("moMain").innerHTML = emptyBox("🔒", "Sign in to use this page."); needSignIn(); return false; }
    if(needChannel && !(me && me.channel)){ $("moMain").innerHTML = `<div class="mo-empty"><p>You need a channel first.</p><a class="mo-btn pri" href="/moments/create-channel" data-go>Create channel</a></div>`; return false; }
    return true;
}

// ---------------- home / search ----------------
async function viewHome(){
    const q = new URLSearchParams(location.search).get("q");
    if(q) return viewSearch(q);
    setTitle("");
    let sort = user() ? "recommended" : "trending";
    shell(`<div class="mo-tabs" role="tablist" aria-label="Feed">
      <button class="mo-tab" role="tab" data-sort="trending">🔥 Trending</button><button class="mo-tab" role="tab" data-sort="new">🆕 New</button><button class="mo-tab" role="tab" data-sort="recommended">✨ For you</button></div>
      <div id="moGrid" class="mo-grid"></div><div id="moMore" style="text-align:center;margin:24px 0"></div>`);
    let cursor = null, loading = false, io = null;
    const grid = $("moGrid"), more = $("moMore");
    async function load(reset){
        if(loading) return; loading = true;
        if(reset){ cursor = null; grid.innerHTML = ""; grid.insertAdjacentHTML("beforeend", Array.from({ length: 8 }, () => '<div class="mo-skel"></div>').join("")); }
        more.innerHTML = "";
        try {
            const d = await api("GET", "feed", { sort, cursor: cursor || "", limit: 12 });
            if(reset) grid.innerHTML = "";
            if(!d.videos.length && reset) grid.innerHTML = `<div style="grid-column:1/-1">${emptyBox("🎬", "No videos here yet. Be the first to share something you made in Zyntra!")}</div>`;
            grid.insertAdjacentHTML("beforeend", d.videos.map(card).join(""));
            cursor = d.next;
            if(cursor){ more.innerHTML = '<button class="mo-btn" id="moLoadMore">Load more</button>'; $("moLoadMore").onclick = () => load(false); if("IntersectionObserver" in window){ io && io.disconnect(); io = new IntersectionObserver(es => { if(es[0].isIntersecting) load(false); }, { rootMargin: "400px" }); io.observe($("moLoadMore")); } }
        } catch(e){ if(reset) grid.innerHTML = ""; more.innerHTML = `<p class="mo-err">${esc(e.message)}</p><button class="mo-btn" id="moRetry">Try again</button>`; $("moRetry").onclick = () => load(reset); }
        loading = false;
    }
    cleanup = () => io && io.disconnect();
    const tabs = root.querySelectorAll(".mo-tab");
    const mark = () => tabs.forEach(t => t.setAttribute("aria-selected", String(t.dataset.sort === sort)));
    tabs.forEach(t => t.addEventListener("click", () => { sort = t.dataset.sort; mark(); load(true); }));
    mark(); load(true);
}
async function viewSearch(q){
    setTitle("Search: " + q);
    shell(skeletons(6));
    try {
        const d = await api("GET", "search", { q });
        $("moMain").innerHTML = `<h2>Results for “${esc(q)}”</h2>
        ${d.channels.length ? `<div class="mo-panel"><h3>Channels</h3>${d.channels.map(c => `<a class="mo-row" style="padding:8px 0" href="/moments/c/${esc(c.handle)}" data-go>${avatar(c)}<div><b>${esc(c.name)}</b> ${badges(c)}<div class="mo-sub">@${esc(c.handle)}${c.subscribers != null ? " · " + fmtNum(c.subscribers) + " subscribers" : ""}</div></div></a>`).join("")}</div>` : ""}
        ${d.videos.length ? `<div class="mo-grid">${d.videos.map(card).join("")}</div>` : (d.channels.length ? "" : emptyBox("🔎", "Nothing found. Try different words."))}`;
    } catch(e){ $("moMain").innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; }
}

// ---------------- watch ----------------
async function viewWatch(id){
    shell('<div class="mo-skel"></div>');
    let d;
    try { d = await api("GET", "watch", { id }); }
    catch(e){ $("moMain").innerHTML = emptyBox("🚫", e.status === 404 ? "This video isn't available." : e.message); return; }
    const v = d.video, ch = d.channel; setTitle(v.title);
    const statusNote = v.status !== "approved" ? `<div class="mo-note mo-warn">Only you${me && me.isAdmin ? " and administrators" : ""} can see this video right now — status: <b>${esc(v.status)}</b>.</div>` : (v.visibility !== "public" ? `<div class="mo-note">This video is <b>${esc(v.visibility)}</b>${v.visibility === "private" ? " — only you can see it." : " — anyone with the link can watch."}</div>` : "");
    $("moMain").innerHTML = `<div class="mo-watch"><div>
      ${statusNote}
      <video id="moVideo" class="mo-player" controls playsinline preload="metadata" ${d.posterUrl ? `poster="${esc(d.posterUrl)}"` : ""} src="${esc(d.videoUrl)}"></video>
      <h2 style="margin:14px 0 6px">${esc(v.title)}</h2>
      <div class="mo-row" style="justify-content:space-between">
        <a class="mo-row" href="/moments/c/${esc(ch.handle)}" data-go>${avatar(ch)}<div><b>${esc(ch.name)}</b> ${badges(ch)}<div class="mo-sub">${ch.subscribers != null ? fmtNum(ch.subscribers) + " subscribers" : "@" + esc(ch.handle)}</div></div></a>
        <div class="mo-row">
          ${d.owner ? "" : `<button class="mo-btn ${d.subscribed ? "on" : "pri"}" id="moSub">${d.subscribed ? "Subscribed ✓" : "Subscribe"}</button>`}
          <button class="mo-btn ${d.liked ? "on" : ""}" id="moLike" aria-pressed="${d.liked}">👍 <span id="moLikes">${fmtNum(v.likes)}</span></button>
          <button class="mo-btn" id="moShare">↗ Share</button>
          ${d.owner ? "" : '<button class="mo-btn" id="moReport">⚑ Report</button>'}
        </div></div>
      <div class="mo-panel" style="margin-top:14px"><div class="mo-sub">${fmtNum(v.verifiedViews)} verified views · ${fmtNum(v.plays)} plays · ${timeAgo(v.publishedAt)}</div>
        <p style="white-space:pre-wrap;margin:8px 0 0">${esc(v.description)}</p>
        ${v.tags.length ? `<p class="mo-sub">${v.tags.map(t => "#" + esc(t)).join(" ")}</p>` : ""}</div>
      <section aria-label="Comments"><h3><span id="moCmCount">${fmtNum(v.comments)}</span> comments</h3>
        ${ch.commentsEnabled || d.owner ? `<div class="mo-row" style="align-items:flex-start"><textarea id="moCmText" class="mo-in" maxlength="500" rows="2" placeholder="Add a comment" aria-label="Add a comment"></textarea><button class="mo-btn pri" id="moCmSend">Post</button></div><div class="mo-err" id="moCmErr"></div>` : '<p class="mo-sub">Comments are turned off for this channel.</p>'}
        <div id="moCms"></div><div id="moCmMore"></div></section></div>
      <aside><h3>More to watch</h3><div style="display:grid;gap:14px">${d.related.map(card).join("") || '<p class="mo-sub">Nothing else yet.</p>'}</div></aside></div>`;

    // like / subscribe / share / report
    $("moLike").onclick = async () => { if(needSignIn()) return; try { const r = await api("POST", "video-like", { id, like: !d.liked }); d.liked = r.liked; v.likes += r.liked ? 1 : -1; $("moLike").classList.toggle("on", d.liked); $("moLike").setAttribute("aria-pressed", d.liked); $("moLikes").textContent = fmtNum(v.likes); } catch(e){ toast(e.message); } };
    const sub = $("moSub"); if(sub) sub.onclick = async () => { if(needSignIn()) return; try { const r = await api("POST", "channel-subscribe", { channelId: ch.id, subscribe: !d.subscribed }); d.subscribed = r.subscribed; sub.textContent = r.subscribed ? "Subscribed ✓" : "Subscribe"; sub.className = "mo-btn " + (r.subscribed ? "on" : "pri"); } catch(e){ toast(e.message); } };
    $("moShare").onclick = async () => { const url = location.origin + "/moments/watch/" + id; try { if(navigator.share && v.visibility !== "private") await navigator.share({ title: v.title, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch(e){} };
    const rep = $("moReport"); if(rep) rep.onclick = () => { if(needSignIn()) return; reportDialog("video", id, id); };

    // comments
    let cmCursor = null;
    const cms = $("moCms");
    const cmHTML = c => `<div class="mo-cm" data-cid="${esc(c.id)}"><div class="mo-av" aria-hidden="true">${esc((c.authorName || "Z")[0].toUpperCase())}</div><div style="flex:1"><div><b>${esc(c.authorName)}</b> ${c.authorHandle ? `<span class="mo-sub">@${esc(c.authorHandle)}</span>` : ""} <span class="mo-sub">${timeAgo(c.createdAt)}</span></div><div style="white-space:pre-wrap;word-break:break-word">${esc(c.text)}</div>
      <div class="mo-row" style="margin-top:4px">${c.mine || d.owner ? `<button class="mo-btn" data-del="${esc(c.id)}" style="padding:2px 10px">Delete</button>` : ""}${!c.mine ? `<button class="mo-btn" data-rep="${esc(c.id)}" style="padding:2px 10px">Report</button>` : ""}</div></div></div>`;
    async function loadComments(){
        try { const r = await api("GET", "comments", { id, cursor: cmCursor || "" }); cms.insertAdjacentHTML("beforeend", r.comments.map(cmHTML).join("")); cmCursor = r.next; $("moCmMore").innerHTML = cmCursor ? '<button class="mo-btn" id="moCmMoreBtn">Show more comments</button>' : ""; if(cmCursor) $("moCmMoreBtn").onclick = loadComments; }
        catch(e){ $("moCmMore").innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; }
    }
    cms.addEventListener("click", async e => {
        const del = e.target.closest("[data-del]"), rp = e.target.closest("[data-rep]");
        if(del){ try { await api("POST", "comment-delete", { videoId: id, commentId: del.dataset.del }); del.closest(".mo-cm").remove(); } catch(er){ toast(er.message); } }
        if(rp){ if(needSignIn()) return; reportDialog("comment", rp.dataset.rep, id); }
    });
    const send = $("moCmSend");
    if(send) send.onclick = async () => {
        if(needSignIn()) return; const t = $("moCmText"); $("moCmErr").textContent = ""; if(!t.value.trim()) return;
        setBusy(send, true, "Posting…");
        try { const r = await api("POST", "comment-add", { id, text: t.value }); cms.insertAdjacentHTML("afterbegin", cmHTML(r.comment)); t.value = ""; $("moCmCount").textContent = fmtNum(++v.comments); } catch(e){ $("moCmErr").textContent = e.message; }
        setBusy(send, false);
    };
    loadComments();

    // view tracking: heartbeats only while actually playing; the server decides what counts
    const vid = $("moVideo"); let timer = null, lastTick = 0, acc = 0, started = false;
    const tick = (ended) => {
        const now = performance.now(); if(lastTick && !vid.paused) acc += (now - lastTick) / 1000; lastTick = vid.paused ? 0 : now;
        const delta = Math.min(15, Math.round(acc * 10) / 10); acc -= delta;
        if(!started && !delta && !ended) return;
        const headers = { "Content-Type": "application/json" }; const send = u => fetch(API, { method: "POST", keepalive: true, headers: u ? Object.assign(headers, { Authorization: "Bearer " + u }) : headers, body: JSON.stringify({ action: "view-beat", id, delta, ended: !!ended }) }).catch(() => {});
        const u = user(); if(u) u.getIdToken().then(send).catch(() => send(null)); else send(null);
    };
    vid.addEventListener("play", () => { if(!started){ started = true; tick(false); } lastTick = performance.now(); if(!timer) timer = setInterval(() => tick(false), 15000); });
    vid.addEventListener("pause", () => { tick(false); });
    vid.addEventListener("ended", () => { tick(true); clearInterval(timer); timer = null; });
    const vis = () => { if(document.hidden && !vid.paused) tick(false); };
    document.addEventListener("visibilitychange", vis);
    cleanup = () => { if(started) tick(true); clearInterval(timer); document.removeEventListener("visibilitychange", vis); try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch(e){} };
}
function reportDialog(type, targetId, videoId){
    const bg = dialog("Report", `<label for="rpR">Why are you reporting this?</label><select id="rpR">${Object.keys(REASONS).map(k => `<option value="${k}">${esc(REASONS[k])}</option>`).join("")}</select>
      <label for="rpD">Details (optional)</label><textarea id="rpD" maxlength="500"></textarea><div class="mo-err" id="rpE"></div>
      <div class="mo-row"><button class="mo-btn pri" id="rpGo">Send report</button><button class="mo-btn" id="rpNo">Cancel</button></div>
      <p class="mo-sub">Reports are reviewed by people. False reports may be ignored.</p>`);
    bg.querySelector("#rpNo").onclick = () => bg.remove();
    bg.querySelector("#rpGo").onclick = async () => { try { await api("POST", "report", { targetType: type, targetId, videoId, reason: bg.querySelector("#rpR").value, details: bg.querySelector("#rpD").value }); bg.remove(); toast("Thanks — we'll take a look."); } catch(e){ bg.querySelector("#rpE").textContent = e.message; } };
}

// ---------------- channel page ----------------
async function viewChannel(handle){
    shell('<div class="mo-skel" style="aspect-ratio:5/1"></div>');
    let d; try { d = await api("GET", "channel", { handle }); } catch(e){ $("moMain").innerHTML = emptyBox("🚫", e.status === 404 ? "Channel not found." : e.message); return; }
    const ch = d.channel; setTitle(ch.name);
    $("moMain").innerHTML = `<div class="mo-banner" ${ch.bannerUrl ? `style="background-image:url('${esc(ch.bannerUrl)}')"` : ""}></div>
    <div class="mo-chead">${avatar(ch, "lg")}<div style="flex:1;min-width:200px"><h2 style="margin:0">${esc(ch.name)} ${badges(ch)}</h2>
      <div class="mo-sub">@${esc(ch.handle)}${ch.subscribers != null ? " · " + fmtNum(ch.subscribers) + " subscribers" : ""} · ${fmtNum(ch.videos)} videos · ${fmtNum(ch.verifiedViews)} verified views</div></div>
      <div class="mo-row">${d.owner ? '<a class="mo-btn pri" href="/moments/studio" data-go>Open Studio</a>' : `<button class="mo-btn ${d.subscribed ? "on" : "pri"}" id="moSub">${d.subscribed ? "Subscribed ✓" : "Subscribe"}</button><button class="mo-btn" id="moRepCh">⚑ Report</button>`}</div></div>
    ${ch.description ? `<div class="mo-panel"><p style="white-space:pre-wrap;margin:0">${esc(ch.description)}</p>${(ch.links || []).length ? `<p class="mo-row">${ch.links.map(l => `<a class="mo-btn" href="${esc(l)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.replace(/^https:\/\//, "").slice(0, 40))}</a>`).join("")}</p>` : ""}</div>` : ""}
    ${d.videos.length ? `<div class="mo-grid">${d.videos.map(card).join("")}</div>` : emptyBox("🎞", "No public videos yet.")}`;
    const sub = $("moSub"); if(sub){ let on = d.subscribed; sub.onclick = async () => { if(needSignIn()) return; try { const r = await api("POST", "channel-subscribe", { channelId: ch.id, subscribe: !on }); on = r.subscribed; sub.textContent = on ? "Subscribed ✓" : "Subscribe"; sub.className = "mo-btn " + (on ? "on" : "pri"); } catch(e){ toast(e.message); } }; }
    const rp = $("moRepCh"); if(rp) rp.onclick = () => { if(needSignIn()) return; reportDialog("channel", ch.id, null); };
}

// ---------------- uploads (browser → Cloud Storage via short-lived signed policy) ----------------
function imgBlob(file, w, h, cover, q){
    return new Promise((res, rej) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
            const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
            const r = cover ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
            x.fillStyle = "#000"; x.fillRect(0, 0, w, h); x.drawImage(img, (w - img.width * r) / 2, (h - img.height * r) / 2, img.width * r, img.height * r);
            URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error("Could not process the image.")), "image/jpeg", q || 0.85);
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That image couldn't be read.")); };
        img.src = url;
    });
}
function postPolicy(policy, blob, onProg, signal){
    return new Promise((resolve, reject) => {
        const fd = new FormData(); Object.keys(policy.fields).forEach(k => fd.append(k, policy.fields[k])); fd.append("file", blob);
        const x = new XMLHttpRequest(); x.open("POST", policy.url);
        x.upload.onprogress = e => { if(e.lengthComputable && onProg) onProg(e.loaded / e.total); };
        x.onload = () => (x.status >= 200 && x.status < 300) ? resolve() : reject(Object.assign(new Error("Upload failed (" + x.status + "). If this keeps happening, the storage bucket's CORS settings may not allow this site yet."), { retry: x.status >= 500 }));
        x.onerror = () => reject(Object.assign(new Error("Network problem during the upload."), { retry: true }));
        x.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { cancelled: true }));
        if(signal) signal.addEventListener("abort", () => x.abort());
        x.send(fd);
    });
}
// Retries transient failures with a fresh signed policy. NOTE: uploads are not resumable —
// a failed attempt restarts that file from the beginning.
async function uploadFile(purpose, ref, blob, onProg, signal){
    for(let attempt = 0; ; attempt++){
        const pol = await api("POST", "upload-init", { purpose, ref, contentType: blob.type, size: blob.size });
        try { await postPolicy(pol, blob, onProg, signal); return pol.path; }
        catch(e){ if(e.retry && attempt < 2 && !(signal && signal.aborted)){ await sleep(1500 * (attempt + 1)); continue; } throw e; }
    }
}
function seekTo(v, t){ return new Promise(r => { const done = () => { v.removeEventListener("seeked", done); r(); }; v.addEventListener("seeked", done); v.currentTime = t; setTimeout(done, 4000); }); }
function toBlob(c, q){ return new Promise(r => c.toBlob(r, "image/jpeg", q)); }
// Reads the video locally: checks it decodes, gets its length, makes a thumbnail and a few small frames
// (the frames feed the automated PRE-screen; a human still reviews every upload).
async function analyzeVideo(file){
    const v = document.createElement("video"); v.preload = "auto"; v.muted = true; v.playsInline = true;
    const url = URL.createObjectURL(file); v.src = url;
    try {
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("This browser can't read that video. Try an MP4 (H.264) or WebM file.")); });
        const dur = v.duration; if(!isFinite(dur) || dur <= 0 || !v.videoWidth) throw new Error("Couldn't read the video's length.");
        const draw = async (t, w) => { await seekTo(v, t); const c = document.createElement("canvas"), r = Math.min(1, w / v.videoWidth); c.width = Math.round(v.videoWidth * r); c.height = Math.round(v.videoHeight * r); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); return c; };
        const tc = await draw(Math.min(1, dur * 0.1), 1280); let q = 0.85, thumb = await toBlob(tc, q);
        while(thumb && thumb.size > 900 * 1024 && q > 0.4){ q -= 0.15; thumb = await toBlob(tc, q); }
        const frames = [];
        for(let i = 0; i < 6; i++){ const c = await draw(dur * (i + 0.5) / 6, 480); let u = c.toDataURL("image/jpeg", 0.6); if(u.length > 150000) u = c.toDataURL("image/jpeg", 0.35); if(u.length < 150000) frames.push(u); }
        return { duration: dur, thumb, frames };
    } finally { URL.revokeObjectURL(url); }
}

// ---------------- create channel ----------------
const GUIDELINES = `<ul style="margin:6px 0 0 18px;padding:0"><li>Only upload content you made or have permission to share.</li><li>No sexual, exploitative, graphic, hateful or harassing content.</li><li>No dangerous or harmful instructions, scams or spam.</li><li>Never show passwords, API keys, private chats or other people's personal information.</li><li>Every video is reviewed before it is published. Rejected videos stay private and you can appeal.</li><li>Views are only counted once per viewer and artificial views are not rewarded.</li></ul>`;
async function viewCreateChannel(){
    shell(""); setTitle("Create channel");
    if(!guard(false)) return;
    if(me.channel){ $("moMain").innerHTML = `<div class="mo-panel">You already have a channel: <a href="/moments/c/${esc(me.channel.handle)}" data-go><b>@${esc(me.channel.handle)}</b></a></div>`; return; }
    $("moMain").innerHTML = `<div class="mo-panel mo-form" style="max-width:640px;margin:0 auto"><h2 style="margin-top:0">Create your channel</h2>
      <p class="mo-sub">A channel is optional — you only get one when you create it. Anyone can watch without one.</p>
      <label for="chName">Channel name</label><input type="text" id="chName" maxlength="40">
      <label for="chHandle">Handle</label><input type="text" id="chHandle" maxlength="30" placeholder="my_channel" autocapitalize="none"><div class="hint">3–30 letters, numbers or underscores. Unique, and it can't be changed later.</div>
      <label for="chAvatar">Profile picture (optional)</label><input type="file" id="chAvatar" accept="image/png,image/jpeg,image/webp">
      <label for="chBanner">Banner (optional)</label><input type="file" id="chBanner" accept="image/png,image/jpeg,image/webp">
      <label for="chDesc">Description</label><textarea id="chDesc" maxlength="1000"></textarea>
      <label for="chLinks">External links (optional, one per line, https only, max 5)</label><textarea id="chLinks" style="min-height:60px"></textarea>
      <div class="mo-note"><b>Community guidelines</b>${GUIDELINES}</div>
      <label class="mo-check"><input type="checkbox" id="chAgree"><span>I have read and agree to the Zyntra Moments community guidelines.</span></label>
      <div class="mo-err" id="chErr" role="alert"></div><button class="mo-btn pri" id="chGo">Create channel</button></div>`;
    $("chGo").onclick = async () => {
        const btn = $("chGo"), err = $("chErr"); err.textContent = "";
        const name = $("chName").value.trim(), handle = $("chHandle").value.trim().toLowerCase().replace(/^@/, "");
        if(name.length < 2) return err.textContent = "Enter a channel name.";
        if(!/^[a-z0-9_]{3,30}$/.test(handle)) return err.textContent = "Handle must be 3–30 letters, numbers or underscores.";
        if(!$("chAgree").checked) return err.textContent = "Please agree to the community guidelines.";
        setBusy(btn, true, "Creating…");
        try {
            const body = { name, handle, description: $("chDesc").value, links: $("chLinks").value.split("\n").map(s => s.trim()).filter(Boolean), agreeGuidelines: true };
            const a = $("chAvatar").files[0], b = $("chBanner").files[0];
            if(a) body.avatarPath = await uploadFile("avatar", null, await imgBlob(a, 256, 256, true));
            if(b) body.bannerPath = await uploadFile("banner", null, await imgBlob(b, 1280, 320, true, 0.8));
            const r = await api("POST", "channel-create", body);
            await loadMe(true); toast("Channel created!"); go("/moments/c/" + r.handle);
        } catch(e){ err.textContent = e.message; setBusy(btn, false); }
    };
}

// ---------------- upload a video ----------------
async function viewUpload(){
    shell(""); setTitle("Upload");
    await loadMe(); shell(""); if(!guard(true)) return;
    const L = me.limits;
    $("moMain").innerHTML = `<div class="mo-panel mo-form" style="max-width:720px;margin:0 auto"><h2 style="margin-top:0">Upload a video</h2>
      <div class="mo-note">Every upload is <b>reviewed before it's published</b>. Automated checks are only a first pass and aren't perfect, so a person looks at anything that goes public. Max ${L.videoMb} MB and ${Math.round(L.durationSec / 60)} minutes · MP4, WebM or MOV.</div>
      <label for="upFile">Video file</label><input type="file" id="upFile" accept="video/mp4,video/webm,video/quicktime"><div id="upInfo" class="hint"></div>
      <div id="upThumbBox" style="display:none"><label>Thumbnail</label><img id="upThumb" alt="Thumbnail preview" style="max-width:280px;border-radius:12px;display:block"><label for="upThumbFile" class="hint">Use your own image instead (optional)</label><input type="file" id="upThumbFile" accept="image/png,image/jpeg,image/webp"></div>
      <label for="upTitle">Title</label><input type="text" id="upTitle" maxlength="100">
      <label for="upDesc">Description</label><textarea id="upDesc" maxlength="2000"></textarea>
      <label for="upTags">Tags (comma separated, up to 8)</label><input type="text" id="upTags" maxlength="120">
      <label for="upVis">Visibility</label><select id="upVis"><option value="public">Public — listed after approval</option><option value="unlisted">Unlisted — anyone with the link, after approval</option><option value="private">Private — only me</option></select>
      <label class="mo-check"><input type="checkbox" id="upOk"><span>This is my own content or I have permission to share it, it follows the community guidelines, and it doesn't show passwords, API keys or private information.</span></label>
      <div class="mo-prog" id="upProgWrap" style="display:none"><i id="upProg"></i></div><div id="upStatus" class="hint" role="status"></div><div class="mo-err" id="upErr" role="alert"></div>
      <div class="mo-row"><button class="mo-btn pri" id="upGo" disabled>Upload for review</button><button class="mo-btn" id="upCancel" style="display:none">Cancel</button></div></div>`;
    let analysis = null, file = null, customThumb = null, ctx = { id: null, v: false, t: false }, ctl = null;
    const info = $("upInfo"), err = $("upErr");
    $("upFile").onchange = async e => {
        err.textContent = ""; analysis = null; $("upGo").disabled = true; $("upThumbBox").style.display = "none"; file = e.target.files[0]; ctx = { id: null, v: false, t: false };
        if(!file) return;
        if(!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) return err.textContent = "Please choose an MP4, WebM or MOV video.";
        if(file.size > L.videoMb * 1048576) return err.textContent = `That file is ${(file.size / 1048576).toFixed(0)} MB — the limit is ${L.videoMb} MB.`;
        info.textContent = "Reading video…";
        try {
            analysis = await analyzeVideo(file);
            if(analysis.duration > L.durationSec) { analysis = null; info.textContent = ""; return err.textContent = `Videos can be up to ${Math.round(L.durationSec / 60)} minutes.`; }
            info.textContent = `${fmtDur(analysis.duration)} · ${(file.size / 1048576).toFixed(1)} MB`;
            $("upThumb").src = URL.createObjectURL(analysis.thumb); $("upThumbBox").style.display = "block";
            if(!$("upTitle").value) $("upTitle").value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
            $("upGo").disabled = false;
        } catch(ex){ info.textContent = ""; err.textContent = ex.message; }
    };
    $("upThumbFile").onchange = async e => { const f = e.target.files[0]; if(!f) { customThumb = null; return; } try { customThumb = await imgBlob(f, 1280, 720, true, 0.85); $("upThumb").src = URL.createObjectURL(customThumb); } catch(ex){ err.textContent = ex.message; } };
    $("upCancel").onclick = () => { ctl && ctl.abort(); };
    $("upGo").onclick = async () => {
        err.textContent = "";
        if(!analysis) return; if($("upTitle").value.trim().length < 2) return err.textContent = "Add a title."; if(!$("upOk").checked) return err.textContent = "Please confirm the checkbox.";
        const btn = $("upGo"); btn.disabled = true; $("upCancel").style.display = ""; $("upProgWrap").style.display = ""; ctl = new AbortController();
        const prog = f => { $("upProg").style.width = Math.round(f * 100) + "%"; };
        try {
            if(!ctx.id){ $("upStatus").textContent = "Preparing…"; ctx.id = (await api("POST", "video-create", { title: $("upTitle").value, description: $("upDesc").value, tags: $("upTags").value, visibility: $("upVis").value, contentType: file.type, size: file.size, durationSec: analysis.duration })).id; }
            if(!ctx.v){ $("upStatus").textContent = "Uploading video…"; await uploadFile("video", ctx.id, file, prog, ctl.signal); ctx.v = true; }
            if(!ctx.t){ $("upStatus").textContent = "Uploading thumbnail…"; prog(0); await uploadFile("thumb", ctx.id, customThumb || analysis.thumb, prog, ctl.signal); ctx.t = true; }
            $("upStatus").textContent = "Submitting for review…"; prog(1);
            const r = await api("POST", "video-finalize", { id: ctx.id, frames: analysis.frames });
            $("upCancel").style.display = "none";
            $("moMain").innerHTML = r.status === "rejected" ? `<div class="mo-panel"><h2>Not published</h2><p>${esc(r.reason)}</p><a class="mo-btn" href="/moments/studio" data-go>Open Studio</a></div>` : `<div class="mo-panel" style="text-align:center"><div style="font-size:44px">✅</div><h2>Submitted for review</h2><p>It stays private until it's approved. You'll get a notification when a decision is made.</p><a class="mo-btn pri" href="/moments/studio" data-go>Go to Studio</a></div>`;
        } catch(e){
            $("upCancel").style.display = "none"; err.textContent = e.message + (e.cancelled ? "" : " — press the button to retry; finished steps won't be repeated."); $("upStatus").textContent = ""; btn.disabled = false; btn.textContent = "Retry upload";
        }
    };
}

// ---------------- studio (creator dashboard) ----------------
async function viewStudio(){
    shell(skeletons(4)); setTitle("Studio"); await loadMe(); shell(skeletons(4)); if(!guard(true)) return;
    let d; try { d = await api("GET", "studio"); } catch(e){ $("moMain").innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; return; }
    let tab = (location.hash || "#overview").slice(1);
    const T = { overview: "Overview", videos: "Videos", rewards: "Rewards", settings: "Settings" };
    function draw(){
        $("moMain").innerHTML = `<h2>Studio · ${esc(d.channel.name)}</h2><div class="mo-tabs" role="tablist">${Object.keys(T).map(k => `<button class="mo-tab" role="tab" data-t="${k}" aria-selected="${k === tab}">${T[k]}</button>`).join("")}</div><div id="stBody"></div>`;
        root.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { tab = b.dataset.t; history.replaceState({}, "", "#" + tab); draw(); });
        ({ overview: tOverview, videos: tVideos, rewards: tRewards, settings: tSettings }[tab] || tOverview)($("stBody"));
    }
    function tOverview(el){
        const t = d.totals; let key = "verified";
        const series = d.series.map(x => Object.assign({ watchMin: Math.round(x.watchSeconds / 60) }, x));
        el.innerHTML = `<div class="mo-stats">
          <div class="mo-stat"><small>Verified views</small><b>${fmtNum(t.verifiedViews)}</b></div><div class="mo-stat"><small>Plays started</small><b>${fmtNum(t.plays)}</b></div>
          <div class="mo-stat"><small>Subscribers</small><b>${fmtNum(t.subscribers)}</b></div><div class="mo-stat"><small>Watch time</small><b>${fmtWatch(t.watchSeconds)}</b></div>
          <div class="mo-stat"><small>Likes</small><b>${fmtNum(t.likes)}</b></div><div class="mo-stat"><small>Comments</small><b>${fmtNum(t.comments)}</b></div>
          <div class="mo-stat"><small>Engagement</small><b>${(t.engagementRate * 100).toFixed(1)}%</b></div><div class="mo-stat"><small>Public videos</small><b>${fmtNum(t.videos)}</b></div></div>
        <div class="mo-panel"><div class="mo-row" style="justify-content:space-between"><h3 style="margin:0">Last 28 days</h3><select id="chK" class="mo-in" style="width:auto" aria-label="Metric"><option value="verified">Verified views</option><option value="plays">Plays started</option><option value="watchMin">Watch minutes</option><option value="likes">Likes</option><option value="comments">Comments</option><option value="subscribers">Net subscribers</option></select></div><div id="chBox"></div></div>
        <div class="mo-note"><b>Verified views</b> count once per viewer per 24 hours, after real watching (30 seconds, or half of a video under a minute). Your own views, repeats and suspicious bursts are excluded. <b>Plays started</b> are just play events. Engagement = (likes + comments) ÷ verified views. All numbers come from stored activity — nothing here is estimated.</div>`;
        const paint = () => { $("chBox").innerHTML = chart(series, key, $("chK").selectedOptions[0].textContent); }; $("chK").onchange = e => { key = e.target.value; paint(); }; paint();
    }
    function tVideos(el){
        if(!d.videos.length){ el.innerHTML = emptyBox("🎞", "No videos yet.") + '<p style="text-align:center"><a class="mo-btn pri" href="/moments/upload" data-go>Upload your first video</a></p>'; return; }
        el.innerHTML = `<div class="mo-table-wrap"><table class="mo-table"><thead><tr><th>Video</th><th>Status</th><th>Visibility</th><th>Verified</th><th>Plays</th><th>👍</th><th>💬</th><th></th></tr></thead><tbody>${d.videos.map(v => `<tr>
          <td><div class="mo-row">${v.thumbUrl ? `<img src="${esc(v.thumbUrl)}" alt="" style="width:96px;border-radius:8px">` : ""}<div><a href="/moments/watch/${esc(v.id)}" data-go><b>${esc(v.title)}</b></a><div class="mo-sub">${timeAgo(v.createdAt)} · ${fmtDur(v.durationSec)}</div></div></div></td>
          <td><span class="mo-pill ${esc(v.status)}">${esc(v.status.replace("_", " "))}</span>${v.rejection ? `<div class="mo-sub" style="max-width:260px">${esc(REASONS[v.rejection.category] || "")}: ${esc(v.rejection.reason)}</div>` : ""}${v.appeal ? `<div class="mo-sub">Appeal: ${esc(v.appeal.status)}${v.appeal.note ? " — " + esc(v.appeal.note) : ""}</div>` : ""}</td>
          <td><select class="mo-in" style="width:auto" data-vis="${esc(v.id)}" aria-label="Visibility"><option ${v.visibility === "public" ? "selected" : ""}>public</option><option ${v.visibility === "unlisted" ? "selected" : ""}>unlisted</option><option ${v.visibility === "private" ? "selected" : ""}>private</option></select></td>
          <td>${fmtNum(v.verifiedViews)}</td><td>${fmtNum(v.plays)}</td><td>${fmtNum(v.likes)}</td><td>${fmtNum(v.comments)}</td>
          <td><div class="mo-row"><button class="mo-btn" data-an="${esc(v.id)}">Analytics</button>${v.status === "rejected" && !v.appeal ? `<button class="mo-btn" data-ap="${esc(v.id)}">Appeal</button>` : ""}<button class="mo-btn danger" data-rm="${esc(v.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div>`;
        el.querySelectorAll("[data-vis]").forEach(s => s.onchange = async () => { try { const r = await api("POST", "video-update", { id: s.dataset.vis, visibility: s.value }); toast(r.needsReview ? "Saved — needs review again." : "Visibility updated"); } catch(e){ toast(e.message); } });
        el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if(!confirm("Delete this video permanently?")) return; try { await api("POST", "video-delete", { id: b.dataset.rm }); d = await api("GET", "studio"); draw(); } catch(e){ toast(e.message); } });
        el.querySelectorAll("[data-ap]").forEach(b => b.onclick = () => { const bg = dialog("Appeal this decision", `<label for="apT">Why should it be reconsidered?</label><textarea id="apT" maxlength="1000"></textarea><div class="mo-err" id="apE"></div><div class="mo-row"><button class="mo-btn pri" id="apGo">Send appeal</button><button class="mo-btn" id="apNo">Cancel</button></div><p class="mo-sub">A person reviews appeals. You can appeal each video once.</p>`); bg.querySelector("#apNo").onclick = () => bg.remove(); bg.querySelector("#apGo").onclick = async () => { try { await api("POST", "appeal-create", { id: b.dataset.ap, text: bg.querySelector("#apT").value }); bg.remove(); d = await api("GET", "studio"); draw(); } catch(e){ bg.querySelector("#apE").textContent = e.message; } }; });
        el.querySelectorAll("[data-an]").forEach(b => b.onclick = async () => { try { const a = await api("GET", "video-analytics", { id: b.dataset.an }); const s = a.series.map(x => Object.assign({ watchMin: Math.round(x.watchSeconds / 60) }, x)); const bg = dialog("Analytics · " + a.title, `<div class="mo-stats"><div class="mo-stat"><small>Verified views</small><b>${fmtNum(a.totals.verifiedViews)}</b></div><div class="mo-stat"><small>Plays</small><b>${fmtNum(a.totals.plays)}</b></div><div class="mo-stat"><small>Watch time</small><b>${fmtWatch(a.totals.watchSeconds)}</b></div><div class="mo-stat"><small>Likes / comments</small><b>${fmtNum(a.totals.likes)} / ${fmtNum(a.totals.comments)}</b></div></div><h4>Verified views, last 28 days</h4>${chart(s, "verified", "Verified views")}<h4>Watch minutes</h4>${chart(s, "watchMin", "Watch minutes")}<button class="mo-btn" id="anX">Close</button>`); bg.querySelector("#anX").onclick = () => bg.remove(); } catch(e){ toast(e.message); } });
    }
    function tRewards(el){
        const e = d.eligibility;
        el.innerHTML = `<div class="mo-note"><b>How rewards work.</b> Reaching a milestone makes you <i>eligible</i> — an administrator reviews every claim and <b>nothing is granted automatically</b>. Only verified views count. To be approved: your channel is at least ${e.minChannelAgeDays} days old; you have ${e.maxStrikes === 0 ? "no" : "at most " + e.maxStrikes} community-guideline strike${e.maxStrikes === 1 ? "" : "s"}; there's no unresolved suspicious-activity hold; and the content is original (not copied or stolen). Milestones and rewards may change over time.</div>
        <div class="mo-split">${d.rewards.map(r => { const pct = Math.min(100, Math.round(r.progress / r.threshold * 100)); const c = r.claim; return `<div class="mo-panel"><h3>${esc(r.title)}</h3><div class="mo-sub">Reward: ${esc(r.reward.label)}</div><div class="mo-bar" style="margin:10px 0" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><div class="mo-sub">${fmtNum(Math.min(r.progress, r.threshold))} / ${fmtNum(r.threshold)} ${esc({ verifiedViews: "verified views", subscribers: "subscribers", videos: "public videos", likes: "likes" }[r.metric])}</div>
          <p style="margin:8px 0 0">${!c ? "In progress" : c.status === "pending_review" ? "🕓 Milestone reached — awaiting administrator review." : c.status === "approved" ? "✅ Approved" + (c.note ? " — " + esc(c.note) : "") : "Not approved" + (c.note ? " — " + esc(c.note) : "")}</p></div>`; }).join("") || emptyBox("🏆", "No milestones are configured yet.")}</div>
        ${(d.channel.badges.length || d.channel.decorations.length) ? `<div class="mo-panel"><h3>Your recognition</h3><p>${d.channel.badges.map(b => (BADGE_EMOJI[b] || "🏅") + " " + esc(b)).join(" · ")} ${d.channel.decorations.map(x => "🖼 " + esc(x)).join(" · ")}</p></div>` : ""}`;
    }
    function tSettings(el){
        const c = me.channel, p = me.prefs;
        el.innerHTML = `<div class="mo-split"><div class="mo-panel mo-form"><h3>Channel</h3>
          <label for="seName">Name</label><input type="text" id="seName" maxlength="40" value="${esc(c.name)}"><div class="hint">Handle: @${esc(c.handle)} (can't be changed)</div>
          <label for="seDesc">Description</label><textarea id="seDesc" maxlength="1000">${esc(c.description || "")}</textarea>
          <label for="seLinks">Links (https, one per line)</label><textarea id="seLinks" style="min-height:60px">${esc((c.links || []).join("\n"))}</textarea>
          <label for="seAv">New profile picture</label><input type="file" id="seAv" accept="image/png,image/jpeg,image/webp"><label for="seBn">New banner</label><input type="file" id="seBn" accept="image/png,image/jpeg,image/webp">
          <label class="mo-check"><input type="checkbox" id="seSubs" ${c.showSubscriberCount ? "checked" : ""}><span>Show my subscriber count publicly</span></label>
          <label class="mo-check"><input type="checkbox" id="seCm" ${c.commentsEnabled ? "checked" : ""}><span>Allow comments on my videos</span></label>
          <div class="mo-err" id="seErr"></div><button class="mo-btn pri" id="seSave">Save channel</button></div>
        <div class="mo-panel mo-form"><h3>Notifications</h3>${[["subscribers", "New subscribers"], ["likes", "Likes"], ["comments", "Comments"], ["published", "Video published"], ["bugUpdates", "Bug report updates"], ["achievements", "Achievements"], ["rewards", "Reward decisions"]].map(([k, l]) => `<label class="mo-check"><input type="checkbox" data-pref="${k}" ${p[k] !== false ? "checked" : ""}><span>${l}</span></label>`).join("")}<div class="mo-note">Video rejections and moderation decisions are always delivered, so you can use the appeal option.</div></div></div>`;
        $("seSave").onclick = async () => { const b = $("seSave"); setBusy(b, true, "Saving…"); $("seErr").textContent = ""; try { const body = { name: $("seName").value, description: $("seDesc").value, links: $("seLinks").value.split("\n").map(s => s.trim()).filter(Boolean), showSubscriberCount: $("seSubs").checked, commentsEnabled: $("seCm").checked }; const a = $("seAv").files[0], n = $("seBn").files[0]; if(a) body.avatarPath = await uploadFile("avatar", null, await imgBlob(a, 256, 256, true)); if(n) body.bannerPath = await uploadFile("banner", null, await imgBlob(n, 1280, 320, true, 0.8)); await api("POST", "channel-update", body); await loadMe(true); toast("Saved"); } catch(e){ $("seErr").textContent = e.message; } setBusy(b, false); };
        el.querySelectorAll("[data-pref]").forEach(i => i.onchange = async () => { try { await api("POST", "prefs-set", { [i.dataset.pref]: i.checked }); me.prefs[i.dataset.pref] = i.checked; } catch(e){ toast(e.message); i.checked = !i.checked; } });
    }
    draw();
}

// ---------------- bug reports ----------------
async function viewBugs(){
    shell(skeletons(2)); setTitle("Bug reports"); await loadMe(); shell(""); if(!guard(false)) return;
    const L = me.limits;
    const dev = { userAgent: navigator.userAgent, platform: navigator.platform || "", language: navigator.language || "", screen: screen.width + "x" + screen.height, viewport: innerWidth + "x" + innerHeight, online: navigator.onLine, page: location.pathname };
    $("moMain").innerHTML = `<div class="mo-split"><div class="mo-panel mo-form"><h2 style="margin-top:0">Report a bug</h2>
      <div class="mo-note mo-warn">Bug reports are <b>private</b> — only you and Zyntra administrators can see them. Still, <b>never include passwords, API keys, tokens or other people's private info</b> in the text or the recording. Reports that look like they contain credentials are blocked.</div>
      <label for="bgT">What went wrong? (short title)</label><input type="text" id="bgT" maxlength="120">
      <label for="bgD">Description</label><textarea id="bgD" maxlength="3000"></textarea>
      <label for="bgS">Steps to reproduce</label><textarea id="bgS" maxlength="2000" placeholder="1. Open…&#10;2. Click…"></textarea>
      <label for="bgF">Screen recording (optional, MP4/WebM/MOV, up to ${L.bugMb} MB)</label><input type="file" id="bgF" accept="video/mp4,video/webm,video/quicktime">
      <label class="mo-check"><input type="checkbox" id="bgDev" checked><span>Attach basic browser & device info (${esc(dev.platform || "platform")}, ${esc(dev.screen)}, ${esc(dev.language)}, browser name/version)</span></label>
      <div class="mo-prog" id="bgPW" style="display:none"><i id="bgP"></i></div><div class="mo-err" id="bgE" role="alert"></div><button class="mo-btn pri" id="bgGo">Send report</button></div>
      <div class="mo-panel"><h3>My reports</h3><div id="bgList">Loading…</div></div></div>`;
    async function list(){ try { const r = await api("GET", "bug-mine"); $("bgList").innerHTML = r.items.length ? r.items.map(b => `<div class="mo-cm"><div style="flex:1"><b>${esc(b.title)}</b><div class="mo-sub">${timeAgo(b.createdAt)}</div>${b.publicNote ? `<div class="mo-sub">Note from the team: ${esc(b.publicNote)}</div>` : ""}</div><span class="mo-pill ${esc(b.status)}">${esc(b.status.replace("_", " "))}</span></div>`).join("") : '<p class="mo-sub">No reports yet.</p>'; } catch(e){ $("bgList").innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; } }
    list();
    let ctx = { id: null, up: false };
    $("bgGo").onclick = async () => {
        const btn = $("bgGo"), err = $("bgE"); err.textContent = ""; const f = $("bgF").files[0];
        if(f && !["video/mp4", "video/webm", "video/quicktime"].includes(f.type)) return err.textContent = "Use an MP4, WebM or MOV recording.";
        if(f && f.size > L.bugMb * 1048576) return err.textContent = `Recording is too large (max ${L.bugMb} MB).`;
        setBusy(btn, true, "Sending…");
        try {
            if(!ctx.id) ctx.id = (await api("POST", "bug-create", { title: $("bgT").value, description: $("bgD").value, steps: $("bgS").value, device: $("bgDev").checked ? dev : {}, hasRecording: !!f, contentType: f ? f.type : undefined, size: f ? f.size : undefined })).id;
            if(f){ $("bgPW").style.display = ""; if(!ctx.up){ await uploadFile("bug", ctx.id, f, p => { $("bgP").style.width = Math.round(p * 100) + "%"; }); ctx.up = true; } await api("POST", "bug-finalize", { id: ctx.id }); }
            toast("Report sent — thank you!"); ctx = { id: null, up: false }; ["bgT", "bgD", "bgS", "bgF"].forEach(i => $(i).value = ""); $("bgPW").style.display = "none"; list();
        } catch(e){ err.textContent = e.message + (ctx.id ? " — press Send again to retry." : ""); }
        setBusy(btn, false);
    };
}

// ---------------- notifications ----------------
function notifText(n){
    const d = n.data || {}, t = d.title ? `“${esc(d.title)}”` : "your video";
    switch(n.type){
        case "new_subscriber": return "👤 Someone subscribed to your channel.";
        case "like": return `👍 Someone liked ${t}.`;
        case "comment": return `💬 New comment on ${t}: “${esc(d.preview || "")}”`;
        case "video_published": return `🎉 ${t} was approved${d.visibility === "private" ? " (it's private)" : " and is live"}.`;
        case "video_rejected": return `⛔ ${t} wasn't published — ${esc(REASONS[d.category] || "policy")}: ${esc(d.reason || "")} You can appeal in <a href="/moments/studio#videos" data-go>Studio</a>.`;
        case "moderation": return "🛡 " + ({ appeal_overturned: `Your appeal was accepted — ${t} is live.`, appeal_denied: `Your appeal for ${t} was reviewed and the decision stands.`, channel_suspended: "Your channel was suspended.", channel_restored: "Your channel was restored.", reward_denied: `Reward “${esc(d.title || "")}” was not approved.` }[d.decision] || "A moderation decision was made.") + (d.note ? " " + esc(d.note) : "");
        case "bug_update": return `🐞 Your bug report “${esc(d.title || "")}” is now <b>${esc(String(d.status || "").replace("_", " "))}</b>.${d.note ? " " + esc(d.note) : ""}`;
        case "achievement": return `🏆 Milestone reached: ${esc(d.title || "")}. An administrator will review it.`;
        case "reward_approved": return `🎁 Reward approved: ${esc(d.reward || d.title || "")}.${d.fulfillment === "manual" ? " We'll deliver it manually." : ""}`;
        default: return "Notification";
    }
}
async function viewNotifications(){
    shell(skeletons(2)); setTitle("Notifications"); await loadMe(); shell(""); if(!guard(false)) return;
    $("moMain").innerHTML = '<div class="mo-row" style="justify-content:space-between"><h2>Notifications</h2><button class="mo-btn" id="ntAll">Mark all read</button></div><div class="mo-panel" id="ntList">Loading…</div><div id="ntMore"></div>';
    let cursor = null;
    async function load(){
        try { const r = await api("GET", "notifications", { cursor: cursor || "" }); const list = $("ntList"); if(!cursor) list.innerHTML = ""; if(!r.items.length && !cursor) list.innerHTML = emptyBox("🔔", "You're all caught up.");
            list.insertAdjacentHTML("beforeend", r.items.map(n => `<div class="mo-cm" style="${n.read ? "opacity:.65" : ""}"><div style="flex:1">${notifText(n)}<div class="mo-sub">${timeAgo(n.createdAt)}</div></div></div>`).join("")); cursor = r.next; $("ntMore").innerHTML = cursor ? '<button class="mo-btn" id="ntMoreBtn">Load more</button>' : ""; if(cursor) $("ntMoreBtn").onclick = load; }
        catch(e){ $("ntList").innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; }
    }
    $("ntAll").onclick = async () => { try { await api("POST", "notif-read", { all: true }); me.unread = 0; cursor = null; load(); shell0(); } catch(e){ toast(e.message); } };
    const shell0 = () => { const b = root.querySelector(".mo-badge"); if(b) b.remove(); };
    await load();
}

// ---------------- admin (every call is re-checked on the server) ----------------
function autoCheckHTML(a){
    if(!a) return '<div class="mo-sub">No automated pre-screen on record.</div>';
    const flags = (a.text && a.text.flags || []).map(f => "text: " + f.category + " (" + Math.round(f.confidence * 100) + "%) " + (f.note || "")).concat((a.frames && a.frames.flags || []).map(f => "frames: " + f.category + " (" + Math.round(f.confidence * 100) + "%) " + (f.note || "")));
    return `<div class="mo-note ${a.summary === "flagged" ? "mo-warn" : ""}"><b>Automated pre-screen: ${a.summary === "flagged" ? "⚠ flagged" : "no flags found"}</b> — not a verdict. Frames are supplied by the uploader's browser and can be unrepresentative; a human decision is always required.<br>
      Text check: ${esc(a.text && a.text.status)} · Frame check: ${esc(a.frames && a.frames.status)} (${a.frames ? a.frames.count : 0} frames)
      ${a.secrets && a.secrets.length ? `<br>🔑 Possible credential patterns: ${esc(a.secrets.join(", "))}` : ""}${a.pii && a.pii.length ? `<br>👤 Possible personal info: ${esc(a.pii.join(", "))}` : ""}${flags.length ? "<br>" + flags.map(esc).join("<br>") : ""}</div>`;
}
async function viewAdmin(){
    shell(skeletons(2)); setTitle("Admin"); await loadMe(); shell("");
    if(!me.isAdmin){ $("moMain").innerHTML = emptyBox("🔒", "Administrators only."); return; }
    const TABS = { stats: "Overview", queue: "Review queue", reports: "Reports", appeals: "Appeals", bugs: "Bug reports", channels: "Channels", suspicious: "Suspicious views", rewards: "Rewards", log: "Moderation log" };
    let tab = (location.hash || "#stats").slice(1); if(!TABS[tab]) tab = "stats";
    $("moMain").innerHTML = `<h2>Admin</h2><div class="mo-tabs" role="tablist">${Object.keys(TABS).map(k => `<button class="mo-tab" role="tab" data-t="${k}" aria-selected="${k === tab}">${TABS[k]}</button>`).join("")}</div><div id="adBody">${skeletons(2)}</div>`;
    root.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { history.replaceState({}, "", "#" + b.dataset.t); viewAdmin(); });
    const el = $("adBody");
    const err = e => { el.innerHTML = `<p class="mo-err">${esc(e.message)}</p>`; };
    const reload = () => viewAdmin();
    const act = (sel, fn) => el.querySelectorAll(sel).forEach(b => b.onclick = async () => { try { await fn(b); } catch(e){ toast(e.message); } });
    const catSelect = id => `<select id="${id}" class="mo-in" style="width:auto">${Object.keys(REASONS).map(k => `<option value="${k}">${esc(REASONS[k])}</option>`).join("")}</select>`;
    try {
        if(tab === "stats"){
            const s = await api("GET", "admin-stats");
            el.innerHTML = `<div class="mo-stats">${[["Channels", s.channels], ["Waiting for review", s.videos.pending], ["Held after reports", s.videos.underReview], ["Approved videos", s.videos.approved], ["Rejected", s.videos.rejected], ["Open reports", s.openReports], ["Open appeals", s.openAppeals], ["Suspicious flags", s.suspicious], ["Reward claims", s.pendingClaims], ["Verified views (platform)", s.verifiedViewsPlatform], ["Bugs received", s.bugs.received], ["Bugs investigating", s.bugs.investigating], ["Bugs in progress", s.bugs.in_progress], ["Bugs fixed", s.bugs.fixed]].map(([l, n]) => `<div class="mo-stat"><small>${l}</small><b>${n == null ? "—" : fmtNum(n)}</b></div>`).join("")}</div>`;
        } else if(tab === "queue" || tab === "appeals"){
            const r = await api("GET", tab === "queue" ? "admin-queue" : "admin-appeals");
            el.innerHTML = r.items.length ? r.items.map(v => `<div class="mo-panel mo-form" data-v="${esc(v.id)}"><div class="mo-row" style="align-items:flex-start">${v.thumbUrl ? `<img src="${esc(v.thumbUrl)}" alt="" style="width:200px;border-radius:12px">` : ""}<div style="flex:1;min-width:220px"><h3 style="margin:0">${esc(v.title)}</h3><div class="mo-sub">@${esc(v.channel.handle)} · strikes: ${v.channel.strikes} · ${esc(v.visibility)} · ${fmtDur(v.durationSec)} · ${timeAgo(v.submittedAt)} ${v.reportCount ? `· <b>${v.reportCount} reports</b>` : ""}</div><p style="white-space:pre-wrap">${esc(v.description)}</p>${v.rejection ? `<div class="mo-sub">Rejected: ${esc(v.rejection.category)} — ${esc(v.rejection.reason)}</div>` : ""}${v.appeal ? `<div class="mo-note"><b>Creator's appeal:</b> ${esc(v.appeal.text)}</div>` : ""}</div></div>${autoCheckHTML(v.autoCheck)}<div class="slot"></div>
              <div class="mo-row"><button class="mo-btn" data-watch="${esc(v.id)}">▶ Watch</button>${tab === "queue" ? `<button class="mo-btn pri" data-ok="${esc(v.id)}">Approve</button>` : `<button class="mo-btn pri" data-ov="${esc(v.id)}">Overturn (approve)</button><button class="mo-btn danger" data-up="${esc(v.id)}">Uphold rejection</button>`}</div>
              ${tab === "queue" ? `<details style="margin-top:10px"><summary class="mo-btn" style="display:inline-flex">Reject…</summary><label>Category</label>${catSelect("rc" + v.id)}<label>Reason shown to the creator</label><textarea id="rr${esc(v.id)}"></textarea><label class="mo-check"><input type="checkbox" id="rs${esc(v.id)}" checked><span>Count as a strike</span></label><button class="mo-btn danger" data-rej="${esc(v.id)}">Reject video</button></details>` : `<label>Note to the creator</label><input class="mo-in" id="an${esc(v.id)}" maxlength="500">`}</div>`).join("") : emptyBox("✅", "Nothing waiting.");
            act("[data-watch]", async b => { const r = await api("GET", "admin-video", { id: b.dataset.watch }); b.closest("[data-v]").querySelector(".slot").innerHTML = r.videoUrl ? `<video class="mo-player" controls playsinline preload="metadata" src="${esc(r.videoUrl)}"></video>` : "<p class='mo-err'>No video file.</p>"; });
            act("[data-ok]", async b => { await api("POST", "admin-decide", { id: b.dataset.ok, decision: "approve" }); reload(); });
            act("[data-rej]", async b => { const id = b.dataset.rej; await api("POST", "admin-decide", { id, decision: "reject", category: $("rc" + id).value, reason: $("rr" + id).value, countsAsStrike: $("rs" + id).checked }); reload(); });
            act("[data-ov]", async b => { await api("POST", "admin-appeal-decide", { id: b.dataset.ov, decision: "overturn", note: $("an" + b.dataset.ov).value }); reload(); });
            act("[data-up]", async b => { await api("POST", "admin-appeal-decide", { id: b.dataset.up, decision: "uphold", note: $("an" + b.dataset.up).value }); reload(); });
        } else if(tab === "reports"){
            const r = await api("GET", "admin-reports");
            el.innerHTML = r.items.length ? r.items.map(x => `<div class="mo-panel"><b>${esc(x.targetType)}</b> · ${esc(REASONS[x.reason] || x.reason)} · ${timeAgo(x.createdAt)}<div class="mo-sub">${esc(x.target.title || x.target.text || (x.target.handle ? "@" + x.target.handle : x.targetId))}</div>${x.details ? `<p>${esc(x.details)}</p>` : ""}<div class="mo-row">${x.targetType === "video" ? `<a class="mo-btn" href="/moments/watch/${esc(x.targetId)}" data-go>Open</a>` : ""}<button class="mo-btn" data-dis="${esc(x.id)}">Dismiss</button><button class="mo-btn danger" data-rm="${esc(x.id)}">Remove / suspend</button></div></div>`).join("") : emptyBox("✅", "No open reports.");
            act("[data-dis]", async b => { await api("POST", "admin-report-resolve", { id: b.dataset.dis, resolution: "dismiss" }); reload(); });
            act("[data-rm]", async b => { const note = prompt("Reason (shown to the creator for videos):", "") ; if(note === null) return; await api("POST", "admin-report-resolve", { id: b.dataset.rm, resolution: "remove", note }); reload(); });
        } else if(tab === "bugs"){
            const r = await api("GET", "admin-bugs");
            el.innerHTML = `<div class="mo-table-wrap"><table class="mo-table"><tbody>${r.items.map(b => `<tr><td><b>${esc(b.title)}</b><div class="mo-sub">${timeAgo(b.createdAt)}${b.hasRecording ? " · 🎥" : ""}</div></td><td><span class="mo-pill ${esc(b.status)}">${esc(b.status.replace("_", " "))}</span></td><td><button class="mo-btn" data-bug="${esc(b.id)}">Open</button></td></tr>`).join("") || "<tr><td>No reports.</td></tr>"}</tbody></table></div><div id="bugDetail"></div>`;
            act("[data-bug]", async b => { const d = await api("GET", "admin-bug", { id: b.dataset.bug }); const x = d.bug;
                $("bugDetail").innerHTML = `<div class="mo-panel mo-form"><h3>${esc(x.title)}</h3><p style="white-space:pre-wrap">${esc(x.description)}</p>${x.steps ? `<h4>Steps</h4><p style="white-space:pre-wrap">${esc(x.steps)}</p>` : ""}<div class="mo-sub">Device: ${esc(Object.values(x.device || {}).filter(Boolean).join(" · "))}</div>${d.recordingUrl ? `<video class="mo-player" controls playsinline preload="metadata" src="${esc(d.recordingUrl)}"></video>` : ""}
                  <label>Status</label><select id="bgS" class="mo-in">${["received", "investigating", "in_progress", "fixed", "closed"].map(s => `<option ${s === x.status ? "selected" : ""} value="${s}">${s.replace("_", " ")}</option>`).join("")}</select><label>Note to the reporter (optional)</label><input class="mo-in" id="bgN" maxlength="500"><div class="mo-row" style="margin-top:10px"><button class="mo-btn pri" id="bgSave">Update status</button></div><div class="mo-sub">History: ${(x.history || []).map(h => esc(h.status) + " (" + timeAgo(h.at) + ")").join(" → ")}</div></div>`;
                $("bgSave").onclick = async () => { try { await api("POST", "admin-bug-update", { id: x.id, status: $("bgS").value, note: $("bgN").value }); toast("Updated"); reload(); } catch(e){ toast(e.message); } }; });
        } else if(tab === "channels"){
            const q = (window.__moChQ || "");
            const r = await api("GET", "admin-channels", { q });
            el.innerHTML = `<div class="mo-row"><input class="mo-in" id="chQ" placeholder="Search handle prefix" value="${esc(q)}" style="max-width:260px"><button class="mo-btn" id="chS">Search</button></div><div class="mo-table-wrap"><table class="mo-table"><tbody>${r.items.map(c => `<tr><td><a href="/moments/c/${esc(c.handle)}" data-go><b>${esc(c.name)}</b></a><div class="mo-sub">@${esc(c.handle)}</div></td><td>${fmtNum(c.subscribers)} subs · ${fmtNum(c.verifiedViews)} verified</td><td>${c.strikes} strikes${c.rewardHold ? " · reward hold" : ""}${c.suspended ? ' · <b class="mo-err">suspended</b>' : ""}</td><td><button class="mo-btn ${c.suspended ? "" : "danger"}" data-sus="${esc(c.id)}" data-to="${c.suspended ? "0" : "1"}">${c.suspended ? "Restore" : "Suspend"}</button></td></tr>`).join("")}</tbody></table></div>`;
            $("chS").onclick = () => { window.__moChQ = $("chQ").value; reload(); };
            act("[data-sus]", async b => { const on = b.dataset.to === "1"; const reason = on ? prompt("Reason for suspension:", "") : ""; if(on && reason === null) return; await api("POST", "admin-channel-set", { id: b.dataset.sus, suspended: on, reason }); reload(); });
        } else if(tab === "suspicious"){
            const r = await api("GET", "admin-suspicious");
            el.innerHTML = r.items.length ? r.items.map(x => `<div class="mo-panel"><b>${esc(x.type === "spike" ? "Burst of verified views" : "Many accounts on one network")}</b> · ${timeAgo(x.createdAt)}<div class="mo-sub">Video <a href="/moments/watch/${esc(x.videoId)}" data-go>${esc(x.videoId)}</a>${x.count ? " · " + x.count + " in one hour" : ""}</div><p>${esc(x.note || "")}</p><div class="mo-row"><button class="mo-btn" data-dis="${esc(x.id)}">Dismiss</button><input class="mo-in" id="in${esc(x.id)}" type="number" min="1" value="1" style="width:90px" aria-label="Views to invalidate"><button class="mo-btn danger" data-inv="${esc(x.id)}">Invalidate views + hold rewards</button></div></div>`).join("") : emptyBox("✅", "Nothing suspicious flagged.");
            act("[data-dis]", async b => { await api("POST", "admin-suspicious-resolve", { id: b.dataset.dis, resolution: "dismiss" }); reload(); });
            act("[data-inv]", async b => { await api("POST", "admin-suspicious-resolve", { id: b.dataset.inv, resolution: "invalidate", count: Number($("in" + b.dataset.inv).value) || 1 }); reload(); });
        } else if(tab === "rewards"){
            const [c, cfg] = await Promise.all([api("GET", "admin-claims"), api("GET", "admin-rewards-config")]);
            el.innerHTML = `<h3>Pending reward claims</h3>${c.items.length ? c.items.map(x => `<div class="mo-panel mo-form"><b>${esc(x.title)}</b> → ${esc(x.reward.label || x.reward.value)} <div class="mo-sub">@${esc(x.channel.handle)} · ${fmtNum(x.channel.verifiedViews)} verified views · ${x.channel.strikes} strikes${x.channel.rewardHold ? " · HOLD" : ""}</div>
              ${x.problemsExcludingOriginality.length ? `<div class="mo-note mo-warn">Not eligible now: ${esc(x.problemsExcludingOriginality.join(" "))}</div>` : '<div class="mo-note">Automatic checks pass. Confirm originality yourself before approving.</div>'}
              <label class="mo-check"><input type="checkbox" id="og${esc(x.id)}"><span>I checked that this channel's content is original (not copied or stolen) and follows the guidelines.</span></label><input class="mo-in" id="cn${esc(x.id)}" placeholder="Note (optional)" maxlength="300"><div class="mo-row" style="margin-top:10px"><button class="mo-btn pri" data-ap="${esc(x.id)}">Approve</button><button class="mo-btn danger" data-dn="${esc(x.id)}">Deny</button></div></div>`).join("") : '<p class="mo-sub">None.</p>'}
              <h3>Milestones & eligibility (editable JSON)</h3><div class="mo-note">Types: badge, decoration, ultra_days (value = days), premium_access, gift, recognition (these last three are fulfilled manually). Metrics: verifiedViews, subscribers, videos, likes.</div><textarea id="cfgT" class="mo-in" style="min-height:300px;font-family:monospace">${esc(JSON.stringify(cfg.config, null, 2))}</textarea><div class="mo-err" id="cfgE"></div><button class="mo-btn pri" id="cfgS">Save configuration</button>`;
            act("[data-ap]", async b => { const id = b.dataset.ap; await api("POST", "admin-claim-decide", { id, decision: "approve", originalityConfirmed: $("og" + id).checked, note: $("cn" + id).value }); reload(); });
            act("[data-dn]", async b => { const id = b.dataset.dn; await api("POST", "admin-claim-decide", { id, decision: "deny", note: $("cn" + id).value }); reload(); });
            $("cfgS").onclick = async () => { try { await api("POST", "admin-rewards-config-set", { config: JSON.parse($("cfgT").value) }); toast("Saved"); $("cfgE").textContent = ""; } catch(e){ $("cfgE").textContent = e.message; } };
        } else if(tab === "log"){
            const r = await api("GET", "admin-moderation-log");
            el.innerHTML = `<div class="mo-table-wrap"><table class="mo-table"><thead><tr><th>When</th><th>Decision</th><th>Source</th><th>Details</th></tr></thead><tbody>${r.items.map(x => `<tr><td>${new Date(x.at).toLocaleString()}</td><td>${esc(x.decision)}</td><td>${esc(x.source || "")}</td><td>${esc([x.category, x.reason, x.videoId && "video " + x.videoId, x.channelId && "channel " + x.channelId].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table></div>`;
        }
    } catch(e){ err(e); }
}

// ---------------- routing ----------------
function render(){
    if(cleanup){ try { cleanup(); } catch(e){} cleanup = null; }
    ensureView(); root = $("moRoot"); if(!root) return;
    const tok = ++renderToken;
    const parts = location.pathname.replace(/^\/+|\/+$/g, "").split("/").slice(1);
    root.innerHTML = '<div class="mo-skel" style="margin-top:20px"></div>';
    loadMe().then(() => {
        if(tok !== renderToken) return;
        const [a, b] = parts;
        if(!a) return viewHome();
        if(a === "watch" && b) return viewWatch(b);
        if(a === "c" && b) return viewChannel(b);
        if(a === "studio") return viewStudio();
        if(a === "upload") return viewUpload();
        if(a === "bugs") return viewBugs();
        if(a === "notifications") return viewNotifications();
        if(a === "create-channel") return viewCreateChannel();
        if(a === "admin") return viewAdmin();
        return viewHome();
    });
}
function openView(){
    ensureView();
    if(typeof showPageView === "function") showPageView("moments");
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const nb = $("navMoments"); if(nb) nb.classList.add("active");
    if(typeof closeSidebarMobile === "function") closeSidebarMobile();
}
function route(slug){
    if(slug !== "moments") return false;
    openView(); render(); return true;
}

// links inside Moments navigate without a page reload
document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("#momentsView a[data-go], .mo-dialog-bg a[data-go]");
    if(!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault(); const bg = a.closest(".mo-dialog-bg"); if(bg) bg.remove(); go(a.getAttribute("href"));
});
document.addEventListener("click", e => {
    if(e.target.closest && e.target.closest("#navMoments")){ openView(); go("/moments"); }
});
// stop playback/timers when the user leaves Moments via the sidebar
function watchActive(){
    const v = $("momentsView"); if(!v || v.__mo) return; v.__mo = true;
    new MutationObserver(() => { if(!v.classList.contains("active") && cleanup){ try { cleanup(); } catch(e){} cleanup = null; } }).observe(v, { attributes: true, attributeFilter: ["class"] });
}
function hookAuth(){
    if(typeof activeAuth !== "function"){ setTimeout(hookAuth, 800); return; }
    try { activeAuth().onAuthStateChanged(() => { me = null; const v = $("momentsView"); if(v && v.classList.contains("active")) render(); }); } catch(e){ setTimeout(hookAuth, 1500); }
}
ensureView(); watchActive(); hookAuth();
window.ZyntraMoments = { route, open: () => { openView(); go("/moments"); } };
})();

// ===== ZYNTRA MOMENTS END =====
