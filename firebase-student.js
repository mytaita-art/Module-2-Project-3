import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB4oy6LIIKRd52rjFpmBd8NfrYJlTrveg4",
  authDomain: "vocabulary-trainer-622db.firebaseapp.com",
  projectId: "vocabulary-trainer-622db",
  storageBucket: "vocabulary-trainer-622db.firebasestorage.app",
  messagingSenderId: "284166673606",
  appId: "1:284166673606:web:3402d3c8dd2426983e73c7"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

function normalizeLogin(login) {
  const normalized = login.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(normalized)) {
    throw new Error("Логин: 2–40 латинских букв, цифр, точек, дефисов или подчёркиваний.");
  }
  return normalized;
}

function loginToEmail(login) {
  return `${normalizeLogin(login)}@vocabulary.example.com`;
}

async function readStudent(uid, retries = 0) {
  const snapshot = await getDoc(doc(db, "students", uid));
  if (!snapshot.exists() && retries > 0) {
    await new Promise(resolve => setTimeout(resolve, 200));
    return readStudent(uid, retries - 1);
  }
  if (!snapshot.exists() || snapshot.data().role !== "student") {
    throw new Error("Профиль ученика не найден или доступ запрещён.");
  }
  return { uid, ...snapshot.data() };
}

export async function registerStudent({ name, login, password, remember }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const normalizedLogin = normalizeLogin(login);
  const credential = await createUserWithEmailAndPassword(auth, loginToEmail(normalizedLogin), password);
  const profile = { name: name.trim(), login: normalizedLogin, role: "student", hw1: 0, hw2: 0, hw3: 0, hw4: 0, hw5: 0 };
  await setDoc(doc(db, "students", credential.user.uid), profile);
  return { uid: credential.user.uid, ...profile };
}

export async function loginStudent({ login, password, remember }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, loginToEmail(login), password);
  return readStudent(credential.user.uid);
}

export async function logoutStudent() {
  await signOut(auth);
}

export function observeStudentAuth(callback) {
  return onAuthStateChanged(auth, async user => {
    if (!user) return callback(null);
    try { callback(await readStudent(user.uid, 5)); }
    catch (error) { await signOut(auth); callback(null, error); }
  });
}
