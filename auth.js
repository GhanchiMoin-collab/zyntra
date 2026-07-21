import { auth } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// Protect AI page
export function protectPage() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "index.html";
    }
  });
}

// Logout
export async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}

// Get current user
export function getCurrentUser(callback) {
  onAuthStateChanged(auth, callback);
}
