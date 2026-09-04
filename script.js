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
                ${isPreviewableCode(block) ? `<button class="filecard-play-btn" data-code="${encoded}" title="Run preview">▶</button>` : ""}
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

function isPreviewableCode(block){
    return block.filename === "index.html" || block.label === "HTML";
}

function ensureCodePreviewModal(){
    let modal = document.getElementById("codePreviewModal");
    if(modal) return modal;

    modal = document.createElement("div");
    modal.id = "codePreviewModal";
    modal.className = "modal-overlay code-preview-overlay";
    modal.innerHTML = `
        <div class="modal-box code-preview-box">
            <div class="code-preview-header">
                <span class="tag" style="margin:0;">LIVE PREVIEW</span>
                <div class="code-preview-header-actions">
                    <button type="button" class="code-preview-newtab" title="Open in new tab">↗</button>
                    <button type="button" class="code-preview-close" title="Close">✕</button>
                </div>
            </div>
            <div class="code-preview-frame-wrap">
                <div class="code-preview-glow-border">
                    <div class="code-preview-frame-inner">
                        <iframe class="code-preview-iframe" sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin"></iframe>
                        <div class="code-preview-loading" id="codePreviewLoading">
                            <div class="code-preview-loading-dots">
                                <span></span><span></span><span></span>
                            </div>
                            <p>Loading preview...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".code-preview-close").addEventListener("click", () => closeModal("codePreviewModal"));
    modal.addEventListener("click", (e) => {
        if(e.target === modal) closeModal("codePreviewModal");
    });

    return modal;
}

function openCodePreview(code){
    const modal = ensureCodePreviewModal();
    const iframe = modal.querySelector(".code-preview-iframe");
    const loading = modal.querySelector("#codePreviewLoading");
    const glowBorder = modal.querySelector(".code-preview-glow-border");

    glowBorder.classList.add("loading");
    loading.classList.add("show");

    // A static HTML page loads into the iframe almost instantly, which
    // would make the loading animation flash by unnoticed. Hold the
    // loading screen for a real minimum duration so it's actually seen,
    // then reveal the page once both the load AND the timer are done.
    const MIN_LOADING_MS = 5000;
    const startedAt = Date.now();
    let iframeLoaded = false;

    function revealWhenReady(){
        if(!iframeLoaded) return;
        const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
        setTimeout(() => {
            loading.classList.remove("show");
            glowBorder.classList.remove("loading");
        }, Math.max(remaining, 0));
    }

    iframe.onload = () => {
        iframeLoaded = true;
        revealWhenReady();
    };
    iframe.srcdoc = code;

    const newTabBtn = modal.querySelector(".code-preview-newtab");
    newTabBtn.onclick = () => {
        const blob = new Blob([code], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    openModal("codePreviewModal");
}

document.addEventListener("click", (e) => {
    const playBtn = e.target.closest(".filecard-play-btn");
    if(playBtn){
        try{
            const code = decodeURIComponent(escape(atob(playBtn.dataset.code)));
            openCodePreview(code);
        }catch(err){
            alert("Could not open the preview.");
        }
        return;
    }

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

function extractImageBlocks(text){
    const images = [];
    let index = 0;
    const withPlaceholders = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (match, alt, url) => {
        const id = "imgblock-" + Date.now() + "-" + (index++);
        images.push({ id, alt: alt || "Generated image", url });
        return "\n%%" + id + "%%\n";
    });
    return { withPlaceholders, images };
}

function escapeAttr(str){
    return escapeForDisplay(str).replace(/"/g, "&quot;");
}

function buildImageBlockHTML(image){
    return `
        <div class="ai-image-block">
            <img class="generated-img" src="${image.url}" alt="${escapeAttr(image.alt)}">
            <div class="ai-image-actions">
                <button class="copy-btn ai-image-download" data-url="${image.url}">⬇ Download</button>
            </div>
        </div>
    `;
}

document.addEventListener("click", (e) => {
    const downloadBtn = e.target.closest(".ai-image-download");
    if(downloadBtn){
        const url = downloadBtn.dataset.url;
        const original = downloadBtn.textContent;
        downloadBtn.textContent = "Downloading...";
        fetch(url)
            .then(res => res.blob())
            .then(blob => {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = "zyntra-ai-image.png";
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(objectUrl);
                downloadBtn.textContent = original;
            })
            .catch(() => {
                window.open(url, "_blank");
                downloadBtn.textContent = original;
            });
    }
});

// Turns markdown links [text](url) and bare https:// URLs into real,
// clickable <a> tags. Runs on already HTML-escaped text, so it's safe to
// insert raw <a> markup without re-escaping it.
function linkifyText(escapedText){
    let out = escapedText.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ai-link">${label}</a>`
    );
    // Bare URLs — only ones not already sitting inside an href="" we just
    // added (those are preceded by a quote or ">", neither of which this
    // pattern's required leading context [\s(] matches).
    out = out.replace(
        /(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:'")\]])/g,
        (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer" class="ai-link">${url}</a>`
    );
    return out;
}

function formatAIText(text){
    const { withPlaceholders: withCodePlaceholders, blocks } = extractCodeBlocks(text);
    const { withPlaceholders, images } = extractImageBlocks(withCodePlaceholders);

    let safe = withPlaceholders
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");

    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    safe = linkifyText(safe);

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

    images.forEach(image => {
        const placeholder = "%%" + image.id + "%%";
        html = html.replace("<p>" + placeholder + "</p>", buildImageBlockHTML(image));
        html = html.replace(placeholder, buildImageBlockHTML(image));
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
    const speed = 8;
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

// ---------- Web search sources (rendered under AI messages when a real search happened) ----------

function faviconUrl(pageUrl){
    try{
        const host = new URL(pageUrl).hostname;
        return "https://www.google.com/s2/favicons?domain=" + host + "&sz=64";
    }catch(err){
        return "";
    }
}

function hostFromUrl(pageUrl){
    try{
        return new URL(pageUrl).hostname.replace(/^www\./, "");
    }catch(err){
        return pageUrl;
    }
}

function buildSourcesRow(sources){
    const wrap = document.createElement("div");
    wrap.className = "message-sources";

    // ---- Collapsed pill: overlapping favicons + "Searched N sites" ----
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sources-toggle";

    const faviconStack = document.createElement("span");
    faviconStack.className = "sources-favicons";
    sources.slice(0, 4).forEach(src => {
        const icon = document.createElement("img");
        icon.src = faviconUrl(src.url);
        icon.alt = "";
        icon.loading = "lazy";
        faviconStack.appendChild(icon);
    });
    toggle.appendChild(faviconStack);

    const label = document.createElement("span");
    label.className = "sources-toggle-label";
    label.textContent = "Searched " + sources.length + (sources.length === 1 ? " site" : " sites");
    toggle.appendChild(label);

    const chevron = document.createElement("span");
    chevron.className = "sources-chevron";
    chevron.textContent = "▾";
    toggle.appendChild(chevron);

    toggle.addEventListener("click", () => {
        wrap.classList.toggle("open");
    });

    // ---- Expanded list: one row per source with favicon + title ----
    const list = document.createElement("div");
    list.className = "sources-list";

    sources.forEach(src => {
        const a = document.createElement("a");
        a.className = "source-chip";
        a.href = src.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = src.url;

        const icon = document.createElement("img");
        icon.className = "source-chip-favicon";
        icon.src = faviconUrl(src.url);
        icon.alt = "";
        icon.loading = "lazy";
        a.appendChild(icon);

        const textWrap = document.createElement("span");
        textWrap.className = "source-chip-text";

        const title = document.createElement("span");
        title.className = "source-chip-title";
        title.textContent = (src.title && src.title.length < 70) ? src.title : hostFromUrl(src.url);
        textWrap.appendChild(title);

        const host = document.createElement("span");
        host.className = "source-chip-host";
        host.textContent = hostFromUrl(src.url);
        textWrap.appendChild(host);

        a.appendChild(textWrap);
        list.appendChild(a);
    });

    wrap.appendChild(toggle);
    wrap.appendChild(list);
    return wrap;
}

function stripForSpeech(text){
    return text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/^[-*•]\s+/gm, "")
        .replace(/\|/g, " ")
        // Strip emoji and symbol pictographs so the voice doesn't try to read them aloud
        .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

// Detects the likely spoken language from the text's script/characters so
// the voice assistant can speak many languages, not just the browser's
// default. Falls back to the browser/system language for Latin-script text
// (English, Spanish, French, etc. can't be told apart by characters alone).
function detectSpeechLang(text){
    if(/[\u0900-\u097F]/.test(text)) return "hi-IN";   // Devanagari (Hindi, Marathi...)
    if(/[\u0600-\u06FF]/.test(text)) return "ar-SA";   // Arabic
    if(/[\u4E00-\u9FFF]/.test(text)) return "zh-CN";   // Chinese
    if(/[\u3040-\u30FF]/.test(text)) return "ja-JP";   // Japanese (Hiragana/Katakana)
    if(/[\uAC00-\uD7AF]/.test(text)) return "ko-KR";   // Korean (Hangul)
    if(/[\u0400-\u04FF]/.test(text)) return "ru-RU";   // Cyrillic
    if(/[\u0E00-\u0E7F]/.test(text)) return "th-TH";   // Thai
    if(/[\u0980-\u09FF]/.test(text)) return "bn-IN";   // Bengali
    if(/[\u0A80-\u0AFF]/.test(text)) return "gu-IN";   // Gujarati
    if(/[\u0B80-\u0BFF]/.test(text)) return "ta-IN";   // Tamil
    if(/[\u0C00-\u0C7F]/.test(text)) return "te-IN";   // Telugu
    if(/[\u0590-\u05FF]/.test(text)) return "he-IL";   // Hebrew
    return navigator.language || "en-US";
}

// Picks the closest available system voice for a language, since setting
// .lang alone doesn't always pick a good voice if the browser has several.
// The user's chosen voice from Settings (if any) always wins over
// automatic per-language matching — mirrors how most voice assistants let
// you pick a persona voice once, used everywhere afterward.
function getPreferredVoice(){
    const uri = localStorage.getItem("zyntra-voice-uri");
    if(!uri) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find(v => v.voiceURI === uri) || null;
}

function pickVoiceForLang(lang){
    const preferred = getPreferredVoice();
    if(preferred) return preferred;

    const voices = speechSynthesis.getVoices();
    if(!voices || !voices.length) return null;
    const prefix = lang.split("-")[0];
    return voices.find(v => v.lang === lang)
        || voices.find(v => v.lang && v.lang.startsWith(prefix))
        || null;
}

function speakText(text, lang){
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);

    // A chosen voice always wins, for every message in every language —
    // and its own .lang is used (not the message's detected language),
    // since pairing a voice with a mismatched lang makes some browsers
    // silently reject the voice and fall back (or stay silent) instead of
    // actually speaking. A single voice can't natively pronounce every
    // language fluently — that's a real OS/browser limitation — but this
    // way it reliably speaks every message in its own accent rather than
    // failing outright.
    const preferred = getPreferredVoice();
    if(preferred){
        utter.voice = preferred;
        utter.lang = preferred.lang;
    } else {
        utter.lang = lang;
        const voice = pickVoiceForLang(lang);
        if(voice) utter.voice = voice;
    }

    speechSynthesis.speak(utter);
}

// ---------- Voice settings (in Settings modal) ----------

let voiceCarouselIndex = 0;

function getVoiceCarouselOptions(){
    const voices = speechSynthesis.getVoices();
    return [{ uri: "", name: "Auto", lang: "", desc: "Matches each message's language" }]
        .concat(voices.map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang, desc: "" })));
}

function renderVoiceCarousel(){
    const orb = document.getElementById("voiceOrb");
    const nameEl = document.getElementById("voiceCarouselName");
    if(!orb || !nameEl) return;

    const options = getVoiceCarouselOptions();
    if(options.length <= 1){
        // Voices often load asynchronously — retry once they're ready.
        speechSynthesis.onvoiceschanged = () => renderVoiceCarousel();
        nameEl.textContent = "Loading voices...";
        document.getElementById("voiceCarouselDesc").textContent = "";
        document.getElementById("voiceCarouselDots").innerHTML = "";
        return;
    }

    const savedUri = localStorage.getItem("zyntra-voice-uri") || "";
    const idx = options.findIndex(o => o.uri === savedUri);
    voiceCarouselIndex = idx === -1 ? 0 : idx;

    updateVoiceCarouselDisplay(options);
}

function updateVoiceCarouselDisplay(options){
    const opt = options[voiceCarouselIndex];

    document.getElementById("voiceCarouselName").textContent = opt.name;
    // Real info only — a browser voice doesn't come with a curated
    // personality description, so we show its actual language instead of
    // inventing one.
    document.getElementById("voiceCarouselDesc").textContent = opt.lang ? `Language: ${opt.lang}` : opt.desc;

    const dotsEl = document.getElementById("voiceCarouselDots");
    dotsEl.innerHTML = "";
    if(options.length <= 10){
        options.forEach((o, i) => {
            const dot = document.createElement("span");
            dot.className = "voice-carousel-dot" + (i === voiceCarouselIndex ? " active" : "");
            dotsEl.appendChild(dot);
        });
    } else {
        const counter = document.createElement("span");
        counter.className = "voice-carousel-counter";
        counter.textContent = `${voiceCarouselIndex + 1} / ${options.length}`;
        dotsEl.appendChild(counter);
    }

    if(opt.uri){
        localStorage.setItem("zyntra-voice-uri", opt.uri);
    } else {
        localStorage.removeItem("zyntra-voice-uri");
    }
}

document.getElementById("voicePrevBtn")?.addEventListener("click", () => {
    const options = getVoiceCarouselOptions();
    voiceCarouselIndex = (voiceCarouselIndex - 1 + options.length) % options.length;
    updateVoiceCarouselDisplay(options);
});

document.getElementById("voiceNextBtn")?.addEventListener("click", () => {
    const options = getVoiceCarouselOptions();
    voiceCarouselIndex = (voiceCarouselIndex + 1) % options.length;
    updateVoiceCarouselDisplay(options);
});

const WORK_OPTIONS = [
    { value: "", label: "Select one" },
    { value: "Engineering", label: "Engineering" },
    { value: "Design", label: "Design" },
    { value: "Marketing", label: "Marketing" },
    { value: "Business", label: "Business" },
    { value: "Student", label: "Student" },
    { value: "Other", label: "Other" }
];

function renderWorkOptions(){
    const picker = document.getElementById("workPicker");
    const label = document.getElementById("workPickerLabel");
    const menu = document.getElementById("workPickerMenu");
    const hiddenSelect = document.getElementById("profileWork");
    if(!picker || !label || !menu || !hiddenSelect) return;

    const current = WORK_OPTIONS.find(o => o.value === hiddenSelect.value) || WORK_OPTIONS[0];
    label.textContent = current.label;

    menu.innerHTML = "";
    WORK_OPTIONS.forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-picker-option" + (opt.value === hiddenSelect.value ? " selected" : "");

        const text = document.createElement("span");
        text.textContent = opt.label;
        btn.appendChild(text);

        if(opt.value === hiddenSelect.value){
            const check = document.createElement("span");
            check.className = "custom-picker-option-check";
            check.textContent = "✓";
            btn.appendChild(check);
        }

        btn.addEventListener("click", () => {
            hiddenSelect.value = opt.value;
            picker.classList.remove("open");
            renderWorkOptions();
        });
        menu.appendChild(btn);
    });
}

document.getElementById("workPickerTrigger")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const picker = document.getElementById("workPicker");
    if(!picker) return;
    const wasOpen = picker.classList.contains("open");
    document.querySelectorAll(".custom-picker.open").forEach(p => p.classList.remove("open"));
    if(!wasOpen) picker.classList.add("open");
});

document.addEventListener("click", () => {
    document.querySelectorAll(".custom-picker.open").forEach(p => p.classList.remove("open"));
});

document.getElementById("voiceTestBtn")?.addEventListener("click", () => {
    speakText("Hi! This is how I'll sound.", navigator.language || "en-US");
});

const MSG_ICONS = {
    copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    feedback: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path></svg>',
    share: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>',
    speaker: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>'
};

function addSpeakRepeatButton(container, text, lang){
    const btn = document.createElement("button");
    btn.className = "msg-action-btn";
    btn.title = "Repeat aloud";
    btn.innerHTML = MSG_ICONS.speaker;
    btn.addEventListener("click", () => {
        speakText(text, lang);
    });
    container.appendChild(btn);
    return btn;
}

function buildMsgCheck(){
    const check = document.createElement("span");
    check.className = "msg-check";
    check.textContent = "✓✓";
    check.title = "Sent";
    return check;
}

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

async function callChatAPI(messages, options){
    const opts = options || {};
    const payload = { messages };
    if(opts.forceSearch) payload.forceSearch = true;
    if(opts.lite) payload.lite = true;

    const headers = { "Content-Type": "application/json" };
    // Sent so the backend can verify who's asking and, if they've connected
    // Google, offer the send_email / create_calendar_event tools for this
    // request. Silently skipped if getIdToken fails — chat still works.
    if(firebase.auth().currentUser){
        try{
            const idToken = await firebase.auth().currentUser.getIdToken();
            headers["Authorization"] = "Bearer " + idToken;
        }catch(err){
            console.error("Couldn't get ID token:", err);
        }
    }

    const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    let data;
    try{
        data = await res.json();
    }catch(parseErr){
        throw new Error(res.status === 504
            ? "The request took too long and timed out. Please try again."
            : "Unexpected response from the server (status " + res.status + "). Please try again.");
    }

    if(!res.ok) throw new Error(data.error || "Request failed");
    return {
        content: data.choices[0].message.content,
        sources: Array.isArray(data.zyntra_sources) ? data.zyntra_sources : [],
        memoryWrites: Array.isArray(data.zyntra_memory_writes) ? data.zyntra_memory_writes : []
    };
}

// Same job as callChatAPI, but the AI's reply arrives in real time instead
// of all at once. onDelta(text) is called with each new piece of text as
// it's generated — the caller is responsible for appending it to whatever
// is shown on screen. Resolves once the reply is complete, with the same
// sources/memoryWrites shape callChatAPI returns.
async function streamChatAPI(messages, onDelta, options){
    const opts = options || {};
    const headers = { "Content-Type": "application/json" };
    if(firebase.auth().currentUser){
        try{
            const idToken = await firebase.auth().currentUser.getIdToken();
            headers["Authorization"] = "Bearer " + idToken;
        }catch(err){
            console.error("Couldn't get ID token:", err);
        }
    }

    const payload = { messages, stream: true };
    if(opts.research) payload.research = true;
    if(opts.website) payload.website = true;

    const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    if(!res.ok || !res.body){
        // Errors are still sent as normal JSON when the request fails
        // before streaming can start (e.g. missing messages).
        let data = {};
        try{ data = await res.json(); }catch{}
        throw new Error(data.error || "Request failed");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sources = [];
    let memoryWrites = [];
    let errorMessage = null;

    while(true){
        const { done, value } = await reader.read();
        if(done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while((boundary = buffer.indexOf("\n\n")) !== -1){
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const line = rawEvent.trim();
            if(!line.startsWith("data:")) continue;

            let payload;
            try{
                payload = JSON.parse(line.slice(5).trim());
            }catch{
                continue; // skip a malformed chunk rather than breaking the whole reply
            }

            if(payload.type === "content" && payload.text){
                onDelta(payload.text);
            } else if(payload.type === "done"){
                sources = Array.isArray(payload.sources) ? payload.sources : [];
                memoryWrites = Array.isArray(payload.memoryWrites) ? payload.memoryWrites : [];
            } else if(payload.type === "error"){
                errorMessage = payload.message || "Something went wrong. Please try again.";
            }
        }
    }

    if(errorMessage) throw new Error(errorMessage);
    return { sources, memoryWrites };
}

// ---------- Generic modal open/close ----------

function openModal(id){
    document.getElementById(id).classList.add("show");
}
function closeModal(id){
    document.getElementById(id).classList.remove("show");
    // If this was the voice assistant (or anything else), stop any speech
    // that might still be playing — closing a modal should silence it.
    if(typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
        if(e.target === overlay){
            overlay.classList.remove("show");
            if(typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
        }
    });
});

document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
        document.querySelectorAll(".modal-overlay.show").forEach(m => m.classList.remove("show"));
        if(typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
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

// ---------- Ads (replaces the old Pro/payment system) ----------
// Zyntra AI no longer has a paid tier — everyone gets full-speed chat and
// image generation. The free message limit still applies (see
// FREE_MESSAGE_LIMIT/isLockedOut above); it's cleared by watching an ad
// instead of upgrading. Ads are shown to every user, all the time.

function isRunningInApp(){
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const isTwaReferrer = document.referrer.startsWith("android-app://");
    return isStandalone || isTwaReferrer;
}

// Set this to true once you have REAL ad slot IDs from an approved AdSense
// account and have replaced YOUR_AD_SLOT_ID / YOUR_SIDEBAR_AD_SLOT_ID in
// index.html with them. Until then, ad slots render nothing — an invalid
// placeholder slot can cause Google's ad script to behave unpredictably.
const AD_SLOT_READY = false;

let adsLoaded = false;

function loadAds(){
    if(!AD_SLOT_READY) return;
    if(adsLoaded) return;
    try{
        document.querySelectorAll("ins.adsbygoogle").forEach(() => {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        });
        adsLoaded = true;
    }catch(err){
        // AdSense script blocked (ad blocker) or not yet approved — fail silently
    }
}

function renderAdSlots(){
    const adBanner = document.getElementById("adBanner");
    const sidebarAdSlot = document.getElementById("sidebarAdSlot");
    if(adBanner) adBanner.style.display = AD_SLOT_READY ? "block" : "none";
    if(sidebarAdSlot) sidebarAdSlot.style.display = AD_SLOT_READY ? "block" : "none";
    loadAds();
}

renderAdSlots();

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
                message: msg
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

    if(loggedIn){
        const email = localStorage.getItem("zyntra-user");
        const profile = getProfile();
        const display = (profile.nickname || profile.fullName || email || "Account").trim();
        const letter = display.charAt(0).toUpperCase();
        nameEl.textContent = display;
        planEl.textContent = "Signed in";
        avatarEl.textContent = letter;
    } else {
        nameEl.textContent = "Guest";
        planEl.textContent = "Sign in";
        avatarEl.textContent = "?";
    }
    renderAdSlots();
    updateDeleteChatBtnVisibility();
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

document.getElementById("topbarSettingsBtn")?.addEventListener("click", handleProfileEntry);
document.getElementById("sidebarUser")?.addEventListener("click", handleProfileEntry);

// ---------- Profile modal ----------

function getProfile(){
    return JSON.parse(localStorage.getItem("zyntra-profile") || "{}");
}

function switchSettingsSection(section){
    document.querySelectorAll(".settings-nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.settingsSection === section);
    });
    document.querySelectorAll(".settings-panel").forEach(panel => {
        panel.style.display = panel.dataset.settingsPanel === section ? "block" : "none";
    });
}

document.querySelectorAll(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchSettingsSection(btn.dataset.settingsSection));
});

function renderProfileModal(){
    const guestView = document.getElementById("profileGuestView");
    const signedInView = document.getElementById("profileSignedInView");

    if(!isLoggedIn()){
        guestView.style.display = "block";
        signedInView.style.display = "none";
        return;
    }

    guestView.style.display = "none";
    signedInView.style.display = "flex";
    switchSettingsSection("personalization");
    renderPinnedChats();
    renderSettingsMemoryList();
    refreshGoogleConnectionStatus();

    const email = localStorage.getItem("zyntra-user");
    const profile = getProfile();

    document.getElementById("profileEmailDisplay").textContent = email;
    document.getElementById("profileFullName").value = profile.fullName || "";
    document.getElementById("profileNickname").value = profile.nickname || "";
    document.getElementById("profileWork").value = profile.work || "";
    document.getElementById("profileInstructions").value = profile.instructions || "";

    const letter = (profile.nickname || profile.fullName || email || "?").trim().charAt(0).toUpperCase();
    document.getElementById("profileAvatar").textContent = letter;

    renderVoiceCarousel();
    renderWorkOptions();
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

function finishSignin(email){
    localStorage.setItem("zyntra-user", email);
    document.getElementById("signinEmail").value = "";
    document.getElementById("signinPass").value = "";
    document.getElementById("signinContext").style.display = "none";
    clearSigninError();
    closeModal("signinModal");
    renderAuthNav();
    renderSidebarHistory();
    showToast("✅ You're signed in successfully!");
}

// ================= Firestore cloud sync =================
// Profile + chat sessions already live in localStorage (read/written by
// getProfile/getSessions/saveSessions elsewhere in this file) so the rest
// of the app works exactly as before. This section mirrors that same data
// to Firestore, keyed by the signed-in Firebase user, so it survives a
// cleared cache and follows the user to a new device — instead of only
// existing in the browser that created it.

let zyntraCloudSyncing = false; // true while pulling down, to avoid an echo save
let zyntraCloudSaveTimer = null;

function zyntraUserDocRef(){
    const user = firebase.auth().currentUser;
    if(!user) return null;
    return db.collection("users").doc(user.uid);
}

// ---- Long-term memory ----
// Durable facts about the user (name, job, ongoing projects, preferences)
// that the AI decides are worth keeping via the remember_fact tool in
// api/chat.js. Stored as a plain array on the same Firestore user doc as
// profile/sessions, cached in localStorage for instant access, and fed
// back into every new conversation's system prompt below.

function getMemories(){
    return JSON.parse(localStorage.getItem("zyntra-memories") || "[]");
}

function saveMemories(memories){
    localStorage.setItem("zyntra-memories", JSON.stringify(memories));
    scheduleCloudSave();
}

// Called after every AI reply with whatever facts it chose to remember
// (zyntra_memory_writes from /api/chat). Skips near-duplicates and caps
// the list so it can't grow without bound.
function addMemories(facts){
    if(!Array.isArray(facts) || facts.length === 0) return;
    if(!getPlugins().memory) return;
    const memories = getMemories();
    facts.forEach(fact => {
        const normalized = (fact || "").trim();
        if(!normalized) return;
        const alreadyKnown = memories.some(m => m.fact.toLowerCase() === normalized.toLowerCase());
        if(alreadyKnown) return;
        memories.push({ fact: normalized, ts: Date.now() });
    });
    // Keep the most recent 60 — plenty for a system-prompt note, and
    // bounded so it never bloats the request payload over time.
    saveMemories(memories.slice(-60));
}

// ---- Projects ----
// Groups of chats that share custom instructions (e.g. "always answer as
// a senior React dev"). Unlike everything else on this page, projects can
// be SHARED between accounts, so they can't live in localStorage or the
// private per-user Firestore doc — they're real documents in a top-level
// `projects` collection, access-controlled by a `members` array (see
// firestore.rules). `projectsCache` is just an in-memory mirror so the
// rest of the UI can keep reading getProjects() synchronously like before.

let projectsCache = [];

async function refreshProjectsCache(){
    if(!isLoggedIn()){ projectsCache = []; return; }
    try{
        const uid = firebase.auth().currentUser.uid;
        const snap = await firebase.firestore().collection("projects").where("members", "array-contains", uid).get();
        projectsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        projectsCache.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }catch(err){
        console.error("Failed to load projects:", err);
    }
}

function getProjects(){
    return projectsCache;
}

const PROJECT_COLORS = ["#7c5cff", "#ff6b8a", "#37c98f", "#ffb545", "#4fb8ff", "#c85cff"];

// Which project (if any) new chats should be tagged with and get their
// custom instructions from. Cleared whenever the user starts a chat that
// isn't explicitly "+ New Chat" from inside a project.
let currentProjectId = null;

async function createProject(name, instructions, color){
    const uid = firebase.auth().currentUser.uid;
    const email = (firebase.auth().currentUser.email || "").toLowerCase();
    const docRef = firebase.firestore().collection("projects").doc();
    const project = {
        name: name.trim(),
        instructions: (instructions || "").trim(),
        color: color || PROJECT_COLORS[0],
        createdAt: Date.now(),
        ownerId: uid,
        members: [uid],
        memberEmails: email ? [email] : []
    };
    await docRef.set(project);
    await refreshProjectsCache();
    return { id: docRef.id, ...project };
}

async function updateProject(id, changes){
    await firebase.firestore().collection("projects").doc(id).update(changes);
    await refreshProjectsCache();
}

async function deleteProject(id){
    await firebase.firestore().collection("projects").doc(id).delete();
    await refreshProjectsCache();
    // Un-tag any of YOUR chats that belonged to this project — their
    // history stays, they just go back to being regular chats. (Chats
    // belong to whoever created them, so this only touches your own.)
    const sessions = getSessions();
    let changed = false;
    sessions.forEach(s => {
        if(s.projectId === id){ s.projectId = null; changed = true; }
    });
    if(changed) saveSessions(sessions);
}

// Invites another Zyntra account (by email) to a project with full
// access. The actual email→uid lookup and members-list write happen in
// api/share-project.js via the Admin SDK — a client can never resolve an
// arbitrary email to a uid itself (see that file's comments).
async function shareProject(projectId, email){
    const idToken = await firebase.auth().currentUser.getIdToken();
    const resp = await fetch("/api/share-project", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
        body: JSON.stringify({ projectId, email })
    });
    const rawText = await resp.text();
    let data;
    try{
        data = rawText ? JSON.parse(rawText) : {};
    }catch(parseErr){
        // The endpoint returned something that isn't JSON at all (often an
        // empty body) — almost always means api/share-project.js hasn't
        // actually been deployed yet, not a real sharing failure.
        throw new Error("The sharing feature isn't live on the server yet — check that api/share-project.js has been deployed.");
    }
    if(!resp.ok) throw new Error(data.error || "Failed to share project.");
    await refreshProjectsCache();
    return data;
}

// ---- Plugins ----
// Toggleable built-in capabilities. Missing/undefined defaults to true so
// existing users see no behavior change until they actually flip something.

const PLUGIN_DEFS = [
    { key: "webSearch", icon: "🔎", color: "#3ea6ff", title: "Web Search & Research", desc: "Let Zyntra search the web for current information, and show the Research mode toggle for deeper, multi-source answers." },
    { key: "googleTools", slug: "google", icon: "📧", color: "#ea4335", title: "Google Tools", desc: "Let a connected Google account be used for Gmail and Calendar actions." },
    { key: "memory", icon: "🧠", color: "#a259ff", title: "Memory", desc: "Let Zyntra remember facts about you across conversations." },
    { key: "imageGen", icon: "🖼️", color: "#37c98f", title: "Image Generator", desc: "Show the Image Generator tool in the sidebar." },
    { key: "codexBuilder", icon: "🧑‍💻", color: "#ffb545", title: "Codex", desc: "Show the Codex (coding + website building) tool in the sidebar." }
];

// Visual-only "coming soon" catalog — these are NOT connected to
// anything real yet (no OAuth, no API calls). They exist purely so the
// Plugins page looks like a real marketplace, same idea as browsing
// ChatGPT's connector directory before you've installed anything. Every
// row is clearly labeled "Soon" and clicking one is honest about that —
// never silently pretend to connect.
//
// `slug` is the Simple Icons (simpleicons.org) identifier used to fetch
// each company's real logo as an SVG, via https://cdn.simpleicons.org —
// a free, open-source icon library maintained specifically for this kind
// of "which apps does X integrate with" use case, not a scrape or
// reproduction of the logo myself. Rendered in white on each brand's own
// color as the background (set via `color` below), matching how the
// built-in plugin icons already look. Entries with no confirmed slug, or
// where the logo fails to load, automatically fall back to the emoji —
// see buildPluginIconEl().
const PLUGIN_COMING_SOON = [
    { slug: "github", icon: "🐙", color: "#24292e", title: "GitHub", desc: "Triage PRs, issues, CI, and publish flows" },
    { slug: "slack", icon: "💬", color: "#4A154B", title: "Slack", desc: "Read and manage Slack" },
    { slug: "microsoftoutlook", icon: "📧", color: "#0072C6", title: "Outlook Email", desc: "Triage Outlook inboxes" },
    { slug: "canva", icon: "🎨", color: "#00C4CC", title: "Canva", desc: "Create, review, edit designs" },
    { slug: "trello", icon: "📋", color: "#0079BF", title: "Trello", desc: "Get things done in Trello" },
    { slug: "notion", icon: "📝", color: "#2f2f2f", title: "Notion", desc: "Notion docs and workflows" },
    { slug: "microsoftoutlook", icon: "📅", color: "#0072C6", title: "Outlook Calendar", desc: "Manage Outlook schedules" },
    { slug: "atlassian", icon: "🔷", color: "#0052CC", title: "Atlassian Rovo", desc: "Manage Jira and Confluence" },
    { slug: "hubspot", icon: "🧡", color: "#FF7A59", title: "HubSpot", desc: "Insights to action in HubSpot" },
    { slug: "supabase", icon: "⚡", color: "#3ECF8E", title: "Supabase", desc: "Manage and query databases" },
    { icon: "🎙️", color: "#7C5CFF", title: "Fathom", desc: "Your meeting insights" },
    { slug: "mondaydotcom", icon: "🔴", color: "#FF3D57", title: "monday.com", desc: "Manage projects, tasks & CRM" },
    { icon: "🥣", color: "#E8A33D", title: "Granola", desc: "Add your meeting context" },
    { icon: "🎤", color: "#4A4A4A", title: "Plaud", desc: "Retrieve insights from Plaud" },
    { slug: "shopify", icon: "🛍️", color: "#95BF47", title: "Shopify", desc: "Create and manage your store" },
    { icon: "🪟", color: "#1E88E5", title: "Windsor.ai", desc: "Connect 330+ data sources" },
    { icon: "🔥", color: "#F2545B", title: "Fireflies", desc: "Search meeting transcripts" },
    { slug: "todoist", icon: "✅", color: "#E44332", title: "Todoist", desc: "To-do list, planner & reminders" },
    { slug: "microsoftteams", icon: "👥", color: "#6264A7", title: "Teams", desc: "Summarize Teams and follow up" },
    { icon: "🔦", color: "#111111", title: "Exa", desc: "Web search for AI agents" },
    { slug: "microsoftsharepoint", icon: "📁", color: "#038387", title: "SharePoint", desc: "Summarize SharePoint content" },
    { slug: "posthog", icon: "📊", color: "#F54E00", title: "PostHog", desc: "Analyze your product data" },
    { icon: "🔍", color: "#2D6CDF", title: "ZoomInfo", desc: "B2B data and GTM insights" },
    { slug: "linear", icon: "📐", color: "#5E6AD2", title: "Linear", desc: "Plan and build products" },
    { icon: "▶️", color: "#26C281", title: "vidIQ", desc: "YouTube stats and keywords" },
    { icon: "🔑", color: "#FF6B35", title: "Ubersuggest", desc: "Find keywords and SEO insights" },
    { slug: "wix", icon: "🌐", color: "#0C6EFC", title: "Wix", desc: "Create your own website" },
    { icon: "🚀", color: "#2E6ADE", title: "Apollo.io", desc: "Find buyers and close deals" },
    { slug: "airtable", icon: "🗂️", color: "#FCB400", title: "Airtable", desc: "Add structured data to Zyntra" },
    { slug: "webflow", icon: "🌊", color: "#4353FF", title: "Webflow", desc: "Manage Webflow sites" },
    { icon: "🎬", color: "#FF4785", title: "Higgsfield", desc: "Every image and video model" },
    { icon: "⚡", color: "#1A1A1A", title: "Superhuman Mail", desc: "Best email + calendar assistant" },
    { slug: "vercel", icon: "▲", color: "#000000", title: "Vercel", desc: "Build and deploy web apps and agents" },
    { icon: "🏢", color: "#003087", title: "NetSuite", desc: "Connect Zyntra to NetSuite" },
    { slug: "asana", icon: "🔺", color: "#F06A6A", title: "Asana", desc: "Turn chats into actions" },
    { icon: "💚", color: "#00E599", title: "Neon", desc: "Manage Neon databases" }
];

// Builds an icon element for a plugin row: a real logo (white, on the
// brand's color) when `def.slug` is set, falling back to the emoji if
// there's no slug or the logo fails to load (wrong/missing Simple Icons
// entry) — never shows a broken image.
function buildPluginIconEl(def, className){
    const icon = document.createElement("div");
    icon.className = className || "plugin-row-icon";
    icon.style.background = def.color;
    if(def.slug){
        const img = document.createElement("img");
        img.src = `https://cdn.simpleicons.org/${def.slug}/ffffff`;
        img.alt = def.title;
        img.className = "plugin-row-icon-img";
        img.onerror = () => { icon.innerHTML = ""; icon.textContent = def.icon; };
        icon.appendChild(img);
    } else {
        icon.textContent = def.icon;
    }
    return icon;
}

function getPlugins(){
    const saved = JSON.parse(localStorage.getItem("zyntra-plugins") || "{}");
    const merged = {};
    PLUGIN_DEFS.forEach(p => { merged[p.key] = saved[p.key] !== false; }); // default true
    return merged;
}

function savePlugins(plugins){
    localStorage.setItem("zyntra-plugins", JSON.stringify(plugins));
    scheduleCloudSave();
}

function setPlugin(key, enabled){
    const plugins = getPlugins();
    plugins[key] = enabled;
    savePlugins(plugins);
    applyPluginVisibility();
}

// Hides/shows sidebar nav items and chat-bar toggles based on the current
// plugin settings — the actual "gating", not just a cosmetic switch.
function applyPluginVisibility(){
    const plugins = getPlugins();

    const imageNav = document.querySelector('.nav-item[data-tool="image"]');
    if(imageNav) imageNav.style.display = plugins.imageGen ? "" : "none";

    const codexNav = document.querySelector('.nav-item[data-tool="codex"]');
    if(codexNav) codexNav.style.display = plugins.codexBuilder ? "" : "none";

    const researchBtn = document.getElementById("researchBtn");
    if(researchBtn) researchBtn.style.display = plugins.webSearch ? "" : "none";
    if(!plugins.webSearch) researchModeEnabled = false;

    const googleCard = document.getElementById("googleConnectionCard");
    if(googleCard) googleCard.style.display = plugins.googleTools ? "" : "none";
}

// ---- Scheduled Tasks ----
// Tasks Zyntra runs automatically on a schedule, even while the app is
// closed. Creation/listing/deletion happens locally + cloud-synced like
// everything else above; actual execution is handled server-side by a
// scheduled job that writes results back here.

function getScheduledTasks(){
    return JSON.parse(localStorage.getItem("zyntra-scheduled") || "[]");
}

function saveScheduledTasks(tasks){
    localStorage.setItem("zyntra-scheduled", JSON.stringify(tasks));
    scheduleCloudSave();
}

function createScheduledTask(prompt, frequency){
    const tasks = getScheduledTasks();
    const task = {
        id: Date.now(),
        prompt: prompt.trim(),
        frequency, // "daily" | "weekly"
        active: true,
        createdAt: Date.now(),
        lastRunAt: null,
        results: [] // { ranAt, reply }
    };
    tasks.unshift(task);
    saveScheduledTasks(tasks);
    return task;
}

function deleteScheduledTask(id){
    saveScheduledTasks(getScheduledTasks().filter(t => t.id !== id));
}

function toggleScheduledTask(id){
    const tasks = getScheduledTasks();
    const task = tasks.find(t => t.id === id);
    if(task) task.active = !task.active;
    saveScheduledTasks(tasks);
}

// ---- Google connection (Gmail / Calendar) ----
// The refresh token itself never touches this browser — it's stored
// server-side by /api/auth/*, keyed to the signed-in Firebase user. This
// section only handles the connect/disconnect UI and status display.

async function refreshGoogleConnectionStatus(){
    const statusEl = document.getElementById("googleConnectionStatus");
    const btn = document.getElementById("googleConnectBtn");
    if(!statusEl || !btn || !firebase.auth().currentUser) return;

    statusEl.textContent = "Checking…";
    try{
        const idToken = await firebase.auth().currentUser.getIdToken();
        const res = await fetch("/api/auth/google-status", {
            headers: { "Authorization": "Bearer " + idToken }
        });
        const data = await res.json();
        if(data.connected){
            statusEl.textContent = data.googleEmail ? `Connected as ${data.googleEmail}` : "Connected";
            btn.textContent = "Disconnect";
            btn.dataset.connected = "true";
        } else {
            statusEl.textContent = "Not connected";
            btn.textContent = "Connect";
            btn.dataset.connected = "false";
        }
    }catch(err){
        console.error("Couldn't check Google connection status:", err);
        statusEl.textContent = "Couldn't check status — try again later.";
    }
}

document.getElementById("googleConnectBtn")?.addEventListener("click", async () => {
    if(!firebase.auth().currentUser) return;
    const btn = document.getElementById("googleConnectBtn");

    if(btn.dataset.connected === "true"){
        confirmAction(
            "Disconnect Google?",
            "Zyntra will no longer be able to send emails or create calendar events on your behalf.",
            async () => {
                try{
                    const idToken = await firebase.auth().currentUser.getIdToken();
                    await fetch("/api/auth/google-disconnect", {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + idToken }
                    });
                    showToast("Google disconnected.");
                    refreshGoogleConnectionStatus();
                }catch(err){
                    console.error("Disconnect failed:", err);
                    showToast("Couldn't disconnect. Please try again.");
                }
            }
        );
        return;
    }

    try{
        btn.disabled = true;
        const idToken = await firebase.auth().currentUser.getIdToken();
        const res = await fetch("/api/auth/google-start", {
            headers: { "Authorization": "Bearer " + idToken }
        });
        const data = await res.json();
        if(!res.ok || !data.url) throw new Error(data.error || "Couldn't start Google connection.");
        window.location.href = data.url; // full navigation — this leaves the app to Google's consent screen
    }catch(err){
        console.error("Connect failed:", err);
        showToast(err.message || "Couldn't connect Google. Please try again.");
        btn.disabled = false;
    }
});

// Google redirects back to "/" with one of these query params after the
// user finishes (or cancels) the consent screen — check once on load.
(function handleGoogleRedirectResult(){
    const params = new URLSearchParams(window.location.search);
    if(params.has("google_connected")){
        showToast("✅ Google connected!");
        window.history.replaceState({}, "", window.location.pathname);
    } else if(params.has("google_error")){
        showToast("⚠️ Google connection failed: " + params.get("google_error"));
        window.history.replaceState({}, "", window.location.pathname);
    }
})();

// Debounced so rapid local writes (e.g. several messages in a row)
// collapse into one Firestore write instead of one per message.
function scheduleCloudSave(){
    if(zyntraCloudSyncing) return;
    clearTimeout(zyntraCloudSaveTimer);
    zyntraCloudSaveTimer = setTimeout(pushLocalToCloud, 1200);
}

async function pushLocalToCloud(){
    const ref = zyntraUserDocRef();
    if(!ref) return;
    try{
        await ref.set({
            profile: getProfile(),
            sessions: getSessions(),
            memories: getMemories(),
            plugins: getPlugins(),
            scheduledTasks: getScheduledTasks(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }catch(err){
        console.error("Zyntra cloud save failed:", err);
    }
}

async function pullCloudToLocal(){
    const ref = zyntraUserDocRef();
    if(!ref) return;
    zyntraCloudSyncing = true;
    try{
        const snap = await ref.get();
        if(snap.exists){
            const data = snap.data() || {};
            if(data.profile) localStorage.setItem("zyntra-profile", JSON.stringify(data.profile));
            if(Array.isArray(data.sessions)) localStorage.setItem("zyntra-sessions", JSON.stringify(data.sessions));
            if(Array.isArray(data.memories)) localStorage.setItem("zyntra-memories", JSON.stringify(data.memories));
            if(data.plugins) localStorage.setItem("zyntra-plugins", JSON.stringify(data.plugins));
            if(Array.isArray(data.scheduledTasks)) localStorage.setItem("zyntra-scheduled", JSON.stringify(data.scheduledTasks));
        } else {
            // Brand new account in Firestore — seed the cloud with
            // whatever this browser already has (e.g. a first chat sent
            // before this sync finished setting up).
            zyntraCloudSyncing = false;
            await pushLocalToCloud();
            return;
        }
    }catch(err){
        console.error("Zyntra cloud pull failed:", err);
    }finally{
        zyntraCloudSyncing = false;
        renderAuthNav();
        renderSidebarHistory();
        applyPluginVisibility();
    }
}

// Runs on every page load AND right after sign-in/sign-up/Google sign-in,
// since all of those trigger onAuthStateChanged — so there's no separate
// hook needed in finishSignin.
firebase.auth().onAuthStateChanged(user => {
    if(user){
        pullCloudToLocal();
        refreshProjectsCache();
    } else {
        projectsCache = [];
    }
});

// Wrap the existing local-save functions (declared earlier in this file)
// so every place that already calls them also schedules a cloud save,
// with no changes needed at any of those call sites.
const zyntraLocalSaveSessions = saveSessions;
saveSessions = function(sessions){
    zyntraLocalSaveSessions(sessions);
    scheduleCloudSave();
};

document.getElementById("profileSaveBtn")?.addEventListener("click", scheduleCloudSave);

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

    const btn = document.getElementById("signinSubmit");
    const original = btn.textContent;
    btn.textContent = isSignupMode ? "Creating account..." : "Signing in...";
    btn.disabled = true;

    if(!isSignupMode){
        firebase.auth().signInWithEmailAndPassword(email, password)
            .then(userCredential => {
                finishSignin(userCredential.user.email);
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
            finishSignin(userCredential.user.email);
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
    const provider = new firebase.auth.GoogleAuthProvider();

    if(isMobileDevice()){
        // Marks that a redirect sign-in is in flight, so if we come back
        // with neither a user nor an error, we can tell the difference
        // between "just a normal page load" and "the redirect silently
        // lost its state" — and say something instead of going quiet.
        sessionStorage.setItem("zyntra-redirect-pending", "1");
        firebase.auth().signInWithRedirect(provider);
        return;
    }

    firebase.auth().signInWithPopup(provider)
        .then(result => {
            finishSignin(result.user.email);
        })
        .catch(err => {
            const msg = firebaseErrorMessage(err.code, err.message);
            if(msg) showSigninError(msg);
        });
});

// Catch the result when returning from a mobile redirect sign-in
const zyntraRedirectWasPending = sessionStorage.getItem("zyntra-redirect-pending") === "1";
sessionStorage.removeItem("zyntra-redirect-pending");

firebase.auth().getRedirectResult()
    .then(result => {
        if(result && result.user){
            finishSignin(result.user.email);
        } else if(zyntraRedirectWasPending){
            // A redirect sign-in was just attempted, but nothing came
            // back — no user, no error either. This usually means the
            // browser (often an embedded/in-app browser rather than
            // Chrome/Safari directly) blocked the storage Firebase needs
            // to carry sign-in state across the redirect. Say so plainly
            // instead of silently reverting to Guest with no explanation.
            console.error('Redirect sign-in returned no user and no error — likely blocked storage in an embedded browser.');
            document.getElementById("signinContext").style.display = "none";
            openModal("signinModal");
            showSigninError("Sign-in didn't complete. If you're inside another app's built-in browser, try opening this site in Chrome or Safari directly and sign in again.");
        }
    })
    .catch(err => {
        console.error('Redirect sign-in error:', err);
        const msg = firebaseErrorMessage(err.code, err.message);
        if(msg){
            document.getElementById("signinContext").style.display = "none";
            openModal("signinModal");
            showSigninError(msg);
        }
    });

// currentSessionId must be declared before renderAuthNav() runs, since
// renderAuthNav -> updateDeleteChatBtnVisibility reads it.
let currentSessionId = null;

renderAuthNav();

// ---------- Chat history (session based sidebar list) ----------

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
            type: activeChatTool || "chat",
            title: cleanTitle.length > 40 ? cleanTitle.slice(0, 40) + "…" : cleanTitle,
            time: Date.now(),
            messages: [],
            projectId: currentProjectId || null
        });
    }

    const session = sessions.find(s => s.id === currentSessionId);
    if(session) session.messages.push({ role, content });
    saveSessions(sessions);
    renderSidebarHistory();
    updateDeleteChatBtnVisibility();

    if(isNewSession && role === "user"){
        generateSessionTitle(currentSessionId, content);
    }
}

async function generateSessionTitle(sessionId, firstMessage){
    try{
        const { content: title } = await callChatAPI([
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

// ---------- History logging for non-chat tools (image / poster / voice) ----------

function logNonChatSession(type, title, extra){
    if(!isLoggedIn()) return;
    const sessions = getSessions();
    const cleanTitle = title.length > 40 ? title.slice(0, 40) + "…" : title;
    const session = Object.assign({
        id: Date.now(),
        type: type,
        title: cleanTitle,
        time: Date.now()
    }, extra);
    sessions.unshift(session);
    saveSessions(sessions);
    renderSidebarHistory();
}

function logImageToHistory(prompt, imageUrl){
    logNonChatSession("image", prompt, { imageUrl: imageUrl, prompt: prompt });
}

function logPosterToHistory(title, posterDataUrl){
    logNonChatSession("poster", title, { posterDataUrl: posterDataUrl });
}

let currentVoiceSessionId = null;

function logVoiceMessageToHistory(role, content){
    if(!isLoggedIn()) return;
    const sessions = getSessions();

    if(!currentVoiceSessionId){
        currentVoiceSessionId = Date.now();
        const cleanTitle = stripMarkdownForTitle(content);
        sessions.unshift({
            id: currentVoiceSessionId,
            type: "voice",
            title: cleanTitle.length > 40 ? cleanTitle.slice(0, 40) + "…" : cleanTitle,
            time: Date.now(),
            messages: []
        });
    }

    const session = sessions.find(s => s.id === currentVoiceSessionId);
    if(session) session.messages.push({ role, content });
    saveSessions(sessions);
    renderSidebarHistory();
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
        title.textContent = (SESSION_TYPE_ICONS[session.type] || SESSION_TYPE_ICONS.chat) + " " + session.title;

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

function deleteChatSession(id){
    const updated = getSessions().filter(s => s.id !== id);
    saveSessions(updated);
    if(currentSessionId === id){
        currentSessionId = null;
        resetChatView();
    }
    renderSidebarHistory();
    renderPinnedChats();
    updateDeleteChatBtnVisibility();
}

const SESSION_TYPE_ICONS = {
    chat: "💬",
    study: "📘",
    code: "💻",
    business: "💼",
    image: "🖼️",
    poster: "🪧",
    voice: "🎤"
};

// ---------- Search chats modal ----------

function renderSearchChatsList(query){
    const list = document.getElementById("searchChatsList");
    if(!list) return;
    list.innerHTML = "";

    if(!isLoggedIn()){
        list.innerHTML = '<p class="search-chats-empty">Sign in to save and search your conversations.</p>';
        return;
    }

    const q = (query || "").trim().toLowerCase();
    const sessions = getSessions().filter(s => !q || s.title.toLowerCase().includes(q));

    if(sessions.length === 0){
        list.innerHTML = q
            ? '<p class="search-chats-empty">No chats match your search.</p>'
            : '<p class="search-chats-empty">No conversations yet. Start chatting!</p>';
        return;
    }

    sessions.forEach(session => {
        const row = document.createElement("div");
        row.className = "search-chats-row" + (session.pinned ? " pinned" : "");
        row.title = session.title;

        const icon = document.createElement("span");
        icon.className = "search-chats-row-icon";
        icon.textContent = SESSION_TYPE_ICONS[session.type] || SESSION_TYPE_ICONS.chat;

        const title = document.createElement("span");
        title.className = "search-chats-row-title";
        title.textContent = session.title;

        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "search-chats-row-action";
        pinBtn.textContent = "📌";
        pinBtn.title = session.pinned ? "Unpin" : "Pin";
        pinBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const all = getSessions();
            const s = all.find(x => x.id === session.id);
            if(s){
                s.pinned = !s.pinned;
                saveSessions(all);
                renderSearchChatsList(document.getElementById("searchChatsInput")?.value || "");
                renderPinnedChats();
            }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "search-chats-row-action";
        deleteBtn.textContent = "🗑";
        deleteBtn.title = "Delete this chat";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            confirmAction(
                "Delete This Chat?",
                "Are you sure you want to delete this conversation? This can't be undone.",
                () => {
                    deleteChatSession(session.id);
                    renderSearchChatsList(document.getElementById("searchChatsInput")?.value || "");
                }
            );
        });

        row.appendChild(icon);
        row.appendChild(title);
        row.appendChild(pinBtn);
        row.appendChild(deleteBtn);
        row.addEventListener("click", () => {
            closeModal("searchChatsModal");
            openSession(session);
        });
        list.appendChild(row);
    });
}

function openSearchChatsModal(){
    openModal("searchChatsModal");
    closeSidebarMobile();
    const input = document.getElementById("searchChatsInput");
    if(input){
        input.value = "";
        renderSearchChatsList("");
        setTimeout(() => input.focus(), 50);
    }
}

document.getElementById("searchChatsBtn")?.addEventListener("click", openSearchChatsModal);
document.getElementById("searchChatsClose")?.addEventListener("click", () => closeModal("searchChatsModal"));
document.getElementById("searchChatsInput")?.addEventListener("input", (e) => {
    renderSearchChatsList(e.target.value);
});

// ==========================
// Projects modal
// ==========================

// ==========================
// Projects page (full-screen, like AI Chat / Image Generator / Codex)
// ==========================

// Switches which of the app's full-page views (chat UI vs Projects vs
// Scheduled) occupies the main content area. Only one is visible at a time.
function showPageView(view){
    document.querySelectorAll(".page-view").forEach(el => el.classList.remove("active"));
    const chatEls = [chatArea, document.getElementById("attachPreview"), document.getElementById("adBanner"), document.querySelector(".chat-input-bar")];

    if(view === "chat"){
        chatEls.forEach(el => { if(el) el.style.display = ""; });
        return;
    }
    chatEls.forEach(el => { if(el) el.style.display = "none"; });
    document.getElementById(view + "View").classList.add("active");
}

function showProjectsScreen(screen){
    document.getElementById("projectsListScreen").style.display = screen === "list" ? "" : "none";
    document.getElementById("projectDetailScreen").style.display = screen === "detail" ? "" : "none";
    document.getElementById("projectShareScreen").style.display = screen === "share" ? "" : "none";
    document.getElementById("projectFormScreen").style.display = screen === "form" ? "" : "none";
}

let projectsActiveFilter = "all";

function renderProjectsList(filterText){
    const list = document.getElementById("projectsList");
    if(!list) return;
    list.innerHTML = "";
    list.classList.remove("is-empty");

    if(!isLoggedIn()){
        list.classList.add("is-empty");
        list.innerHTML = '<div class="page-empty-state"><div class="page-empty-state-icon">📁</div><p>Sign in to create and sync projects</p></div>';
        return;
    }

    // Sharing is real now — filter by actual ownership instead of the
    // old placeholder that always showed "Shared with you" as empty.
    const uid = firebase.auth().currentUser?.uid;
    let projects = getProjects();
    if(projectsActiveFilter === "mine") projects = projects.filter(p => p.ownerId === uid);
    if(projectsActiveFilter === "shared") projects = projects.filter(p => p.ownerId !== uid);

    if(filterText){
        const q = filterText.toLowerCase();
        projects = projects.filter(p => p.name.toLowerCase().includes(q));
    }

    if(projects.length === 0){
        list.classList.add("is-empty");
        const emptyText = filterText
            ? "No projects match your search"
            : (projectsActiveFilter === "shared" ? "Nothing's been shared with you yet" : "No projects yet");
        list.innerHTML = `<div class="page-empty-state"><div class="page-empty-state-icon">📁</div><p>${emptyText}</p></div>`;
        return;
    }

    projects.forEach(project => {
        const card = document.createElement("div");
        card.className = "project-card";

        const dot = document.createElement("div");
        dot.className = "project-card-dot";
        dot.style.background = project.color + "26";
        dot.style.color = project.color;
        dot.textContent = "📁";

        const name = document.createElement("div");
        name.className = "project-card-name";
        name.textContent = project.name;

        const count = document.createElement("div");
        count.className = "project-card-count";
        const chatCount = getSessions().filter(s => s.projectId === project.id).length;
        const memberCount = (project.members || []).length;
        count.textContent = chatCount + (chatCount === 1 ? " chat" : " chats") + (memberCount > 1 ? ` · 👥 ${memberCount}` : "");

        card.appendChild(dot);
        card.appendChild(name);
        card.appendChild(count);
        card.addEventListener("click", () => openProjectDetail(project.id));
        list.appendChild(card);
    });
}

let projectDetailId = null;

function renderMemberChips(container, emails){
    container.innerHTML = "";
    (emails || []).forEach(email => {
        const chip = document.createElement("div");
        chip.className = "project-member-chip";
        const avatar = document.createElement("div");
        avatar.className = "project-member-avatar";
        avatar.textContent = (email[0] || "?").toUpperCase();
        const label = document.createElement("span");
        label.textContent = email;
        chip.appendChild(avatar);
        chip.appendChild(label);
        container.appendChild(chip);
    });
}

function openProjectDetail(id){
    const project = getProjects().find(p => p.id === id);
    if(!project) return;
    projectDetailId = id;
    document.getElementById("projectDetailColorTag").textContent = project.name.toUpperCase();
    document.getElementById("projectDetailColorTag").style.background = project.color + "33";
    document.getElementById("projectDetailColorTag").style.color = project.color;
    document.getElementById("projectDetailName").textContent = project.name;
    document.getElementById("projectDetailInstructions").textContent = project.instructions || "No custom instructions set.";
    renderMemberChips(document.getElementById("projectMembersRow"), project.memberEmails);
    // Only the owner can delete or invite others — a member with shared
    // access shouldn't be able to remove the project out from under the
    // owner or the other members.
    const isOwner = project.ownerId === firebase.auth().currentUser?.uid;
    document.getElementById("projectDeleteBtn").style.display = isOwner ? "" : "none";
    document.getElementById("projectShareBtn").style.display = isOwner ? "" : "none";
    document.getElementById("projectEditBtn").style.display = isOwner ? "" : "none";
    renderProjectChatsList(id);
    showProjectsScreen("detail");
}

function openProjectShare(id){
    const project = getProjects().find(p => p.id === id);
    if(!project) return;
    projectDetailId = id;
    document.getElementById("projectShareTitle").textContent = `Share "${project.name}"`;
    document.getElementById("projectShareEmailInput").value = "";
    document.getElementById("projectShareStatus").textContent = "";
    renderMemberChips(document.getElementById("projectShareMembersList"), project.memberEmails);
    showProjectsScreen("share");
}

async function sendProjectInvite(){
    const input = document.getElementById("projectShareEmailInput");
    const status = document.getElementById("projectShareStatus");
    const email = input.value.trim();
    if(!email){ status.style.color = "var(--danger)"; status.textContent = "Enter an email address."; return; }

    const btn = document.getElementById("projectShareSendBtn");
    btn.disabled = true;
    status.style.color = "var(--text-2)";
    status.textContent = "Sending invite…";
    try{
        const result = await shareProject(projectDetailId, email);
        status.style.color = "#37c98f";
        status.textContent = result.alreadyMember ? "They're already in this project." : `✅ ${email} added — they now have full access.`;
        input.value = "";
        const project = getProjects().find(p => p.id === projectDetailId);
        renderMemberChips(document.getElementById("projectShareMembersList"), project?.memberEmails);
        renderMemberChips(document.getElementById("projectMembersRow"), project?.memberEmails);
    }catch(err){
        status.style.color = "var(--danger)";
        status.textContent = err.message || "Couldn't send that invite.";
    }finally{
        btn.disabled = false;
    }
}

document.getElementById("projectShareBtn")?.addEventListener("click", () => openProjectShare(projectDetailId));
document.getElementById("projectShareBackBtn")?.addEventListener("click", () => showProjectsScreen("detail"));
document.getElementById("projectShareSendBtn")?.addEventListener("click", sendProjectInvite);
document.getElementById("projectShareEmailInput")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter") sendProjectInvite();
});

function renderProjectChatsList(projectId){
    const list = document.getElementById("projectChatsList");
    if(!list) return;
    list.innerHTML = "";
    const sessions = getSessions().filter(s => s.projectId === projectId);
    if(sessions.length === 0){
        list.innerHTML = '<p class="search-chats-empty">No chats in this project yet.</p>';
        return;
    }
    sessions.forEach(session => {
        const row = document.createElement("div");
        row.className = "search-chats-row";
        const icon = document.createElement("span");
        icon.className = "search-chats-row-icon";
        icon.textContent = SESSION_TYPE_ICONS[session.type] || SESSION_TYPE_ICONS.chat;
        const title = document.createElement("span");
        title.className = "search-chats-row-title";
        title.textContent = session.title;
        row.appendChild(icon);
        row.appendChild(title);
        row.addEventListener("click", () => openSession(session));
        list.appendChild(row);
    });
}

let projectFormEditId = null;
let projectFormSelectedColor = PROJECT_COLORS[0];

function renderProjectColorPicker(){
    const picker = document.getElementById("projectColorPicker");
    if(!picker) return;
    picker.innerHTML = "";
    PROJECT_COLORS.forEach(color => {
        const dot = document.createElement("div");
        dot.className = "project-color-dot" + (color === projectFormSelectedColor ? " selected" : "");
        dot.style.background = color;
        dot.addEventListener("click", () => {
            projectFormSelectedColor = color;
            renderProjectColorPicker();
        });
        picker.appendChild(dot);
    });
}

function openProjectForm(editId){
    projectFormEditId = editId || null;
    const project = editId ? getProjects().find(p => p.id === editId) : null;
    document.getElementById("projectFormTag").textContent = editId ? "EDIT PROJECT" : "NEW PROJECT";
    document.getElementById("projectFormTitle").textContent = editId ? "Edit Project" : "New Project";
    document.getElementById("projectNameInput").value = project ? project.name : "";
    document.getElementById("projectInstructionsInput").value = project ? project.instructions : "";
    projectFormSelectedColor = project ? project.color : PROJECT_COLORS[0];
    renderProjectColorPicker();
    showProjectsScreen("form");
    setTimeout(() => document.getElementById("projectNameInput").focus(), 50);
}

document.getElementById("navProjects")?.addEventListener("click", async () => {
    if(!isLoggedIn()){
        openModal("signinModal");
        closeSidebarMobile();
        return;
    }
    currentProjectId = null;
    setActiveNav("projects");
    showProjectsScreen("list");
    document.getElementById("projectsSearchInput").value = "";
    projectsActiveFilter = "all";
    document.querySelectorAll(".page-view-tab").forEach(t => t.classList.toggle("active", t.dataset.projectFilter === "all"));
    showPageView("projects");
    closeSidebarMobile();
    document.getElementById("projectsList").classList.add("is-empty");
    document.getElementById("projectsList").innerHTML = '<div class="page-empty-state"><div class="page-empty-state-icon">⏳</div><p>Loading projects…</p></div>';
    await refreshProjectsCache();
    renderProjectsList("");
});
document.querySelectorAll(".page-view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        projectsActiveFilter = tab.dataset.projectFilter;
        document.querySelectorAll(".page-view-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderProjectsList(document.getElementById("projectsSearchInput").value);
    });
});
document.getElementById("projectsSearchInput")?.addEventListener("input", (e) => renderProjectsList(e.target.value));
document.getElementById("newProjectBtn")?.addEventListener("click", () => openProjectForm(null));
document.getElementById("projectBackBtn")?.addEventListener("click", () => { showProjectsScreen("list"); renderProjectsList(""); });
document.getElementById("projectFormBackBtn")?.addEventListener("click", () => {
    showProjectsScreen(projectFormEditId ? "detail" : "list");
    if(!projectFormEditId) renderProjectsList("");
});
document.getElementById("projectCancelBtn")?.addEventListener("click", () => {
    showProjectsScreen(projectFormEditId ? "detail" : "list");
    if(!projectFormEditId) renderProjectsList("");
});
document.getElementById("projectSaveBtn")?.addEventListener("click", async () => {
    const name = document.getElementById("projectNameInput").value.trim();
    if(!name){ showToast("Give the project a name first."); return; }
    const instructions = document.getElementById("projectInstructionsInput").value.trim();
    const btn = document.getElementById("projectSaveBtn");
    btn.disabled = true;
    try{
        if(projectFormEditId){
            await updateProject(projectFormEditId, { name, instructions, color: projectFormSelectedColor });
            openProjectDetail(projectFormEditId);
        } else {
            await createProject(name, instructions, projectFormSelectedColor);
            showProjectsScreen("list");
            renderProjectsList("");
        }
    }catch(err){
        showToast("Couldn't save the project. Please try again.");
    }finally{
        btn.disabled = false;
    }
});
document.getElementById("projectEditBtn")?.addEventListener("click", () => openProjectForm(projectDetailId));
document.getElementById("projectDeleteBtn")?.addEventListener("click", () => {
    const project = getProjects().find(p => p.id === projectDetailId);
    if(!project) return;
    confirmAction(
        "Delete This Project?",
        `Are you sure you want to delete "${project.name}"? Its chats will stay in your history, just no longer grouped together.`,
        async () => {
            await deleteProject(projectDetailId);
            showProjectsScreen("list");
            renderProjectsList("");
        }
    );
});
document.getElementById("projectNewChatBtn")?.addEventListener("click", () => {
    currentProjectId = projectDetailId;
    resetChatView();
    activeChatTool = "chat";
    applyToolGreeting("chat");
    userInput.placeholder = TOOL_PLACEHOLDERS.chat;
    setActiveNav("chat");
    showPageView("chat");
    showToast("💬 New chat started in this project");
});

// ==========================
// Plugins page (full-screen marketplace, like Projects/Scheduled)
// ==========================

function renderPluginsInstalledRow(){
    const row = document.getElementById("pluginsInstalledRow");
    const label = document.getElementById("pluginsInstalledLabel");
    if(!row) return;
    row.innerHTML = "";
    const plugins = getPlugins();
    const installed = PLUGIN_DEFS.filter(def => plugins[def.key]);

    if(installed.length === 0){
        label.style.display = "none";
        row.style.display = "none";
        return;
    }
    label.style.display = "";
    row.style.display = "";

    installed.forEach(def => {
        const tile = document.createElement("div");
        tile.className = "plugin-icon-tile";
        tile.title = def.title;
        const square = buildPluginIconEl(def, "plugin-icon-tile-square");
        const label2 = document.createElement("span");
        label2.className = "label";
        label2.textContent = def.title;
        tile.appendChild(square);
        tile.appendChild(label2);
        tile.addEventListener("click", () => {
            const targetRow = document.querySelector(`.plugin-row[data-key="${def.key}"]`);
            if(targetRow){
                targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
                targetRow.classList.add("flash");
                setTimeout(() => targetRow.classList.remove("flash"), 900);
            }
        });
        row.appendChild(tile);
    });
}

function renderPluginsList(filterText){
    const list = document.getElementById("pluginsList");
    if(!list) return;
    list.innerHTML = "";
    const plugins = getPlugins();

    let defs = PLUGIN_DEFS;
    if(filterText){
        const q = filterText.toLowerCase();
        defs = defs.filter(d => d.title.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q));
    }

    if(defs.length === 0){
        list.innerHTML = '<div class="page-empty-state" style="grid-column:1/-1;"><div class="page-empty-state-icon">🧩</div><p>No plugins match your search</p></div>';
        return;
    }

    defs.forEach(def => {
        const row = document.createElement("div");
        row.className = "plugin-row";
        row.dataset.key = def.key;

        const left = document.createElement("div");
        left.style.cssText = "display:flex; align-items:flex-start;";
        const icon = buildPluginIconEl(def);
        const textWrap = document.createElement("div");
        const title = document.createElement("div");
        title.className = "plugin-row-title";
        title.textContent = def.title;
        const desc = document.createElement("div");
        desc.className = "plugin-row-desc";
        desc.textContent = def.desc;
        textWrap.appendChild(title);
        textWrap.appendChild(desc);
        left.appendChild(icon);
        left.appendChild(textWrap);

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "plugin-row-switch";
        toggle.checked = plugins[def.key];
        toggle.addEventListener("change", () => {
            setPlugin(def.key, toggle.checked);
            renderPluginsInstalledRow();
            showToast((toggle.checked ? "✅ " : "🚫 ") + def.title + (toggle.checked ? " enabled" : " disabled"));
        });

        row.appendChild(left);
        row.appendChild(toggle);
        list.appendChild(row);
    });
}

document.getElementById("navPlugins")?.addEventListener("click", () => {
    setActiveNav("plugins");
    document.getElementById("pluginsSearchInput").value = "";
    renderPluginsInstalledRow();
    renderPluginsList("");
    renderComingSoonPlugins("");
    showPageView("plugins");
    closeSidebarMobile();
});
document.getElementById("pluginsSearchInput")?.addEventListener("input", (e) => {
    renderPluginsList(e.target.value);
    renderComingSoonPlugins(e.target.value);
});

function renderComingSoonPlugins(filterText){
    const list = document.getElementById("pluginsComingSoonList");
    if(!list) return;
    list.innerHTML = "";

    let items = PLUGIN_COMING_SOON;
    if(filterText){
        const q = filterText.toLowerCase();
        items = items.filter(d => d.title.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q));
    }

    items.forEach(def => {
        const row = document.createElement("div");
        row.className = "plugin-row coming-soon";

        const left = document.createElement("div");
        left.style.cssText = "display:flex; align-items:flex-start;";
        const icon = buildPluginIconEl(def);
        const textWrap = document.createElement("div");
        const title = document.createElement("div");
        title.className = "plugin-row-title";
        title.textContent = def.title;
        const desc = document.createElement("div");
        desc.className = "plugin-row-desc";
        desc.textContent = def.desc;
        textWrap.appendChild(title);
        textWrap.appendChild(desc);
        left.appendChild(icon);
        left.appendChild(textWrap);

        const badge = document.createElement("span");
        badge.className = "plugin-soon-badge";
        badge.textContent = "Soon";

        row.appendChild(left);
        row.appendChild(badge);
        row.addEventListener("click", () => showToast(`🔒 ${def.title} isn't connected yet — coming soon`));
        list.appendChild(row);
    });
}

// ==========================
// Scheduled page (full-screen))
// ==========================

const SCHEDULED_RECOMMENDED = [
    { icon: "🌅", title: "Daily brief", prompt: "Give me a short daily briefing on the topics I care about most", frequency: "daily" },
    { icon: "📖", title: "Weekend long read", prompt: "Every Saturday, find me one exceptional recent long read based on my interests", frequency: "weekly" },
    { icon: "💡", title: "Fresh ideas", prompt: "Give me 3 fresh business ideas for a small budget", frequency: "weekly" },
    { icon: "📈", title: "Weekly recap", prompt: "Summarize the biggest news in tech and AI from this week", frequency: "weekly" }
];

let scheduledShowActiveOnly = true;

function renderScheduledRecommended(){
    const wrap = document.getElementById("scheduledRecommendedList");
    if(!wrap) return;
    wrap.innerHTML = "";
    SCHEDULED_RECOMMENDED.forEach(rec => {
        const row = document.createElement("div");
        row.className = "scheduled-task-row";

        const icon = document.createElement("span");
        icon.className = "scheduled-task-icon";
        icon.textContent = rec.icon;

        const body = document.createElement("div");
        body.className = "scheduled-task-body";
        const title = document.createElement("div");
        title.className = "scheduled-task-title";
        title.textContent = rec.title;
        const desc = document.createElement("div");
        desc.className = "scheduled-task-desc";
        desc.textContent = rec.prompt;
        body.appendChild(title);
        body.appendChild(desc);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "scheduled-task-action";
        addBtn.textContent = "+";
        addBtn.title = "Add this task";
        addBtn.addEventListener("click", () => {
            if(!isLoggedIn()){ openModal("signinModal"); return; }
            createScheduledTask(rec.prompt, rec.frequency);
            renderScheduledList();
            showToast("🕐 Added: " + rec.title);
        });

        row.appendChild(icon);
        row.appendChild(body);
        row.appendChild(addBtn);
        wrap.appendChild(row);
    });
}

function renderScheduledList(){
    const list = document.getElementById("scheduledList");
    const label = document.getElementById("scheduledTasksLabel");
    if(!list) return;
    list.innerHTML = "";

    if(!isLoggedIn()){
        label.style.display = "none";
        return;
    }

    let tasks = getScheduledTasks();
    if(scheduledShowActiveOnly) tasks = tasks.filter(t => t.active);

    if(tasks.length === 0){
        label.style.display = "none";
        return;
    }
    label.style.display = "";

    tasks.forEach(task => {
        const row = document.createElement("div");
        row.className = "scheduled-task-row";

        const icon = document.createElement("span");
        icon.className = "scheduled-task-icon";
        icon.textContent = "🕐";

        const body = document.createElement("div");
        body.className = "scheduled-task-body";
        const title = document.createElement("div");
        title.className = "scheduled-task-title";
        title.textContent = task.prompt;
        const meta = document.createElement("div");
        meta.className = "scheduled-task-desc";
        const lastRun = task.lastRunAt ? `Last ran ${timeAgo(task.lastRunAt)}` : "Not run yet";
        meta.textContent = (task.frequency === "daily" ? "Daily" : "Weekly") + " — " + lastRun;
        body.appendChild(title);
        body.appendChild(meta);
        if(task.results && task.results.length){
            const lastResult = task.results[task.results.length - 1];
            const resultPreview = document.createElement("div");
            resultPreview.className = "scheduled-task-result";
            resultPreview.textContent = "💬 " + (lastResult.reply.length > 110 ? lastResult.reply.slice(0, 110) + "…" : lastResult.reply);
            body.appendChild(resultPreview);
        }

        const status = document.createElement("span");
        status.className = "scheduled-task-status";
        status.textContent = task.active ? "Active" : "Paused";
        status.title = "Click to " + (task.active ? "pause" : "resume");
        status.addEventListener("click", () => {
            toggleScheduledTask(task.id);
            renderScheduledList();
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "scheduled-task-action";
        deleteBtn.textContent = "🗑";
        deleteBtn.title = "Delete this task";
        deleteBtn.addEventListener("click", () => {
            deleteScheduledTask(task.id);
            renderScheduledList();
        });

        row.appendChild(icon);
        row.appendChild(body);
        row.appendChild(status);
        row.appendChild(deleteBtn);
        list.appendChild(row);
    });
}

document.getElementById("navScheduled")?.addEventListener("click", () => {
    if(!isLoggedIn()){
        openModal("signinModal");
        closeSidebarMobile();
        return;
    }
    currentProjectId = null;
    setActiveNav("scheduled");
    renderScheduledList();
    renderScheduledRecommended();
    showPageView("scheduled");
    closeSidebarMobile();
});

document.getElementById("scheduledFilterBtn")?.addEventListener("click", () => {
    scheduledShowActiveOnly = !scheduledShowActiveOnly;
    document.getElementById("scheduledFilterLabel").textContent = scheduledShowActiveOnly ? "Active" : "All";
    renderScheduledList();
});

let scheduledQuickFrequency = "daily";

function createScheduledTaskFromQuickBar(){
    const input = document.getElementById("scheduledQuickInput");
    const prompt = input.value.trim();
    if(!prompt){ showToast("Describe what Zyntra should do first."); return; }
    if(!isLoggedIn()){ openModal("signinModal"); return; }
    createScheduledTask(prompt, scheduledQuickFrequency);
    input.value = "";
    renderScheduledList();
    showToast("🕐 Scheduled task created");
}
document.getElementById("scheduledInputPlus")?.addEventListener("click", () => document.getElementById("scheduledQuickInput").focus());
document.getElementById("scheduledQuickSend")?.addEventListener("click", createScheduledTaskFromQuickBar);
document.getElementById("scheduledQuickInput")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter") createScheduledTaskFromQuickBar();
});

// Custom frequency dropdown (Daily/Weekly) — see the CSS comment on
// .custom-select for why this isn't a native <select>.
document.getElementById("scheduledFrequencyBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("scheduledFrequencyMenu").classList.toggle("open");
});
document.querySelectorAll("#scheduledFrequencyMenu .custom-select-option").forEach(opt => {
    opt.addEventListener("click", () => {
        scheduledQuickFrequency = opt.dataset.value;
        document.getElementById("scheduledFrequencyLabel").textContent = opt.textContent;
        document.querySelectorAll("#scheduledFrequencyMenu .custom-select-option").forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
        document.getElementById("scheduledFrequencyMenu").classList.remove("open");
    });
});
document.addEventListener("click", () => {
    document.getElementById("scheduledFrequencyMenu")?.classList.remove("open");
});

applyPluginVisibility();

function buildSidebarHistoryRow(session){
    const row = document.createElement("div");
    row.className = "sidebar-history-row" + (session.pinned ? " pinned" : "");
    row.title = session.title;

    const icon = document.createElement("span");
    icon.className = "shr-icon";
    icon.textContent = SESSION_TYPE_ICONS[session.type] || SESSION_TYPE_ICONS.chat;

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
            () => deleteChatSession(session.id)
        );
    });

    row.appendChild(icon);
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

document.getElementById("searchChatsClearBtn")?.addEventListener("click", () => {
    if(!isLoggedIn()) return;
    confirmAction(
        "Clear All History?",
        "Are you sure you want to delete every saved conversation? This can't be undone.",
        () => {
            saveSessions([]);
            currentSessionId = null;
            renderSidebarHistory();
            renderPinnedChats();
            renderSearchChatsList(document.getElementById("searchChatsInput")?.value || "");
        }
    );
});

function openSession(session){
    showPageView("chat");
    const type = session.type || "chat";
    if(type === "image" && session.imageUrl){
        openImageSession(session);
    } else if(type === "poster"){
        openPosterSession(session);
    } else if(type === "voice"){
        openVoiceSession(session);
    } else {
        openChatSession(session);
    }
    closeSidebarMobile();
}

function openChatSession(session){
    activeChatTool = session.type || "chat";
    currentProjectId = session.projectId || null;
    setActiveNav(activeChatTool);
    if(TOOL_PLACEHOLDERS[activeChatTool]) userInput.placeholder = TOOL_PLACEHOLDERS[activeChatTool];

    chatHistory = session.messages.map(m => ({ role: m.role, content: m.content }));
    currentSessionId = session.id;
    document.getElementById("chatGreeting").style.display = "none";
    chatMessages.innerHTML = "";
    session.messages.forEach(m => {
        if(m.role === "user"){
            const div = document.createElement("div");
            div.className = "user-message";
            const p = document.createElement("p");
            p.style.margin = "0";
            p.textContent = m.content;
            div.appendChild(p);
            div.appendChild(buildMsgCheck());
            chatMessages.appendChild(div);
        } else {
            const div = document.createElement("div");
            div.className = "ai-message done";
            const avatar = document.createElement("img");
            avatar.src = "favicon.png";
            avatar.alt = "";
            avatar.className = "ai-message-avatar";
            const content = document.createElement("div");
            content.className = "ai-message-content";
            content.innerHTML = formatAIText(m.content);
            div.appendChild(avatar);
            div.appendChild(content);
            chatMessages.appendChild(div);
        }
    });
    chatArea.scrollTop = chatArea.scrollHeight;
    updateDeleteChatBtnVisibility();
}

function openImageSession(session){
    openModal("imageModal");
    const input = document.getElementById("imageInput");
    const result = document.getElementById("imageResult");
    if(input) input.value = session.prompt || "";
    if(!result) return;
    result.innerHTML = "";
    const img = document.createElement("img");
    img.className = "generated-img";
    img.alt = session.title || "Generated image";
    img.src = session.imageUrl;
    result.appendChild(img);

    const actionsRow = document.createElement("div");
    actionsRow.style.display = "flex";
    actionsRow.style.gap = "8px";
    actionsRow.style.marginTop = "8px";
    result.appendChild(actionsRow);

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "copy-btn";
    downloadBtn.textContent = "⬇ Download";
    downloadBtn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = session.imageUrl;
        a.download = "zyntra-ai-image.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
    });
    actionsRow.appendChild(downloadBtn);
}

function openPosterSession(session){
    openModal("posterModal");
    const result = document.getElementById("posterResult");
    if(!result) return;
    result.innerHTML = "";
    const img = document.createElement("img");
    img.className = "generated-img";
    img.alt = session.title || "Generated poster";
    img.src = session.posterDataUrl;
    result.appendChild(img);

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
        a.href = session.posterDataUrl;
        a.download = "zyntra-ai-poster.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
    });
    actionsRow.appendChild(downloadBtn);
}

function openVoiceSession(session){
    openModal("voiceModal");
    voiceHistory = session.messages.map(m => ({ role: m.role, content: m.content }));
    currentVoiceSessionId = session.id;
    voiceBox.innerHTML = "";
    session.messages.forEach(m => {
        addVoiceMsg(m.content, m.role === "user" ? "user" : "ai");
    });
}

// ---------- New chat ----------

function resetChatView(){
    // Any messages already sent were saved to chat history live as they
    // happened (see logMessageToHistory), so this just clears the view.
    chatHistory = [];
    currentSessionId = null;
    chatMessages.innerHTML = "";
    document.getElementById("chatGreeting").style.display = "";
    renderPromptSuggestions();
    updateDeleteChatBtnVisibility();
}function updateDeleteChatBtnVisibility(){
    const btn = document.getElementById("deleteChatBtn");
    if(!btn) return;
    btn.style.display = (currentSessionId && isLoggedIn()) ? "flex" : "none";
}

document.getElementById("deleteChatBtn")?.addEventListener("click", () => {
    if(!currentSessionId) return;
    const idToDelete = currentSessionId;
    confirmAction(
        "Delete This Chat?",
        "Are you sure you want to delete this conversation? This can't be undone.",
        () => deleteChatSession(idToDelete)
    );
});

document.getElementById("newChatBtn")?.addEventListener("click", () => {
    currentProjectId = null;
    showPageView("chat");
    resetChatView();
    closeSidebarMobile();
    userInput.focus();
});

// ---------- Theme toggle ----------

const themeToggle = document.getElementById("themeToggle");

function applyTheme(isLight){
    document.body.classList.toggle("light-mode", isLight);
    if(themeToggle) themeToggle.textContent = isLight ? "☀️" : "🌙";
    localStorage.setItem("zyntra-theme", isLight ? "light" : "dark");
    document.querySelectorAll(".settings-theme-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.theme === (isLight ? "light" : "dark"));
    });
}

applyTheme(localStorage.getItem("zyntra-theme") === "light");

themeToggle?.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("light-mode"));
});

document.querySelectorAll(".settings-theme-btn").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme === "light"));
});

document.getElementById("settingsClearHistoryBtn")?.addEventListener("click", () => {
    if(!isLoggedIn()) return;
    confirmAction(
        "Clear All History?",
        "Are you sure you want to delete every saved conversation? This can't be undone.",
        () => {
            saveSessions([]);
            currentSessionId = null;
            renderSidebarHistory();
            renderPinnedChats();
            renderSearchChatsList(document.getElementById("searchChatsInput")?.value || "");
        }
    );
});

function renderSettingsMemoryList(){
    const list = document.getElementById("settingsMemoryList");
    const empty = document.getElementById("settingsMemoryEmpty");
    if(!list || !empty) return;

    const memories = getMemories();
    list.innerHTML = "";
    if(memories.length === 0){
        empty.style.display = "block";
        return;
    }
    empty.style.display = "none";
    // Most recently learned first.
    [...memories].reverse().forEach(m => {
        const li = document.createElement("li");
        li.textContent = m.fact;
        list.appendChild(li);
    });
}

document.querySelectorAll('.settings-nav-item[data-settings-section="data"]').forEach(btn => {
    btn.addEventListener("click", renderSettingsMemoryList);
});

document.getElementById("settingsClearMemoryBtn")?.addEventListener("click", () => {
    if(!isLoggedIn()) return;
    confirmAction(
        "Clear Everything Remembered?",
        "This deletes every fact Zyntra has learned about you across all your conversations. This can't be undone.",
        () => {
            saveMemories([]);
            renderSettingsMemoryList();
        }
    );
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
let attachedDocument = null; // { name, text } — set once client-side extraction finishes

// ---------- Centered input on empty chat, moves to the bottom once a
// conversation starts (like ChatGPT's home screen) ----------

function updateInputBarLayout(){
    const inputBar = document.querySelector(".chat-input-bar");
    const greeting = document.getElementById("chatGreeting");
    const mainArea = document.querySelector(".main-area");
    if(!inputBar || !greeting || !mainArea) return;

    const isEmpty = chatMessages.children.length === 0;

    if(isEmpty){
        if(inputBar.parentElement !== greeting){
            greeting.appendChild(inputBar);
        }
        mainArea.classList.add("centered-input");
    } else {
        if(inputBar.parentElement !== mainArea){
            mainArea.appendChild(inputBar);
        }
        mainArea.classList.remove("centered-input");
    }
}

new MutationObserver(updateInputBarLayout).observe(chatMessages, { childList: true });
updateInputBarLayout();

document.getElementById("attachBtn").addEventListener("click", () => {
    document.getElementById("chatFileInput").click();
});

document.getElementById("chatFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;

    if(file.type.startsWith("image/")){
        attachedDocument = null;
        const reader = new FileReader();
        reader.onload = () => {
            attachedImage = reader.result;
            renderAttachPreview();
        };
        reader.readAsDataURL(file);
        return;
    }

    extractDocumentText(file)
        .then(text => {
            attachedImage = null;
            // Cap what actually gets sent to the AI — long enough for real
            // documents, short enough to not blow past model context limits
            // (trimMessages on the backend caps history separately anyway).
            const MAX_CHARS = 15000;
            attachedDocument = {
                name: file.name,
                text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n\n[...truncated, document continues beyond this point...]" : text,
                truncated: text.length > MAX_CHARS
            };
            renderAttachPreview();
        })
        .catch(err => {
            console.error("Document extraction failed:", err);
            showToast("⚠️ Couldn't read that file: " + (err.message || "unsupported format"));
            document.getElementById("chatFileInput").value = "";
        });
});

// Pulls plain text out of a PDF, Word doc, Excel sheet, or plain text/CSV
// file — entirely in the browser, so an attached document is ready to
// discuss immediately with no server round-trip. Returns a Promise<string>.
async function extractDocumentText(file){
    const name = file.name.toLowerCase();

    if(name.endsWith(".pdf")){
        if(!window.pdfjsLib) throw new Error("PDF reader didn't load — check your connection and try again.");
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        let text = "";
        const pageCount = Math.min(pdf.numPages, 60); // sane cap for very long PDFs
        for(let i = 1; i <= pageCount; i++){
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(" ") + "\n\n";
        }
        if(!text.trim()) throw new Error("This PDF has no selectable text (it may be a scanned image).");
        return text.trim();
    }

    if(name.endsWith(".docx") || name.endsWith(".doc")){
        if(!window.mammoth) throw new Error("Word document reader didn't load — check your connection and try again.");
        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        if(!result.value.trim()) throw new Error("Couldn't find any text in that document.");
        return result.value.trim();
    }

    if(name.endsWith(".xlsx") || name.endsWith(".xls")){
        if(!window.XLSX) throw new Error("Spreadsheet reader didn't load — check your connection and try again.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        let text = "";
        workbook.SheetNames.forEach(sheetName => {
            text += `--- Sheet: ${sheetName} ---\n`;
            text += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]) + "\n\n";
        });
        return text.trim();
    }

    if(name.endsWith(".txt") || name.endsWith(".csv")){
        return await file.text();
    }

    throw new Error("Unsupported file type. Try a PDF, Word doc, Excel sheet, CSV, or plain text file.");
}

function renderAttachPreview(){
    const preview = document.getElementById("attachPreview");
    preview.innerHTML = "";

    if(attachedImage){
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
        return;
    }

    if(attachedDocument){
        const chip = document.createElement("div");
        chip.className = "attach-doc-chip";
        const wordCount = attachedDocument.text.split(/\s+/).filter(Boolean).length;
        chip.innerHTML = `<span class="attach-doc-icon">📄</span>`
            + `<span class="attach-doc-info"><strong>${attachedDocument.name}</strong>`
            + `<small>${wordCount.toLocaleString()} words extracted${attachedDocument.truncated ? " (truncated)" : ""}</small></span>`;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            attachedDocument = null;
            document.getElementById("chatFileInput").value = "";
            renderAttachPreview();
        });
        chip.appendChild(removeBtn);
        preview.appendChild(chip);
    }
}

// Fallback-only heuristic, used solely if the AI classification call itself
// fails (e.g. a network error) — kept intentionally conservative since the
// AI classifier below is what actually carries this most of the time.
function looksLikeImagePrompt(msg){
    const text = (msg || "").trim();
    if(!text) return false;

    const words = text.split(/\s+/);

    const conversationalStart = /^(bro|hey|hi+|hello|yo|sup|thanks|thank you|thx|nice|wow|cool|amazing|great|awesome|good|lol+|haha+|ok(ay)?|perfect|love it|not bad|damn|omg|nice one|nice work|good job|well done|bhai|yaar|what|why|how|who|when|where|let|lets|let's|please|pls|plz|stop|wait|no|nah|don't|dont|cancel|undo|enough|never ?mind)\b/i;
    if(conversationalStart.test(text) && words.length <= 8){
        return false;
    }

    if(/^(can you|could you|do you|are you|what is|what's|who are you|how do|how does|why|is this|is that)\b/i.test(text) && text.endsWith("?")){
        return false;
    }

    return true;
}

// Statements that only express a wish to create *something*, without ever
// saying what — "i want to make image", "let's create something", "make a
// picture" — should prompt the AI to ask what to create, not generate a
// random image from that vague phrase. Checked before anything else.
function isVagueImageIntent(msg){
    const text = (msg || "").trim().toLowerCase().replace(/[.!]+$/, "");
    return /^(i want to (make|create|draw|generate)( an?)? (image|picture|photo)s?|i want (an?|to make) (image|picture|photo)|let'?s (make|create|draw|generate)( an?)? (image|picture|photo|something)|make (an?|the) (image|picture|photo)|create (an?|the) (image|picture|photo)|generate (an?|the) (image|picture|photo)|can (you|u) make (an?|me an?) (image|picture|photo))$/i.test(text);
}

function parseImageIntentReply(content){
    const clean = (content || "").trim().toLowerCase();
    if(clean.startsWith("image")) return true;
    if(clean.startsWith("chat")) return false;
    if(/\bimage\b/.test(clean) && !/\bchat\b/.test(clean)) return true;
    if(/\bchat\b/.test(clean) && !/\bimage\b/.test(clean)) return false;
    return null; // genuinely ambiguous — let the caller fall back to the heuristic
}

// Asks the AI itself whether this message is a request to generate a new
// image, or something else (a reply, question, complaint, greeting, command,
// or vague statement of intent). Far more reliable than pattern-matching
// alone — the few-shot examples below directly cover cases regex missed:
// "please stop", complaints like "you made it look ugly", and vague intent
// like "i want to make image" with no actual subject.
async function classifyImageIntent(msg){
    const text = (msg || "").trim();
    const wordCount = text.split(/\s+/).length;

    if(isVagueImageIntent(text)){
        return false;
    }

    // Skip the round trip entirely for messages that are unambiguous —
    // a reasonably long message that doesn't open with a casual/reactive
    // word is virtually always a real image description. This also cuts
    // total API call volume, which helps avoid rate limits.
    const conversationalStart = /^(bro|hey|hi+|hello|yo|sup|thanks|thank you|thx|nice|wow|cool|amazing|great|awesome|good|lol+|haha+|ok(ay)?|perfect|not bad|damn|omg|what|why|how|who|when|where|let|lets|let's|can|could|do|are|is|please|pls|plz|stop|wait|no|nah|don't|dont|cancel|undo|enough)\b/i;
    if(wordCount >= 7 && !conversationalStart.test(text)){
        return true;
    }

    try{
        const { content } = await callChatAPI([
            {
                role: "user",
                content: `You are classifying a message sent inside an AI image-generation chat. Reply with exactly one word: IMAGE or CHAT.

IMAGE = the message describes an actual picture to create — a subject, scene, object, or style (e.g. "a dragon flying over mountains", "make the sky purple", "add a hat to the girl").

CHAT = anything else: greetings, thanks, questions, complaints about a result, commands directed at the assistant (stop, wait, please, don't, cancel, undo, no), or vague statements of intent with no real subject (e.g. "i want to make an image", "make an image", "let's create something").

Examples:
"a cat astronaut in space" -> IMAGE
"make the sky purple" -> IMAGE
"please stop" -> CHAT
"what u make it look so ugly" -> CHAT
"i want to make image" -> CHAT
"thanks!" -> CHAT
"can you make it bigger?" -> CHAT

Message: "${msg}"

Answer with exactly one word: IMAGE or CHAT.`
            }
        ], { lite: true });
        const parsed = parseImageIntentReply(content);
        return parsed === null ? looksLikeImagePrompt(msg) : parsed;
    }catch(err){
        return looksLikeImagePrompt(msg);
    }
}

// A single, warm, human fallback message used anywhere a reply genuinely
// fails — instead of a cold "something went wrong", or a swallowed error.
function friendlyErrorMessage(err){
    const msg = (err && err.message) ? err.message.trim() : "";
    if(/took too long|timed out|timeout/i.test(msg)){
        return "🌐 That took too long to finish. Please try again, or ask a more specific question.";
    }
    if(msg && msg.toLowerCase() !== "request failed"){
        return msg;
    }
    return "Hmm, I'm having a little trouble understanding that — could you try rephrasing, or send it again?";
}

function appendUserBubble(msg){
    document.getElementById("chatGreeting").style.display = "none";

    const userDiv = document.createElement("div");
    userDiv.className = "user-message";
    const p = document.createElement("p");
    p.textContent = msg;
    p.style.margin = "0";
    userDiv.appendChild(p);
    const userTime = document.createElement("span");
    userTime.className = "msg-time";
    userTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " ";
    userTime.appendChild(buildMsgCheck());
    userDiv.appendChild(userTime);
    chatMessages.appendChild(userDiv);
    userInput.value = "";
    chatArea.scrollTop = chatArea.scrollHeight;
}

function appendLoadingAiBubble(initialHTML){
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "ai-message";
    const aiAvatar = document.createElement("img");
    aiAvatar.src = "favicon.png";
    aiAvatar.alt = "";
    aiAvatar.className = "ai-message-avatar";
    const aiContent = document.createElement("div");
    aiContent.className = "ai-message-content";
    aiContent.innerHTML = initialHTML;
    loadingDiv.appendChild(aiAvatar);
    loadingDiv.appendChild(aiContent);
    chatMessages.appendChild(loadingDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
    return { loadingDiv, aiContent };
}

function runImageGeneration(msg, loadingDiv, aiContent){
    const waitLabel = "Creating image";
    aiContent.innerHTML = `<div class="creating-box"><p class="creating-label">${waitLabel}</p><div class="creating-dots"></div></div>`;

    function finishWithImage(imageUrl){
        bumpStat("images");
        aiContent.innerHTML = buildImageBlockHTML({ alt: msg, url: imageUrl });
        loadingDiv.classList.add("done");
        addReportButton(aiContent.querySelector(".ai-image-actions"), "Generated image for prompt: \"" + msg + "\"");
        const aiTime = document.createElement("span");
        aiTime.className = "msg-time";
        aiTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        aiContent.appendChild(aiTime);
        chatArea.scrollTop = chatArea.scrollHeight;

        // Saved as a markdown image so reopening this chat later renders it
        // again automatically via formatAIText's image-block support.
        logMessageToHistory("assistant", `![${msg.replace(/[[\]]/g, "")}](${imageUrl})`);
    }

    function attemptGenerate(retryCount){
        const img = new Image();
        img.onload = () => finishWithImage(img.src);
        img.onerror = () => {
            if(retryCount < 2){
                setTimeout(() => attemptGenerate(retryCount + 1), 800);
            } else {
                aiContent.innerHTML = '<p>Could not generate the image right now. Please try again in a moment.</p>';
                loadingDiv.classList.add("done");
            }
        };
        const seed = Math.floor(Math.random() * 1000000);
        img.src = "https://image.pollinations.ai/prompt/" + encodeURIComponent(msg) + "?model=flux&enhance=true&seed=" + seed;
    }

    const waitMs = 2000;
    setTimeout(() => attemptGenerate(0), waitMs);
}

async function runImageModeConversationalReply(msg, loadingDiv, aiContent){
    aiContent.textContent = "Thinking...";

    // A lightweight system note so the reply understands the context it's
    // replying in, without needing the actual image data.
    const contextNote = {
        role: "system",
        content: isVagueImageIntent(msg)
            ? "You are chatting inside Zyntra AI's Image Generator. The user just said they want an image but didn't describe what it should look like (e.g. \"i want to make image\", \"make an image\"). Warmly ask them what they'd like to see — suggest they describe the subject, scene, or style. Keep it short."
            : "You are chatting inside Zyntra AI's Image Generator. The user just sent a message that is a reply/question/comment rather than a new image request (e.g. reacting to an image you just generated for them). Reply naturally and briefly, like a friendly assistant — don't try to describe or generate an image for this message."
    };

    try{
        const { content: reply } = await callChatAPI([contextNote, { role: "user", content: msg }]);
        logMessageToHistory("assistant", reply);
        aiContent.textContent = "";
        typeOutText(aiContent, reply, chatArea, () => {
            loadingDiv.classList.add("done");
            addMessageActionBar(aiContent, reply);
            const aiTime = document.createElement("span");
            aiTime.className = "msg-time";
            aiTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            aiContent.appendChild(aiTime);
        });
    }catch(err){
        aiContent.textContent = friendlyErrorMessage(err);
        loadingDiv.classList.add("done");
    }
    chatArea.scrollTop = chatArea.scrollHeight;
}

async function sendImageOrChatMessage(msg){
    if(!msg) return;

    appendUserBubble(msg);
    logMessageToHistory("user", msg);
    bumpStat("conversations");

    const { loadingDiv, aiContent } = appendLoadingAiBubble("Thinking...");

    const isImageRequest = await classifyImageIntent(msg);

    if(isImageRequest){
        runImageGeneration(msg, loadingDiv, aiContent);
    } else {
        runImageModeConversationalReply(msg, loadingDiv, aiContent);
    }
}

async function sendChatMessage(prefill){
    const msg = (prefill !== undefined ? prefill : userInput.value.trim());
    if(!msg && !attachedImage && !attachedDocument) return;

    if(activeChatTool === "image" && msg){
        return sendImageOrChatMessage(msg);
    }

    if(isLockedOut()){
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
    if(attachedDocument){
        const docChip = document.createElement("div");
        docChip.className = "sent-doc-chip";
        docChip.innerHTML = `<span>📄</span> ${attachedDocument.name}`;
        userDiv.appendChild(docChip);
    }
    if(msg){
        const p = document.createElement("p");
        p.textContent = msg;
        p.style.margin = "0";
        userDiv.appendChild(p);
    }
    const userTime = document.createElement("span");
    userTime.className = "msg-time";
    userTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " ";
    userTime.appendChild(buildMsgCheck());
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
    } else if(attachedDocument){
        // Documents aren't multimodal like images — fold the already-
        // extracted text straight into the text the model reads.
        historyContent = `[Attached document: "${attachedDocument.name}"]\n---\n${attachedDocument.text}\n---\n\n`
            + (msg || "Please read the attached document and summarize the key points.");
    } else {
        historyContent = msg;
    }

    if(chatHistory.length === 0){
        const profile = getProfile();
        let note = "Always reply in the same language the user writes in (for example, reply in Hindi if they write in Hindi, in Spanish if they write in Spanish, and so on — support any language naturally). If the user explicitly asks you to reply or speak in a specific language (for example \"talk in Gujarati\" or \"reply in French\"), you MUST switch to writing your entire response in that requested language from that point on, using its native script, not English. Pay attention to the emotional tone of what the user writes (happy, sad, frustrated, excited, worried, etc.) and respond with matching empathy and tone — be warm and supportive if they seem upset or stressed, and match their energy if they're happy or excited. Answer naturally and conversationally — do not include headings like \"Reasoning behind my answer\", do not explain your reasoning process or thought process, and do not add unnecessary meta-commentary about the question itself. Just give the direct, natural answer.";
        if(profile.nickname) note += ` Call the user "${profile.nickname}".`;
        if(profile.instructions) note += ` User's custom instructions: ${profile.instructions}`;
        const memories = getMemories();
        if(memories.length && getPlugins().memory){
            note += ` Here are things you already know about this user from past conversations — weave them in naturally where relevant, don't just list them back at the user: ${memories.map(m => m.fact).join("; ")}.`;
        }
        if(activeChatTool === "codex"){
            note += " " + CODEX_SYSTEM_NOTE;
        }
        if(currentProjectId){
            const project = getProjects().find(p => p.id === currentProjectId);
            if(project && project.instructions){
                note += ` You are working inside the "${project.name}" project. Project-specific instructions: ${project.instructions}`;
            }
        }
        chatHistory.push({ role: "system", content: note });
    }

    chatHistory.push({ role: "user", content: historyContent });
    logMessageToHistory("user", msg || (attachedDocument ? `[Document: ${attachedDocument.name}]` : "[Image attached]"));
    bumpStat("conversations");
    recordFreeMessage();

    attachedImage = null;
    attachedDocument = null;
    document.getElementById("chatFileInput").value = "";
    renderAttachPreview();

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "ai-message";
    const aiAvatar = document.createElement("img");
    aiAvatar.src = "favicon.png";
    aiAvatar.alt = "";
    aiAvatar.className = "ai-message-avatar";
    const aiContent = document.createElement("div");
    aiContent.className = "ai-message-content";
    aiContent.textContent = researchModeEnabled ? "🔎 Researching…" : "Thinking...";
    loadingDiv.appendChild(aiAvatar);
    loadingDiv.appendChild(aiContent);
    chatMessages.appendChild(loadingDiv);
    chatArea.scrollTop = chatArea.scrollHeight;

    try{
        let accumulated = "";
        let firstChunkReceived = false;
        const { sources, memoryWrites } = await streamChatAPI(chatHistory, (chunk) => {
            if(!firstChunkReceived){
                aiContent.textContent = "";
                firstChunkReceived = true;
            }
            accumulated += chunk;
            aiContent.innerHTML = formatAIText(accumulated);
            chatArea.scrollTop = chatArea.scrollHeight;
        }, { research: researchModeEnabled, website: activeChatTool === "codex" });

        if(!accumulated){
            aiContent.textContent = "Sorry, I didn't get a response. Please try again.";
        } else {
            chatHistory.push({ role: "assistant", content: accumulated });
            logMessageToHistory("assistant", accumulated);
            addMemories(memoryWrites);
            loadingDiv.classList.add("done");
            if(sources && sources.length){
                aiContent.appendChild(buildSourcesRow(sources));
            }
            addMessageActionBar(aiContent, accumulated);
            const aiTime = document.createElement("span");
            aiTime.className = "msg-time";
            aiTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            aiContent.appendChild(aiTime);
        }
    }catch(err){
        aiContent.textContent = friendlyErrorMessage(err);
    }
    chatArea.scrollTop = chatArea.scrollHeight;
}

document.getElementById("sendMessage").addEventListener("click", () => sendChatMessage());
userInput.addEventListener("keydown", e => {
    if(e.key === "Enter") sendChatMessage();
});

// ---------- Research mode ----------
// A deliberate "go deep" toggle — when on, the agent runs several web
// searches from different angles instead of one quick one, and writes a
// longer, more thoroughly sourced answer. Off by default since most
// messages don't need it.

let researchModeEnabled = false;

function setResearchButtonState(){
    const btn = document.getElementById("researchBtn");
    if(!btn) return;
    btn.classList.toggle("active", researchModeEnabled);
    btn.title = researchModeEnabled
        ? "Research mode: ON — deeper, multi-source answers. Click to turn off"
        : "Research mode — click for deeper, multi-source answers";
}

document.getElementById("researchBtn")?.addEventListener("click", () => {
    researchModeEnabled = !researchModeEnabled;
    setResearchButtonState();
    showToast(researchModeEnabled ? "🔎 Research mode turned on" : "🔎 Research mode turned off");
});

setResearchButtonState();

// ---------- Homepage suggestion chips ----------
// Fills the empty space below the greeting with a handful of clickable
// starter prompts — a fresh random set each time the greeting screen
// shows, pulled from a much bigger pool so it doesn't feel repetitive.

const PROMPT_SUGGESTIONS = [
    { icon: "💡", text: "Explain quantum computing in simple terms" },
    { icon: "🐍", text: "Write a Python function to sort a list" },
    { icon: "📈", text: "Give me 5 tips to be more productive" },
    { icon: "🌍", text: "Write a short essay about climate change" },
    { icon: "🥗", text: "Help me plan a healthy weekly meal plan" },
    { icon: "💼", text: "Give me business ideas for a small budget" },
    { icon: "⛓️", text: "Explain how blockchain works, simply" },
    { icon: "✉️", text: "Write a friendly email asking for a deadline extension" },
    { icon: "🎯", text: "Help me set achievable goals for this month" },
    { icon: "🧠", text: "Quiz me on world capitals" },
    { icon: "📝", text: "Summarize a book plot I describe to you" },
    { icon: "🎁", text: "Give me creative gift ideas for a friend's birthday" },
    { icon: "🏋️", text: "Build me a beginner home workout routine" },
    { icon: "📊", text: "Explain the stock market like I'm 10 years old" },
    { icon: "🧳", text: "Plan a 3-day budget-friendly trip itinerary" },
    { icon: "🎬", text: "Recommend movies based on a mood I describe" }
];

function renderPromptSuggestions(){
    const container = document.getElementById("promptSuggestions");
    if(!container) return;

    // Only makes sense on the plain chat homepage — other tools (Study,
    // Business, Code, etc.) have their own focused greeting already.
    if(activeChatTool && activeChatTool !== "chat"){
        container.innerHTML = "";
        return;
    }

    const pool = [...PROMPT_SUGGESTIONS];
    const picks = [];
    for(let i = 0; i < 4 && pool.length; i++){
        const idx = Math.floor(Math.random() * pool.length);
        picks.push(pool.splice(idx, 1)[0]);
    }

    container.innerHTML = "";
    picks.forEach(({ icon, text }) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prompt-suggestion-chip";
        chip.innerHTML = `<span class="chip-icon">${icon}</span><span>${text}</span>`;
        chip.addEventListener("click", () => {
            userInput.value = text;
            sendChatMessage();
        });
        container.appendChild(chip);
    });
}

// ==========================
// Tool routing (sidebar nav, dropdown-less)
// ==========================

function setActiveNav(tool){
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const el = document.querySelector(`.nav-item[data-tool="${tool}"]`) || document.querySelector(`.nav-item[data-panel="${tool}"]`);
    if(el) el.classList.add("active");
}

// Design + behavior instructions for Codex mode, which merges what used to
// be four separate tools (Poster Maker, Study Helper, Code with Zyntra,
// Website Builder) into one option that handles both plain coding help and
// full website/app builds — the model decides which per message, based on
// this note, rather than a separate classifier call.
const CODEX_SYSTEM_NOTE = `
You are in Codex mode — Zyntra's unified coding and building assistant. Every message calls for ONE of these two response styles; figure out which and respond accordingly:

1. BUILDING a full website, web app, game, or any other browser-based tool (e.g. "a portfolio site for a photographer", "make the header bigger", "change it to dark mode", "build me a simple calculator app"): reply with a single, complete, working HTML file — inline <style> and <script> in the same file, no external files or build steps — wrapped in one \`\`\`html code block. After the code block, talk to the user like a real developer/designer handing off work: a couple of natural sentences on what you built and why you made the choices you did — not a cold one-liner, not a wall of text. When the user asks for a change to something you already built, regenerate the ENTIRE file again with the change applied — never send a diff or partial snippet, since the preview needs one complete file every time.

   Design like a thoughtful human designer, not a template generator: pick a typeface pairing and color palette that actually fits the subject (a masjid site, a photography portfolio, and a SaaS landing page should NOT look like the same template with different text) — load fonts from Google Fonts via a <link> tag. Vary layout structure between projects rather than defaulting to centered-hero-plus-three-cards every time. Use generous whitespace and a restrained palette (2-3 colors plus neutrals) over busy gradients everywhere. Make it responsive with plain CSS (flexbox/grid, media queries) — a CDN-hosted framework like Tailwind's play CDN is fine if it helps, but nothing that needs a build step. Add tasteful, restrained motion rather than heavy animation. Use real semantic HTML (header, nav, main, section, footer) and reasonable alt text/aria labels. If the user hasn't given specific facts (real prices, hours, addresses, phone numbers, testimonials, team names), do NOT invent specific-sounding fake details presented as real — use clearly generic placeholders or ask for the missing specifics instead.

2. EVERYDAY CODING help — writing, debugging, explaining, refactoring, or answering questions about code in any language or context (a Python function, a React component meant to live inside a real project, a SQL query, fixing an error, code review, algorithms, etc.): just help directly and conversationally, with properly formatted code blocks in the relevant language. Do NOT wrap these into a single HTML file — that treatment is ONLY for full standalone browser builds from case 1. Most everyday coding questions belong here.

If a message is just conversation (thanks, a question about something you already built, a greeting) — reply naturally and briefly, without generating any code at all.
`;

const TOOL_PLACEHOLDERS = {
    chat: "Ask me anything...",
    business: "Ask a business or growth question...",
    image: "Describe the image you want to create...",
    codex: "Ask me to code, debug, or build a website/app..."
};

const TOOL_GREETINGS = {
    chat: {
        heading: 'Hey, I\'m <span>Zyntra AI</span>',
        subtitle: "Your personal AI assistant. Ask me anything!"
    },
    business: {
        heading: 'Let\'s Grow Your <span>Business</span>!',
        subtitle: "Ask me for ideas, strategy, or growth tips."
    },
    image: {
        heading: 'Let\'s Create an <span>Image</span>!',
        subtitle: "Describe what you want to see, and I'll bring it to life."
    },
    codex: {
        heading: '<span>Codex</span>',
        subtitle: "Write and debug code, or describe a website or app and watch it come to life."
    }
};

function applyToolGreeting(tool){
    const greeting = TOOL_GREETINGS[tool];
    if(!greeting) return;
    document.getElementById("greetingHeading").innerHTML = greeting.heading;
    document.getElementById("greetingSubtitle").textContent = greeting.subtitle;
}

// Which chat-mode tool is currently open (chat / study / business / code)
let activeChatTool = "chat";

function openTool(tool, prefix){
    showPageView("chat");
    if(TOOL_PLACEHOLDERS[tool]){
        // Switching to a different chat mode starts a clean chat.
        // The previous conversation is already saved in history (it was
        // logged message-by-message as it happened), so this is safe.
        // Checked against the actual displayed messages (not chatHistory)
        // since Image-mode conversations don't populate chatHistory at all.
        if(tool !== activeChatTool && chatMessages.children.length > 0){
            resetChatView();
        }
        activeChatTool = tool;
        applyToolGreeting(tool);
        userInput.placeholder = TOOL_PLACEHOLDERS[tool];
        document.getElementById("chatGreeting").style.display = chatMessages.children.length ? "none" : "";
        renderPromptSuggestions();
        userInput.value = prefix || "";
        userInput.focus();
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
        currentProjectId = null; // manually picking a sidebar tool always exits project context
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

        // For history storage we need a URL that survives page reloads —
        // blob: URLs are only valid for this page session, so convert to a
        // data URL for anything we save.
        const persistentUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(resultBlob);
        });

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
            logImageToHistory("Background removed from photo", persistentUrl);
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
    const { content: reply } = await callChatAPI([
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

    const waitLabel = "Creating image";
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

    const wantsRealistic = document.getElementById("imageRealisticToggle")?.checked;
    if(wantsRealistic){
        finalPrompt += ", photorealistic, ultra realistic, highly detailed, sharp focus, natural lighting, shot on DSLR, 8k";
    }

    function attemptGenerate(retryCount){
        const img = new Image();
        img.className = "generated-img";
        img.alt = finalPrompt;
        img.onload = () => {
            result.innerHTML = "";
            result.appendChild(img);
            bumpStat("images");
            logImageToHistory(val || finalPrompt, img.src);

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
        img.src = "https://image.pollinations.ai/prompt/" + encodeURIComponent(finalPrompt) + "?model=flux&enhance=true&seed=" + seed;
    }

    const waitMs = 2000;
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
    const waitLabel = "Designing poster";
    showCreatingAnimation(result, waitLabel);

    const wantsRealistic = document.getElementById("posterRealisticToggle")?.checked;
    const realismSuffix = wantsRealistic
        ? ", photorealistic, ultra realistic, highly detailed, sharp focus, natural lighting, shot on DSLR, 8k"
        : "";
    const promptText = (theme || "abstract poster background") + ", poster background art, no text, no watermark, high detail" + realismSuffix;
    const seed = Math.floor(Math.random() * 1000000);
    const bgUrl = "https://image.pollinations.ai/prompt/" + encodeURIComponent(promptText)
        + "?width=" + size.w + "&height=" + size.h + "&model=flux&enhance=true&seed=" + seed;

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
                    const posterDataUrl = canvas.toDataURL("image/png");
                    previewImg.src = posterDataUrl;
                    result.appendChild(previewImg);
                    bumpStat("images");
                    logPosterToHistory(title || theme, posterDataUrl);

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

    const waitMs = 2000;
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
    recognition.lang = navigator.language || "en-US";

    voiceMicBtn.addEventListener("click", () => {
        voiceMicBtn.textContent = "🎙 Listening...";
        recognition.start();
    });

    recognition.onresult = async (e) => {
        const said = e.results[0][0].transcript;
        voiceMicBtn.textContent = "🎤 Tap to speak";
        addVoiceMsg(said, "user");
        if(voiceHistory.length === 0){
            voiceHistory.push({
                role: "system",
                content: "Always reply in the same language the user speaks in (for example, reply in Hindi if they speak Hindi, in Spanish if they speak Spanish, and so on — support any language naturally). If the user explicitly asks you to reply or speak in a specific language (for example \"talk in Gujarati\" or \"reply in French\"), you MUST switch to writing your entire response in that requested language from that point on, using its native script, not English. Pay attention to the emotional tone of what the user says (happy, sad, frustrated, excited, worried, etc.) and respond with matching empathy and tone — be warm and supportive if they seem upset or stressed, and match their energy if they're happy or excited. Answer naturally and conversationally — do not include headings like \"Reasoning behind my answer\", do not explain your reasoning process, and do not add unnecessary meta-commentary. Keep replies fairly brief since they will be read aloud."
            });
        }
        voiceHistory.push({ role: "user", content: said });
        logVoiceMessageToHistory("user", said);
        addVoiceMsg("Thinking...", "ai-loading");
        try{
            const { content: reply } = await callChatAPI(voiceHistory);
            voiceHistory.push({ role: "assistant", content: reply });
            logVoiceMessageToHistory("assistant", reply);
            voiceBox.removeChild(voiceBox.lastChild);
            const clean = reply.replace(/\*\*/g, "");
            const spoken = stripForSpeech(reply);
            const lang = detectSpeechLang(spoken);
            const aiDiv = document.createElement("div");
            aiDiv.className = "chat-msg ai";
            voiceBox.appendChild(aiDiv);
            typeOutText(aiDiv, clean, voiceBox, () => {
                aiDiv.classList.add("done");
                const bar = addMessageActionBar(aiDiv, clean);
                addSpeakRepeatButton(bar, spoken, lang);
            });
            speakText(spoken, lang);
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
renderPromptSuggestions();
