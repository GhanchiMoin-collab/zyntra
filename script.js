// ==========================
// Zyntra AI Homepage
// ==========================
const cards = document.querySelectorAll(".card");
document.querySelectorAll(".card").forEach(card => {

    card.addEventListener("click", () => {

        const title = card.querySelector("h2").innerText;

        if(title === "AI Chat"){

            document.getElementById("chatModal").classList.add("show");

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
chatModal.onclick = (e)=>{

    if(e.target === chatModal){

        chatModal.classList.remove("show");

    }

};
