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

// ---------- Contact modal ----------

["contactBtn","contactBtnFooter","contactBtnFooter2","contactBtnFooter3"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => { e.preventDefault(); openModal("contactModal"); });
});
document.getElementById("contactModalClose")?.addEventListener("click", () => closeModal("contactModal"));
document.getElementById("contactSubmit")?.addEventListener("click", () => {
    const name = document.getElementById("contactName").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const msg = document.getElementById("contactMsg").value.trim();
    if(!name || !email || !msg){
        alert("Please fill in all fields.");
        return;
    }
    alert("Thanks " + name + "! Your message has been received.");
    document.getElementById("contactName").value = "";
    document.getElementById("contactEmail").value = "";
    document.getElementById("contactMsg").value = "";
    closeModal("contactModal");
});

// ---------- Sign in modal ----------

document.getElementById("signinBtn")?.addEventListener("click", () => openModal("signinModal"));
document.getElementById("signinModalClose")?.addEventListener("click", () => closeModal("signinModal"));
document.getElementById("signinSubmit")?.addEventListener("click", () => {
    const email = document.getElementById("signinEmail").value.trim();
    if(!email){
        alert("Please enter your email.");
        return;
    }
    alert("Sign in is coming soon!");
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

async function sendChatMessage(prefill){
    const msg = (prefill !== undefined ? prefill : userInput.value.trim());
    if(!msg) return;

    const userDiv = document.createElement("div");
    userDiv.className = "user-message";
    userDiv.textContent = msg;
    chatMessages.appendChild(userDiv);
    userInput.value = "";
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatHistory.push({ role: "user", content: msg });

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "ai-message";
    loadingDiv.textContent = "Typing...";
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try{
        const reply = await callChatAPI(chatHistory);
        chatHistory.push({ role: "assistant", content: reply });
        loadingDiv.textContent = "";
        typeOutText(loadingDiv, reply, chatMessages, () => loadingDiv.classList.add("done"));
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
    img.onload = () => { result.innerHTML = ""; result.appendChild(img); };
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
            typeOutText(aiDiv, clean, voiceBox, () => aiDiv.classList.add("done"));
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
