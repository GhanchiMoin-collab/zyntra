// ==========================
// Zyntra AI Homepage
// ==========================
const cards = document.querySelectorAll(".card");
cards.forEach(card => {
    card.addEventListener("click", () => {
        const title = card.querySelector("h2").innerText;
        switch(title){
            case "AI Chat":
                window.location.href="pages/chat.html";
                break;
            case "Image Generator":
                window.location.href="pages/image.html";
                break;
            case "Video Generator":
                window.location.href="pages/video.html";
                break;
            case "Study Helper":
                window.location.href="pages/study.html";
                break;
            case "Voice Assistant":
                window.location.href="pages/voice.html";
                break;
            case "Business Tools":
                window.location.href="pages/business.html";
                break;
        }
    });
});

// Ask AI button
document.querySelector(".hero-search button").onclick = () => {
    const question =
        document.querySelector(".hero-search input").value.trim();
    if(question===""){
        alert("Please enter a question.");
        return;
    }
    localStorage.setItem("question",question);
    window.location.href="pages/chat.html";
};
