import { db } from "./firebase";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

// This module mimics the get/set/delete/list(key, shared) interface the app
// was originally written against, so the rest of the app barely had to
// change. "shared" data goes to Firestore (visible to everyone using the
// app); "personal" data goes to localStorage (this browser/device only).

const LOCAL_PREFIX = "cfbpool:";

function parseSharedKey(key) {
  if (key === "league-meta") {
    return { collection: "leagueMeta", id: "current" };
  }
  let m = key.match(/^week:(\d+):games$/);
  if (m) return { collection: "weeks", id: m[1] };
  m = key.match(/^week:(\d+):picks:(.+)$/);
  if (m) {
    return {
      collection: "picks",
      id: `${m[1]}_${m[2]}`,
      week: Number(m[1]),
      slug: m[2],
    };
  }
  m = key.match(/^wintotals:(\d+):board$/);
  if (m) return { collection: "winTotalsBoards", id: m[1] };
  m = key.match(/^wintotals:(\d+):picks:(.+)$/);
  if (m) {
    return {
      collection: "winTotalsPicks",
      id: `${m[1]}_${m[2]}`,
      wtYear: Number(m[1]),
      slug: m[2],
    };
  }
  throw new Error(`Unrecognized storage key: ${key}`);
}

export const storage = {
  async get(key, shared = false) {
    if (!shared) {
      const v = localStorage.getItem(LOCAL_PREFIX + key);
      return v == null ? null : { key, value: v, shared: false };
    }
    const parsed = parseSharedKey(key);
    const snap = await getDoc(doc(db, parsed.collection, parsed.id));
    if (!snap.exists()) return null;
    return { key, value: snap.data().value, shared: true };
  },

  async set(key, value, shared = false) {
    if (!shared) {
      localStorage.setItem(LOCAL_PREFIX + key, value);
      return { key, value, shared: false };
    }
    const parsed = parseSharedKey(key);
    const payload = { value };
    if (parsed.week != null) {
      payload.week = parsed.week;
      payload.slug = parsed.slug;
    }
    if (parsed.wtYear != null) {
      payload.wtYear = parsed.wtYear;
      payload.slug = parsed.slug;
    }
    await setDoc(doc(db, parsed.collection, parsed.id), payload);
    return { key, value, shared: true };
  },

  async delete(key, shared = false) {
    if (!shared) {
      localStorage.removeItem(LOCAL_PREFIX + key);
      return { key, deleted: true, shared: false };
    }
    const parsed = parseSharedKey(key);
    await deleteDoc(doc(db, parsed.collection, parsed.id));
    return { key, deleted: true, shared: true };
  },

  async list(prefix, shared = false) {
    if (!shared) {
      const full = LOCAL_PREFIX + prefix;
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(full))
        .map((k) => k.slice(LOCAL_PREFIX.length));
      return { keys, prefix, shared: false };
    }
    // Shared prefixes this app lists: "week:{n}:picks:" and "wintotals:{y}:picks:"
    let m = prefix.match(/^week:(\d+):picks:$/);
    if (m) {
      const weekNum = Number(m[1]);
      const snap = await getDocs(
        query(collection(db, "picks"), where("week", "==", weekNum))
      );
      const keys = snap.docs.map((d) => `week:${weekNum}:picks:${d.data().slug}`);
      return { keys, prefix, shared: true };
    }
    m = prefix.match(/^wintotals:(\d+):picks:$/);
    if (m) {
      const wtYear = Number(m[1]);
      const snap = await getDocs(
        query(collection(db, "winTotalsPicks"), where("wtYear", "==", wtYear))
      );
      const keys = snap.docs.map((d) => `wintotals:${wtYear}:picks:${d.data().slug}`);
      return { keys, prefix, shared: true };
    }
    return { keys: [], prefix, shared: true };
  },
};