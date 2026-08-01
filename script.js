// ==========================
// Zyntra AI — main script
// ==========================

// ---------- Helpers ----------

function formatAIText(text){
    let safe = text
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
    return html || "<p>" + safe + "</p>";
}

function typeOutText(el, fullText, scrollContainer, onDone){
    const words = fullText.split(" ");
    let i = 0;

    function step(){
        i++;
        el.innerHTML = formatAIText(words.slice(0, i).join(" "));
        if(scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        if(i < words.length){
            setTimeout(step, 25);
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

function isPro(){
    return localStorage.getItem("zyntra-plan") === "pro";
}

function renderPlanUI(){
    const badge = document.getElementById("proBadge");
    const getProBtn = document.getElementById("getProBtn");
    if(isPro()){
        badge.style.display = "inline";
        getProBtn.textContent = "You're on Pro ✓";
        getProBtn.disabled = true;
        getProBtn.style.opacity = "0.7";
        getProBtn.style.cursor = "default";
    } else {
        badge.style.display = "none";
        getProBtn.textContent = "Get Pro";
        getProBtn.disabled = false;
        getProBtn.style.opacity = "1";
        getProBtn.style.cursor = "pointer";
    }
}

document.getElementById("getProBtn")?.addEventListener("click", async () => {
    if(isPro()) return;
    const btn = document.getElementById("getProBtn");
    const original = btn.textContent;
    btn.textContent = "Redirecting to Stripe...";
    btn.disabled = true;

    try{
        const res = await fetch("/api/create-checkout", { method: "POST" });
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
    localStorage.setItem("zyntra-plan", "pro");
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
            body: JSON.stringify({ name, email, message: msg })
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
    const blogLink = document.getElementById("navBlogLink");
    const signinBtn = document.getElementById("signinBtn");

    if(isLoggedIn()){
        blogLink.textContent = "Chat History";
        blogLink.onclick = (e) => {
            e.preventDefault();
            openModal("historyModal");
            renderHistory();
        };
        signinBtn.textContent = "Sign Out";
    } else {
        blogLink.textContent = "Blog";
        blogLink.onclick = (e) => e.preventDefault();
        signinBtn.textContent = "Sign In";
    }
}

document.getElementById("signinBtn")?.addEventListener("click", () => {
    if(isLoggedIn()){
        localStorage.removeItem("zyntra-user");
        renderAuthNav();
    } else {
        openModal("signinModal");
    }
});
document.getElementById("signinModalClose")?.addEventListener("click", () => closeModal("signinModal"));
document.getElementById("signinSubmit")?.addEventListener("click", () => {
    const email = document.getElementById("signinEmail").value.trim();
    if(!email){
        alert("Please enter your email.");
        return;
    }
    localStorage.setItem("zyntra-user", email);
    document.getElementById("signinEmail").value = "";
    document.getElementById("signinPass").value = "";
    closeModal("signinModal");
    renderAuthNav();
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
        row.className = "history-row";

        const title = document.createElement("span");
        title.className = "history-row-title";
        title.textContent = session.title;

        const time = document.createElement("span");
        time.className = "history-row-time";
        time.textContent = timeAgo(session.time);

        const menuBtn = document.createElement("button");
        menuBtn.className = "history-menu-btn";
        menuBtn.textContent = "⋮";

        row.appendChild(title);
        row.appendChild(time);
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
            });
            dropdown.appendChild(deleteBtn);
            row.appendChild(dropdown);
        });

        row.addEventListener("click", () => {
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
            closeModal("historyModal");
            chatModal.classList.add("show");
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    });
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

    chatHistory.push({ role: "user", content: historyContent });
    logMessageToHistory("user", msg || "[Image attached]");
    bumpStat("conversations", "statConversations");

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
        case "image":
            openModal("imageModal");
            break;
        case "video":
            openModal("videoModal");
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
// Image modal
// ==========================

document.getElementById("imageModalClose").addEventListener("click", () => closeModal("imageModal"));
document.getElementById("imageGenBtn").addEventListener("click", () => {
    const val = document.getElementById("imageInput").value.trim();
    const result = document.getElementById("imageResult");
    if(!val){ alert("Please describe the image first."); return; }
    result.innerHTML = '<p class="loading-text">Generating image...</p>';
    const img = new Image();
    img.className = "generated-img";
    img.alt = val;
    img.onload = () => {
        result.innerHTML = "";
        result.appendChild(img);
        bumpStat("images", "statImages");
        addReportButton(result, "Generated image for prompt: \"" + val + "\"");
    };
    img.onerror = () => { result.innerHTML = '<p class="loading-text">Could not generate image. Please try again.</p>'; };
    img.src = "https://image.pollinations.ai/prompt/" + encodeURIComponent(val);
});

// ==========================
// Video modal
// ==========================

document.getElementById("videoModalClose").addEventListener("click", () => closeModal("videoModal"));
document.getElementById("videoGenBtn").addEventListener("click", () => {
    const val = document.getElementById("videoInput").value.trim();
    const result = document.getElementById("videoResult");
    if(!val){ alert("Please describe the video first."); return; }

    result.innerHTML = '<p class="loading-text">Generating preview frames...</p>';

    const variations = [
        val,
        val + ", wide shot",
        val + ", close up",
        val + ", cinematic lighting"
    ];

    const urls = variations.map((v, i) =>
        "https://image.pollinations.ai/prompt/" + encodeURIComponent(v) + "?seed=" + (i + 1)
    );

    let loaded = 0;
    const images = urls.map(src => {
        const img = new Image();
        img.src = src;
        img.onload = () => {
            loaded++;
            if(loaded === images.length) startSlideshow();
        };
        img.onerror = () => {
            loaded++;
            if(loaded === images.length) startSlideshow();
        };
        return img;
    });

    function startSlideshow(){
        const wrapper = document.createElement("div");
        wrapper.className = "slideshow";
        images.forEach((img, i) => {
            img.className = i === 0 ? "active" : "";
            wrapper.appendChild(img);
        });

        result.innerHTML = "";
        result.appendChild(wrapper);
        const caption = document.createElement("p");
        caption.className = "loading-text";
        caption.textContent = "AI-generated preview (image sequence) — full video generation coming soon.";
        result.appendChild(caption);

        let current = 0;
        setInterval(() => {
            images[current].classList.remove("active");
            current = (current + 1) % images.length;
            images[current].classList.add("active");
        }, 2200);
    }
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
