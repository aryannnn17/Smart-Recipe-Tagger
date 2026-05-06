import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC_uah3Qvo5kqxCEuOVIlKVquikMrrD_ts",
  authDomain: "smart-recipe-tagger-cd0f9.firebaseapp.com",
  projectId: "smart-recipe-tagger-cd0f9",
  storageBucket: "smart-recipe-tagger-cd0f9.firebasestorage.app",
  messagingSenderId: "883492439925",
  appId: "1:883492439925:web:cc5e06cb2729f2ffa1b53c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Analytics
export const analytics = getAnalytics(app);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Set custom parameters to use the correct OAuth client
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Add scopes for Google user info (Photos access now uses OAuth in AuthContext)
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');

export default app;

