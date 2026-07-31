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

// ==========================
// About popup modal
// ==========================
const aboutModal = document.getElementById("aboutModal");
const aboutBtn = document.getElementById("aboutBtn");
const aboutBtnFooter = document.getElementById("aboutBtnFooter");
const aboutClose = document.getElementById("aboutClose");

function openAboutModal(e){
    e.preventDefault();
    aboutModal.classList.add("show");
}

function closeAboutModal(){
    aboutModal.classList.remove("show");
}

if(aboutBtn) aboutBtn.addEventListener("click", openAboutModal);
if(aboutBtnFooter) aboutBtnFooter.addEventListener("click", openAboutModal);
if(aboutClose) aboutClose.addEventListener("click", closeAboutModal);

// close when clicking outside the box
aboutModal.addEventListener("click", (e) => {
    if(e.target === aboutModal){
        closeAboutModal();
    }
});

// close on Escape key
document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
        closeAboutModal();
    }
});
// ============================
// AI CHAT MODAL
// ============================

const chatModal = document.getElementById("chatModal");
const closeChat = document.getElementById("closeChat");

// Open chat when AI Chat card is clicked
document.querySelectorAll(".card").forEach(card => {

    const title = card.querySelector("h2")?.innerText;

    if(title === "AI Chat"){

        card.addEventListener("click",(e)=>{
            e.preventDefault();
            chatModal.classList.add("show");
        });

    }

});

// Open chat when Ask AI button is clicked
const askBtn = document.querySelector(".hero-search button");

if(askBtn){

    askBtn.addEventListener("click",(e)=>{

        e.preventDefault();

        chatModal.classList.add("show");

    });

}

// Close button
closeChat.onclick = () => {

    chatModal.classList.remove("show");

};

// Close when clicking outside
chatModal.onclick = (e)=>{

    if(e.target === chatModal){

        chatModal.classList.remove("show");

    }

};
