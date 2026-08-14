// ==========================
// Zyntra AI — main script
// ==========================

// ---------- Helpers ----------

const CODE_FILE_MAP = {
    html: { filename: "index.html", label: "HTML" },
    css: { filename: "style.css", label: "CSS" },
    js: { filename: "script.js", label: "JS" },
    javascript: { filename: "script.js", label: "JavaScript" },
    jsx: { filename: "component.jsx", label: "JSX" },
    ts: { filename: "script.ts", label: "TypeScript" },
    tsx: { filename: "component.tsx", label: "TSX" },
    python: { filename: "script.py", label: "Python" },
    py: { filename: "script.py", label: "Python" },
    json: { filename: "data.json", label: "JSON" },
    java: { filename: "Main.java", label: "Java" },
    cpp: { filename: "main.cpp", label: "C++" },
    c: { filename: "main.c", label: "C" },
    sql: { filename: "query.sql", label: "SQL" },
    php: { filename: "index.php", label: "PHP" },
    bash: { filename: "script.sh", label: "Bash" },
    sh: { filename: "script.sh", label: "Shell" },
    yaml: { filename: "config.yaml", label: "YAML" },
    xml: { filename: "data.xml", label: "XML" }
};

function encodeCodeForCard(code){
    return btoa(unescape(encodeURIComponent(code)));
}

function extractCodeBlocks(text){
    const blocks = [];
    let index = 0;
    const withPlaceholders = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const key = (lang || "").toLowerCase();
        const meta = CODE_FILE_MAP[key] || { filename: "code.txt", label: key ? key.toUpperCase() : "TEXT" };
        const id = "codeblock-" + Date.now() + "-" + (index++);
        blocks.push({ id, filename: meta.filename, label: meta.label, code: code.trim() });
        return "\n%%" + id + "%%\n";
    });
    return { withPlaceholders, blocks };
}

function escapeForDisplay(code){
    return code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function buildFileCardHTML(block){
    const encoded = encodeCodeForCard(block.code);
    return `
        <div class="file-card">
            <div class="file-card-header">
                <div class="file-card-icon">&lt;/&gt;</div>
                <div class="file-card-info">
                    <p class="file-card-title">${block.filename}</p>
                    <p class="file-card-sub">Code · ${block.label}</p>
                </div>
                <span class="file-card-chevron">▾</span>
                <button class="filecard-download-btn" data-filename="${block.filename}" data-code="${encoded}">Download</button>
            </div>
            <div class="file-card-preview">
                <div class="file-card-preview-top">
                    <span>${block.filename}</span>
                    <button class="filecard-copy-btn" data-code="${encoded}">📋 Copy</button>
                </div>
                <pre><code>${escapeForDisplay(block.code)}</code></pre>
            </div>
        </div>
    `;
}

document.addEventListener("click", (e) => {
    const downloadBtn = e.target.closest(".filecard-download-btn");
    if(downloadBtn){
        try{
            const code = decodeURIComponent(escape(atob(downloadBtn.dataset.code)));
            const blob = new Blob([code], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = downloadBtn.dataset.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }catch(err){
            alert("Could not download the file.");
        }
        return;
    }

    const copyBtn = e.target.closest(".filecard-copy-btn");
    if(copyBtn){
        try{
            const code = decodeURIComponent(escape(atob(copyBtn.dataset.code)));
            navigator.clipboard.writeText(code).then(() => {
                const original = copyBtn.textContent;
                copyBtn.textContent = "✅ Copied";
                setTimeout(() => { copyBtn.textContent = original; }, 1500);
            });
        }catch(err){}
        return;
    }

    const header = e.target.closest(".file-card-header");
    if(header){
        header.closest(".file-card").classList.toggle("open");
    }
});

function formatAIText(text){
    const { withPlaceholders, blocks } = extractCodeBlocks(text);

    let safe = withPlaceholders
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");

    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    const lines = safe.split(/\n+/).filter(l => l.trim() !== "");
    let html = "";
    let inList = false;
    let listType = null; // "ul" or "ol"

    function closeList(){
        if(inList){
            html += listType === "ol" ? "</ol>" : "</ul>";
            inList = false;
            listType = null;
        }
    }

    function isTableRow(line){
        return /^\|.*\|$/.test(line.trim());
    }
    function isTableSeparator(line){
        return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
    }
    function parseTableRow(line){
        return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    }

    let i = 0;
    while(i < lines.length){
        const trimmed = lines[i].trim();

        // Horizontal rule (---)
        if(/^-{3,}$/.test(trimmed)){
            closeList();
            html += "<hr>";
            i++;
            continue;
        }

        // Markdown table
        if(isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])){
            closeList();
            const headerCells = parseTableRow(trimmed);
            let tableHtml = "<div class=\"table-wrap\"><table><thead><tr>"
                + headerCells.map(c => "<th>" + c + "</th>").join("")
                + "</tr></thead><tbody>";
            i += 2;
            while(i < lines.length && isTableRow(lines[i].trim())){
                const rowCells = parseTableRow(lines[i].trim());
                tableHtml += "<tr>" + rowCells.map(c => "<td>" + c + "</td>").join("") + "</tr>";
                i++;
            }
            tableHtml += "</tbody></table></div>";
            html += tableHtml;
            continue;
        }

        const headerMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
        const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
        const bulletMatch = /^[-*•]\s+/.test(trimmed);

        if(headerMatch){
            closeList();
            html += "<h4>" + headerMatch[1] + "</h4>";
        } else if(numberedMatch){
            if(inList && listType !== "ol") closeList();
            if(!inList){ html += "<ol>"; inList = true; listType = "ol"; }
            html += "<li>" + numberedMatch[2] + "</li>";
        } else if(bulletMatch){
            if(inList && listType !== "ul") closeList();
            if(!inList){ html += "<ul>"; inList = true; listType = "ul"; }
            html += "<li>" + trimmed.replace(/^[-*•]\s+/, "") + "</li>";
        } else {
            closeList();
            html += "<p>" + trimmed + "</p>";
        }
        i++;
    }
    closeList();
    if(!html) html = "<p>" + safe + "</p>";

    blocks.forEach(block => {
        const placeholder = "%%" + block.id + "%%";
        html = html.replace("<p>" + placeholder + "</p>", buildFileCardHTML(block));
        html = html.replace(placeholder, buildFileCardHTML(block));
    });

    return html;
}

const FREE_MESSAGE_LIMIT = 10;
const LOCKOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

function getChatUsage(){
    return JSON.parse(localStorage.getItem("zyntra-chat-usage") || '{"count":0,"lockoutUntil":0}');
}

function saveChatUsage(usage){
    localStorage.setItem("zyntra-chat-usage", JSON.stringify(usage));
}

function isLockedOut(){
    return getChatUsage().lockoutUntil > Date.now();
}

function recordFreeMessage(){
    const usage = getChatUsage();
    usage.count = (usage.count || 0) + 1;
    if(usage.count >= FREE_MESSAGE_LIMIT){
        usage.lockoutUntil = Date.now() + LOCKOUT_MS;
        usage.count = 0;
    }
    saveChatUsage(usage);
}

let lockCountdownInterval = null;

function formatCountdown(ms){
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function showChatLockedModal(){
    openModal("chatLockedModal");

    const countdownEl = document.getElementById("lockCountdown");

    function tick(){
        const usage = getChatUsage();
        const remaining = usage.lockoutUntil - Date.now();
        if(remaining <= 0){
            countdownEl.textContent = "00:00:00";
            clearInterval(lockCountdownInterval);
            saveChatUsage({ count: 0, lockoutUntil: 0 });
            closeModal("chatLockedModal");
            return;
        }
        countdownEl.textContent = formatCountdown(remaining);
    }

    tick();
    clearInterval(lockCountdownInterval);
    lockCountdownInterval = setInterval(tick, 1000);
}

document.getElementById("lockUpgradeBtn")?.addEventListener("click", () => {
    closeModal("chatLockedModal");
    if(!isLoggedIn()){
        document.getElementById("signinContext").style.display = "none";
        openModal("signinModal");
    } else {
        openModal("pricingModal");
    }
});

document.getElementById("lockWatchAdBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("lockWatchAdBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "🎬 Watching ad...";
    setTimeout(() => {
        saveChatUsage({ count: 0, lockoutUntil: 0 });
        clearInterval(lockCountdownInterval);
        closeModal("chatLockedModal");
        btn.textContent = original;
        btn.disabled = false;
    }, 3000);
});

function typeOutText(el, fullText, scrollContainer, onDone){
    const words = fullText.split(" ");
    const speed = isPro() ? 8 : 25;
    let i = 0;

    function step(){
        i++;
        const isLast = i >= words.length;
        el.innerHTML = formatAIText(isLast ? fullText : words.slice(0, i).join(" "));
        if(scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        if(!isLast){
            setTimeout(step, speed);
        } else if(onDone){
            onDone();
        }
    }
    step();
}

function addCopyButton(container, textToCopy){
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "📋 Copy";
    btn.addEventListener("click", () => {
        navigator.clipboard.writeText(textToCopy).then(() => {
            btn.textContent = "✅ Copied";
            setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
        });
    });
    container.appendChild(btn);
}

function addReportButton(container, contentToReport){
    const btn = document.createElement("button");
    btn.className = "copy-btn report-btn";
    btn.textContent = "🚩 Report";
    btn.addEventListener("click", () => {
        openModal("contactModal");
        const msgBox = document.getElementById("contactMsg");
        msgBox.value = 'Reporting AI-generated content:\n\n"' + contentToReport + '"\n\nReason: ';
        msgBox.focus();
    });
    container.appendChild(btn);
}

const MSG_ICONS = {
    copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    feedback: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path></svg>',
    share: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>'
};

function addMessageActionBar(container, text){
    const bar = document.createElement("div");
    bar.className = "msg-actions";

    // ---- Copy ----
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.title = "Copy";
    copyBtn.innerHTML = MSG_ICONS.copy;
    copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.innerHTML = MSG_ICONS.check;
            setTimeout(() => { copyBtn.innerHTML = MSG_ICONS.copy; }, 1200);
        });
    });
    bar.appendChild(copyBtn);

    // ---- Feedback (single button, opens a small good/bad menu) ----
    const feedbackWrap = document.createElement("div");
    feedbackWrap.className = "msg-feedback-wrap";

    const feedbackBtn = document.createElement("button");
    feedbackBtn.className = "msg-action-btn";
    feedbackBtn.title = "Feedback";
    feedbackBtn.innerHTML = MSG_ICONS.feedback;

    const feedbackMenu = document.createElement("div");
    feedbackMenu.className = "msg-feedback-menu";

    const goodOpt = document.createElement("button");
    goodOpt.className = "msg-feedback-option";
    goodOpt.textContent = "👍 Good response";

    const badOpt = document.createElement("button");
    badOpt.className = "msg-feedback-option";
    badOpt.textContent = "👎 Needs improvement";

    goodOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        feedbackMenu.classList.remove("show");
        feedbackBtn.classList.add("active");
        showToast("Thanks for the feedback!");
    });

    badOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        feedbackMenu.classList.remove("show");
        feedbackBtn.classList.add("active");
        openModal("contactModal");
        const msgBox = document.getElementById("contactMsg");
        msgBox.value = 'Reporting AI-generated content:\n\n"' + text + '"\n\nReason: ';
        msgBox.focus();
    });

    feedbackBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = feedbackMenu.classList.contains("show");
        document.querySelectorAll(".msg-feedback-menu.show").forEach(m => m.classList.remove("show"));
        if(!wasOpen) feedbackMenu.classList.add("show");
    });

    feedbackMenu.appendChild(goodOpt);
    feedbackMenu.appendChild(badOpt);
    feedbackWrap.appendChild(feedbackBtn);
    feedbackWrap.appendChild(feedbackMenu);
    bar.appendChild(feedbackWrap);

    // ---- Share ----
    const shareBtn = document.createElement("button");
    shareBtn.className = "msg-action-btn";
    shareBtn.title = "Share";
    shareBtn.innerHTML = MSG_ICONS.share;
    shareBtn.addEventListener("click", async () => {
        if(navigator.share){
            try{ await navigator.share({ text }); }catch(err){ /* user cancelled */ }
        } else {
            navigator.clipboard.writeText(text).then(() => showToast("📋 Copied to clipboard"));
        }
    });
    bar.appendChild(shareBtn);

    container.appendChild(bar);
    return bar;
}

document.addEventListener("click", () => {
    document.querySelectorAll(".msg-feedback-menu.show").forEach(m => m.classList.remove("show"));
});

async function callChatAPI(messages){
    const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Request failed");
    return data.choices[0].message.content;
}

// ---------- Generic modal open/close ----------

function openModal(id){
    document.getElementById(id).classList.add("show");
}
function closeModal(id){
    document.getElementById(id).classList.remove("show");
}

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
        if(e.target === overlay) overlay.classList.remove("show");
    });
});

document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
        document.querySelectorAll(".modal-overlay.show").forEach(m => m.classList.remove("show"));
        closeSidebarMobile();
    }
});

// ---------- About modal ----------

document.getElementById("aboutBtn")?.addEventListener("click", e => { e.preventDefault(); openModal("aboutModal"); });
document.getElementById("aboutClose")?.addEventListener("click", () => closeModal("aboutModal"));

// ---------- Privacy Policy modal ----------

document.getElementById("privacyBtn")?.addEventListener("click", e => {
    e.preventDefault();
    openModal("privacyModal");
});
document.getElementById("privacyModalClose")?.addEventListener("click", () => closeModal("privacyModal"));

if(window.location.hash === "#privacy"){
    openModal("privacyModal");
}

// ---------- Pricing / Stripe checkout ----------

const PRO_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 1 month

function getProRecord(email){
    const accounts = JSON.parse(localStorage.getItem("zyntra-pro-accounts") || "{}");
    return accounts[email] || null;
}

function saveProRecord(email, record){
    const accounts = JSON.parse(localStorage.getItem("zyntra-pro-accounts") || "{}");
    accounts[email] = record;
    localStorage.setItem("zyntra-pro-accounts", JSON.stringify(accounts));
}

function markCurrentUserPro(){
    const email = localStorage.getItem("zyntra-user");
    if(!email) return;
    saveProRecord(email, { purchasedAt: Date.now(), notified: false });
}

function isPro(){
    const email = localStorage.getItem("zyntra-user");
    if(!email) return false;
    const record = getProRecord(email);
    if(!record) return false;
    return (Date.now() - record.purchasedAt) < PRO_DURATION_MS;
}

function checkProExpiry(){
    const email = localStorage.getItem("zyntra-user");
    if(!email) return;
    const record = getProRecord(email);
    if(!record) return;
    const expired = (Date.now() - record.purchasedAt) >= PRO_DURATION_MS;
    if(expired && !record.notified){
        record.notified = true;
        saveProRecord(email, record);
        openModal("proExpiredModal");
    }
}

document.getElementById("proExpiredOkBtn")?.addEventListener("click", () => {
    closeModal("proExpiredModal");
    renderPlanUI();
    openModal("pricingModal");
});

function isRunningInApp(){
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const isTwaReferrer = document.referrer.startsWith("android-app://");
    return isStandalone || isTwaReferrer;
}

let adBannerLoaded = false;

function loadAdBanner(){
    if(adBannerLoaded) return;
    try{
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        adBannerLoaded = true;
    }catch(err){
        // AdSense script blocked (ad blocker) or not yet approved — fail silently
    }
}

function renderPlanUI(){
    const badge = document.getElementById("proBadge");
    const getProBtn = document.getElementById("getProBtn");
    const adBanner = document.getElementById("adBanner");
    const twaNotice = document.getElementById("twaBuyNotice");
    const topUpgradeBtn = document.getElementById("topUpgradeBtn");
    const sidebarUpgradeCard = document.getElementById("sidebarUpgradeCard");

    if(isPro()){
        badge.style.display = "inline";
        getProBtn.textContent = "You're on Pro ✓";
        getProBtn.disabled = true;
        getProBtn.style.opacity = "0.7";
        getProBtn.style.cursor = "default";
        if(adBanner) adBanner.style.display = "none";
        if(twaNotice) twaNotice.style.display = "none";
        if(topUpgradeBtn) topUpgradeBtn.style.display = "none";
        if(sidebarUpgradeCard) sidebarUpgradeCard.style.display = "none";
    } else if(isRunningInApp()){
        badge.style.display = "none";
        getProBtn.textContent = "Purchase Unavailable Here";
        getProBtn.disabled = true;
        getProBtn.style.opacity = "0.5";
        getProBtn.style.cursor = "default";
        if(adBanner){ adBanner.style.display = "block"; loadAdBanner(); }
        if(twaNotice) twaNotice.style.display = "block";
        if(topUpgradeBtn) topUpgradeBtn.style.display = "";
        if(sidebarUpgradeCard) sidebarUpgradeCard.style.display = "";
    } else {
        badge.style.display = "none";
        getProBtn.textContent = isLoggedIn() ? "Get Pro" : "Sign In to Upgrade";
        getProBtn.disabled = false;
        getProBtn.style.opacity = "1";
        getProBtn.style.cursor = "pointer";
        if(adBanner){ adBanner.style.display = "block"; loadAdBanner(); }
        if(twaNotice) twaNotice.style.display = "none";
        if(topUpgradeBtn) topUpgradeBtn.style.display = "";
        if(sidebarUpgradeCard) sidebarUpgradeCard.style.display = "";
    }
}

["topUpgradeBtn", "sidebarUpgradeBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => {
        e.preventDefault();
        openModal("pricingModal");
        closeSidebarMobile();
    });
});

document.getElementById("pricingModalClose")?.addEventListener("click", () => closeModal("pricingModal"));

document.getElementById("getProBtn")?.addEventListener("click", async () => {
    if(isPro()) return;

    if(isRunningInApp()){
        return;
    }

    if(!isLoggedIn()){
        closeModal("pricingModal");
        document.getElementById("signinContext").style.display = "block";
        resetSigninModalUI(); openModal("signinModal");
        return;
    }

    const btn = document.getElementById("getProBtn");
    const original = btn.textContent;
    btn.textContent = "Redirecting to Stripe...";
    btn.disabled = true;

    try{
        const res = await fetch("/api/checkout", { method: "POST" });
        const data = await res.json();
        if(data.url){
            window.location.href = data.url;
        } else {
            alert("Could not start checkout. Please try again.");
            btn.textContent = original;
            btn.disabled = false;
        }
    }catch(err){
        alert("Could not start checkout. Please try again.");
        btn.textContent = original;
        btn.disabled = false;
    }
});

const urlParams = new URLSearchParams(window.location.search);
if(urlParams.get("payment") === "success"){
    markCurrentUserPro();
    alert("🎉 Payment successful! You're now on Zyntra AI Pro.");
    window.history.replaceState({}, "", window.location.pathname);
    openModal("pricingModal");
} else if(urlParams.get("payment") === "cancelled"){
    window.history.replaceState({}, "", window.location.pathname);
}

renderPlanUI();

document.getElementById("contactBtn")?.addEventListener("click", e => { e.preventDefault(); openModal("contactModal"); closeSidebarMobile(); });
document.getElementById("contactModalClose")?.addEventListener("click", () => closeModal("contactModal"));
document.getElementById("contactSubmit")?.addEventListener("click", async () => {
    const name = document.getElementById("contactName").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const msg = document.getElementById("contactMsg").value.trim();
    if(!name || !email || !msg){
        alert("Please fill in all fields.");
        return;
    }

    const btn = document.getElementById("contactSubmit");
    const originalText = btn.textContent;
    btn.textContent = "Sending...";
    btn.disabled = true;

    try{
        const res = await fetch("https://formspree.io/f/xbdnvlkg", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                email,
                message: (isPro() ? "[PRIORITY - PRO USER]\n\n" : "") + msg
            })
        });

        if(res.ok){
            alert("Thanks " + name + "! Your message has been sent.");
            document.getElementById("contactName").value = "";
            document.getElementById("contactEmail").value = "";
            document.getElementById("contactMsg").value = "";
            closeModal("contactModal");
        } else {
            alert("Something went wrong sending your message. Please try again.");
        }
    }catch(err){
        alert("Something went wrong sending your message. Please try again.");
    }

    btn.textContent = originalText;
    btn.disabled = false;
});

// ---------- Live stats (kept running in the background, no UI display) ----------

const STAT_NAMESPACE = "zyntra-ai-ghanchimoin";

async function bumpStat(key){
    try{
        await fetch(`https://api.countapi.xyz/hit/${STAT_NAMESPACE}/${key}`);
    }catch(err){
        // ignore
    }
}

if(!localStorage.getItem("zyntra-visited")){
    localStorage.setItem("zyntra-visited", "1");
    bumpStat("users");
}

// ---------- Splash screen ----------

function hideSplashScreen(){
    setTimeout(() => {
        const splash = document.getElementById("splashScreen");
        if(splash) splash.classList.add("hide");
    }, 900);
}

if(document.readyState === "complete"){
    hideSplashScreen();
} else {
    window.addEventListener("load", hideSplashScreen);
}

// ---------- Install app button ----------

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById("installAppBtn");
    if(btn && !isRunningInApp()) btn.style.display = "block";
});

document.getElementById("installAppBtn")?.addEventListener("click", async () => {
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if(choice.outcome === "accepted"){
        showToast("📥 Installing Zyntra AI...");
    }
    deferredInstallPrompt = null;
    document.getElementById("installAppBtn").style.display = "none";
});

window.addEventListener("appinstalled", () => {
    showToast("✅ Zyntra AI installed!");
    const btn = document.getElementById("installAppBtn");
    if(btn) btn.style.display = "none";
});

function isLoggedIn(){
    return !!localStorage.getItem("zyntra-user");
}

function renderAuthNav(){
    const loggedIn = isLoggedIn();
    const nameEl = document.getElementById("sidebarUserName");
    const planEl = document.getElementById("sidebarUserPlan");
    const avatarEl = document.getElementById("sidebarUserAvatar");
    const topbarAvatar = document.getElementById("topbarProfileBtn");

    if(loggedIn){
        const email = localStorage.getItem("zyntra-user");
        const profile = getProfile();
        const display = (profile.nickname || profile.fullName || email || "Account").trim();
        const letter = display.charAt(0).toUpperCase();
        nameEl.textContent = display;
        planEl.textContent = isPro() ? "Pro Plan" : "Free Plan";
        avatarEl.textContent = letter;
        topbarAvatar.textContent = letter;
    } else {
        nameEl.textContent = "Guest";
        planEl.textContent = "Sign in";
        avatarEl.textContent = "?";
        topbarAvatar.textContent = "👤";
    }
    renderPlanUI();
    checkProExpiry();
}

function handleProfileEntry(){
    if(isLoggedIn()){
        openModal("profileModal");
        renderProfileModal();
    } else {
        document.getElementById("signinContext").style.display = "none";
        resetSigninModalUI();
        openModal("signinModal");
    }
    closeSidebarMobile();
}

document.getElementById("topbarProfileBtn")?.addEventListener("click", handleProfileEntry);
document.getElementById("sidebarUser")?.addEventListener("click", handleProfileEntry);

// ---------- Profile modal ----------

function getProfile(){
    return JSON.parse(localStorage.getItem("zyntra-profile") || "{}");
}

function renderProfileModal(){
    const guestView = document.getElementById("profileGuestView");
    const signedInView = document.getElementById("profileSignedInView");

    if(!isLoggedIn()){
        guestView.style.display = "block";
        signedInView.style.display = "none";
        return;
    }

    guestView.style.display = "none";
    signedInView.style.display = "block";
    renderPinnedChats();

    const email = localStorage.getItem("zyntra-user");
    const profile = getProfile();

    document.getElementById("profileEmailDisplay").textContent = email;
    document.getElementById("profileFullName").value = profile.fullName || "";
    document.getElementById("profileNickname").value = profile.nickname || "";
    document.getElementById("profileWork").value = profile.work || "";
    document.getElementById("profileInstructions").value = profile.instructions || "";

    const letter = (profile.nickname || profile.fullName || email || "?").trim().charAt(0).toUpperCase();
    document.getElementById("profileAvatar").textContent = letter;
}

document.getElementById("profileModalClose")?.addEventListener("click", () => closeModal("profileModal"));

document.getElementById("profileSigninBtn")?.addEventListener("click", () => {
    closeModal("profileModal");
    document.getElementById("signinContext").style.display = "none";
    resetSigninModalUI(); openModal("signinModal");
});

document.getElementById("profileSaveBtn")?.addEventListener("click", () => {
    const profile = {
        fullName: document.getElementById("profileFullName").value.trim(),
        nickname: document.getElementById("profileNickname").value.trim(),
        work: document.getElementById("profileWork").value,
        instructions: document.getElementById("profileInstructions").value.trim()
    };
    localStorage.setItem("zyntra-profile", JSON.stringify(profile));
    renderProfileModal();
    renderAuthNav();

    const btn = document.getElementById("profileSaveBtn");
    const original = btn.textContent;
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById("profileSignoutBtn")?.addEventListener("click", () => {
    closeModal("profileModal");
    openModal("signoutModal");
});

document.getElementById("signoutModalClose")?.addEventListener("click", () => closeModal("signoutModal"));
document.getElementById("signoutCancel")?.addEventListener("click", () => closeModal("signoutModal"));
document.getElementById("signoutConfirm")?.addEventListener("click", () => {
    firebase.auth().signOut().catch(() => {});
    localStorage.removeItem("zyntra-user");
    closeModal("signoutModal");
    renderAuthNav();
    renderSidebarHistory();
});
document.getElementById("signinModalClose")?.addEventListener("click", () => closeModal("signinModal"));
let isSignupMode = false;

function showSigninError(message){
    const errEl = document.getElementById("signinError");
    errEl.textContent = message;
    errEl.style.display = "block";
}

function clearSigninError(){
    document.getElementById("signinError").style.display = "none";
}

function firebaseErrorMessage(code, rawMessage){
    switch(code){
        case "auth/user-not-found":
            return "No account exists with this email.";
        case "auth/wrong-password":
        case "auth/invalid-credential":
            return "Incorrect email or password. If you signed up with Google before, use \"Continue with Google\" instead.";
        case "auth/invalid-email":
            return "Please enter a valid email address.";
        case "auth/email-already-in-use":
            return "An account with this email already exists. Try signing in instead.";
        case "auth/weak-password":
            return "Password should be at least 6 characters.";
        case "auth/too-many-requests":
            return "Too many attempts. Please wait a moment and try again.";
        case "auth/account-exists-with-different-credential":
            return "This email already has a password-based account. Please sign in with your email and password instead of Google.";
        case "auth/popup-closed-by-user":
            return "Sign-in was closed before finishing. Please try again.";
        case "auth/popup-blocked":
            return "Your browser blocked the sign-in popup. Please allow popups for this site and try again.";
        case "auth/cancelled-popup-request":
            return "";
        case "auth/network-request-failed":
            return "Network error. Please check your connection and try again.";
        case "auth/unauthorized-domain":
            return "This domain isn't authorized for sign-in yet. Please contact support.";
        default:
            return "Something went wrong: " + (rawMessage || code || "unknown error") + ". Please try again.";
    }
}

function finishSignin(email, cameFromPro){
    localStorage.setItem("zyntra-user", email);
    document.getElementById("signinEmail").value = "";
    document.getElementById("signinPass").value = "";
    document.getElementById("signinContext").style.display = "none";
    clearSigninError();
    closeModal("signinModal");
    renderAuthNav();
    renderSidebarHistory();
    showToast("✅ You're signed in successfully!");
    if(cameFromPro){
        openModal("pricingModal");
    }
}

function showToast(message){
    let toast = document.getElementById("zyntraToast");
    if(!toast){
        toast = document.createElement("div");
        toast.id = "zyntraToast";
        toast.className = "zyntra-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function resetSigninModalUI(){
    isSignupMode = false;
    clearSigninError();
    document.getElementById("signinTitle").innerHTML = 'Welcome <span>Back</span>';
    document.getElementById("signinSubmit").textContent = "Sign In";
    document.getElementById("signupToggleText").innerHTML = 'Don\'t have an account? <a href="#" id="signupToggleLink" style="color:#c9a8ff; font-weight:600;">Sign up</a>';
    document.getElementById("signupToggleLink").addEventListener("click", handleSignupToggleClick);
}

function handleSignupToggleClick(e){
    e.preventDefault();
    isSignupMode = !isSignupMode;
    clearSigninError();
    document.getElementById("signinTitle").innerHTML = isSignupMode
        ? 'Create <span>Account</span>'
        : 'Welcome <span>Back</span>';
    document.getElementById("signinSubmit").textContent = isSignupMode ? "Sign Up" : "Sign In";
    document.getElementById("signupToggleText").innerHTML = isSignupMode
        ? 'Already have an account? <a href="#" id="signupToggleLink" style="color:#c9a8ff; font-weight:600;">Sign in</a>'
        : 'Don\'t have an account? <a href="#" id="signupToggleLink" style="color:#c9a8ff; font-weight:600;">Sign up</a>';
    document.getElementById("signupToggleLink").addEventListener("click", handleSignupToggleClick);
}
document.getElementById("signupToggleLink")?.addEventListener("click", handleSignupToggleClick);

document.getElementById("signinSubmit")?.addEventListener("click", () => {
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPass").value;
    clearSigninError();

    if(!email || !password){
        showSigninError("Please enter both email and password.");
        return;
    }

    const cameFromPro = document.getElementById("signinContext").style.display !== "none";
    const btn = document.getElementById("signinSubmit");
    const original = btn.textContent;
    btn.textContent = isSignupMode ? "Creating account..." : "Signing in...";
    btn.disabled = true;

    if(!isSignupMode){
        firebase.auth().signInWithEmailAndPassword(email, password)
            .then(userCredential => {
                finishSignin(userCredential.user.email, cameFromPro);
            })
            .catch(err => {
                showSigninError(firebaseErrorMessage(err.code, err.message));
            })
            .finally(() => {
                btn.textContent = original;
                btn.disabled = false;
            });
        return;
    }

    const authAction = firebase.auth().createUserWithEmailAndPassword(email, password);

    authAction
        .then(userCredential => {
            finishSignin(userCredential.user.email, cameFromPro);
        })
        .catch(err => {
            if(err.code === "auth/email-already-in-use"){
                showSigninError("This email already has an account. If you signed up with Google before, use \"Continue with Google\" instead.");
            } else {
                showSigninError(firebaseErrorMessage(err.code, err.message));
            }
        })
        .finally(() => {
            btn.textContent = original;
            btn.disabled = false;
        });
});

function isMobileDevice(){
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

document.getElementById("googleSigninBtn")?.addEventListener("click", () => {
    clearSigninError();
    const cameFromPro = document.getElementById("signinContext").style.display !== "none";
    const provider = new firebase.auth.GoogleAuthProvider();

    if(isMobileDevice()){
        if(cameFromPro){
            sessionStorage.setItem("zyntra-signin-from-pro", "1");
        } else {
            sessionStorage.removeItem("zyntra-signin-from-pro");
        }
        firebase.auth().signInWithRedirect(provider);
        return;
    }

    firebase.auth().signInWithPopup(provider)
        .then(result => {
            finishSignin(result.user.email, cameFromPro);
        })
        .catch(err => {
            const msg = firebaseErrorMessage(err.code, err.message);
            if(msg) showSigninError(msg);
        });
});

// Catch the result when returning from a mobile redirect sign-in
firebase.auth().getRedirectResult()
    .then(result => {
        if(result && result.user){
            const cameFromPro = sessionStorage.getItem("zyntra-signin-from-pro") === "1";
            sessionStorage.removeItem("zyntra-signin-from-pro");
            finishSignin(result.user.email, cameFromPro);
        }
    })
    .catch(err => {
        const msg = firebaseErrorMessage(err.code, err.message);
        if(msg){
            document.getElementById("signinContext").style.display = "none";
            openModal("signinModal");
            showSigninError(msg);
        }
    });

renderAuthNav();

// ---------- Chat history (session based sidebar list) ----------

let currentSessionId = null;

function timeAgo(ts){
    const diff = Math.floor((Date.now() - ts) / 1000);
    if(diff < 60) return "Just now";
    if(diff < 3600) return Math.floor(diff / 60) + "m ago";
    if(diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
}

function getSessions(){
    return JSON.parse(localStorage.getItem("zyntra-sessions") || "[]");
}

function saveSessions(sessions){
    localStorage.setItem("zyntra-sessions", JSON.stringify(sessions));
}

function stripMarkdownForTitle(text){
    return text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim();
}

function logMessageToHistory(role, content){
    if(!isLoggedIn()) return;

    const sessions = getSessions();
    let isNewSession = false;

    if(!currentSessionId){
        currentSessionId = Date.now();
        isNewSession = true;
        const cleanTitle = stripMarkdownForTitle(content);
        sessions.unshift({
            id: currentSessionId,
            title: cleanTitle.length > 40 ? cleanTitle.slice(0, 40) + "…" : cleanTitle,
            time: Date.now(),
            messages: []
        });
    }

    const session = sessions.find(s => s.id === currentSessionId);
    if(session) session.messages.push({ role, content });
    saveSessions(sessions);
    renderSidebarHistory();

    if(isNewSession && role === "user"){
        generateSessionTitle(currentSessionId, content);
    }
}

async function generateSessionTitle(sessionId, firstMessage){
    try{
        const title = await callChatAPI([
            {
                role: "user",
                content: 'Summarize the topic of this message in 3-5 words. No punctuation, no quotes, no markdown, just the topic itself:\n\n"' + firstMessage + '"'
            }
        ]);
        const clean = stripMarkdownForTitle(title).replace(/["'.]/g, "");
        if(!clean) return;

        const sessions = getSessions();
        const session = sessions.find(s => s.id === sessionId);
        if(session){
            session.title = clean.length > 60 ? clean.slice(0, 60) : clean;
            saveSessions(sessions);
            renderSidebarHistory();
        }
    }catch(err){
        // keep the fallback title already saved
    }
}

function renderPinnedChats(){
    const box = document.getElementById("pinnedChatsBox");
    if(!box) return;
    const pinned = getSessions().filter(s => s.pinned);
    box.innerHTML = "";

    if(pinned.length === 0){
        box.innerHTML = '<p class="pinned-empty">No pinned chats yet. Pin a conversation from the sidebar.</p>';
        return;
    }

    pinned.forEach(session => {
        const row = document.createElement("div");
        row.className = "history-row pinned";

        const title = document.createElement("span");
        title.className = "history-row-title";
        title.textContent = session.title;

        const time = document.createElement("span");
        time.className = "history-row-time";
        time.textContent = timeAgo(session.time);

        row.appendChild(title);
        row.appendChild(time);
        box.appendChild(row);

        row.addEventListener("click", () => {
            openSession(session);
            closeModal("profileModal");
        });
    });
}

function buildSidebarHistoryRow(session){
    const row = document.createElement("div");
    row.className = "sidebar-history-row" + (session.pinned ? " pinned" : "");
    row.title = session.title;

    const title = document.createElement("span");
    title.className = "shr-title";
    title.textContent = session.title;

    const pinBtn = document.createElement("button");
    pinBtn.className = "shr-pin";
    pinBtn.textContent = "📌";
    pinBtn.title = session.pinned ? "Unpin" : "Pin";
    pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const all = getSessions();
        const s = all.find(x => x.id === session.id);
        if(s){
            s.pinned = !s.pinned;
            saveSessions(all);
            renderSidebarHistory();
            renderPinnedChats();
        }
    });

    const menuBtn = document.createElement("button");
    menuBtn.className = "shr-menu";
    menuBtn.textContent = "⋮";
    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmAction(
            "Delete This Chat?",
            "Are you sure you want to delete this conversation? This can't be undone.",
            () => {
                const updated = getSessions().filter(s => s.id !== session.id);
                saveSessions(updated);
                if(currentSessionId === session.id) currentSessionId = null;
                renderSidebarHistory();
                renderPinnedChats();
            }
        );
    });

    row.appendChild(title);
    row.appendChild(pinBtn);
    row.appendChild(menuBtn);
    row.addEventListener("click", () => openSession(session));
    return row;
}

function renderSidebarHistory(){
    const list = document.getElementById("sidebarHistoryList");
    const pinnedSection = document.getElementById("sidebarPinnedSection");
    const pinnedList = document.getElementById("sidebarPinnedList");
    if(!list || !pinnedSection || !pinnedList) return;
    list.innerHTML = "";
    pinnedList.innerHTML = "";

    if(!isLoggedIn()){
        list.innerHTML = '<p class="sidebar-history-empty">Sign in to save and revisit your conversations.</p>';
        pinnedSection.style.display = "none";
        return;
    }

    const sessions = getSessions();
    const pinned = sessions.filter(s => s.pinned);
    const unpinned = sessions.filter(s => !s.pinned);

    if(pinned.length > 0){
        pinnedSection.style.display = "";
        pinned.forEach(session => pinnedList.appendChild(buildSidebarHistoryRow(session)));
    } else {
        pinnedSection.style.display = "none";
    }

    if(unpinned.length === 0){
        list.innerHTML = sessions.length === 0
            ? '<p class="sidebar-history-empty">No conversations yet. Start chatting!</p>'
            : '<p class="sidebar-history-empty">All chats are pinned.</p>';
        return;
    }

    unpinned.forEach(session => list.appendChild(buildSidebarHistoryRow(session)));
}

function confirmAction(title, text, onConfirm){
    document.getElementById("confirmActionTitle").innerHTML = title;
    document.getElementById("confirmActionText").textContent = text;
    openModal("confirmActionModal");

    const okBtn = document.getElementById("confirmActionOk");
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    newOkBtn.addEventListener("click", () => {
        closeModal("confirmActionModal");
        onConfirm();
    });
}

document.getElementById("confirmActionClose")?.addEventListener("click", () => closeModal("confirmActionModal"));
document.getElementById("confirmActionCancel")?.addEventListener("click", () => closeModal("confirmActionModal"));

document.getElementById("sidebarClearHistoryBtn")?.addEventListener("click", () => {
    if(!isLoggedIn()) return;
    confirmAction(
        "Clear All History?",
        "Are you sure you want to delete every saved conversation? This can't be undone.",
        () => {
            saveSessions([]);
            currentSessionId = null;
            renderSidebarHistory();
            renderPinnedChats();
        }
    );
});

function openSession(session){
    chatHistory = session.messages.map(m => ({ role: m.role, content: m.content }));
    currentSessionId = session.id;
    document.getElementById("chatGreeting").style.display = "none";
    chatMessages.innerHTML = "";
    session.messages.forEach(m => {
        const div = document.createElement("div");
        div.className = m.role === "user" ? "user-message" : "ai-message done";
        if(m.role === "user"){
            div.textContent = m.content;
        } else {
            div.innerHTML = formatAIText(m.content);
        }
        chatMessages.appendChild(div);
    });
    closeSidebarMobile();
    chatArea.scrollTop = chatArea.scrollHeight;
}

// ---------- New chat ----------

function resetChatView(){
    // Any messages already sent were saved to chat history live as they
    // happened (see logMessageToHistory), so this just clears the view.
    chatHistory = [];
    currentSessionId = null;
    chatMessages.innerHTML = "";
    document.getElementById("chatGreeting").style.display = "";
}

document.getElementById("newChatBtn")?.addEventListener("click", () => {
    resetChatView();
    closeSidebarMobile();
    userInput.focus();
});

// ---------- Theme toggle ----------

const themeToggle = document.getElementById("themeToggle");
if(localStorage.getItem("zyntra-theme") === "light"){
    document.body.classList.add("light-mode");
    themeToggle.textContent = "☀️";
}
themeToggle?.addEventListener("click", () => {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    themeToggle.textContent = isLight ? "☀️" : "🌙";
    localStorage.setItem("zyntra-theme", isLight ? "light" : "dark");
});

// ---------- Sidebar (mobile off-canvas) ----------

function openSidebarMobile(){
    document.getElementById("sidebar").classList.add("show");
    document.getElementById("sidebarOverlay").classList.add("show");
}
function closeSidebarMobile(){
    document.getElementById("sidebar").classList.remove("show");
    document.getElementById("sidebarOverlay").classList.remove("show");
}

document.getElementById("hamburgerBtn")?.addEventListener("click", openSidebarMobile);
document.getElementById("sidebarCloseBtn")?.addEventListener("click", closeSidebarMobile);
document.getElementById("sidebarOverlay")?.addEventListener("click", closeSidebarMobile);

// ==========================
// AI CHAT
// ==========================

const chatMessages = document.getElementById("chatMessages");
const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
let chatHistory = [];
let attachedImage = null;

document.getElementById("attachBtn").addEventListener("click", () => {
    document.getElementById("chatFileInput").click();
});

document.getElementById("chatFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        alert("Please select an image file.");
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        attachedImage = reader.result;
        renderAttachPreview();
    };
    reader.readAsDataURL(file);
});

function renderAttachPreview(){
    const preview = document.getElementById("attachPreview");
    if(!attachedImage){ preview.innerHTML = ""; return; }
    preview.innerHTML = "";
    const thumb = document.createElement("div");
    thumb.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = attachedImage;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
        attachedImage = null;
        document.getElementById("chatFileInput").value = "";
        renderAttachPreview();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    preview.appendChild(thumb);
}

async function sendChatMessage(prefill){
    const msg = (prefill !== undefined ? prefill : userInput.value.trim());
    if(!msg && !attachedImage) return;

    if(!isPro() && isLockedOut()){
        showChatLockedModal();
        return;
    }

    document.getElementById("chatGreeting").style.display = "none";

    const userDiv = document.createElement("div");
    userDiv.className = "user-message";
    if(attachedImage){
        const imgEl = document.createElement("img");
        imgEl.src = attachedImage;
        imgEl.className = "sent-image";
        userDiv.appendChild(imgEl);
    }
    if(msg){
        const p = document.createElement("p");
        p.textContent = msg;
        p.style.margin = "0";
        userDiv.appendChild(p);
    }
    const userTime = document.createElement("span");
    userTime.className = "msg-time";
    userTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    userDiv.appendChild(userTime);
    chatMessages.appendChild(userDiv);
    userInput.value = "";
    chatArea.scrollTop = chatArea.scrollHeight;

    let historyContent;
    if(attachedImage){
        historyContent = [
            { type: "text", text: msg || "What is in this image? Please help solve or explain it." },
            { type: "image_url", image_url: { url: attachedImage } }
        ];
    } else {
        historyContent = msg;
    }

    if(chatHistory.length === 0){
        const profile = getProfile();
        if(profile.instructions || profile.nickname){
            let note = "";
            if(profile.nickname) note += `Call the user "${profile.nickname}". `;
            if(profile.instructions) note += `User's custom instructions: ${profile.instructions}`;
            chatHistory.push({ role: "system", content: note });
        }
    }

    chatHistory.push({ role: "user", content: historyContent });
    logMessageToHistory("user", msg || "[Image attached]");
    bumpStat("conversations");
    if(!isPro()) recordFreeMessage();

    attachedImage = null;
    document.getElementById("chatFileInput").value = "";
    renderAttachPreview();

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "ai-message";
    loadingDiv.textContent = "Typing...";
    chatMessages.appendChild(loadingDiv);
    chatArea.scrollTop = chatArea.scrollHeight;

    try{
        const reply = await callChatAPI(chatHistory);
        chatHistory.push({ role: "assistant", content: reply });
        logMessageToHistory("assistant", reply);
        loadingDiv.textContent = "";
        typeOutText(loadingDiv, reply, chatArea, () => {
            loadingDiv.classList.add("done");
            addMessageActionBar(loadingDiv, reply);
            const aiTime = document.createElement("span");
            aiTime.className = "msg-time";
            aiTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            loadingDiv.appendChild(aiTime);
        });
    }catch(err){
        loadingDiv.textContent = "Sorry, something went wrong. Please try again.";
    }
    chatArea.scrollTop = chatArea.scrollHeight;
}

document.getElementById("sendMessage").addEventListener("click", () => sendChatMessage());
userInput.addEventListener("keydown", e => {
    if(e.key === "Enter") sendChatMessage();
});

// ==========================
// Tool routing (sidebar nav, dropdown-less)
// ==========================

function setActiveNav(tool){
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const el = document.querySelector(`.nav-item[data-tool="${tool}"]`);
    if(el) el.classList.add("active");
}

const TOOL_PLACEHOLDERS = {
    chat: "Type your message...",
    study: "Ask me to explain, summarize, or solve...",
    business: "Ask a business or growth question...",
    code: "Ask me to write, debug, or explain code..."
};

// Which chat-mode tool is currently open (chat / study / business / code)
let activeChatTool = "chat";

function openTool(tool, prefix){
    if(TOOL_PLACEHOLDERS[tool]){
        // Switching to a different chat mode starts a clean chat.
        // The previous conversation is already saved in history (it was
        // logged message-by-message as it happened), so this is safe.
        if(tool !== activeChatTool && chatHistory.length > 0){
            resetChatView();
        }
        activeChatTool = tool;
        userInput.placeholder = TOOL_PLACEHOLDERS[tool];
        document.getElementById("chatGreeting").style.display = chatHistory.length ? "none" : "";
        if(prefix){ userInput.value = prefix; }
        userInput.focus();
        closeSidebarMobile();
    } else if(tool === "image"){
        openModal("imageModal");
        closeSidebarMobile();
    } else if(tool === "poster"){
        openModal("posterModal");
        closeSidebarMobile();
    } else if(tool === "voice"){
        openModal("voiceModal");
        closeSidebarMobile();
    }
    setActiveNav(tool);
}

document.querySelectorAll("[data-tool]").forEach(el => {
    el.addEventListener("click", e => {
        e.preventDefault();
        openTool(el.dataset.tool, el.dataset.prefix);
    });
});

// ==========================
// Image modal (with optional reference image upload)
// ==========================

document.getElementById("imageModalClose").addEventListener("click", () => closeModal("imageModal"));

let imgUploadedFile = null;

document.getElementById("imgUploadBtn").addEventListener("click", () => {
    document.getElementById("imgUploadInput").click();
});

document.getElementById("imgUploadInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        alert("Please select an image file.");
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        imgUploadedFile = reader.result;
        renderImgUploadPreview();
    };
    reader.readAsDataURL(file);
});

function renderImgUploadPreview(){
    const preview = document.getElementById("imgUploadPreview");
    const removeBgBtn = document.getElementById("removeBgBtn");
    preview.innerHTML = "";
    if(!imgUploadedFile){
        if(removeBgBtn) removeBgBtn.style.display = "none";
        return;
    }
    if(removeBgBtn) removeBgBtn.style.display = "block";
    const thumb = document.createElement("div");
    thumb.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = imgUploadedFile;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
        imgUploadedFile = null;
        document.getElementById("imgUploadInput").value = "";
        renderImgUploadPreview();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    preview.appendChild(thumb);
}

document.getElementById("removeBgBtn")?.addEventListener("click", async () => {
    if(!imgUploadedFile) return;
    const result = document.getElementById("imageResult");
    const btn = document.getElementById("removeBgBtn");
    const original = btn.textContent;
    btn.textContent = "🪄 Removing background...";
    btn.disabled = true;
    showCreatingAnimation(result, "Removing background");

    try{
        const { removeBackground } = await import("https://esm.sh/@imgly/background-removal@1.5.5");
        const response = await fetch(imgUploadedFile);
        const sourceBlob = await response.blob();
        const resultBlob = await removeBackground(sourceBlob);
        const url = URL.createObjectURL(resultBlob);

        const img = new Image();
        img.className = "generated-img";
        img.alt = "Background removed";
        img.style.background = "repeating-conic-gradient(#2b3154 0% 25%, #171d3d 0% 50%) 50% / 20px 20px";
        img.onload = () => {
            result.innerHTML = "";
            result.appendChild(img);

            const actionsRow = document.createElement("div");
            actionsRow.style.display = "flex";
            actionsRow.style.gap = "8px";
            actionsRow.style.marginTop = "8px";
            result.appendChild(actionsRow);

            const downloadBtn = document.createElement("button");
            downloadBtn.className = "copy-btn";
            downloadBtn.textContent = "⬇ Download PNG";
            downloadBtn.addEventListener("click", () => {
                const a = document.createElement("a");
                a.href = url;
                a.download = "zyntra-ai-no-background.png";
                document.body.appendChild(a);
                a.click();
                a.remove();
            });
            actionsRow.appendChild(downloadBtn);
            bumpStat("images");
        };
        img.src = url;
    }catch(err){
        result.innerHTML = '<p class="loading-text">Could not remove the background. Please try a different photo.</p>';
    }

    btn.textContent = original;
    btn.disabled = false;
});

function showCreatingAnimation(container, label){
    container.innerHTML = `
        <div class="creating-box">
            <p class="creating-label">${label}</p>
            <div class="creating-dots"></div>
        </div>
    `;
}

async function describeUploadedImage(dataUrl){
    const reply = await callChatAPI([
        {
            role: "user",
            content: [
                { type: "text", text: "Describe this image in one vivid sentence, focused on visual details useful for recreating a similar scene in a new AI-generated image." },
                { type: "image_url", image_url: { url: dataUrl } }
            ]
        }
    ]);
    return reply.replace(/\*\*/g, "").trim();
}

document.getElementById("imageGenBtn").addEventListener("click", async () => {
    const val = document.getElementById("imageInput").value.trim();
    const result = document.getElementById("imageResult");
    if(!val && !imgUploadedFile){ alert("Please describe the image or upload a reference image."); return; }

    const waitLabel = isPro() ? "Creating image" : "Creating image (upgrade to Pro for faster generation)";
    showCreatingAnimation(result, waitLabel);

    let finalPrompt = val;

    if(imgUploadedFile){
        try{
            const description = await describeUploadedImage(imgUploadedFile);
            finalPrompt = val ? `${description}. ${val}` : description;
        }catch(err){
            // fall back to just the typed prompt if description fails
        }
    }

    if(!finalPrompt){
        result.innerHTML = '<p class="loading-text">Please describe the image or upload a reference image.</p>';
        return;
    }

    function attemptGenerate(retryCount){
        const img = new Image();
        img.className = "generated-img";
        img.alt = finalPrompt;
        img.onload = () => {
            result.innerHTML = "";
            result.appendChild(img);
            bumpStat("images");

            const actionsRow = document.createElement("div");
            actionsRow.style.display = "flex";
            actionsRow.style.gap = "8px";
            actionsRow.style.marginTop = "8px";
            result.appendChild(actionsRow);

            const downloadBtn = document.createElement("button");
            downloadBtn.className = "copy-btn";
            downloadBtn.textContent = "⬇ Download";
            downloadBtn.addEventListener("click", async () => {
                downloadBtn.textContent = "Downloading...";
                try{
                    const res = await fetch(img.src);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "zyntra-ai-image.png";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                }catch(err){
                    window.open(img.src, "_blank");
                }
                downloadBtn.textContent = "⬇ Download";
            });
            actionsRow.appendChild(downloadBtn);

            addReportButton(actionsRow, "Generated image for prompt: \"" + finalPrompt + "\"");

            imgUploadedFile = null;
            document.getElementById("imgUploadInput").value = "";
            renderImgUploadPreview();
        };
        img.onerror = () => {
            if(retryCount < 2){
                showCreatingAnimation(result, waitLabel);
                setTimeout(() => attemptGenerate(retryCount + 1), 800);
            } else {
                result.innerHTML = '<p class="loading-text">Could not generate image right now. Please try again in a moment.</p>';
            }
        };
        const seed = Math.floor(Math.random() * 1000000);
        img.src = "https://image.pollinations.ai/prompt/" + encodeURIComponent(finalPrompt) + "?seed=" + seed;
    }

    const waitMs = isPro() ? 2000 : 10000;
    setTimeout(() => attemptGenerate(0), waitMs);
});

// ==========================
// Poster Maker
// ==========================

document.getElementById("posterModalClose")?.addEventListener("click", () => closeModal("posterModal"));

const POSTER_SIZES = {
    portrait: { w: 900, h: 1200 },
    square: { w: 1000, h: 1000 },
    landscape: { w: 1200, h: 900 }
};

// Wraps text inside maxWidth, drawing top-down starting at (x, y). Returns lines drawn.
function wrapCanvasTextTop(ctx, text, x, y, maxWidth, lineHeight){
    const words = text.split(" ");
    let line = "";
    let linesDrawn = 0;
    words.forEach(word => {
        const testLine = line ? line + " " + word : word;
        if(ctx.measureText(testLine).width > maxWidth && line){
            ctx.fillText(line, x, y + linesDrawn * lineHeight);
            linesDrawn++;
            line = word;
        } else {
            line = testLine;
        }
    });
    if(line){
        ctx.fillText(line, x, y + linesDrawn * lineHeight);
        linesDrawn++;
    }
    return linesDrawn;
}

document.getElementById("posterGenBtn")?.addEventListener("click", () => {
    const title = document.getElementById("posterTitleInput").value.trim();
    const subtitle = document.getElementById("posterSubtitleInput").value.trim();
    const theme = document.getElementById("posterThemeInput").value.trim();
    const aspect = document.getElementById("posterAspect").value;
    const result = document.getElementById("posterResult");

    if(!title && !theme){
        alert("Please add a title or describe the background style.");
        return;
    }

    const size = POSTER_SIZES[aspect] || POSTER_SIZES.portrait;
    const waitLabel = isPro() ? "Designing poster" : "Designing poster (upgrade to Pro for faster generation)";
    showCreatingAnimation(result, waitLabel);

    const promptText = (theme || "abstract poster background") + ", poster background art, no text, no watermark, high detail";
    const seed = Math.floor(Math.random() * 1000000);
    const bgUrl = "https://image.pollinations.ai/prompt/" + encodeURIComponent(promptText)
        + "?width=" + size.w + "&height=" + size.h + "&seed=" + seed;

    function drawPoster(){
        fetch(bgUrl)
            .then(res => res.blob())
            .then(blob => {
                const objectUrl = URL.createObjectURL(blob);
                const bgImg = new Image();

                bgImg.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = size.w;
                    canvas.height = size.h;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(bgImg, 0, 0, size.w, size.h);
                    URL.revokeObjectURL(objectUrl);

                    // Dark gradient at the bottom so text stays readable
                    const gradient = ctx.createLinearGradient(0, size.h * 0.55, 0, size.h);
                    gradient.addColorStop(0, "rgba(5,6,16,0)");
                    gradient.addColorStop(1, "rgba(5,6,16,0.85)");
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, size.h * 0.55, size.w, size.h * 0.45);

                    const padding = size.w * 0.08;
                    const maxTextWidth = size.w - padding * 2;
                    let cursorY = size.h * 0.62;
                    ctx.textBaseline = "top";

                    if(title){
                        const titleFontSize = Math.round(size.w * 0.075);
                        ctx.font = "800 " + titleFontSize + "px Inter, sans-serif";
                        ctx.fillStyle = "#ffffff";
                        const lineHeight = titleFontSize * 1.15;
                        const linesUsed = wrapCanvasTextTop(ctx, title, padding, cursorY, maxTextWidth, lineHeight);
                        cursorY += linesUsed * lineHeight + titleFontSize * 0.4;
                    }

                    if(subtitle){
                        const subFontSize = Math.round(size.w * 0.035);
                        ctx.font = "600 " + subFontSize + "px Inter, sans-serif";
                        ctx.fillStyle = "#c9a8ff";
                        wrapCanvasTextTop(ctx, subtitle, padding, cursorY, maxTextWidth, subFontSize * 1.3);
                    }

                    result.innerHTML = "";
                    const previewImg = document.createElement("img");
                    previewImg.className = "generated-img";
                    previewImg.alt = title || "Generated poster";
                    previewImg.src = canvas.toDataURL("image/png");
                    result.appendChild(previewImg);
                    bumpStat("images");

                    const actionsRow = document.createElement("div");
                    actionsRow.style.display = "flex";
                    actionsRow.style.gap = "8px";
                    actionsRow.style.marginTop = "8px";
                    result.appendChild(actionsRow);

                    const downloadBtn = document.createElement("button");
                    downloadBtn.className = "copy-btn";
                    downloadBtn.textContent = "⬇ Download Poster";
                    downloadBtn.addEventListener("click", () => {
                        const a = document.createElement("a");
                        a.href = canvas.toDataURL("image/png");
                        a.download = "zyntra-ai-poster.png";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    });
                    actionsRow.appendChild(downloadBtn);

                    addReportButton(actionsRow, "Generated poster for: \"" + (title || theme) + "\"");
                };

                bgImg.onerror = () => {
                    result.innerHTML = '<p class="loading-text">Could not generate the poster background. Please try again.</p>';
                };

                bgImg.src = objectUrl;
            })
            .catch(() => {
                result.innerHTML = '<p class="loading-text">Could not generate the poster background. Please try again.</p>';
            });
    }

    const waitMs = isPro() ? 2000 : 10000;
    setTimeout(drawPoster, waitMs);
});

// ==========================
// Voice modal
// ==========================

document.getElementById("voiceModalClose").addEventListener("click", () => closeModal("voiceModal"));

const voiceBox = document.getElementById("voiceBox");
const voiceMicBtn = document.getElementById("voiceMicBtn");

function addVoiceMsg(text, who){
    const p = document.createElement("p");
    p.className = "chat-msg " + who;
    p.textContent = text;
    voiceBox.appendChild(p);
    voiceBox.scrollTop = voiceBox.scrollHeight;
}

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceHistory = [];

if(!SpeechRecognitionAPI){
    voiceMicBtn.addEventListener("click", () => {
        addVoiceMsg("Voice recognition is not supported in this browser.", "ai");
    });
} else {
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";

    voiceMicBtn.addEventListener("click", () => {
        voiceMicBtn.textContent = "🎙 Listening...";
        recognition.start();
    });

    recognition.onresult = async (e) => {
        const said = e.results[0][0].transcript;
        voiceMicBtn.textContent = "🎤 Tap to speak";
        addVoiceMsg(said, "user");
        voiceHistory.push({ role: "user", content: said });
        addVoiceMsg("Thinking...", "ai-loading");
        try{
            const reply = await callChatAPI(voiceHistory);
            voiceHistory.push({ role: "assistant", content: reply });
            voiceBox.removeChild(voiceBox.lastChild);
            const clean = reply.replace(/\*\*/g, "");
            const aiDiv = document.createElement("p");
            aiDiv.className = "chat-msg ai";
            voiceBox.appendChild(aiDiv);
            typeOutText(aiDiv, clean, voiceBox, () => {
                aiDiv.classList.add("done");
                addMessageActionBar(aiDiv, clean);
            });
            const utter = new SpeechSynthesisUtterance(clean);
            speechSynthesis.speak(utter);
        }catch(err){
            voiceBox.removeChild(voiceBox.lastChild);
            addVoiceMsg("Sorry, I couldn't process that.", "ai");
        }
    };

    recognition.onerror = () => {
        voiceMicBtn.textContent = "🎤 Tap to speak";
    };
}

// ---------- Initial render ----------

renderSidebarHistory();
