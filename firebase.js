// Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAWuJOkwON5KLALez5_p4rQYA7vNoGgjvM",
  authDomain: "zyntra-98cad.firebaseapp.com",
  projectId: "zyntra-98cad",
  storageBucket: "zyntra-98cad.firebasestorage.app",
  messagingSenderId: "960720019638",
  appId: "1:960720019638:web:3e212b262c672fdd858617"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
