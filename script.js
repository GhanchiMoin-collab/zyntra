// About Button
const aboutBtn = document.getElementById("aboutBtn");

aboutBtn.addEventListener("click", () => {
    alert("Zyntra AI\n\nCreated by Ghanchi Moin");
});

// Ask AI Button
document.getElementById("askBtn").addEventListener("click", () => {

    const text = document.getElementById("quickInput").value.trim();

    if (text === "") {
        alert("Please type something.");
        return;
    }

    alert("You asked:\n\n" + text);
});

// Tool Cards
document.querySelectorAll(".card").forEach(card => {

    card.addEventListener("click", () => {

        const tool = card.dataset.tool;

        switch(tool){

            case "AI Chat":
                alert("Opening AI Chat...");
                break;

            case "Create Image":
                alert("Opening Image Generator...");
                break;

            case "AI Video":
                alert("Opening AI Video...");
                break;

            case "Study Helper":
                alert("Opening Study Helper...");
                break;

            case "Voice Assistant":
                alert("Opening Voice Assistant...");
                break;

            case "Business Tools":
                alert("Opening Business Tools...");
                break;

            default:
                alert(tool);

        }

    });

});
