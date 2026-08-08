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

    lines.forEach(line => {
        const trimmed = line.trim();
        if(/^[-*•]\s+/.test(trimmed)){
            if(!inList){ html += "<ul>"; inList = true; }
            html += "<li>" + trimmed.replace(/^[-*•]\s+/, "") + "</li>";
        } else {
            if(inList){ html += "</ul>"; inList = false; }
            html += "<p>" + trimmed + "</p>";
        }
    });
    if(inList) html += "</ul>";
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
    chatModal.classList.remove("show");
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
            chatModal.classList.add("show");
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
        chatModal.classList.add("show");
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
        chatModal.classList.remove("show");
    }
});

// ---------- About modal ----------

const aboutModal = document.getElementById("aboutModal");
document.getElementById("aboutBtn")?.addEventListener("click", e => { e.preventDefault(); openModal("aboutModal"); });
document.getElementById("aboutBtnFooter")?.addEventListener("click", e => { e.preventDefault(); openModal("aboutModal"); });
document.getElementById("aboutClose")?.addEventListener("click", () => closeModal("aboutModal"));

// ---------- Pricing modal ----------

document.getElementById("pricingBtn")?.addEventListener("click", e => { e.preventDefault(); openModal("pricingModal"); });
document.getElementById("pricingBtnFooter")?.addEventListener("click", e => { e.preventDefault(); openModal("pricingModal"); });
document.getElementById("pricingModalClose")?.addEventListener("click", () => closeModal("pricingModal"));

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

function renderPlanUI(){
    const badge = document.getElementById("proBadge");
    const getProBtn = document.getElementById("getProBtn");
    const adBanner = document.getElementById("adBanner");

    if(isPro()){
        badge.style.display = "inline";
        getProBtn.textContent = "You're on Pro ✓";
        getProBtn.disabled = true;
        getProBtn.style.opacity = "0.7";
        getProBtn.style.cursor = "default";
        if(adBanner) adBanner.style.display = "none";
    } else if(!isLoggedIn()){
        badge.style.display = "none";
        getProBtn.textContent = "Sign In to Upgrade";
        getProBtn.disabled = false;
        getProBtn.style.opacity = "1";
        getProBtn.style.cursor = "pointer";
        if(adBanner) adBanner.style.display = "flex";
    } else {
        badge.style.display = "none";
        getProBtn.textContent = "Get Pro";
        getProBtn.disabled = false;
        getProBtn.style.opacity = "1";
        getProBtn.style.cursor = "pointer";
        if(adBanner) adBanner.style.display = "flex";
    }
}

document.getElementById("adBanner")?.addEventListener("click", () => {
    chatModal.classList.remove("show");
    openModal("pricingModal");
});

document.getElementById("getProBtn")?.addEventListener("click", async () => {
    if(isPro()) return;

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

["contactBtn","contactBtnFooter","contactBtnFooter2","contactBtnFooter3"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => { e.preventDefault(); openModal("contactModal"); });
});
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

// ---------- Live stats (real, shared globally across all visitors via CountAPI) ----------

const STAT_BASE = {
    users: 50000,
    conversations: 1000000,
    images: 250000
};
const STAT_NAMESPACE = "zyntra-ai-ghanchimoin";

function formatCount(n){
    if(n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M+";
    if(n >= 1000) return Math.round(n / 1000) + "K+";
    return n + "+";
}

async function fetchStatValue(key, shouldHit){
    try{
        const endpoint = shouldHit ? "hit" : "get";
        const res = await fetch(`https://api.countapi.xyz/${endpoint}/${STAT_NAMESPACE}/${key}`);
        const data = await res.json();
        return typeof data.value === "number" ? data.value : 0;
    }catch(err){
        return null;
    }
}

async function updateStatDisplay(key, elId){
    const val = await fetchStatValue(key, false);
    if(val !== null){
        document.getElementById(elId).textContent = formatCount(STAT_BASE[key] + val);
    }
}

async function bumpStat(key, elId){
    const val = await fetchStatValue(key, true);
    if(val !== null){
        document.getElementById(elId).textContent = formatCount(STAT_BASE[key] + val);
    }
}

function renderStats(){
    updateStatDisplay("users", "statUsers");
    updateStatDisplay("conversations", "statConversations");
    updateStatDisplay("images", "statImages");
    document.getElementById("statUptime").textContent = "99.9%";
}

renderStats();

if(!localStorage.getItem("zyntra-visited")){
    localStorage.setItem("zyntra-visited", "1");
    bumpStat("users", "statUsers");
}

function isLoggedIn(){
    return !!localStorage.getItem("zyntra-user");
}

function renderAuthNav(){
    const signinBtn = document.getElementById("signinBtn");
    signinBtn.textContent = isLoggedIn() ? "Sign Out" : "Sign In";
    renderPlanUI();
    checkProExpiry();
}

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

document.getElementById("profileBtn")?.addEventListener("click", e => {
    e.preventDefault();
    openModal("profileModal");
    renderProfileModal();
});
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

    const btn = document.getElementById("profileSaveBtn");
    const original = btn.textContent;
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById("profileSignoutBtn")?.addEventListener("click", () => {
    closeModal("profileModal");
    openModal("signoutModal");
});

document.getElementById("signinBtn")?.addEventListener("click", () => {
    if(isLoggedIn()){
        openModal("signoutModal");
    } else {
        document.getElementById("signinContext").style.display = "none";
        resetSigninModalUI(); openModal("signinModal");
    }
});
document.getElementById("signoutModalClose")?.addEventListener("click", () => closeModal("signoutModal"));
document.getElementById("signoutCancel")?.addEventListener("click", () => closeModal("signoutModal"));
document.getElementById("signoutConfirm")?.addEventListener("click", () => {
    firebase.auth().signOut().catch(() => {});
    localStorage.removeItem("zyntra-user");
    closeModal("signoutModal");
    renderAuthNav();
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
    if(cameFromPro){
        openModal("pricingModal");
    }
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

// ---------- Chat history (session based, Claude-style list) ----------

let currentSessionId = null;

function timeAgo(ts){
    const diff = Math.floor((Date.now() - ts) / 1000);
    if(diff < 60) return "Just now";
    if(diff < 3600) return Math.floor(diff / 60) + " minutes ago";
    if(diff < 86400) return Math.floor(diff / 3600) + " hours ago";
    return Math.floor(diff / 86400) + " days ago";
}

function getSessions(){
    return JSON.parse(localStorage.getItem("zyntra-sessions") || "[]");
}

function saveSessions(sessions){
    localStorage.setItem("zyntra-sessions", JSON.stringify(sessions));
}

function logMessageToHistory(role, content){
    const sessions = getSessions();
    let isNewSession = false;

    if(!currentSessionId){
        currentSessionId = Date.now();
        isNewSession = true;
        sessions.unshift({
            id: currentSessionId,
            title: content.length > 40 ? content.slice(0, 40) + "…" : content,
            time: Date.now(),
            messages: []
        });
    }

    const session = sessions.find(s => s.id === currentSessionId);
    if(session) session.messages.push({ role, content });
    saveSessions(sessions);

    if(isNewSession && role === "user"){
        generateSessionTitle(currentSessionId, content);
    }
}

async function generateSessionTitle(sessionId, firstMessage){
    try{
        const title = await callChatAPI([
            {
                role: "user",
                content: 'Summarize the topic of this message in 3-5 words. No punctuation, no quotes, just the topic itself:\n\n"' + firstMessage + '"'
            }
        ]);
        const clean = title.trim().replace(/["'.]/g, "");
        if(!clean) return;

        const sessions = getSessions();
        const session = sessions.find(s => s.id === sessionId);
        if(session){
            session.title = clean.length > 60 ? clean.slice(0, 60) : clean;
            saveSessions(sessions);
            if(document.getElementById("historyModal").classList.contains("show")){
                renderHistory();
            }
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
        box.innerHTML = '<p class="pinned-empty">No pinned chats yet. Pin a conversation from Chat History.</p>';
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

function renderHistory(){
    const sessions = getSessions();
    const box = document.getElementById("historyBox");
    box.innerHTML = "";

    if(sessions.length === 0){
        box.innerHTML = '<p class="loading-text">No conversations yet.</p>';
        return;
    }

    sessions.forEach(session => {
        const row = document.createElement("div");
        row.className = "history-row" + (session.pinned ? " pinned" : "");

        const title = document.createElement("span");
        title.className = "history-row-title";
        title.textContent = session.title;

        const time = document.createElement("span");
        time.className = "history-row-time";
        time.textContent = timeAgo(session.time);

        const pinBtn = document.createElement("button");
        pinBtn.className = "pin-btn" + (session.pinned ? " pinned" : "");
        pinBtn.textContent = "📌";
        pinBtn.title = session.pinned ? "Unpin" : "Pin";
        pinBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const all = getSessions();
            const s = all.find(x => x.id === session.id);
            if(s){
                s.pinned = !s.pinned;
                saveSessions(all);
                renderHistory();
                renderPinnedChats();
            }
        });

        const menuBtn = document.createElement("button");
        menuBtn.className = "history-menu-btn";
        menuBtn.textContent = "⋮";

        row.appendChild(title);
        row.appendChild(time);
        row.appendChild(pinBtn);
        row.appendChild(menuBtn);
        box.appendChild(row);

        menuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            document.querySelectorAll(".history-menu-dropdown").forEach(m => m.remove());

            const dropdown = document.createElement("div");
            dropdown.className = "history-menu-dropdown";
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "🗑 Delete";
            deleteBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const updated = getSessions().filter(s => s.id !== session.id);
                saveSessions(updated);
                if(currentSessionId === session.id) currentSessionId = null;
                renderHistory();
                renderPinnedChats();
            });
            dropdown.appendChild(deleteBtn);
            row.appendChild(dropdown);
        });

        row.addEventListener("click", () => {
            openSession(session);
            closeModal("historyModal");
        });
    });
}

function openSession(session){
    chatHistory = session.messages.map(m => ({ role: m.role, content: m.content }));
    currentSessionId = session.id;
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
    chatModal.classList.add("show");
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.addEventListener("click", () => {
    document.querySelectorAll(".history-menu-dropdown").forEach(m => m.remove());
});

document.getElementById("historyModalClose")?.addEventListener("click", () => closeModal("historyModal"));
document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
    saveSessions([]);
    currentSessionId = null;
    renderHistory();
});

document.getElementById("watchAdBtn")?.addEventListener("click", () => {
    if(isPro()){
        alert("You're on Pro — you already have unlimited chats! 🎉");
        return;
    }
    const btn = document.getElementById("watchAdBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "🎬 Watching ad...";

    setTimeout(() => {
        const usage = getChatUsage();
        usage.lockoutUntil = 0;
        usage.count = Math.max(0, (usage.count || 0) - 5);
        saveChatUsage(usage);
        btn.textContent = "✅ +5 Messages Added!";
        setTimeout(() => {
            btn.textContent = original;
            btn.disabled = false;
        }, 2000);
    }, 3000);
});

// ---------- Get Started ----------

document.getElementById("getStartedBtn")?.addEventListener("click", () => {
    chatModal.classList.add("show");
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

// ---------- Mobile hamburger ----------

document.getElementById("hamburgerBtn")?.addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("show");
});

// ==========================
// AI CHAT MODAL
// ==========================

const chatModal = document.getElementById("chatModal");
const chatMessages = document.getElementById("chatMessages");
const userInput = document.getElementById("userInput");
const closeChat = document.getElementById("closeChat");
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
    chatMessages.appendChild(userDiv);
    userInput.value = "";
    chatMessages.scrollTop = chatMessages.scrollHeight;

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
    bumpStat("conversations", "statConversations");
    if(!isPro()) recordFreeMessage();

    attachedImage = null;
    document.getElementById("chatFileInput").value = "";
    renderAttachPreview();

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "ai-message";
    loadingDiv.textContent = "Typing...";
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try{
        const reply = await callChatAPI(chatHistory);
        chatHistory.push({ role: "assistant", content: reply });
        logMessageToHistory("assistant", reply);
        loadingDiv.textContent = "";
        typeOutText(loadingDiv, reply, chatMessages, () => {
            loadingDiv.classList.add("done");
            addCopyButton(loadingDiv, reply);
            addReportButton(loadingDiv, reply);
        });
    }catch(err){
        loadingDiv.textContent = "Sorry, something went wrong. Please try again.";
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById("sendMessage").addEventListener("click", () => sendChatMessage());
userInput.addEventListener("keydown", e => {
    if(e.key === "Enter") sendChatMessage();
});

closeChat.addEventListener("click", () => chatModal.classList.remove("show"));
chatModal.addEventListener("click", e => {
    if(e.target === chatModal) chatModal.classList.remove("show");
});

document.getElementById("floatingChatBtn").addEventListener("click", () => {
    chatModal.classList.add("show");
});

// ---------- Hero "Ask AI" ----------

document.getElementById("heroAskBtn").addEventListener("click", () => {
    const q = document.getElementById("heroInput").value.trim();
    if(q === ""){
        alert("Please enter a question.");
        return;
    }
    document.getElementById("heroInput").value = "";
    chatModal.classList.add("show");
    sendChatMessage(q);
});
document.getElementById("heroInput").addEventListener("keydown", e => {
    if(e.key === "Enter") document.getElementById("heroAskBtn").click();
});

// ==========================
// Tool routing (cards, pills, dropdown, chips)
// ==========================

function openTool(tool, prefix){
    switch(tool){
        case "chat":
            chatModal.classList.add("show");
            if(prefix){ userInput.value = prefix; userInput.focus(); }
            break;
        case "study":
            chatModal.classList.add("show");
            userInput.placeholder = "Ask me to explain, summarize, or solve...";
            if(prefix){ userInput.value = prefix; userInput.focus(); }
            break;
        case "business":
            chatModal.classList.add("show");
            userInput.placeholder = "Ask a business or growth question...";
            if(prefix){ userInput.value = prefix; userInput.focus(); }
            break;
        case "code":
            chatModal.classList.add("show");
            userInput.placeholder = "Ask me to write, debug, or explain code...";
            if(prefix){ userInput.value = prefix; userInput.focus(); }
            break;
        case "history":
            openModal("historyModal");
            renderHistory();
            break;
        case "image":
            openModal("imageModal");
            break;
        case "voice":
            openModal("voiceModal");
            break;
    }
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
    preview.innerHTML = "";
    if(!imgUploadedFile) return;
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
            bumpStat("images", "statImages");

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
                addCopyButton(aiDiv, clean);
                addReportButton(aiDiv, clean);
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
