import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

console.log("✅ Firestore Connected");
console.log("✅ chat.js loaded");

window.saveChat = async function(prompt){

  console.log("🔥 saveChat called");

    const user = auth.currentUser;

    if(!user){
        console.log("Guest Mode - Chat not saved");
        return;
    }

    try{

       await addDoc(
    collection(db,"users",user.uid,"chats"),
    {
        title: prompt.substring(0,30),
        prompt: prompt,
        createdAt: Date.now()
    }
);

        console.log("✅ Chat Saved");

    }catch(err){

    console.error(err);

    alert(err.code + "\n" + err.message);

}

};
window.loadChatHistory = async function(){

    const user = auth.currentUser;

    if(!user) return;

    const history = document.getElementById("chatHistory");

    history.innerHTML = "";

    const q = query(
        collection(db,"users",user.uid,"chats"),
        orderBy("createdAt","desc")
    );

    const snapshot = await getDocs(q);

    snapshot.forEach((doc)=>{

        const data = doc.data();

        const item = document.createElement("div");

        item.className = "chatItem";

        item.textContent = "💬 " + data.title;

        history.appendChild(item);

    });

};
