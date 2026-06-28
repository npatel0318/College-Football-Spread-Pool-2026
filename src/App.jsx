import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { storage } from "./storage";
import { db } from "./firebase";
import { collection, getDocs, writeBatch } from "firebase/firestore";
import {
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Trophy,
  Plus,
  Trash2,
  Shield,
  Users,
  RefreshCw,
  LogOut,
  AlertCircle,
  ChevronRight,
  Upload,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Target,
  Award,
  Flame,
  DollarSign,
  Send,
  Copy,
  Eye,
  Clock,
} from "lucide-react";

/* ----------------------------- design tokens ----------------------------- */

const COLORS = {
  fieldDeep: "#0c0c0e",
  fieldDark: "#141417",
  fieldMid: "#1e1e24",
  chalk: "#f0f0f2",
  chalkDim: "#a8a8b8",
  gold: "#D9A441",
  goldBright: "#EFC169",
  red: "#B3372A",
  redBright: "#D14B3C",
  ink: "#0c0c0e",
  muted: "#666678",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.16)",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
.cfb-root { font-family: 'Inter', sans-serif; }
.cfb-display { font-family: 'Anton', sans-serif; letter-spacing: 0.02em; }
.cfb-mono { font-family: 'JetBrains Mono', monospace; }
.cfb-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
.cfb-scroll::-webkit-scrollbar-thumb { background: ${COLORS.lineStrong}; border-radius: 3px; }
.cfb-tab-nav::-webkit-scrollbar { display: none; }
.cfb-btn { transition: transform 0.08s ease, background-color 0.12s ease, border-color 0.12s ease, opacity 0.12s ease; }
.cfb-btn:active { transform: scale(0.98); }
.cfb-fade-in { animation: cfbFadeIn 0.25s ease; }
@keyframes cfbFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
`;

/* ------------------------------- utilities -------------------------------- */

function slugify(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]/g, "")
    .slice(0, 60) || "member";
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// Returns 'home' | 'away' | 'push' | null (null = not yet played)
function coveringSide(game) {
  if (game.homeScore == null || game.awayScore == null) return null;
  const favScore = game.favorite === "home" ? game.homeScore : game.awayScore;
  const dogScore = game.favorite === "home" ? game.awayScore : game.homeScore;
  const margin = favScore - dogScore;
  if (margin > game.spread) return game.favorite;
  if (margin < game.spread) return game.favorite === "home" ? "away" : "home";
  return "push";
}

function spreadLabel(game, side) {
  const team = side === "home" ? game.home : game.away;
  const isFav = side === game.favorite;
  const num = Number(game.spread) === 0 ? "PK" : (isFav ? "-" : "+") + game.spread;
  return { team: team || (side === "home" ? "Home" : "Away"), num };
}

function normalizeTeam(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function defaultCfbdSeasonYear() {
  const now = new Date();
  // CFB seasons run Aug–Jan; before July, "this year" usually means the season that just finished.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function isoDateInput(d) {
  return d.toISOString().slice(0, 10);
}

const P4_CONFERENCES = ["ACC", "Big Ten", "Big 12", "SEC"];

function normalizeConf(c) {
  const s = (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "acc") return "ACC";
  if (s === "sec") return "SEC";
  if (s === "bigten" || s === "big10" || s === "b1g") return "Big Ten";
  if (s === "big12" || s === "bigtwelve") return "Big 12";
  return c || "";
}

function defaultWinTotalsYear() {
  const now = new Date();
  // Win total lines post in spring/summer for the upcoming season; in January
  // the prior season's board is usually still the relevant one.
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

// 'over' | 'under' | 'push' | null (null = not yet graded)
function winTotalCover(team) {
  if (team.finalWins == null) return null;
  if (team.finalWins > team.line) return "over";
  if (team.finalWins < team.line) return "under";
  return "push";
}

function newWinTotalsTeam() {
  return { id: newId(), school: "", conference: "ACC", line: "" };
}

const PLAYOFF_SLOTS = [
  { key: "tier1-1", label: "Tier 1, Pick 1", tier: 1 },
  { key: "tier1-2", label: "Tier 1, Pick 2", tier: 1 },
  { key: "tier1-3", label: "Tier 1, Pick 3", tier: 1 },
  { key: "tier2-1", label: "Tier 2, Pick 1", tier: 2 },
  { key: "tier2-2", label: "Tier 2, Pick 2", tier: 2 },
  { key: "tier3-1", label: "Tier 3, Pick 1", tier: 3 },
];

function newPlayoffTeam() {
  return { id: newId(), school: "", odds: "" };
}

const DEFAULT_MONEY_SETTINGS = {
  buyIn: 100,
  weeklyWinAmount: 25,
  weeklyLossAmount: 10,
  lockAmount: 10,
  underdogTier1Amount: 5, // +14 to +19.5
  underdogTier2Amount: 10, // +20 to +27.5
  underdogTier3Amount: 20, // +28 or more
  secondPlacePayout: 100,
  thirdPlacePayout: 50,
};

function underdogPayout(spread, settings) {
  const s = Number(spread);
  if (isNaN(s) || s < 14) return 0;
  if (s <= 19.5) return settings.underdogTier1Amount;
  if (s <= 27.5) return settings.underdogTier2Amount;
  return settings.underdogTier3Amount;
}

// Returns a Set of game IDs whose day's first kickoff has already passed.
// Games without kickoffISO are never auto-locked here (fall back to manual lock).
function computeAutoLockStatus(games, now = Date.now()) {
  const dayFirstKickoff = {}; // "YYYY-MM-DD" (CT) → first kickoff timestamp (ms)
  games.forEach((g) => {
    if (!g.kickoffISO) return;
    const ms = new Date(g.kickoffISO).getTime();
    if (isNaN(ms)) return;
    const dateKey = new Date(g.kickoffISO).toLocaleDateString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    if (dayFirstKickoff[dateKey] == null || ms < dayFirstKickoff[dateKey]) {
      dayFirstKickoff[dateKey] = ms;
    }
  });

  const locked = new Set();
  games.forEach((g) => {
    if (!g.kickoffISO) return;
    const dateKey = new Date(g.kickoffISO).toLocaleDateString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    if (dayFirstKickoff[dateKey] != null && now >= dayFirstKickoff[dateKey]) {
      locked.add(g.id);
    }
  });
  return locked;
}

// Returns ms until the next upcoming kickoff (for scheduling a re-render), or null.
function msUntilNextKickoff(games, now = Date.now()) {
  const future = games
    .filter((g) => g.kickoffISO)
    .map((g) => new Date(g.kickoffISO).getTime())
    .filter((t) => !isNaN(t) && t > now)
    .sort((a, b) => a - b);
  return future.length ? future[0] - now : null;
}

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2).replace(/\.00$/, "")}`;
}

// Splits teams into 3 roughly-even tiers by best (lowest positive) odds first.
// Returns { tiersById: {teamId: 1|2|3}, tier1: [...], tier2: [...], tier3: [...] }
function computePlayoffTiers(teams) {
  const sorted = teams
    .filter((t) => Number(t.odds) > 0)
    .slice()
    .sort((a, b) => Number(a.odds) - Number(b.odds));
  const n = sorted.length;
  const tier1Size = Math.ceil(n / 3);
  const tier2Size = Math.ceil((n - tier1Size) / 2);
  const tier1 = sorted.slice(0, tier1Size);
  const tier2 = sorted.slice(tier1Size, tier1Size + tier2Size);
  const tier3 = sorted.slice(tier1Size + tier2Size);
  const tiersById = {};
  tier1.forEach((t) => (tiersById[t.id] = 1));
  tier2.forEach((t) => (tiersById[t.id] = 2));
  tier3.forEach((t) => (tiersById[t.id] = 3));
  return { tiersById, tier1, tier2, tier3 };
}

async function safeGet(key, shared) {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8000)
    );
    const r = await Promise.race([storage.get(key, shared), timeout]);
    return r ? r.value : null;
  } catch (e) {
    return null;
  }
}

async function safeList(prefix, shared) {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8000)
    );
    const r = await Promise.race([storage.list(prefix, shared), timeout]);
    return r?.keys || [];
  } catch (e) {
    return [];
  }
}

/* -------------------------------- small UI -------------------------------- */

function Spinner({ label }) {
  const [showRetry, setShowRetry] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShowRetry(true), 6000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2" style={{ color: COLORS.chalkDim }}>
        <RefreshCw size={14} className="animate-spin" />
        <span className="text-sm cfb-mono">{label || "Loading..."}</span>
      </div>
      {showRetry && (
        <button
          onClick={() => window.location.reload()}
          className="cfb-mono text-xs px-3 py-2 cfb-btn"
          style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalk }}
        >
          Taking too long? Tap to reload
        </button>
      )}
    </div>
  );
}

function Banner({ kind = "error", children, onDismiss }) {
  const bg = kind === "error" ? "rgba(179,55,42,0.16)" : "rgba(217,164,65,0.16)";
  const border = kind === "error" ? COLORS.red : COLORS.gold;
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 text-sm cfb-fade-in"
      style={{ background: bg, border: `1px solid ${border}`, color: COLORS.chalk }}
    >
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: border }} />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="cfb-mono text-xs opacity-70 hover:opacity-100">
          dismiss
        </button>
      )}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, type = "button", full }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cfb-btn cfb-mono text-sm font-bold uppercase tracking-wider px-4 py-2 ${full ? "w-full" : ""}`}
      style={{
        background: disabled ? COLORS.muted : COLORS.gold,
        color: COLORS.ink,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled, full }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`cfb-btn cfb-mono text-xs font-bold uppercase tracking-wider px-3 py-2 ${full ? "w-full" : ""}`}
      style={{
        background: "transparent",
        color: COLORS.chalk,
        border: `1px solid ${COLORS.lineStrong}`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function FieldInput({ value, onChange, placeholder, type = "text", style, disabled }) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="cfb-mono text-base sm:text-sm px-2 py-2.5 sm:py-2 w-full"
      style={{
        background: COLORS.fieldDeep,
        color: COLORS.chalk,
        border: `1px solid ${COLORS.lineStrong}`,
        outline: "none",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
    />
  );
}

/* --------------------------------- App ------------------------------------ */

export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | setup | identify | app
  const [leagueMeta, setLeagueMeta] = useState(null);
  const [myName, setMyName] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("picks"); // picks | standings | commish
  const [selectedWeek, setSelectedWeek] = useState(null);

  const [weekCache, setWeekCache] = useState({}); // weekNum -> {weekNum, games, locked, graded}
  const [picksCache, setPicksCache] = useState({}); // weekNum -> { memberSlug: {picks, name} }
  const [weekLoading, setWeekLoading] = useState(false);
  const [savingGameId, setSavingGameId] = useState(null);

  const [standings, setStandings] = useState(null);
  const [standingsLoading, setStandingsLoading] = useState(false);

  const [selectedWinTotalsYear, setSelectedWinTotalsYear] = useState(null);
  const [winTotalsCache, setWinTotalsCache] = useState({}); // year -> {year, teams, locked}
  const [winTotalsPicksCache, setWinTotalsPicksCache] = useState({}); // year -> { slug: {name, picks, submittedAt} }
  const [winTotalsLoading, setWinTotalsLoading] = useState(false);

  const [selectedPlayoffYear, setSelectedPlayoffYear] = useState(null);
  const [playoffCache, setPlayoffCache] = useState({}); // year -> {year, teams, locked}
  const [playoffPicksCache, setPlayoffPicksCache] = useState({}); // year -> { slug: {name, picks, submittedAt} }
  const [playoffLoading, setPlayoffLoading] = useState(false);

  const [moneyData, setMoneyData] = useState(null);
  const [moneyLoading, setMoneyLoading] = useState(false);

  const [historyData, setHistoryData] = useState({}); // year → parsed JSON
  const [historyLoading, setHistoryLoading] = useState(false);

  const [lastAutoCheckTime, setLastAutoCheckTime] = useState(null);

  const [commishUnlocked, setCommishUnlocked] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");

  /* ---------- initial load ---------- */
  useEffect(() => {
    (async () => {
      const metaRaw = await safeGet("league-meta", true);
      const nameRaw = await safeGet("my-name", false);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        setLeagueMeta(meta);
        if (nameRaw && meta.members.includes(nameRaw)) {
          setMyName(nameRaw);
          setPhase("app");
          const latest = meta.weeks.length ? Math.max(...meta.weeks) : null;
          setSelectedWeek(latest);
          const wtYears = meta.winTotalsYears || [];
          setSelectedWinTotalsYear(wtYears.length ? Math.max(...wtYears) : null);
          const pYears = meta.playoffYears || [];
          setSelectedPlayoffYear(pYears.length ? Math.max(...pYears) : null);
        } else {
          setPhase("identify");
        }
      } else {
        setPhase("setup");
      }
    })();
  }, []);

  const slugToName = useMemo(() => {
    const map = {};
    (leagueMeta?.members || []).forEach((m) => (map[slugify(m)] = m));
    return map;
  }, [leagueMeta]);

  /* ---------- league setup / identity ---------- */

  async function createLeague(leagueName, yourName, passcode) {
    const meta = {
      leagueName: leagueName.trim(),
      members: [yourName.trim()],
      commissionerPasscode: passcode,
      weeks: [],
      winTotalsYears: [],
      playoffYears: [],
      moneySettings: DEFAULT_MONEY_SETTINGS,
      seasonFinalized: false,
      seasonPayouts: {},
      createdAt: Date.now(),
    };
    const r = await storage.set("league-meta", JSON.stringify(meta), true).catch(() => null);
    if (!r) {
      setError("Couldn't create the league — try again.");
      return;
    }
    await storage.set("my-name", yourName.trim(), false).catch(() => null);
    setLeagueMeta(meta);
    setMyName(yourName.trim());
    setPhase("app");
  }

  async function joinExisting(name) {
    await storage.set("my-name", name, false).catch(() => null);
    setMyName(name);
    setPhase("app");
    const latest = leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) : null;
    setSelectedWeek(latest);
  }

  async function joinNew(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (leagueMeta.members.includes(trimmed)) {
      joinExisting(trimmed);
      return;
    }
    const updated = { ...leagueMeta, members: [...leagueMeta.members, trimmed] };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (!r) {
      setError("Couldn't join the pool — try again.");
      return;
    }
    setLeagueMeta(updated);
    await joinExisting(trimmed);
  }

  async function switchIdentity() {
    await storage.delete("my-name", false).catch(() => null);
    setMyName(null);
    setCommishUnlocked(false);
    setPhase("identify");
  }

  /* ---------- week data ---------- */

  const loadWeek = useCallback(async (weekNum, withPicks) => {
    if (weekNum == null) return;
    setWeekLoading(true);
    try {
      const raw = await safeGet(`week:${weekNum}:games`, true);
      const weekObj = raw ? JSON.parse(raw) : null;
      setWeekCache((prev) => ({ ...prev, [weekNum]: weekObj }));
      if (withPicks) {
        const list = await safeList(`week:${weekNum}:picks:`, true);
        const keys = list;
        const picksObj = {};
        for (const k of keys) {
          const raw2 = await safeGet(k, true);
          if (!raw2) continue;
          const slug = k.slice(`week:${weekNum}:picks:`.length);
          picksObj[slug] = JSON.parse(raw2);
        }
        setPicksCache((prev) => ({ ...prev, [weekNum]: picksObj }));
      }
    } catch (e) {
      console.error("loadWeek error", e);
    } finally {
      setWeekLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "app" && selectedWeek != null && activeTab === "picks") {
      loadWeek(selectedWeek, true);
    }
  }, [phase, selectedWeek, activeTab, loadWeek]);

  async function savePick(weekNum, gameId, side) {
    setSavingGameId(gameId);
    const mySlug = slugify(myName);
    const existing = picksCache[weekNum]?.[mySlug] || {};
    const currentPick = (existing.picks || {})[gameId];

    // Toggle: clicking the already-selected side unselects it
    const updatedPicks = { ...(existing.picks || {}) };
    if (currentPick === side) {
      delete updatedPicks[gameId];
    } else {
      updatedPicks[gameId] = side;
    }

    // If we just cleared the locked game, clear the lock too
    const newLockedGameId =
      currentPick === side && existing.lockedGameId === gameId ? null : existing.lockedGameId;

    const payload = { name: myName, picks: updatedPicks, lockedGameId: newLockedGameId, submittedAt: Date.now() };
    const r = await storage
      .set(`week:${weekNum}:picks:${mySlug}`, JSON.stringify(payload), true)
      .catch(() => null);
    if (!r) {
      setError("Your pick didn't save — check your connection and try again.");
    } else {
      setPicksCache((prev) => ({
        ...prev,
        [weekNum]: { ...(prev[weekNum] || {}), [mySlug]: payload },
      }));
    }
    setSavingGameId(null);
  }

  async function toggleMyLock(weekNum, gameId) {
    const mySlug = slugify(myName);
    const existing = picksCache[weekNum]?.[mySlug] || {};
    if (!existing.picks || !existing.picks[gameId]) return; // can't lock a game you haven't picked
    const nextLockedGameId = existing.lockedGameId === gameId ? null : gameId;
    const payload = { ...existing, name: myName, lockedGameId: nextLockedGameId, submittedAt: Date.now() };
    const r = await storage
      .set(`week:${weekNum}:picks:${mySlug}`, JSON.stringify(payload), true)
      .catch(() => null);
    if (!r) {
      setError("Couldn't update your lock — check your connection and try again.");
      return;
    }
    setPicksCache((prev) => ({
      ...prev,
      [weekNum]: { ...(prev[weekNum] || {}), [mySlug]: payload },
    }));
  }

  async function saveUnderdogPick(weekNum, underdogPick) {
    const mySlug = slugify(myName);
    const existing = picksCache[weekNum]?.[mySlug] || {};
    const payload = { ...existing, name: myName, underdogPick, underdogResult: null, submittedAt: Date.now() };
    const r = await storage
      .set(`week:${weekNum}:picks:${mySlug}`, JSON.stringify(payload), true)
      .catch(() => null);
    if (!r) {
      setError("Your underdog pick didn't save — check your connection and try again.");
      return false;
    }
    setPicksCache((prev) => ({
      ...prev,
      [weekNum]: { ...(prev[weekNum] || {}), [mySlug]: payload },
    }));
    return true;
  }

  async function saveUnderdogResults(weekNum, resultsBySlug) {
    const weekPicks = picksCache[weekNum] || {};
    const updates = {};
    for (const [slug, result] of Object.entries(resultsBySlug)) {
      const existing = weekPicks[slug];
      if (!existing) continue;
      const payload = { ...existing, underdogResult: result };
      const r = await storage.set(`week:${weekNum}:picks:${slug}`, JSON.stringify(payload), true).catch(() => null);
      if (r) updates[slug] = payload;
    }
    if (Object.keys(updates).length) {
      setPicksCache((prev) => ({ ...prev, [weekNum]: { ...(prev[weekNum] || {}), ...updates } }));
    }
    return true;
  }

  /* ---------- commissioner actions ---------- */

  async function saveWeekGames(weekNum, games, locked, weekDates) {
    const existing = weekCache[weekNum];
    const payload = {
      weekNum,
      games,
      locked,
      showPicksEarly: existing?.showPicksEarly || false,
      graded: existing?.graded && existing.games.length === games.length ? existing.graded : false,
      weekDates: weekDates || existing?.weekDates || null,
    };
    // preserve scores for games whose id already existed
    if (existing) {
      const scoreMap = {};
      existing.games.forEach((g) => (scoreMap[g.id] = { homeScore: g.homeScore, awayScore: g.awayScore }));
      payload.games = games.map((g) => ({
        ...g,
        homeScore: scoreMap[g.id]?.homeScore ?? null,
        awayScore: scoreMap[g.id]?.awayScore ?? null,
      }));
      payload.graded = payload.games.every((g) => g.homeScore != null && g.awayScore != null);
    } else {
      payload.games = games.map((g) => ({ ...g, homeScore: null, awayScore: null }));
      payload.graded = false;
    }
    const r = await storage.set(`week:${weekNum}:games`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save the week's games — try again.");
      return false;
    }
    setWeekCache((prev) => ({ ...prev, [weekNum]: payload }));
    if (!leagueMeta.weeks.includes(weekNum)) {
      const updatedMeta = { ...leagueMeta, weeks: [...leagueMeta.weeks, weekNum].sort((a, b) => a - b) };
      await storage.set("league-meta", JSON.stringify(updatedMeta), true).catch(() => null);
      setLeagueMeta(updatedMeta);
    }
    return true;
  }

  async function deleteWeek(weekNum) {
    // Delete games doc
    await storage.delete(`week:${weekNum}:games`, true).catch(() => null);
    // Delete every pick for this week
    const pickKeys = await safeList(`week:${weekNum}:picks:`, true);
    for (const key of pickKeys) {
      await storage.delete(key, true).catch(() => null);
    }
    // Remove from leagueMeta
    const updatedMeta = { ...leagueMeta, weeks: leagueMeta.weeks.filter((w) => w !== weekNum) };
    await storage.set("league-meta", JSON.stringify(updatedMeta), true).catch(() => null);
    setLeagueMeta(updatedMeta);
    setWeekCache((prev) => { const n = { ...prev }; delete n[weekNum]; return n; });
    setPicksCache((prev) => { const n = { ...prev }; delete n[weekNum]; return n; });
  }

  async function deleteMember(name) {
    const updated = { ...leagueMeta, members: leagueMeta.members.filter((m) => m !== name) };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) setLeagueMeta(updated);
  }

  async function toggleLock(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return;
    const payload = { ...week, locked: !week.locked };
    const r = await storage.set(`week:${weekNum}:games`, JSON.stringify(payload), true).catch(() => null);
    if (r) setWeekCache((prev) => ({ ...prev, [weekNum]: payload }));
  }

  async function toggleShowPicksEarly(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return;
    const payload = { ...week, showPicksEarly: !week.showPicksEarly };
    const r = await storage.set(`week:${weekNum}:games`, JSON.stringify(payload), true).catch(() => null);
    if (r) setWeekCache((prev) => ({ ...prev, [weekNum]: payload }));
  }

  async function saveResults(weekNum, gamesWithScores) {
    const graded = gamesWithScores.every((g) => g.homeScore != null && g.homeScore !== "" && g.awayScore != null && g.awayScore !== "");
    const payload = {
      ...weekCache[weekNum],
      games: gamesWithScores.map((g) => ({
        ...g,
        homeScore: g.homeScore === "" || g.homeScore == null ? null : Number(g.homeScore),
        awayScore: g.awayScore === "" || g.awayScore == null ? null : Number(g.awayScore),
      })),
      graded,
    };
    const r = await storage.set(`week:${weekNum}:games`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save results — try again.");
      return false;
    }
    setWeekCache((prev) => ({ ...prev, [weekNum]: payload }));
    return true;
  }

  /* ---------- auto-grade ---------- */

  async function fetchEspnScoresForDates(fromDate, toDate) {
    const dates = getDatesInRange(fromDate, toDate);
    const espnGames = [];
    for (const yyyymmdd of dates) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yyyymmdd}&limit=200`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const event of data.events || []) {
          const comp = event.competitions?.[0];
          if (!comp) continue;
          const homeComp = comp.competitors?.find((c) => c.homeAway === "home");
          const awayComp = comp.competitors?.find((c) => c.homeAway === "away");
          if (!homeComp || !awayComp) continue;
          espnGames.push({
            homeTeam: homeComp.team?.displayName || "",
            awayTeam: awayComp.team?.displayName || "",
            homeScore: homeComp.score != null ? Number(homeComp.score) : null,
            awayScore: awayComp.score != null ? Number(awayComp.score) : null,
            completed: comp.status?.type?.completed === true,
            statusName: comp.status?.type?.name || "",
          });
        }
      } catch (_) { /* skip failed dates */ }
    }
    return espnGames;
  }

  function matchGameToEspn(game, espnGames) {
    const homeLower = (game.home || "").toLowerCase();
    const awayLower = (game.away || "").toLowerCase();
    // 1. Exact match on both teams
    let match = espnGames.find(
      (e) => e.homeTeam.toLowerCase() === homeLower && e.awayTeam.toLowerCase() === awayLower
    );
    if (match) return match;
    // 2. Exact home team match (away might differ slightly)
    match = espnGames.find((e) => e.homeTeam.toLowerCase() === homeLower);
    if (match) return match;
    // 3. First-word school name match (strips mascot)
    const homeFirst = homeLower.split(" ")[0];
    const awayFirst = awayLower.split(" ")[0];
    match = espnGames.find(
      (e) => e.homeTeam.toLowerCase().startsWith(homeFirst) && e.awayTeam.toLowerCase().startsWith(awayFirst)
    );
    if (match) return match;
    return null;
  }

  async function autoGradeWeek(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return { status: "error", message: "Week data not loaded." };
    if (!week.locked) return { status: "not-locked" };
    if (week.graded) return { status: "already-graded" };
    if (!week.weekDates?.from || !week.weekDates?.to) {
      return { status: "no-dates", message: "No game dates stored for this week. Set dates in the Games tab and re-save." };
    }
    let espnGames;
    try {
      espnGames = await fetchEspnScoresForDates(week.weekDates.from, week.weekDates.to);
    } catch (e) {
      return { status: "error", message: "Couldn't reach ESPN — check your connection and try again." };
    }

    const matched = [];
    const unmatched = [];
    for (const game of week.games) {
      const espn = matchGameToEspn(game, espnGames);
      if (espn) {
        matched.push({ game, espn });
      } else {
        unmatched.push(game);
      }
    }

    const notFinal = matched.filter((m) => !m.espn.completed);
    if (notFinal.length > 0) {
      return {
        status: "pending",
        message: `${notFinal.length} game${notFinal.length === 1 ? "" : "s"} still in progress — check back once all games are final.`,
        completedCount: matched.length - notFinal.length,
        totalCount: week.games.length,
      };
    }
    if (unmatched.length > 0) {
      return {
        status: "partial",
        message: `Couldn't find scores for ${unmatched.length} game${unmatched.length === 1 ? "" : "s"}: ${unmatched.map((g) => `${g.away} @ ${g.home}`).join(", ")}. Grade those manually.`,
        unmatched,
      };
    }

    // All matched and final — save automatically
    const gamesWithScores = week.games.map((game) => {
      const m = matched.find((x) => x.game.id === game.id);
      return m ? { ...game, homeScore: m.espn.homeScore, awayScore: m.espn.awayScore } : game;
    });
    const ok = await saveResults(weekNum, gamesWithScores);
    if (!ok) return { status: "error", message: "Scores fetched but couldn't save — try again." };
    return { status: "graded", message: `Week ${weekNum} auto-graded: all ${week.games.length} games matched and saved.` };
  }

  /* ---------- win totals ---------- */

  const loadWinTotals = useCallback(async (year, withPicks) => {
    if (year == null) return;
    setWinTotalsLoading(true);
    try {
      const raw = await safeGet(`wintotals:${year}:board`, true);
      const board = raw ? JSON.parse(raw) : null;
      setWinTotalsCache((prev) => ({ ...prev, [year]: board }));
      if (withPicks) {
        const list = await safeList(`wintotals:${year}:picks:`, true);
        const keys = list;
        const picksObj = {};
        for (const k of keys) {
          const raw2 = await safeGet(k, true);
          if (!raw2) continue;
          const slug = k.slice(`wintotals:${year}:picks:`.length);
          picksObj[slug] = JSON.parse(raw2);
        }
        setWinTotalsPicksCache((prev) => ({ ...prev, [year]: picksObj }));
      }
    } catch (e) {
      console.error("loadWinTotals error", e);
    } finally {
      setWinTotalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "app" && selectedWinTotalsYear != null && activeTab === "wintotals") {
      loadWinTotals(selectedWinTotalsYear, true);
    }
  }, [phase, selectedWinTotalsYear, activeTab, loadWinTotals]);

  async function saveWinTotalsPicks(year, picks) {
    const mySlug = slugify(myName);
    const payload = { name: myName, picks, submittedAt: Date.now() };
    const r = await storage
      .set(`wintotals:${year}:picks:${mySlug}`, JSON.stringify(payload), true)
      .catch(() => null);
    if (!r) {
      setError("Your win total picks didn't save — check your connection and try again.");
      return false;
    }
    setWinTotalsPicksCache((prev) => ({
      ...prev,
      [year]: { ...(prev[year] || {}), [mySlug]: payload },
    }));
    return true;
  }

  async function saveWinTotalsBoard(year, teams, locked) {
    const existing = winTotalsCache[year];
    let payload;
    if (existing) {
      const finalMap = {};
      existing.teams.forEach((t) => (finalMap[t.id] = t.finalWins));
      payload = {
        year,
        locked,
        teams: teams.map((t) => ({ ...t, finalWins: finalMap[t.id] ?? null })),
      };
    } else {
      payload = { year, locked, teams: teams.map((t) => ({ ...t, finalWins: null })) };
    }
    const r = await storage.set(`wintotals:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save the win totals board — try again.");
      return false;
    }
    setWinTotalsCache((prev) => ({ ...prev, [year]: payload }));
    const existingYears = leagueMeta.winTotalsYears || [];
    if (!existingYears.includes(year)) {
      const updatedMeta = { ...leagueMeta, winTotalsYears: [...existingYears, year].sort((a, b) => a - b) };
      await storage.set("league-meta", JSON.stringify(updatedMeta), true).catch(() => null);
      setLeagueMeta(updatedMeta);
    }
    return true;
  }

  async function toggleWinTotalsLock(year) {
    const board = winTotalsCache[year];
    if (!board) return;
    const payload = { ...board, locked: !board.locked };
    const r = await storage.set(`wintotals:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (r) setWinTotalsCache((prev) => ({ ...prev, [year]: payload }));
  }

  async function saveWinTotalsResults(year, teamsWithFinalWins) {
    const payload = { ...winTotalsCache[year], teams: teamsWithFinalWins };
    const r = await storage.set(`wintotals:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save win totals results — try again.");
      return false;
    }
    setWinTotalsCache((prev) => ({ ...prev, [year]: payload }));
    return true;
  }

  /* ---------- playoff picks ---------- */

  const loadPlayoff = useCallback(async (year, withPicks) => {
    if (year == null) return;
    setPlayoffLoading(true);
    try {
      const raw = await safeGet(`playoff:${year}:board`, true);
      const board = raw ? JSON.parse(raw) : null;
      setPlayoffCache((prev) => ({ ...prev, [year]: board }));
      if (withPicks) {
        const list = await safeList(`playoff:${year}:picks:`, true);
        const keys = list;
        const picksObj = {};
        for (const k of keys) {
          const raw2 = await safeGet(k, true);
          if (!raw2) continue;
          const slug = k.slice(`playoff:${year}:picks:`.length);
          picksObj[slug] = JSON.parse(raw2);
        }
        setPlayoffPicksCache((prev) => ({ ...prev, [year]: picksObj }));
      }
    } catch (e) {
      console.error("loadPlayoff error", e);
    } finally {
      setPlayoffLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "app" && selectedPlayoffYear != null && activeTab === "playoff") {
      loadPlayoff(selectedPlayoffYear, true);
    }
  }, [phase, selectedPlayoffYear, activeTab, loadPlayoff]);

  async function savePlayoffPicks(year, picks) {
    const mySlug = slugify(myName);
    const payload = { name: myName, picks, submittedAt: Date.now() };
    const r = await storage
      .set(`playoff:${year}:picks:${mySlug}`, JSON.stringify(payload), true)
      .catch(() => null);
    if (!r) {
      setError("Your playoff picks didn't save — check your connection and try again.");
      return false;
    }
    setPlayoffPicksCache((prev) => ({
      ...prev,
      [year]: { ...(prev[year] || {}), [mySlug]: payload },
    }));
    return true;
  }

  async function savePlayoffBoard(year, teams, locked) {
    const existing = playoffCache[year];
    let payload;
    if (existing) {
      const finalMap = {};
      existing.teams.forEach((t) => (finalMap[t.id] = t.madePlayoff));
      payload = {
        year,
        locked,
        teams: teams.map((t) => ({ ...t, madePlayoff: finalMap[t.id] ?? null })),
      };
    } else {
      payload = { year, locked, teams: teams.map((t) => ({ ...t, madePlayoff: null })) };
    }
    const r = await storage.set(`playoff:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save the playoff board — try again.");
      return false;
    }
    setPlayoffCache((prev) => ({ ...prev, [year]: payload }));
    const existingYears = leagueMeta.playoffYears || [];
    if (!existingYears.includes(year)) {
      const updatedMeta = { ...leagueMeta, playoffYears: [...existingYears, year].sort((a, b) => a - b) };
      await storage.set("league-meta", JSON.stringify(updatedMeta), true).catch(() => null);
      setLeagueMeta(updatedMeta);
    }
    return true;
  }

  async function togglePlayoffLock(year) {
    const board = playoffCache[year];
    if (!board) return;
    const payload = { ...board, locked: !board.locked };
    const r = await storage.set(`playoff:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (r) setPlayoffCache((prev) => ({ ...prev, [year]: payload }));
  }

  async function savePlayoffResults(year, teamsWithMadePlayoff) {
    const payload = { ...playoffCache[year], teams: teamsWithMadePlayoff };
    const r = await storage.set(`playoff:${year}:board`, JSON.stringify(payload), true).catch(() => null);
    if (!r) {
      setError("Couldn't save playoff results — try again.");
      return false;
    }
    setPlayoffCache((prev) => ({ ...prev, [year]: payload }));
    return true;
  }

  /* ---------- full reset (testing only) ---------- */

  async function resetAllData() {
    try {
      const collectionsToWipe = ["weeks", "picks", "winTotalsBoards", "winTotalsPicks", "playoffBoards", "playoffPicks"];
      for (const colName of collectionsToWipe) {
        const snap = await getDocs(collection(db, colName));
        if (snap.docs.length === 0) continue;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      const freshMeta = {
        ...leagueMeta,
        members: [],
        weeks: [],
        winTotalsYears: [],
        playoffYears: [],
        moneySettings: DEFAULT_MONEY_SETTINGS,
        seasonFinalized: false,
        seasonPayouts: {},
      };
      const r = await storage.set("league-meta", JSON.stringify(freshMeta), true).catch(() => null);
      if (!r) {
        setError("Reset partially failed while resaving league info — check the Firebase console.");
        return false;
      }
      setLeagueMeta(freshMeta);
      setWeekCache({});
      setPicksCache({});
      setWinTotalsCache({});
      setWinTotalsPicksCache({});
      setStandings(null);
      setSelectedWeek(null);
      setSelectedWinTotalsYear(null);
      setPlayoffCache({});
      setPlayoffPicksCache({});
      setSelectedPlayoffYear(null);
      await storage.delete("my-name", false).catch(() => null);
      setMyName(null);
      setCommishUnlocked(false);
      setPasscodeInput("");
      setActiveTab("picks");
      setPhase("identify");
      return true;
    } catch (e) {
      setError("Reset failed partway through — check the Firebase console to see what's left.");
      return false;
    }
  }

  /* ---------- standings ---------- */

  const loadStandings = useCallback(async () => {
    if (!leagueMeta) return;
    setStandingsLoading(true);
    try {
    const blank = () => ({
      weeklyWins: 0,
      weeklyLosses: 0,
      winTotalsWins: 0,
      winTotalsLosses: 0,
      playoffWins: 0,
      playoffLosses: 0,
      totalWins: 0,
      totalLosses: 0,
      weeksPlayed: 0,
      weeksWon: 0,
      breakdown: {},
    });
    const results = {};
    leagueMeta.members.forEach((m) => (results[m] = blank()));

    for (const w of leagueMeta.weeks) {
      const raw = await safeGet(`week:${w}:games`, true);
      if (!raw) continue;
      const weekObj = JSON.parse(raw);
      if (!weekObj.graded) continue;
      const list = await safeList(`week:${w}:picks:`, true);
      const keys = list;
      const weekWins = {};
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const picksObj = JSON.parse(raw2);
        const member = picksObj.name || slugToName[k.slice(`week:${w}:picks:`.length)];
        if (!member) continue;
        let wins = 0;
        let losses = 0;
        weekObj.games.forEach((g) => {
          const cover = coveringSide(g);
          const pick = picksObj.picks[g.id];
          if (!cover || cover === "push" || !pick) return;
          if (pick === cover) wins++;
          else losses++;
        });
        if (!results[member]) results[member] = blank();
        results[member].weeklyWins += wins;
        results[member].weeklyLosses += losses;
        results[member].weeksPlayed += 1;
        results[member].breakdown[w] = wins;
        weekWins[member] = wins;
      }
      const vals = Object.values(weekWins);
      if (vals.length) {
        const max = Math.max(...vals);
        Object.entries(weekWins).forEach(([member, c]) => {
          if (c === max && max > 0) results[member].weeksWon += 1;
        });
      }
    }

    // Merge in win-totals scoring (most recent year) — counts toward the same total.
    const winTotalsYears = leagueMeta.winTotalsYears || [];
    if (winTotalsYears.length) {
      const wtYear = Math.max(...winTotalsYears);
      const raw = await safeGet(`wintotals:${wtYear}:board`, true);
      if (raw) {
        const board = JSON.parse(raw);
        const teamsById = {};
        board.teams.forEach((t) => (teamsById[t.id] = t));
        const list = await safeList(`wintotals:${wtYear}:picks:`, true);
        const keys = list;
        for (const k of keys) {
          const raw2 = await safeGet(k, true);
          if (!raw2) continue;
          const picksObj = JSON.parse(raw2);
          const member = picksObj.name;
          if (!member) continue;
          if (!results[member]) results[member] = blank();
          let wins = 0;
          let losses = 0;
          (picksObj.picks || []).forEach((p) => {
            const team = teamsById[p.teamId];
            if (!team) return;
            const cover = winTotalCover(team);
            if (!cover || cover === "push") return;
            if (p.side === cover) wins++;
            else losses++;
          });
          results[member].winTotalsWins = wins;
          results[member].winTotalsLosses = losses;
        }
      }
    }

    // Merge in playoff-picks scoring (most recent year) — counts toward the same total.
    const playoffYears = leagueMeta.playoffYears || [];
    if (playoffYears.length) {
      const pYear = Math.max(...playoffYears);
      const raw = await safeGet(`playoff:${pYear}:board`, true);
      if (raw) {
        const board = JSON.parse(raw);
        const teamsById = {};
        board.teams.forEach((t) => (teamsById[t.id] = t));
        const list = await safeList(`playoff:${pYear}:picks:`, true);
        const keys = list;
        for (const k of keys) {
          const raw2 = await safeGet(k, true);
          if (!raw2) continue;
          const picksObj = JSON.parse(raw2);
          const member = picksObj.name;
          if (!member) continue;
          if (!results[member]) results[member] = blank();
          let wins = 0;
          let losses = 0;
          (picksObj.picks || []).forEach((p) => {
            const team = teamsById[p.teamId];
            if (!team || team.madePlayoff == null) return;
            if (team.madePlayoff === true) wins++;
            else losses++;
          });
          results[member].playoffWins = wins;
          results[member].playoffLosses = losses;
        }
      }
    }

    Object.values(results).forEach((r) => {
      r.totalWins = r.weeklyWins + r.winTotalsWins + r.playoffWins;
      r.totalLosses = r.weeklyLosses + r.winTotalsLosses + r.playoffLosses;
    });

    setStandings(results);
    setStandingsLoading(false);
  } catch (e) {
    console.error("loadStandings error", e);
    setStandingsLoading(false);
  }
  }, [leagueMeta, slugToName]);

  useEffect(() => {
    if (phase === "app" && activeTab === "standings") loadStandings();
  }, [phase, activeTab, loadStandings]);

  /* ---------- money ---------- */

  const loadMoneyData = useCallback(async () => {
    if (!leagueMeta) return;
    setMoneyLoading(true);
    try {
    const settings = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
    const perMember = {};
    leagueMeta.members.forEach(
      (m) => (perMember[m] = { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0, underdogWin: 0 })
    );

    for (const w of leagueMeta.weeks) {
      const raw = await safeGet(`week:${w}:games`, true);
      if (!raw) continue;
      const weekObj = JSON.parse(raw);
      if (!weekObj.graded) continue;
      const list = await safeList(`week:${w}:picks:`, true);
      const keys = list;
      const weekWins = {}; // member -> wins this week (only members who played)
      const picksByMember = {};
      const allPicksByMember = {}; // includes members who only submitted an underdog pick
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const picksObj = JSON.parse(raw2);
        const member = picksObj.name || slugToName[k.slice(`week:${w}:picks:`.length)];
        if (!member) continue;
        if (!perMember[member]) perMember[member] = { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0, underdogWin: 0 };
        allPicksByMember[member] = picksObj;
        if (!picksObj.picks || Object.keys(picksObj.picks).length === 0) continue;
        picksByMember[member] = picksObj;
        let wins = 0;
        weekObj.games.forEach((g) => {
          const cover = coveringSide(g);
          if (cover && cover !== "push" && picksObj.picks[g.id] === cover) wins++;
        });
        weekWins[member] = wins;
      }

      // Weekly winner/loser money — only if there's an actual spread of results that week.
      const entries = Object.entries(weekWins);
      if (entries.length) {
        const max = Math.max(...entries.map(([, c]) => c));
        const min = Math.min(...entries.map(([, c]) => c));
        if (max > 0 && max !== min) {
          const winners = entries.filter(([, c]) => c === max).map(([m]) => m);
          const losers = entries.filter(([, c]) => c === min).map(([m]) => m);
          const winShare = settings.weeklyWinAmount / winners.length;
          const lossShare = settings.weeklyLossAmount / losers.length;
          winners.forEach((m) => (perMember[m].weeklyWin += winShare));
          losers.forEach((m) => (perMember[m].weeklyLoss += lossShare));
        }
      }

      // Lock of the week — full amount each, no splitting.
      Object.entries(picksByMember).forEach(([member, picksObj]) => {
        if (!picksObj.lockedGameId) return;
        const game = weekObj.games.find((g) => g.id === picksObj.lockedGameId);
        if (!game) return;
        const cover = coveringSide(game);
        if (!cover || cover === "push") return;
        const myPick = picksObj.picks[picksObj.lockedGameId];
        if (!myPick) return;
        if (myPick === cover) perMember[member].lockWin += settings.lockAmount;
        else perMember[member].lockLoss += settings.lockAmount;
      });

      // Underdog of the week — pure bonus, no cost on a miss.
      Object.entries(allPicksByMember).forEach(([member, picksObj]) => {
        if (!picksObj.underdogPick || picksObj.underdogResult !== true) return;
        perMember[member].underdogWin += underdogPayout(picksObj.underdogPick.spread, settings);
      });
    }

    const totalBuyIns = settings.buyIn * leagueMeta.members.length;
    let totalWeeklyWinsPaid = 0;
    let totalWeeklyLossesOwed = 0;
    let totalLockWinsPaid = 0;
    let totalLockLossesOwed = 0;
    let totalUnderdogWinsPaid = 0;
    Object.values(perMember).forEach((m) => {
      totalWeeklyWinsPaid += m.weeklyWin;
      totalWeeklyLossesOwed += m.weeklyLoss;
      totalLockWinsPaid += m.lockWin;
      totalLockLossesOwed += m.lockLoss;
      totalUnderdogWinsPaid += m.underdogWin;
    });
    const potRemaining =
      totalBuyIns - totalWeeklyWinsPaid + totalWeeklyLossesOwed - totalLockWinsPaid + totalLockLossesOwed - totalUnderdogWinsPaid;

    setMoneyData({
      perMember,
      totalBuyIns,
      totalWeeklyWinsPaid,
      totalWeeklyLossesOwed,
      totalLockWinsPaid,
      totalLockLossesOwed,
      totalUnderdogWinsPaid,
      potRemaining,
    });
    setMoneyLoading(false);
  } catch (e) {
    console.error("loadMoneyData error", e);
    setMoneyLoading(false);
  }
  }, [leagueMeta, slugToName]);

  useEffect(() => {
    if (phase === "app" && activeTab === "money") loadMoneyData();
  }, [phase, activeTab, loadMoneyData]);

  async function saveMoneySettings(settings) {
    const updated = { ...leagueMeta, moneySettings: settings };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (!r) {
      setError("Couldn't save money settings — try again.");
      return false;
    }
    setLeagueMeta(updated);
    return true;
  }

  async function finalizeSeasonPayouts() {
    if (!standings || !moneyData) {
      setError("Load Standings and Money tabs first so there's data to finalize from.");
      return false;
    }
    const settings = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
    const rows = Object.entries(standings)
      .map(([name, s]) => ({ name, totalWins: s.totalWins }))
      .sort((a, b) => b.totalWins - a.totalWins);
    if (!rows.length) {
      setError("No standings to finalize yet.");
      return false;
    }
    const groups = [];
    rows.forEach((r) => {
      const last = groups[groups.length - 1];
      if (last && last.totalWins === r.totalWins) last.names.push(r.name);
      else groups.push({ totalWins: r.totalWins, names: [r.name] });
    });
    const placementAmounts = [
      moneyData.potRemaining - settings.secondPlacePayout - settings.thirdPlacePayout,
      settings.secondPlacePayout,
      settings.thirdPlacePayout,
    ];
    const payouts = {};
    let placementIndex = 0;
    for (const group of groups) {
      if (placementIndex > 2) break;
      const slotsRemaining = 3 - placementIndex;
      const slotsThisGroup = Math.min(group.names.length, slotsRemaining);
      const amountForGroup = placementAmounts.slice(placementIndex, placementIndex + slotsThisGroup).reduce((a, b) => a + b, 0);
      const perPerson = amountForGroup / group.names.length;
      group.names.forEach((n) => (payouts[n] = (payouts[n] || 0) + perPerson));
      placementIndex += group.names.length;
    }
    const updated = { ...leagueMeta, seasonFinalized: true, seasonPayouts: payouts };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (!r) {
      setError("Couldn't finalize season payouts — try again.");
      return false;
    }
    setLeagueMeta(updated);
    return true;
  }

  async function unfinalizeSeasonPayouts() {
    const updated = { ...leagueMeta, seasonFinalized: false, seasonPayouts: {} };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) setLeagueMeta(updated);
  }

  /* ---------- history ---------- */

  const loadHistoryYear = useCallback(async (year) => {
    setHistoryLoading(true);
    try {
      const raw = await safeGet(`history:${year}`, true);
      if (raw) {
        setHistoryData((prev) => {
          if (prev[year]) return prev; // already loaded
          try { return { ...prev, [year]: JSON.parse(raw) }; }
          catch { return prev; }
        });
      }
    } catch (e) {
      console.error("loadHistoryYear error", e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "app" && activeTab === "history") {
      loadHistoryYear(2025);
      loadHistoryYear(2024);
      loadHistoryYear(2023);
      loadHistoryYear(2022);
      loadHistoryYear(2021);
    }
  }, [phase, activeTab, loadHistoryYear]);

  /* ---------- visibility API polling ---------- */

  // Refs so the event listener and timer always close over the latest state
  // without needing to re-attach on every render.
  const checkInProgressRef = useRef(false);
  const lastCheckTimeRef = useRef(0);
  const COOLDOWN_MS = 60 * 1000; // at most one ESPN call per 60 seconds
  const TIMER_INTERVAL_MS = 3 * 60 * 1000; // fallback timer every 3 minutes

  const runAutoCheckRef = useRef(null);
  runAutoCheckRef.current = async () => {
    if (phase !== "app" || !leagueMeta) return;
    if (checkInProgressRef.current) return;
    const now = Date.now();
    if (now - lastCheckTimeRef.current < COOLDOWN_MS) return;

    // Find weeks that are locked, ungraded, and already in the cache
    const weeksToGrade = leagueMeta.weeks.filter((w) => {
      const c = weekCache[w];
      return c && c.locked && !c.graded;
    });
    if (!weeksToGrade.length) return;

    checkInProgressRef.current = true;
    lastCheckTimeRef.current = now;
    setLastAutoCheckTime(now);
    for (const w of weeksToGrade) {
      await autoGradeWeek(w);
    }
    checkInProgressRef.current = false;
  };

  // Visibility listener — fires the moment anyone switches back to the tab/app
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        runAutoCheckRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", handler);
    // Also fire immediately on first load in case a graded week is waiting
    runAutoCheckRef.current?.();
    return () => document.removeEventListener("visibilitychange", handler);
  }, []); // intentionally empty — ref keeps it current without re-attaching

  // Fallback interval for people who leave the tab open
  useEffect(() => {
    const id = setInterval(() => runAutoCheckRef.current?.(), TIMER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function saveHistoryData(year, data) {
    const r = await storage.set(`history:${year}`, JSON.stringify(data), true).catch(() => null);
    if (!r) {
      setError("Couldn't save history data — check your connection and try again.");
      return false;
    }
    setHistoryData((prev) => ({ ...prev, [year]: data }));
    return true;
  }

  /* ------------------------------- render ------------------------------- */

  const rootStyle = {
    minHeight: "100%",
    background: COLORS.fieldDeep,
    color: COLORS.chalk,
  };

  if (phase === "loading") {
    return (
      <div className="cfb-root flex items-center justify-center p-12" style={rootStyle}>
        <style>{FONT_CSS}</style>
        <Spinner label="Loading pool..." />
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="cfb-root" style={rootStyle}>
        <style>{FONT_CSS}</style>
        <SetupScreen onCreate={createLeague} error={error} />
      </div>
    );
  }

  if (phase === "identify") {
    return (
      <div className="cfb-root" style={rootStyle}>
        <style>{FONT_CSS}</style>
        <IdentifyScreen
          leagueName={leagueMeta.leagueName}
          members={leagueMeta.members}
          onPick={joinExisting}
          onJoinNew={joinNew}
          error={error}
        />
      </div>
    );
  }

  const week = selectedWeek != null ? weekCache[selectedWeek] : null;

  return (
    <div className="cfb-root" style={rootStyle}>
      <style>{FONT_CSS}</style>

      {/* marquee header */}
      <div style={{ background: COLORS.fieldDeep, borderBottom: `2px solid ${COLORS.gold}` }} className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="cfb-mono text-xs uppercase tracking-widest" style={{ color: COLORS.gold }}>
              Spread Pool
            </div>
            <div className="cfb-display text-2xl sm:text-3xl uppercase leading-none mt-0.5">{leagueMeta.leagueName}</div>
          </div>
          <div className="text-right">
            <div className="cfb-mono text-xs" style={{ color: COLORS.chalkDim }}>
              playing as
            </div>
            <div className="text-sm font-semibold">{myName}</div>
            <button
              onClick={switchIdentity}
              className="cfb-mono text-xs flex items-center gap-1 mt-1 opacity-70 hover:opacity-100"
              style={{ color: COLORS.chalkDim }}
            >
              <LogOut size={12} /> switch
            </button>
          </div>
        </div>

        {/* week selector */}
        {leagueMeta.weeks.length > 0 && (
          <div className="flex items-center gap-2 mt-4 overflow-x-auto cfb-scroll pb-1">
            {leagueMeta.weeks
              .slice()
              .sort((a, b) => a - b)
              .map((w) => (
                <button
                  key={w}
                  onClick={() => setSelectedWeek(w)}
                  className="cfb-mono cfb-btn text-xs font-bold px-3 py-2 flex-shrink-0"
                  style={{
                    background: selectedWeek === w ? COLORS.gold : "transparent",
                    color: selectedWeek === w ? COLORS.ink : COLORS.chalkDim,
                    border: `1px solid ${selectedWeek === w ? COLORS.gold : COLORS.lineStrong}`,
                  }}
                >
                  WK {w}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* tab nav */}
      <div
        className="flex overflow-x-auto cfb-tab-nav"
        style={{
          background: COLORS.fieldDark,
          borderBottom: `1px solid ${COLORS.line}`,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {[
          { id: "money", label: "Money", icon: DollarSign },
          { id: "playoff", label: "Playoff", icon: Award },
          { id: "wintotals", label: "Win Totals", icon: Target },
          { id: "picks", label: "Picks", icon: CheckCircle2 },
          { id: "standings", label: "Standings", icon: Trophy },
          { id: "history", label: "History", icon: Clock },
          { id: "commish", label: "Commish", icon: Shield },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="cfb-mono cfb-btn flex-shrink-0 flex items-center justify-center gap-1 text-xs font-bold uppercase tracking-wider py-3 px-4"
              style={{
                color: active ? COLORS.goldBright : COLORS.chalkDim,
                borderBottom: active ? `2px solid ${COLORS.gold}` : "2px solid transparent",
                background: active ? "rgba(217,164,65,0.06)" : "transparent",
                whiteSpace: "nowrap",
              }}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {error && <div className="mb-3"><Banner onDismiss={() => setError(null)}>{error}</Banner></div>}

        {activeTab === "picks" && (
          <PicksTab
            leagueMeta={leagueMeta}
            selectedWeek={selectedWeek}
            week={week}
            weekLoading={weekLoading}
            picksCache={picksCache}
            myName={myName}
            savePick={savePick}
            savingGameId={savingGameId}
            slugToName={slugToName}
            toggleMyLock={toggleMyLock}
            saveUnderdogPick={saveUnderdogPick}
            lastAutoCheckTime={lastAutoCheckTime}
          />
        )}

        {activeTab === "standings" && (
          <StandingsTab
            leagueMeta={leagueMeta}
            standings={standings}
            loading={standingsLoading}
            onRefresh={loadStandings}
          />
        )}

        {activeTab === "wintotals" && (
          <WinTotalsTab
            leagueMeta={leagueMeta}
            selectedYear={selectedWinTotalsYear}
            setSelectedYear={setSelectedWinTotalsYear}
            board={selectedWinTotalsYear != null ? winTotalsCache[selectedWinTotalsYear] : null}
            loading={winTotalsLoading}
            picksCache={winTotalsPicksCache}
            myName={myName}
            saveWinTotalsPicks={saveWinTotalsPicks}
            slugToName={slugToName}
          />
        )}

        {activeTab === "playoff" && (
          <PlayoffTab
            leagueMeta={leagueMeta}
            selectedYear={selectedPlayoffYear}
            setSelectedYear={setSelectedPlayoffYear}
            board={selectedPlayoffYear != null ? playoffCache[selectedPlayoffYear] : null}
            loading={playoffLoading}
            picksCache={playoffPicksCache}
            myName={myName}
            savePlayoffPicks={savePlayoffPicks}
            slugToName={slugToName}
          />
        )}

        {activeTab === "money" && (
          <MoneyTab
            leagueMeta={leagueMeta}
            moneyData={moneyData}
            loading={moneyLoading}
            onRefresh={loadMoneyData}
          />
        )}

        {activeTab === "history" && (
          <HistoryTab
            historyData={historyData}
            loading={historyLoading}
          />
        )}

        {activeTab === "commish" && (
          <CommishTab
            leagueMeta={leagueMeta}
            commishUnlocked={commishUnlocked}
            passcodeInput={passcodeInput}
            picksCache={picksCache}
            saveUnderdogResults={saveUnderdogResults}
            setPasscodeInput={setPasscodeInput}
            onUnlock={() => {
              if (passcodeInput === leagueMeta.commissionerPasscode) {
                setCommishUnlocked(true);
                setError(null);
              } else {
                setError("That passcode doesn't match.");
              }
            }}
            weekCache={weekCache}
            loadWeek={loadWeek}
            saveWeekGames={saveWeekGames}
            toggleLock={toggleLock}
            toggleShowPicksEarly={toggleShowPicksEarly}
            saveResults={saveResults}
            autoGradeWeek={autoGradeWeek}
            winTotalsCache={winTotalsCache}
            loadWinTotals={loadWinTotals}
            saveWinTotalsBoard={saveWinTotalsBoard}
            toggleWinTotalsLock={toggleWinTotalsLock}
            saveWinTotalsResults={saveWinTotalsResults}
            playoffCache={playoffCache}
            loadPlayoff={loadPlayoff}
            savePlayoffBoard={savePlayoffBoard}
            togglePlayoffLock={togglePlayoffLock}
            savePlayoffResults={savePlayoffResults}
            moneyData={moneyData}
            loadMoneyData={loadMoneyData}
            saveMoneySettings={saveMoneySettings}
            standings={standings}
            loadStandings={loadStandings}
            finalizeSeasonPayouts={finalizeSeasonPayouts}
            unfinalizeSeasonPayouts={unfinalizeSeasonPayouts}
            historyData={historyData}
            saveHistoryData={saveHistoryData}
            resetAllData={resetAllData}
            deleteWeek={deleteWeek}
            deleteMember={deleteMember}
          />
        )}
      </div>

    </div>
  );
}

/* ----------------------------- setup screen -------------------------------- */

function SetupScreen({ onCreate, error }) {
  const [leagueName, setLeagueName] = useState("");
  const [yourName, setYourName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = leagueName.trim() && yourName.trim() && passcode.trim();

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm cfb-fade-in">
        <div className="text-center mb-6">
          <div className="cfb-mono text-xs uppercase tracking-widest" style={{ color: COLORS.gold }}>
            New Pool
          </div>
          <div className="cfb-display text-3xl uppercase mt-1">Set The Field</div>
          <div className="text-sm mt-2" style={{ color: COLORS.chalkDim }}>
            No pool exists here yet. Set one up — your friends will join with the names they pick.
          </div>
        </div>

        {error && <div className="mb-4"><Banner>{error}</Banner></div>}

        <div className="space-y-3">
          <div>
            <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
              Pool name
            </div>
            <FieldInput value={leagueName} onChange={setLeagueName} placeholder="e.g. Saturday Skins" />
          </div>
          <div>
            <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
              Your name
            </div>
            <FieldInput value={yourName} onChange={setYourName} placeholder="e.g. Jordan" />
          </div>
          <div>
            <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
              Commissioner passcode
            </div>
            <FieldInput value={passcode} onChange={setPasscode} placeholder="shared with no one but you" />
            <div className="text-xs mt-1" style={{ color: COLORS.muted }}>
              Whoever enters this can set games and grade weeks. Not high security — just enough to keep picks honest.
            </div>
          </div>
          <PrimaryButton
            full
            disabled={!canSubmit || busy}
            onClick={async () => {
              setBusy(true);
              await onCreate(leagueName, yourName, passcode);
              setBusy(false);
            }}
          >
            {busy ? "Setting up..." : "Create the pool"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- identify screen ------------------------------ */

function IdentifyScreen({ leagueName, members, onPick, onJoinNew, error }) {
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(members.length === 0);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm cfb-fade-in">
        <div className="text-center mb-6">
          <div className="cfb-mono text-xs uppercase tracking-widest" style={{ color: COLORS.gold }}>
            {leagueName}
          </div>
          <div className="cfb-display text-3xl uppercase mt-1">Who's Picking?</div>
        </div>

        {error && <div className="mb-4"><Banner>{error}</Banner></div>}

        {members.length > 0 && (
          <div className="space-y-2 mb-4">
            {members.map((m) => (
              <button
                key={m}
                onClick={() => onPick(m)}
                className="cfb-btn w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalk }}
              >
                {m}
                <ChevronRight size={16} style={{ color: COLORS.gold }} />
              </button>
            ))}
          </div>
        )}

        {!showNew && (
          <SecondaryButton full onClick={() => setShowNew(true)}>
            <span className="flex items-center justify-center gap-1.5"><Plus size={14} /> I'm new here</span>
          </SecondaryButton>
        )}

        {showNew && (
          <div className="space-y-2 mt-2">
            <FieldInput value={newName} onChange={setNewName} placeholder="Your name" />
            <PrimaryButton full disabled={!newName.trim()} onClick={() => onJoinNew(newName)}>
              Join the pool
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- picks tab --------------------------------- */

function PicksTab({ leagueMeta, selectedWeek, week, weekLoading, picksCache, myName, savePick, savingGameId, slugToName, toggleMyLock, saveUnderdogPick, lastAutoCheckTime }) {
  const [viewMode, setViewMode] = useState("mine"); // "mine" | "everyone" | "standings"
  const [autoLockTick, setAutoLockTick] = useState(0); // incremented to force re-render at kickoff

  useEffect(() => {
    setViewMode("mine");
  }, [selectedWeek]);

  // Timer that fires precisely when the next game day's first kickoff passes,
  // incrementing autoLockTick so autoLockedGameIds recomputes.
  useEffect(() => {
    if (!week?.games?.length) return;
    const ms = msUntilNextKickoff(week.games);
    if (ms == null) return;
    const id = setTimeout(() => setAutoLockTick((t) => t + 1), ms + 1500);
    return () => clearTimeout(id);
  }, [week?.games, autoLockTick]);

  if (selectedWeek == null) {
    return (
      <EmptyState
        title="No weeks yet"
        body="The commissioner hasn't set up a week. Once they add games, they'll show up here."
      />
    );
  }

  if (weekLoading && !week) {
    return <Spinner label="Loading week..." />;
  }

  if (!week) {
    return <EmptyState title={`Week ${selectedWeek} not found`} body="This week may have been removed." />;
  }

  const mySlug = slugify(myName);
  const myPicks = picksCache[selectedWeek]?.[mySlug]?.picks || {};
  const myLockedGameId = picksCache[selectedWeek]?.[mySlug]?.lockedGameId || null;
  const myUnderdogPick = picksCache[selectedWeek]?.[mySlug]?.underdogPick || null;
  const myUnderdogResult = picksCache[selectedWeek]?.[mySlug]?.underdogResult ?? null;
  const allEntries = Object.entries(picksCache[selectedWeek] || {});
  const submittedCount = allEntries.filter(([, v]) => v && Object.keys(v.picks || {}).length > 0).length;

  // Plain computation — safe after the early-return guards above.
  const autoLockedGameIds = computeAutoLockStatus(week.games);

  const myCorrect = week.graded
    ? week.games.reduce((acc, g) => {
        const cover = coveringSide(g);
        return cover && cover !== "push" && myPicks[g.id] === cover ? acc + 1 : acc;
      }, 0)
    : null;

  return (
    <div className="cfb-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">Week {selectedWeek}</div>
        <div className="flex items-center gap-2">
          {week.locked ? (
            <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.muted }}>
              <Lock size={12} /> locked
            </span>
          ) : (
            <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.goldBright }}>
              <Unlock size={12} /> open
            </span>
          )}
        </div>
      </div>

      {!week.locked && (
        <div className="text-sm" style={{ color: COLORS.chalkDim }}>
          {submittedCount} of {leagueMeta.members.length} have submitted picks.{" "}
          {week.showPicksEarly
            ? "The commissioner has made picks visible to everyone this week, even before lock."
            : "Games lock automatically at the first kickoff of each day — Friday games lock Friday, Saturday games lock Saturday."}
        </div>
      )}

      <div className="flex gap-2">
        {[
          { id: "mine", label: "My Picks" },
          { id: "everyone", label: "Everyone's Picks" },
          { id: "standings", label: "This Week" },
        ].map((opt) => (
          <button
            key={opt.id}
            onClick={() => setViewMode(opt.id)}
            className="cfb-mono cfb-btn text-xs font-bold uppercase tracking-wider px-3 py-2 flex-1"
            style={{
              background: viewMode === opt.id ? COLORS.gold : "transparent",
              color: viewMode === opt.id ? COLORS.ink : COLORS.chalkDim,
              border: `1px solid ${viewMode === opt.id ? COLORS.gold : COLORS.lineStrong}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {viewMode === "everyone" && !week.locked && !week.showPicksEarly && (
        <EmptyState
          title="Picks are still hidden"
          body="Everyone's picks stay private until the commissioner locks the week — check back after that."
        />
      )}

      {viewMode === "everyone" && (week.locked || week.showPicksEarly) && (
        <PicksGrid leagueMeta={leagueMeta} week={week} picksCache={picksCache[selectedWeek] || {}} slugToName={slugToName} />
      )}

      {viewMode === "standings" && (
        <WeekLiveStandings
          leagueMeta={leagueMeta}
          week={week}
          picksCache={picksCache[selectedWeek] || {}}
          lastAutoCheckTime={lastAutoCheckTime}
        />
      )}

      {viewMode === "mine" && (
        <>
      {week.graded && (
        <div
          className="px-3 py-2 flex items-center gap-2"
          style={{ background: "rgba(217,164,65,0.12)", border: `1px solid ${COLORS.gold}` }}
        >
          <Trophy size={16} style={{ color: COLORS.gold }} />
          <span className="text-sm font-semibold">
            You went {myCorrect} for {week.games.filter((g) => coveringSide(g) === "push" ? false : true).length} this week.
          </span>
        </div>
      )}

      <div className="relative">
        {/* yard-line rail */}
        <div className="absolute top-0 bottom-0 left-3 w-px" style={{ background: COLORS.lineStrong }} />
        <div className="space-y-3">
          {week.games.map((g, idx) => {
            const cover = coveringSide(g);
            const myPick = myPicks[g.id];
            const homeL = spreadLabel(g, "home");
            const awayL = spreadLabel(g, "away");
            const disabled = week.locked || autoLockedGameIds.has(g.id);
            const saving = savingGameId === g.id;

            return (
              <div key={g.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-1" style={{ width: 24, flexShrink: 0 }}>
                  <div
                    className="cfb-mono text-xs flex items-center justify-center"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: COLORS.fieldDeep,
                      border: `1px solid ${COLORS.gold}`,
                      color: COLORS.gold,
                      zIndex: 1,
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                </div>

                <div className="flex-1 px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${autoLockedGameIds.has(g.id) && !week.locked ? COLORS.lineStrong : COLORS.line}` }}>
                  <div className="cfb-mono text-xs mb-1.5 flex items-center justify-between gap-2">
                    <span style={{ color: COLORS.muted }}>
                      {[g.kickoffTime, g.network].filter(Boolean).join(" · ")}
                    </span>
                    {autoLockedGameIds.has(g.id) && !week.graded && (
                      <span className="flex items-center gap-1 flex-shrink-0" style={{ color: COLORS.muted }}>
                        <Lock size={10} /> picks closed
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {["away", "home"].map((side) => {
                      const lbl = side === "home" ? homeL : awayL;
                      const isPicked = myPick === side;
                      const isOtherPicked = myPick && myPick !== side;
                      const isCorrect = week.graded && cover === side && cover !== "push";
                      const isWrong = week.graded && isPicked && cover !== side && cover !== "push";
                      const teamColor = side === "home" ? g.homeColor : g.awayColor;
                      const teamLogo = side === "home" ? g.homeLogo : g.awayLogo;

                      // Background and border logic
                      let bg, borderColor, borderWidth = "1px";
                      if (week.graded) {
                        if (isCorrect) {
                          bg = "rgba(217,164,65,0.18)";
                          borderColor = COLORS.gold;
                        } else if (isPicked && isWrong) {
                          bg = "rgba(179,55,42,0.18)";
                          borderColor = COLORS.red;
                        } else {
                          bg = hexToRgba(teamColor, 0.07);
                          borderColor = hexToRgba(teamColor, 0.25);
                        }
                      } else if (isPicked) {
                        bg = hexToRgba(teamColor, 0.22);
                        borderColor = teamColor || COLORS.gold;
                        borderWidth = "2px";
                      } else {
                        bg = hexToRgba(teamColor, 0.06);
                        borderColor = hexToRgba(teamColor, 0.3);
                      }

                      return (
                        <button
                          key={side}
                          disabled={disabled}
                          onClick={() => savePick(selectedWeek, g.id, side)}
                          className="cfb-btn flex flex-col items-center justify-start px-2 py-3 text-center"
                          style={{
                            background: bg,
                            border: `${borderWidth} solid ${borderColor}`,
                            cursor: disabled ? "default" : "pointer",
                            opacity: isOtherPicked ? 0.4 : 1,
                            transition: "opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease",
                            minHeight: 90,
                          }}
                        >
                          {teamLogo ? (
                            <img
                              src={teamLogo}
                              alt={lbl.team}
                              style={{
                                width: 44,
                                height: 44,
                                objectFit: "contain",
                                marginBottom: 6,
                                opacity: isPicked || !myPick ? 1 : 0.7,
                                filter: isOtherPicked ? "grayscale(0.5)" : "none",
                              }}
                              onError={(e) => { e.target.style.display = "none"; }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 44, height: 44, marginBottom: 6,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                borderRadius: "50%",
                                background: hexToRgba(teamColor, 0.25),
                                fontSize: "0.7rem", fontWeight: "bold",
                                color: teamColor || COLORS.chalk,
                                flexShrink: 0,
                              }}
                            >
                              {lbl.team.slice(0, 3).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs font-semibold leading-tight w-full" style={{ color: COLORS.chalk }}>
                            {lbl.team}
                          </span>
                          <span className="cfb-mono text-xs mt-0.5" style={{ color: COLORS.goldBright }}>
                            {lbl.num}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {myPick && !disabled && !week.graded && (
                    <div className="mt-1.5 text-center">
                      <span className="cfb-mono" style={{ fontSize: "0.65rem", color: COLORS.muted }}>
                        tap your pick again to clear
                      </span>
                    </div>
                  )}
                  {myPick && (() => {
                    const isMyLock = myLockedGameId === g.id;
                    const lockGraded = week.graded && isMyLock;
                    const lockWon = lockGraded && cover !== "push" && myPick === cover;
                    const lockLost = lockGraded && cover !== "push" && myPick !== cover;
                    let lockColor = COLORS.chalkDim;
                    let lockBorder = COLORS.lineStrong;
                    if (isMyLock && !week.graded) {
                      lockColor = COLORS.goldBright;
                      lockBorder = COLORS.gold;
                    } else if (lockWon) {
                      lockColor = COLORS.goldBright;
                      lockBorder = COLORS.gold;
                    } else if (lockLost) {
                      lockColor = COLORS.redBright;
                      lockBorder = COLORS.red;
                    }
                    return (
                      <button
                        disabled={disabled}
                        onClick={() => toggleMyLock(selectedWeek, g.id)}
                        className="cfb-btn flex items-center gap-1.5 mt-2 px-2 py-1.5 text-xs cfb-mono uppercase tracking-wide"
                        style={{
                          background: isMyLock ? "rgba(217,164,65,0.12)" : "transparent",
                          border: `1px solid ${lockBorder}`,
                          color: lockColor,
                          cursor: disabled ? "default" : "pointer",
                          opacity: disabled && !isMyLock ? 0.5 : 1,
                        }}
                      >
                        <Flame size={12} />
                        {isMyLock ? (lockGraded ? (lockWon ? "Lock won" : lockLost ? "Lock lost" : "Your lock") : "Your lock") : "Make this your lock"}
                      </button>
                    );
                  })()}
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
                      {saving && "saving..."}
                      {week.graded && g.homeScore != null && (
                        <>
                          final: {g.away} {g.awayScore} – {g.home} {g.homeScore}
                          {cover === "push" && "  (push)"}
                        </>
                      )}
                    </div>
                    {week.graded && cover === "push" && <MinusCircle size={14} style={{ color: COLORS.muted }} />}
                    {week.graded && isCorrectIcon(cover, myPick)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <UnderdogOfWeekCard
        weekNum={selectedWeek}
        locked={week.locked}
        existingPick={myUnderdogPick}
        existingResult={myUnderdogResult}
        saveUnderdogPick={saveUnderdogPick}
      />
        </>
      )}
    </div>
  );
}

function isCorrectIcon(cover, myPick) {
  if (!myPick || cover === "push") return null;
  if (cover === myPick) return <CheckCircle2 size={14} style={{ color: COLORS.goldBright }} />;
  return <XCircle size={14} style={{ color: COLORS.redBright }} />;
}

function UnderdogOfWeekCard({ weekNum, locked, existingPick, existingResult, saveUnderdogPick }) {
  const [team, setTeam] = useState(existingPick?.team || "");
  const [opponent, setOpponent] = useState(existingPick?.opponent || "");
  const [spread, setSpread] = useState(existingPick?.spread != null ? String(existingPick.spread) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTeam(existingPick?.team || "");
    setOpponent(existingPick?.opponent || "");
    setSpread(existingPick?.spread != null ? String(existingPick.spread) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekNum]);

  const spreadNum = Number(spread);
  const valid = team.trim() && opponent.trim() && spread !== "" && !isNaN(spreadNum) && spreadNum >= 14;

  let resultColor = COLORS.chalkDim;
  if (existingResult === true) resultColor = COLORS.goldBright;
  else if (existingResult === false) resultColor = COLORS.redBright;

  return (
    <div className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
      <div className="cfb-mono text-xs uppercase mb-2 flex items-center gap-1.5" style={{ color: COLORS.gold }}>
        <Flame size={13} /> Underdog of the week (optional)
      </div>
      <div className="text-xs mb-2" style={{ color: COLORS.muted }}>
        Any FBS game, doesn't have to be on this week's list. Underdog must be getting at least +14 and must win
        outright. +14 to +19.5 pays {fmtMoney(DEFAULT_MONEY_SETTINGS.underdogTier1Amount)}, +20 to +27.5 pays{" "}
        {fmtMoney(DEFAULT_MONEY_SETTINGS.underdogTier2Amount)}, +28 or more pays{" "}
        {fmtMoney(DEFAULT_MONEY_SETTINGS.underdogTier3Amount)} (amounts set by the commissioner). No cost if it misses.
      </div>
      <div className="space-y-2">
        <FieldInput value={team} onChange={setTeam} placeholder="Underdog team" disabled={locked} />
        <FieldInput value={opponent} onChange={setOpponent} placeholder="Opponent" disabled={locked} />
        <FieldInput type="number" value={spread} onChange={setSpread} placeholder="Spread (e.g. 16.5)" disabled={locked} />
      </div>
      {!locked && (
        <div className="mt-2 flex items-center gap-3">
          <SecondaryButton
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              await saveUnderdogPick(weekNum, { team: team.trim(), opponent: opponent.trim(), spread: spreadNum });
              setSaving(false);
            }}
          >
            {saving ? "Saving..." : "Save underdog pick"}
          </SecondaryButton>
          {existingPick && (
            <button
              onClick={async () => {
                setSaving(true);
                await saveUnderdogPick(weekNum, null);
                setTeam("");
                setOpponent("");
                setSpread("");
                setSaving(false);
              }}
              className="cfb-mono text-xs"
              style={{ color: COLORS.muted }}
            >
              clear
            </button>
          )}
        </div>
      )}
      {!valid && (team || opponent || spread) && !locked && (
        <div className="text-xs mt-1.5" style={{ color: COLORS.muted }}>
          Needs a team, an opponent, and a spread of at least +14.
        </div>
      )}
      {existingPick && (
        <div className="cfb-mono text-xs mt-2" style={{ color: resultColor }}>
          {existingPick.team} +{existingPick.spread} vs {existingPick.opponent}
          {existingResult === true && " — hit!"}
          {existingResult === false && " — missed"}
          {existingResult == null && locked && " — pending"}
        </div>
      )}
    </div>
  );
}

function WeekLiveStandings({ leagueMeta, week, picksCache, lastAutoCheckTime }) {
  const members = leagueMeta.members;
  const totalGames = week.games.length;
  const gamesWithScores = week.games.filter((g) => g.homeScore != null && g.awayScore != null);
  const completedCount = gamesWithScores.length;

  // Format how long ago the last check was
  const [checkAgoLabel, setCheckAgoLabel] = useState(null);
  useEffect(() => {
    if (!lastAutoCheckTime) return;
    function update() {
      const diff = Math.floor((Date.now() - lastAutoCheckTime) / 1000);
      if (diff < 60) setCheckAgoLabel("just now");
      else if (diff < 3600) setCheckAgoLabel(`${Math.floor(diff / 60)}m ago`);
      else setCheckAgoLabel(`${Math.floor(diff / 3600)}h ago`);
    }
    update();
    const id = setInterval(update, 30 * 1000);
    return () => clearInterval(id);
  }, [lastAutoCheckTime]);

  const rows = members.map((name) => {
    const slug = slugify(name);
    const memberPicks = picksCache[slug]?.picks || {};
    const lockedGameId = picksCache[slug]?.lockedGameId || null;
    let wins = 0, losses = 0, lockResult = null;

    week.games.forEach((g) => {
      const pick = memberPicks[g.id];
      if (!pick || g.homeScore == null || g.awayScore == null) return;
      const cover = coveringSide(g);
      if (!cover || cover === "push") return;
      if (pick === cover) wins++;
      else losses++;
      if (g.id === lockedGameId) {
        lockResult = pick === cover ? "won" : "lost";
      }
    });

    const pending = totalGames - wins - losses;
    return { name, wins, losses, pending, lockResult, submitted: Object.keys(memberPicks).length > 0 };
  }).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.losses - b.losses;
  });

  const noScoresYet = completedCount === 0;

  return (
    <div className="space-y-3 cfb-fade-in">
      <div className="flex items-center justify-between">
        <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.chalkDim }}>
          Week {week.weekNum} standings
        </div>
        <div className="cfb-mono text-xs flex items-center gap-1.5" style={{ color: COLORS.muted }}>
          {completedCount} of {totalGames} scored
          {checkAgoLabel && (
            <span style={{ color: COLORS.muted }}>· checked {checkAgoLabel}</span>
          )}
        </div>
      </div>

      {noScoresYet && (
        <div className="text-sm" style={{ color: COLORS.chalkDim }}>
          {week.locked
            ? "Picks are locked — standings will update here as games finish and scores come in."
            : "Standings show up once the week is locked and games start finishing."}
        </div>
      )}

      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>#</th>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>W</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>L</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>left</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>
                <span className="inline-flex items-center gap-1"><Flame size={11} style={{ color: COLORS.gold }} /> lock</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLeading = i === 0 && r.wins > 0 && (rows[0].wins > (rows[1]?.wins ?? -1));
              return (
                <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2" style={{ color: isLeading ? COLORS.gold : COLORS.muted }}>
                    {isLeading ? <Trophy size={14} /> : i + 1}
                  </td>
                  <td className="px-3 py-2 font-semibold" style={{ color: r.submitted ? COLORS.chalk : COLORS.muted }}>
                    {r.name}
                    {!r.submitted && <span className="cfb-mono font-normal text-xs ml-1.5" style={{ color: COLORS.muted }}>no picks</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: r.wins > 0 ? COLORS.goldBright : COLORS.chalkDim }}>
                    {r.wins}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: r.losses > 0 ? COLORS.redBright : COLORS.chalkDim }}>
                    {r.losses}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: COLORS.muted }}>
                    {r.pending}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.lockResult === "won" && <span style={{ color: COLORS.goldBright }}>+$10</span>}
                    {r.lockResult === "lost" && <span style={{ color: COLORS.redBright }}>−$10</span>}
                    {r.lockResult === null && <span style={{ color: COLORS.muted }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!week.graded && completedCount > 0 && (
        <div className="text-xs" style={{ color: COLORS.muted }}>
          Updates automatically when you open the app. {totalGames - completedCount} game{totalGames - completedCount === 1 ? "" : "s"} still to play.
        </div>
      )}
    </div>
  );
}

function PicksGrid({ leagueMeta, week, picksCache, slugToName }) {
  const members = leagueMeta.members;
  return (
    <div className="mt-2">
      <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.chalkDim }}>
        Everyone's picks
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-xs w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                game
              </th>
              {members.map((m) => (
                <th key={m} className="text-left px-2 py-1.5 whitespace-nowrap" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.games.map((g, idx) => {
              const cover = coveringSide(g);
              return (
                <tr key={g.id} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>
                    <div>{String(idx + 1).padStart(2, "0")}</div>
                    {g.kickoffTime && (
                      <div className="cfb-mono" style={{ fontSize: "0.6rem", color: COLORS.muted, lineHeight: 1.3 }}>{g.kickoffTime}</div>
                    )}
                  </td>
                  {members.map((m) => {
                    const slug = slugify(m);
                    const pick = picksCache[slug]?.picks?.[g.id];
                    const isLock = picksCache[slug]?.lockedGameId === g.id;
                    const pickedSide = pick; // "home" or "away"
                    const label = pick ? (pick === "home" ? g.home : g.away) : "—";
                    const logo = pick ? (pick === "home" ? g.homeLogo : g.awayLogo) : "";
                    const teamColor = pick ? (pick === "home" ? g.homeColor : g.awayColor) : "";
                    let color = COLORS.chalkDim;
                    if (week.graded && pick) {
                      if (cover === "push") color = COLORS.muted;
                      else color = pick === cover ? COLORS.goldBright : COLORS.redBright;
                    }
                    return (
                      <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                        <span className="inline-flex items-center gap-1">
                          {logo ? (
                            <img
                              src={logo}
                              alt={label}
                              style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }}
                              onError={(e) => { e.target.style.display = "none"; }}
                            />
                          ) : pick && teamColor ? (
                            <span style={{
                              display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                              background: teamColor, flexShrink: 0,
                            }} />
                          ) : null}
                          {label.split(" ")[0]}
                          {isLock && <Flame size={11} style={{ color: COLORS.gold, flexShrink: 0 }} />}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderTop: `2px solid ${COLORS.lineStrong}` }}>
              <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>
                <span className="inline-flex items-center gap-1">
                  <Flame size={11} style={{ color: COLORS.gold }} /> dog
                </span>
              </td>
              {members.map((m) => {
                const slug = slugify(m);
                const pick = picksCache[slug]?.underdogPick;
                const result = picksCache[slug]?.underdogResult;
                let color = COLORS.chalkDim;
                if (pick && result === true) color = COLORS.goldBright;
                else if (pick && result === false) color = COLORS.redBright;
                return (
                  <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                    {pick ? `${pick.team} +${pick.spread}` : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------- standings tab -------------------------------- */

function StandingsTab({ leagueMeta, standings, loading, onRefresh }) {
  if (loading && !standings) return <Spinner label="Tallying the season..." />;

  const rows = Object.entries(standings || {})
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.totalWins - a.totalWins);

  const gradedWeeks = leagueMeta.weeks.length;
  const hasWinTotals = rows.some((r) => r.winTotalsWins > 0 || r.winTotalsLosses > 0);
  const hasPlayoff = rows.some((r) => r.playoffWins > 0 || r.playoffLosses > 0);
  const isEmpty =
    rows.length === 0 ||
    rows.every((r) => r.weeksPlayed === 0 && !r.winTotalsWins && !r.winTotalsLosses && !r.playoffWins && !r.playoffLosses);

  return (
    <div className="cfb-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">Standings</div>
        <button onClick={onRefresh} className="cfb-mono text-xs flex items-center gap-1 opacity-70 hover:opacity-100">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> refresh
        </button>
      </div>

      {isEmpty ? (
        <EmptyState title="No graded weeks yet" body="Standings fill in once the commissioner enters results for a week." />
      ) : (
        <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
          <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: COLORS.fieldDeep }}>
                <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>#</th>
                <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
                <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weekly</th>
                {hasWinTotals && <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>win totals</th>}
                {hasPlayoff && <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>playoff</th>}
                <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>total</th>
                <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weeks won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2" style={{ color: i === 0 ? COLORS.gold : COLORS.muted }}>
                    {i === 0 && r.totalWins > 0 ? <Trophy size={14} /> : i + 1}
                  </td>
                  <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{r.name}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{r.weeklyWins}-{r.weeklyLosses}</td>
                  {hasWinTotals && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.winTotalsWins}-{r.winTotalsLosses}</td>
                  )}
                  {hasPlayoff && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.playoffWins}-{r.playoffLosses}</td>
                  )}
                  <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{r.totalWins}-{r.totalLosses}</td>
                  <td className="px-3 py-2 text-right">{r.weeksWon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs" style={{ color: COLORS.muted }}>{gradedWeeks} week{gradedWeeks === 1 ? "" : "s"} on the board so far.</div>
    </div>
  );
}

/* ----------------------------- commissioner tab ------------------------------ */

function CommishTab({
  leagueMeta,
  commishUnlocked,
  passcodeInput,
  picksCache,
  saveUnderdogResults,
  setPasscodeInput,
  onUnlock,
  weekCache,
  loadWeek,
  saveWeekGames,
  toggleLock,
  toggleShowPicksEarly,
  saveResults,
  autoGradeWeek,
  winTotalsCache,
  loadWinTotals,
  saveWinTotalsBoard,
  toggleWinTotalsLock,
  saveWinTotalsResults,
  playoffCache,
  loadPlayoff,
  savePlayoffBoard,
  togglePlayoffLock,
  savePlayoffResults,
  moneyData,
  loadMoneyData,
  saveMoneySettings,
  standings,
  loadStandings,
  finalizeSeasonPayouts,
  unfinalizeSeasonPayouts,
  historyData,
  saveHistoryData,
  resetAllData,
  deleteWeek,
  deleteMember,
}) {
  const [mode, setMode] = useState("games"); // games | results | wtBoard | wtResults | pBoard | pResults | money
  const [editingWeek, setEditingWeek] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!commishUnlocked) {
    return (
      <div className="cfb-fade-in max-w-xs">
        <div className="cfb-display text-xl uppercase mb-3">Commissioner</div>
        <div className="text-sm mb-3" style={{ color: COLORS.chalkDim }}>
          Enter the passcode to manage games and results.
        </div>
        <FieldInput type="password" value={passcodeInput} onChange={setPasscodeInput} placeholder="Passcode" />
        <div className="mt-2">
          <PrimaryButton full onClick={onUnlock}>Unlock</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="cfb-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">Commissioner</div>
        <div className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.goldBright }}>
          <Shield size={12} /> unlocked
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={() => { setMode("games"); setEditingWeek(null); }} disabled={mode === "games" && editingWeek === null}>
          Manage games
        </SecondaryButton>
        <SecondaryButton onClick={() => { setMode("results"); setEditingWeek(null); }} disabled={mode === "results" && editingWeek === null}>
          Enter results
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("wtBoard")} disabled={mode === "wtBoard"}>
          Win totals board
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("wtResults")} disabled={mode === "wtResults"}>
          Win totals results
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("pBoard")} disabled={mode === "pBoard"}>
          Playoff board
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("pResults")} disabled={mode === "pResults"}>
          Playoff results
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("money")} disabled={mode === "money"}>
          Money
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("history")} disabled={mode === "history"}>
          Import history
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("members")} disabled={mode === "members"}>
          Members
        </SecondaryButton>
      </div>

      <div className="text-sm flex items-center gap-1.5" style={{ color: COLORS.chalkDim }}>
        <Users size={14} /> {leagueMeta.members.length} in the pool: {leagueMeta.members.join(", ")}
      </div>

      {mode === "games" && (
        <GamesManager
          leagueMeta={leagueMeta}
          weekCache={weekCache}
          loadWeek={loadWeek}
          saveWeekGames={saveWeekGames}
          toggleLock={toggleLock}
          toggleShowPicksEarly={toggleShowPicksEarly}
          deleteWeek={deleteWeek}
        />
      )}

      {mode === "results" && (
        <ResultsManager
          leagueMeta={leagueMeta}
          weekCache={weekCache}
          loadWeek={loadWeek}
          saveResults={saveResults}
          autoGradeWeek={autoGradeWeek}
          picksCache={picksCache}
          saveUnderdogResults={saveUnderdogResults}
        />
      )}

      {mode === "wtBoard" && (
        <WinTotalsBoardManager
          leagueMeta={leagueMeta}
          winTotalsCache={winTotalsCache}
          loadWinTotals={loadWinTotals}
          saveWinTotalsBoard={saveWinTotalsBoard}
          toggleWinTotalsLock={toggleWinTotalsLock}
        />
      )}

      {mode === "wtResults" && (
        <WinTotalsResultsManager
          leagueMeta={leagueMeta}
          winTotalsCache={winTotalsCache}
          loadWinTotals={loadWinTotals}
          saveWinTotalsResults={saveWinTotalsResults}
        />
      )}

      {mode === "pBoard" && (
        <PlayoffBoardManager
          leagueMeta={leagueMeta}
          playoffCache={playoffCache}
          loadPlayoff={loadPlayoff}
          savePlayoffBoard={savePlayoffBoard}
          togglePlayoffLock={togglePlayoffLock}
        />
      )}

      {mode === "pResults" && (
        <PlayoffResultsManager
          leagueMeta={leagueMeta}
          playoffCache={playoffCache}
          loadPlayoff={loadPlayoff}
          savePlayoffResults={savePlayoffResults}
        />
      )}

      {mode === "money" && (
        <MoneySettingsManager
          leagueMeta={leagueMeta}
          moneyData={moneyData}
          loadMoneyData={loadMoneyData}
          saveMoneySettings={saveMoneySettings}
          standings={standings}
          loadStandings={loadStandings}
          finalizeSeasonPayouts={finalizeSeasonPayouts}
          unfinalizeSeasonPayouts={unfinalizeSeasonPayouts}
        />
      )}

      {mode === "history" && (
        <HistoryImportManager historyData={historyData} saveHistoryData={saveHistoryData} />
      )}

      {mode === "members" && (
        <MembersManager leagueMeta={leagueMeta} deleteMember={deleteMember} />
      )}

      <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => { setResetOpen((o) => !o); setResetConfirming(false); }}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5"
          style={{ color: COLORS.redBright }}
        >
          <AlertCircle size={13} /> Danger zone (testing only)
        </button>
        {resetOpen && (
          <div className="mt-3 p-3 space-y-3" style={{ background: "rgba(179,55,42,0.08)", border: `1px solid ${COLORS.red}` }}>
            <div className="text-sm" style={{ color: COLORS.chalk }}>
              This permanently deletes every member, every week's games and picks, every win totals board and
              pick, every playoff board and pick, and resets money settings and season payouts. Your league name
              and commissioner passcode are kept, but everyone — including you — will need to rejoin under a
              name afterward. Remove this button before opening the pool to real members.
            </div>
            {!resetConfirming ? (
              <SecondaryButton
                onClick={() => setResetConfirming(true)}
                disabled={resetting}
              >
                Reset all data
              </SecondaryButton>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold" style={{ color: COLORS.redBright }}>
                  Are you sure? This can't be undone.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setResetting(true);
                      await resetAllData();
                      setResetting(false);
                    }}
                    disabled={resetting}
                    className="cfb-mono cfb-btn text-xs font-bold uppercase tracking-wider px-3 py-2"
                    style={{ background: COLORS.red, color: COLORS.chalk, border: `1px solid ${COLORS.red}`, opacity: resetting ? 0.6 : 1 }}
                  >
                    {resetting ? "Deleting everything..." : "Yes, delete everything"}
                  </button>
                  <SecondaryButton onClick={() => setResetConfirming(false)} disabled={resetting}>
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function toCST(isoStr) {
  // Convert UTC ISO string → "Sat 11:00 AM CT" label
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " CT";
}

function getDatesInRange(fromDateStr, toDateStr) {
  const dates = [];
  const start = new Date(fromDateStr + "T00:00:00");
  const end = new Date(toDateStr + "T23:59:59");
  const cur = new Date(start);
  while (cur <= end && dates.length < 10) {
    dates.push(cur.toISOString().slice(0, 10).replace(/-/g, ""));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function fetchEspnGameMetadata(fromDate, toDate) {
  const networks = {}; // lowerName -> network string
  const teams = {};    // lowerName -> { logo, color, altColor }
  const dates = getDatesInRange(fromDate, toDate);
  for (const yyyymmdd of dates) {
    try {
      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
        `?dates=${yyyymmdd}&limit=200`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const event of data.events || []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const networkNames = (comp.broadcasts || []).flatMap((b) => b.names || []).filter(Boolean);
        const network = networkNames[0] || "";
        for (const competitor of comp.competitors || []) {
          const team = competitor.team;
          const name = team?.displayName;
          if (!name) continue;
          const key = name.toLowerCase();
          networks[key] = network;
          if (!teams[key]) {
            teams[key] = {
              logo: team.logo || "",
              color: team.color ? `#${team.color}` : "",
              altColor: team.alternateColor ? `#${team.alternateColor}` : "",
            };
          }
        }
      }
    } catch (_) {
      // Non-fatal — ESPN is unofficial and may not have all dates yet
    }
  }
  return { networks, teams };
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(217,164,65,${alpha})`; // fallback: app gold
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function emptyGame() {
  return {
    id: newId(), away: "", home: "", favorite: "home", spread: "",
    kickoffTime: "", kickoffISO: "", network: "",
    homeLogo: "", awayLogo: "", homeColor: "", awayColor: "",
  };
}

function GamesManager({ leagueMeta, weekCache, loadWeek, saveWeekGames, toggleLock, toggleShowPicksEarly, deleteWeek }) {
  const nextWeekNum = leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) + 1 : 1;
  const [selectedWeek, setSelectedWeek] = useState(null); // null = new week
  const [games, setGames] = useState(Array.from({ length: 10 }, emptyGame));
  const [weekNumInput, setWeekNumInput] = useState(String(nextWeekNum));
  const [busy, setBusy] = useState(false);
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importSelected, setImportSelected] = useState({});
  const [confirmDeleteWeek, setConfirmDeleteWeek] = useState(null); // week num pending delete

  const [cfbdOpen, setCfbdOpen] = useState(false);
  const [cfbdKeyInput, setCfbdKeyInput] = useState("");
  const [cfbdKeySaved, setCfbdKeySaved] = useState(false);
  const [cfbdKeyLoading, setCfbdKeyLoading] = useState(true);
  const [cfbdYear, setCfbdYear] = useState(String(defaultCfbdSeasonYear()));
  const [cfbdWeek, setCfbdWeek] = useState(String(nextWeekNum));
  const [cfbdSeasonType, setCfbdSeasonType] = useState("regular");
  const [cfbdTop25Only, setCfbdTop25Only] = useState(true);
  const [cfbdConferences, setCfbdConferences] = useState("");
  const [cfbdBusy, setCfbdBusy] = useState(false);
  const [cfbdError, setCfbdError] = useState(null);

  const [oddsOpen, setOddsOpen] = useState(false);
  const [oddsKeyInput, setOddsKeyInput] = useState("");
  const [oddsKeySaved, setOddsKeySaved] = useState(false);
  const [oddsKeyLoading, setOddsKeyLoading] = useState(true);
  const [oddsFrom, setOddsFrom] = useState(isoDateInput(new Date()));
  const [oddsTo, setOddsTo] = useState(isoDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [oddsBusy, setOddsBusy] = useState(false);
  const [oddsError, setOddsError] = useState(null);
  const [weekDatesFrom, setWeekDatesFrom] = useState("");
  const [weekDatesTo, setWeekDatesTo] = useState("");

  const [shareMessage, setShareMessage] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await safeGet("odds-api-key", false);
      if (raw) {
        setOddsKeyInput(raw);
        setOddsKeySaved(true);
      }
      setOddsKeyLoading(false);
    })();
  }, []);

  async function saveOddsKey() {
    const r = await storage.set("odds-api-key", oddsKeyInput.trim(), false).catch(() => null);
    if (r) setOddsKeySaved(true);
    else setOddsError("Couldn't save the key on this device — try again.");
  }

  async function clearOddsKey() {
    await storage.delete("odds-api-key", false).catch(() => null);
    setOddsKeyInput("");
    setOddsKeySaved(false);
  }

  useEffect(() => {
    (async () => {
      const raw = await safeGet("cfbd-api-key", false);
      if (raw) {
        setCfbdKeyInput(raw);
        setCfbdKeySaved(true);
      }
      setCfbdKeyLoading(false);
    })();
  }, []);

  async function saveCfbdKey() {
    const r = await storage.set("cfbd-api-key", cfbdKeyInput.trim(), false).catch(() => null);
    if (r) setCfbdKeySaved(true);
    else setCfbdError("Couldn't save the key on this device — try again.");
  }

  async function clearCfbdKey() {
    await storage.delete("cfbd-api-key", false).catch(() => null);
    setCfbdKeyInput("");
    setCfbdKeySaved(false);
  }

  async function fetchCfbdWeek() {
    setCfbdError(null);
    setCfbdBusy(true);
    try {
      const headers = { Authorization: `Bearer ${cfbdKeyInput.trim()}`, Accept: "application/json" };
      const base = "https://api.collegefootballdata.com";
      const gamesUrl = `${base}/games?year=${cfbdYear}&week=${cfbdWeek}&seasonType=${cfbdSeasonType}&classification=fbs`;
      const linesUrl = `${base}/lines?year=${cfbdYear}&week=${cfbdWeek}&seasonType=${cfbdSeasonType}`;
      const ranksUrl = `${base}/rankings?year=${cfbdYear}&week=${cfbdWeek}&seasonType=${cfbdSeasonType}`;

      const [gamesRes, linesRes, ranksRes] = await Promise.all([
        fetch(gamesUrl, { headers }),
        fetch(linesUrl, { headers }),
        fetch(ranksUrl, { headers }),
      ]);

      if (gamesRes.status === 401 || gamesRes.status === 403) {
        throw new Error("CFBD rejected that API key. Double check it was copied in full.");
      }
      if (!gamesRes.ok) {
        throw new Error(`CFBD games request failed (status ${gamesRes.status}).`);
      }
      const gamesData = await gamesRes.json();
      const linesData = linesRes.ok ? await linesRes.json() : [];
      const ranksData = ranksRes.ok ? await ranksRes.json() : [];

      const rankMap = {};
      const weekRankings = Array.isArray(ranksData) ? ranksData[0] : null;
      const apPoll =
        weekRankings?.polls?.find((p) => /ap/i.test(p.poll || "")) || weekRankings?.polls?.[0] || null;
      (apPoll?.ranks || []).forEach((r) => {
        rankMap[normalizeTeam(r.school)] = r.rank;
      });

      const lineMap = {};
      (Array.isArray(linesData) ? linesData : []).forEach((l) => {
        const gid = l.id ?? l.gameId ?? l.game_id;
        const ln = (l.lines || [])[0];
        if (gid != null && ln && ln.spread != null) lineMap[gid] = Number(ln.spread);
      });

      const confFilter = cfbdConferences
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const merged = (Array.isArray(gamesData) ? gamesData : [])
        .map((g) => {
          const id = g.id ?? g.gameId ?? g.game_id;
          const home = g.homeTeam ?? g.home_team;
          const away = g.awayTeam ?? g.away_team;
          const homeConf = g.homeConference ?? g.home_conference ?? "";
          const awayConf = g.awayConference ?? g.away_conference ?? "";
          const rawSpread = lineMap[id];
          return {
            away,
            home,
            homeConf,
            awayConf,
            rawSpread,
            awayRank: rankMap[normalizeTeam(away)] || null,
            homeRank: rankMap[normalizeTeam(home)] || null,
          };
        })
        .filter((g) => g.home && g.away && g.rawSpread != null)
        .filter((g) => {
          if (!cfbdTop25Only && confFilter.length === 0) return true;
          const ranked = g.awayRank || g.homeRank;
          const confMatch =
            confFilter.includes((g.homeConf || "").toLowerCase()) ||
            confFilter.includes((g.awayConf || "").toLowerCase());
          return (cfbdTop25Only && ranked) || (confFilter.length > 0 && confMatch);
        })
        .map((g) => ({
          away: g.away,
          home: g.home,
          favorite: g.rawSpread < 0 ? "home" : "away",
          spread: Math.abs(g.rawSpread),
          conference:
            g.homeConf && g.awayConf
              ? g.homeConf === g.awayConf
                ? g.homeConf
                : `${g.awayConf} @ ${g.homeConf}`
              : g.homeConf || g.awayConf || "",
          awayRank: g.awayRank,
          homeRank: g.homeRank,
        }));

      if (!merged.length) {
        setCfbdError(
          "No games matched. Lines sometimes don't post until a few days before kickoff — or try widening Top 25 / conference filters."
        );
      } else {
        setImportPreview(merged);
        const sel = {};
        merged.forEach((_, i) => (sel[i] = true));
        setImportSelected(sel);
        setImportOpen(true);
        setCfbdOpen(false);
      }
    } catch (e) {
      const networkIssue = e instanceof TypeError;
      setCfbdError(
        networkIssue
          ? "Couldn't reach CollegeFootballData from this browser. Paste a list instead below — ask me in chat to generate one — or run the standalone script."
          : e.message || "Something went wrong fetching games."
      );
    } finally {
      setCfbdBusy(false);
    }
  }

  async function fetchOddsApiWeek() {
    setOddsError(null);
    setOddsBusy(true);
    try {
      const params = new URLSearchParams({
        apiKey: oddsKeyInput.trim(),
        regions: "us",
        markets: "spreads",
        oddsFormat: "american",
      });
      if (oddsFrom) params.set("commenceTimeFrom", `${oddsFrom}T00:00:00Z`);
      if (oddsTo) params.set("commenceTimeTo", `${oddsTo}T23:59:59Z`);
      const url = `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds?${params.toString()}`;

      const res = await fetch(url);
      if (res.status === 401) {
        throw new Error("The Odds API rejected that key. Double check it was copied in full.");
      }
      if (!res.ok) {
        throw new Error(`The Odds API request failed (status ${res.status}).`);
      }
      const data = await res.json();

      const merged = (Array.isArray(data) ? data : [])
        .map((ev) => {
          const home = ev.home_team;
          const away = ev.away_team;
          const book = (ev.bookmakers || []).find((b) => b.key === "draftkings") || (ev.bookmakers || [])[0];
          const market = (book?.markets || []).find((m) => m.key === "spreads");
          const homeOutcome = (market?.outcomes || []).find((o) => o.name === home);
          const homePoint = homeOutcome?.point;
          const kickoffTime = toCST(ev.commence_time);
          const kickoffISO = ev.commence_time || "";
          return { home, away, homePoint, kickoffTime, kickoffISO };
        })
        .filter((g) => g.home && g.away && g.homePoint != null);

      // Secondary fetch: ESPN scoreboard for TV network + team branding (best-effort, no API key needed)
      const { networks: espnNetworks, teams: espnTeams } = await fetchEspnGameMetadata(oddsFrom, oddsTo).catch(() => ({ networks: {}, teams: {} }));

      const withNetworks = merged.map((g) => {
        const homeKey = g.home.toLowerCase();
        const awayKey = g.away.toLowerCase();
        const homeTeam = espnTeams[homeKey] || {};
        const awayTeam = espnTeams[awayKey] || {};
        return {
          away: g.away,
          home: g.home,
          favorite: g.homePoint < 0 ? "home" : "away",
          spread: Math.abs(g.homePoint),
          kickoffTime: g.kickoffTime,
          kickoffISO: g.kickoffISO,
          network: espnNetworks[homeKey] || espnNetworks[awayKey] || "",
          homeLogo: homeTeam.logo || "",
          awayLogo: awayTeam.logo || "",
          homeColor: homeTeam.color || "",
          awayColor: awayTeam.color || "",
          conference: "",
          awayRank: null,
          homeRank: null,
        };
      });

      if (!withNetworks.length) {
        setOddsError(
          "No games with posted spreads in that date range. Sportsbooks usually post lines a few days before kickoff — try again closer to game day, or widen the date range."
        );
      } else {
        // Store these dates so Results can auto-fetch scores later
        setWeekDatesFrom(oddsFrom);
        setWeekDatesTo(oddsTo);
        setImportPreview(withNetworks);
        const sel = {};
        withNetworks.forEach((_, i) => (sel[i] = true));
        setImportSelected(sel);
        setImportOpen(true);
        setOddsOpen(false);
      }
    } catch (e) {
      const networkIssue = e instanceof TypeError;
      setOddsError(
        networkIssue
          ? "Couldn't reach The Odds API from this browser. Paste a list instead below, or run the standalone script."
          : e.message || "Something went wrong fetching odds."
      );
    } finally {
      setOddsBusy(false);
    }
  }

  useEffect(() => {
    if (selectedWeek != null && !weekCache[selectedWeek]) {
      loadWeek(selectedWeek, false);
    } else if (selectedWeek != null && weekCache[selectedWeek] && !loadedExisting) {
      setGames(weekCache[selectedWeek].games.map((g) => ({ ...g, spread: String(g.spread) })));
      setWeekNumInput(String(selectedWeek));
      const wd = weekCache[selectedWeek].weekDates;
      if (wd) { setWeekDatesFrom(wd.from || ""); setWeekDatesTo(wd.to || ""); }
      setLoadedExisting(true);
    }
  }, [selectedWeek, weekCache, loadWeek, loadedExisting]);

  function startNew() {
    setSelectedWeek(null);
    setLoadedExisting(false);
    setGames(Array.from({ length: 10 }, emptyGame));
    setWeekNumInput(String(nextWeekNum));
  }

  function startEdit(w) {
    setLoadedExisting(false);
    setSelectedWeek(w);
  }

  function updateGame(idx, patch) {
    setGames((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }

  function addRow() {
    setGames((prev) => [...prev, emptyGame()]);
  }

  function removeRow(idx) {
    setGames((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleParseImport() {
    setImportError(null);
    setImportPreview(null);
    let data;
    try {
      data = JSON.parse(importText);
    } catch (e) {
      setImportError("That doesn't look like valid JSON. Make sure you copied the whole list, brackets included.");
      return;
    }
    if (!Array.isArray(data)) {
      setImportError("Expected a JSON array of games, e.g. [ {...}, {...} ].");
      return;
    }
    try {
      const cleaned = data.map((g, i) => {
        if (!g.away || !g.home || g.spread == null || isNaN(Number(g.spread))) {
          throw new Error(`Entry ${i + 1} is missing an away team, home team, or numeric spread.`);
        }
        return {
          away: String(g.away),
          home: String(g.home),
          favorite: g.favorite === "away" ? "away" : "home",
          spread: Number(g.spread),
          conference: g.conference || g.away_conference || g.home_conference || "",
          awayRank: g.awayRank ?? g.away_rank ?? null,
          homeRank: g.homeRank ?? g.home_rank ?? null,
        };
      });
      setImportPreview(cleaned);
      const sel = {};
      cleaned.forEach((_, i) => (sel[i] = true));
      setImportSelected(sel);
    } catch (e) {
      setImportError(e.message);
    }
  }

  function applyImportSelection() {
    const chosen = importPreview.filter((_, i) => importSelected[i]);
    if (!chosen.length) return;

    // Sort by kickoff time. Times look like "Thu 9:00 PM CT", "Sat 11:00 AM CT".
    // Parse the day + time into a sortable number.
    const DAY_ORDER = { thu: 0, fri: 1, sat: 2, sun: 3, mon: 4, tue: 5, wed: 6 };
    function kickoffSortKey(t) {
      if (!t) return 9999;
      const lower = t.toLowerCase();
      const dayMatch = lower.match(/^(mon|tue|wed|thu|fri|sat|sun)/);
      const timeMatch = lower.match(/(\d+):(\d+)\s*(am|pm)/);
      if (!dayMatch || !timeMatch) return 9999;
      const day = DAY_ORDER[dayMatch[1]] ?? 9;
      let hour = Number(timeMatch[1]);
      const min = Number(timeMatch[2]);
      const ampm = timeMatch[3];
      if (ampm === "pm" && hour !== 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
      return day * 10000 + hour * 100 + min;
    }

    const sorted = [...chosen].sort(
      (a, b) => kickoffSortKey(a.kickoffTime) - kickoffSortKey(b.kickoffTime)
    );

    setGames(
      sorted.map((g) => ({
        id: newId(),
        away: g.away,
        home: g.home,
        favorite: g.favorite,
        spread: String(g.spread),
        kickoffTime: g.kickoffTime || "",
        kickoffISO: g.kickoffISO || "",
        network: g.network || "",
        homeLogo: g.homeLogo || "",
        awayLogo: g.awayLogo || "",
        homeColor: g.homeColor || "",
        awayColor: g.awayColor || "",
      }))
    );
    setImportPreview(null);
    setImportText("");
    setImportOpen(false);
  }

  const valid =
    weekNumInput.trim() &&
    !isNaN(Number(weekNumInput)) &&
    games.length > 0 &&
    games.every((g) => g.away.trim() && g.home.trim() && g.spread !== "" && !isNaN(Number(g.spread)));

  const currentWeekData = selectedWeek != null ? weekCache[selectedWeek] : null;

  useEffect(() => {
    if (selectedWeek != null && currentWeekData) {
      const url = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
      setShareMessage(
        `🏈 Week ${selectedWeek} picks are live! ${currentWeekData.games.length} games to pick — get your picks in before kickoff.\n${url}`
      );
      setShareCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, currentWeekData?.games?.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={startNew} disabled={selectedWeek === null}>
          <span className="flex items-center gap-1"><Plus size={12} /> new week</span>
        </SecondaryButton>
        {leagueMeta.weeks
          .slice()
          .sort((a, b) => b - a)
          .map((w) => (
            <div key={w} className="flex items-center gap-1">
              <SecondaryButton onClick={() => startEdit(w)} disabled={selectedWeek === w}>
                edit wk {w}
              </SecondaryButton>
              {confirmDeleteWeek === w ? (
                <>
                  <button
                    onClick={async () => {
                      setConfirmDeleteWeek(null);
                      if (selectedWeek === w) { setSelectedWeek(null); setLoadedExisting(false); }
                      await deleteWeek(w);
                    }}
                    className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2"
                    style={{ background: "rgba(179,55,42,0.22)", border: `1px solid ${COLORS.red}`, color: COLORS.redBright }}
                  >
                    confirm delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteWeek(null)}
                    className="cfb-mono cfb-btn text-xs px-2.5 py-2"
                    style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalkDim }}
                  >
                    cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDeleteWeek(w)}
                  className="cfb-mono cfb-btn text-xs px-2 py-2"
                  style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}
                  title={`Delete week ${w}`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
      </div>

      {selectedWeek != null && currentWeekData && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: COLORS.chalkDim }}>Week {selectedWeek} is currently</span>
          <button
            onClick={() => toggleLock(selectedWeek)}
            className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2 flex items-center gap-1"
            style={{
              background: currentWeekData.locked ? "rgba(179,55,42,0.16)" : "rgba(217,164,65,0.16)",
              border: `1px solid ${currentWeekData.locked ? COLORS.red : COLORS.gold}`,
              color: currentWeekData.locked ? COLORS.redBright : COLORS.goldBright,
            }}
          >
            {currentWeekData.locked ? <Lock size={12} /> : <Unlock size={12} />}
            {currentWeekData.locked ? "locked — click to open" : "open — click to lock"}
          </button>
          <button
            onClick={() => toggleShowPicksEarly(selectedWeek)}
            className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2 flex items-center gap-1"
            style={{
              background: currentWeekData.showPicksEarly ? "rgba(217,164,65,0.16)" : "transparent",
              border: `1px solid ${currentWeekData.showPicksEarly ? COLORS.gold : COLORS.lineStrong}`,
              color: currentWeekData.showPicksEarly ? COLORS.goldBright : COLORS.chalkDim,
            }}
          >
            <Eye size={12} />
            {currentWeekData.showPicksEarly ? "picks visible early — click to hide until lock" : "picks hidden until lock — click to show early"}
          </button>
        </div>
      )}

      {selectedWeek != null && currentWeekData && (
        <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
          <div className="cfb-mono text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: COLORS.goldBright }}>
            <Send size={13} /> Share this week
          </div>
          <textarea
            value={shareMessage}
            onChange={(e) => {
              setShareMessage(e.target.value);
              setShareCopied(false);
            }}
            rows={4}
            className="cfb-mono text-base sm:text-xs w-full p-2"
            style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
          />
          <div className="mt-2">
            <SecondaryButton
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareMessage);
                  setShareCopied(true);
                } catch (e) {
                  setShareCopied(false);
                }
              }}
            >
              <span className="flex items-center gap-1.5">
                <Copy size={12} /> {shareCopied ? "Copied!" : "Copy message"}
              </span>
            </SecondaryButton>
          </div>
          <div className="text-xs mt-2" style={{ color: COLORS.muted }}>
            Edit the wording if you want, then paste it into your group text.
          </div>
        </div>
      )}

      <div>
        <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
          Week number
        </div>
        <div style={{ maxWidth: 120 }}>
          <FieldInput
            type="number"
            value={weekNumInput}
            onChange={setWeekNumInput}
            disabled={selectedWeek != null}
          />
        </div>
      </div>

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => setCfbdOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}
        >
          <RefreshCw size={13} /> Pull from CollegeFootballData
          <span className="flex-1" />
          {cfbdOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {cfbdOpen && (
          <div className="mt-3 space-y-3">
            {cfbdKeyLoading ? (
              <Spinner label="Checking for a saved key..." />
            ) : !cfbdKeySaved ? (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: COLORS.chalkDim }}>
                  Paste a free CollegeFootballData.com API key. It's saved only on this device, never shared with the
                  rest of the pool, and never stored in the app's code.
                </div>
                <FieldInput type="password" value={cfbdKeyInput} onChange={setCfbdKeyInput} placeholder="CFBD API key" />
                <SecondaryButton onClick={saveCfbdKey} disabled={!cfbdKeyInput.trim()}>
                  Save key on this device
                </SecondaryButton>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs" style={{ color: COLORS.chalkDim }}>
                  <span>Key saved on this device.</span>
                  <button onClick={clearCfbdKey} className="opacity-70 hover:opacity-100">
                    remove key
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>year</div>
                    <FieldInput type="number" value={cfbdYear} onChange={setCfbdYear} />
                  </div>
                  <div>
                    <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>cfb week</div>
                    <FieldInput type="number" value={cfbdWeek} onChange={setCfbdWeek} />
                  </div>
                </div>
                <div>
                  <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>season</div>
                  <select
                    value={cfbdSeasonType}
                    onChange={(e) => setCfbdSeasonType(e.target.value)}
                    className="cfb-mono text-base sm:text-sm px-2 py-2.5 sm:py-2 w-full"
                    style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
                  >
                    <option value="regular">regular</option>
                    <option value="postseason">postseason</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs cfb-mono cursor-pointer" style={{ color: COLORS.chalkDim }}>
                  <input
                    type="checkbox"
                    checked={cfbdTop25Only}
                    onChange={(e) => setCfbdTop25Only(e.target.checked)}
                    style={{ width: 18, height: 18, flexShrink: 0 }}
                  />
                  Only games with a Top 25 team
                </label>
                <div>
                  <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
                    conferences (comma-separated, optional)
                  </div>
                  <FieldInput value={cfbdConferences} onChange={setCfbdConferences} placeholder="SEC, Big Ten" />
                </div>
                {cfbdError && <Banner onDismiss={() => setCfbdError(null)}>{cfbdError}</Banner>}
                <PrimaryButton full onClick={fetchCfbdWeek} disabled={cfbdBusy}>
                  {cfbdBusy ? "Fetching..." : "Fetch this week's games"}
                </PrimaryButton>
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => setOddsOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}
        >
          <TrendingUp size={13} /> Pull from The Odds API
          <span className="flex-1" />
          {oddsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {oddsOpen && (
          <div className="mt-3 space-y-3">
            <div className="text-xs" style={{ color: COLORS.chalkDim }}>
              No Top 25 or conference data from this source — it returns whatever games sportsbooks have posted
              lines for in your date range. You'll pick which ones to use from the list below.
            </div>
            {oddsKeyLoading ? (
              <Spinner label="Checking for a saved key..." />
            ) : !oddsKeySaved ? (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: COLORS.chalkDim }}>
                  Paste your The Odds API key. It's saved only on this device, never shared with the rest of the
                  pool, and never stored in the app's code.
                </div>
                <FieldInput type="password" value={oddsKeyInput} onChange={setOddsKeyInput} placeholder="Odds API key" />
                <SecondaryButton onClick={saveOddsKey} disabled={!oddsKeyInput.trim()}>
                  Save key on this device
                </SecondaryButton>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs" style={{ color: COLORS.chalkDim }}>
                  <span>Key saved on this device.</span>
                  <button onClick={clearOddsKey} className="opacity-70 hover:opacity-100">
                    remove key
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>from date</div>
                    <FieldInput type="date" value={oddsFrom} onChange={setOddsFrom} />
                  </div>
                  <div>
                    <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>to date</div>
                    <FieldInput type="date" value={oddsTo} onChange={setOddsTo} />
                  </div>
                </div>
                {oddsError && <Banner onDismiss={() => setOddsError(null)}>{oddsError}</Banner>}
                <PrimaryButton full onClick={fetchOddsApiWeek} disabled={oddsBusy}>
                  {oddsBusy ? "Fetching..." : "Fetch games in this range"}
                </PrimaryButton>
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => setImportOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}
        >
          <Upload size={13} /> Paste a list
          <span className="flex-1" />
          {importOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {importOpen && (
          <div className="mt-3 space-y-2">
            <div className="text-xs" style={{ color: COLORS.chalkDim }}>
              Ask me in chat — e.g. "pull this week's Top 25 and SEC spreads" — and I'll hand you a list to paste
              here. Each entry needs away, home, favorite ("home" or "away"), and spread; conference and rank are
              optional and just shown as labels below.
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              className="cfb-mono text-base sm:text-xs w-full p-2"
              style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              placeholder='[{"away":"Michigan","home":"Ohio State","favorite":"home","spread":6.5,"conference":"Big Ten","awayRank":5,"homeRank":2}]'
            />
            {importError && (
              <Banner onDismiss={() => setImportError(null)}>{importError}</Banner>
            )}
            <SecondaryButton onClick={handleParseImport} disabled={!importText.trim()}>
              Preview list
            </SecondaryButton>
          </div>
        )}
      </div>

      {importPreview && (
        <div className="px-3 py-3 space-y-1.5" style={{ border: `1px solid ${COLORS.gold}`, background: "rgba(217,164,65,0.06)" }}>
          <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.goldBright }}>
            Pick which games to use
          </div>
          {importPreview.map((g, i) => (
            <label
              key={i}
              className="flex items-start gap-2 px-2 py-2 text-xs cfb-mono cursor-pointer"
              style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}
            >
              <input
                type="checkbox"
                checked={!!importSelected[i]}
                onChange={() => setImportSelected((s) => ({ ...s, [i]: !s[i] }))}
                style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ color: COLORS.chalk }}>
                  {g.awayRank ? `#${g.awayRank} ` : ""}
                  {g.away} @ {g.homeRank ? `#${g.homeRank} ` : ""}
                  {g.home}
                </div>
                {(g.kickoffTime || g.network) && (
                  <div style={{ color: COLORS.muted }}>{[g.kickoffTime, g.network].filter(Boolean).join(" · ")}</div>
                )}
              </div>
              <span style={{ color: COLORS.goldBright, flexShrink: 0 }}>
                {g.favorite === "home" ? g.home : g.away} -{g.spread}
              </span>
            </label>
          ))}
          <PrimaryButton full onClick={applyImportSelection} disabled={Object.values(importSelected).every((v) => !v)}>
            Use {Object.values(importSelected).filter(Boolean).length} selected game
            {Object.values(importSelected).filter(Boolean).length === 1 ? "" : "s"}
          </PrimaryButton>
        </div>
      )}

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.chalkDim }}>
          Game week dates <span style={{ fontWeight: "normal", textTransform: "none", letterSpacing: 0, color: COLORS.muted }}>— used to auto-fetch scores after games are played</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="cfb-mono text-xs mb-1" style={{ color: COLORS.muted }}>from</div>
            <FieldInput type="date" value={weekDatesFrom} onChange={setWeekDatesFrom} />
          </div>
          <div>
            <div className="cfb-mono text-xs mb-1" style={{ color: COLORS.muted }}>to</div>
            <FieldInput type="date" value={weekDatesTo} onChange={setWeekDatesTo} />
          </div>
        </div>
        {!weekDatesFrom && (
          <div className="text-xs mt-1.5" style={{ color: COLORS.muted }}>
            Auto-fills when you import via The Odds API. Set manually if you enter games by hand.
          </div>
        )}
      </div>

      <div className="space-y-2">
        {games.map((g, idx) => (
          <div key={g.id} className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
                game {String(idx + 1).padStart(2, "0")}
              </span>
              {games.length > 1 && (
                <button onClick={() => removeRow(idx)} style={{ color: COLORS.muted }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <FieldInput value={g.away} onChange={(v) => updateGame(idx, { away: v })} placeholder="Away team" />
              <FieldInput value={g.home} onChange={(v) => updateGame(idx, { home: v })} placeholder="Home team" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 grid grid-cols-2 gap-1">
                <button
                  onClick={() => updateGame(idx, { favorite: "away" })}
                  className="cfb-mono text-xs px-2 py-2"
                  style={{
                    background: g.favorite === "away" ? COLORS.gold : "transparent",
                    color: g.favorite === "away" ? COLORS.ink : COLORS.chalkDim,
                    border: `1px solid ${COLORS.lineStrong}`,
                  }}
                >
                  fav: {g.away || "away"}
                </button>
                <button
                  onClick={() => updateGame(idx, { favorite: "home" })}
                  className="cfb-mono text-xs px-2 py-2"
                  style={{
                    background: g.favorite === "home" ? COLORS.gold : "transparent",
                    color: g.favorite === "home" ? COLORS.ink : COLORS.chalkDim,
                    border: `1px solid ${COLORS.lineStrong}`,
                  }}
                >
                  fav: {g.home || "home"}
                </button>
              </div>
              <div style={{ width: 84, flexShrink: 0 }}>
                <FieldInput type="number" value={g.spread} onChange={(v) => updateGame(idx, { spread: v })} placeholder="spread" />
              </div>
            </div>
            <div className="mt-1.5">
              <FieldInput
                value={g.kickoffTime || ""}
                onChange={(v) => updateGame(idx, { kickoffTime: v })}
                placeholder="Kickoff (e.g. Sat 11:00 AM CT)"
              />
            </div>
            <div className="mt-1.5">
              <FieldInput
                value={g.network || ""}
                onChange={(v) => updateGame(idx, { network: v })}
                placeholder="Network (e.g. ABC, ESPN, FOX)"
              />
            </div>
          </div>
        ))}
      </div>

      <SecondaryButton onClick={addRow}>
        <span className="flex items-center gap-1"><Plus size={12} /> add game</span>
      </SecondaryButton>

      <PrimaryButton
        full
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          const wk = Number(weekNumInput);
          const cleanGames = games.map((g) => ({ ...g, spread: Number(g.spread) }));
          const weekDates = weekDatesFrom && weekDatesTo ? { from: weekDatesFrom, to: weekDatesTo } : null;
          const ok = await saveWeekGames(wk, cleanGames, currentWeekData?.locked || false, weekDates);
          setBusy(false);
          if (ok) setSelectedWeek(wk);
        }}
      >
        {busy ? "Saving..." : selectedWeek != null ? "Save changes" : "Create week"}
      </PrimaryButton>
    </div>
  );
}

function ResultsManager({ leagueMeta, weekCache, loadWeek, saveResults, autoGradeWeek, picksCache, saveUnderdogResults }) {
  const [selectedWeek, setSelectedWeek] = useState(leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) : null);
  const [scores, setScores] = useState({});
  const [busy, setBusy] = useState(false);
  const [autoStatus, setAutoStatus] = useState(null); // {status, message, ...}
  const [autoRunning, setAutoRunning] = useState(false);
  const [udStatuses, setUdStatuses] = useState({});
  const [udBusy, setUdBusy] = useState(false);
  const week = selectedWeek != null ? weekCache[selectedWeek] : null;
  const weekPicks = selectedWeek != null ? picksCache[selectedWeek] || {} : {};

  useEffect(() => {
    if (selectedWeek != null && !weekCache[selectedWeek]) {
      loadWeek(selectedWeek, true);
    }
  }, [selectedWeek, weekCache, loadWeek]);

  // Sync score inputs from cached/auto-graded week data
  useEffect(() => {
    if (week) {
      const init = {};
      week.games.forEach((g) => {
        init[g.id] = { homeScore: g.homeScore ?? "", awayScore: g.awayScore ?? "" };
      });
      setScores(init);
    }
  }, [week?.weekNum, week?.graded]);

  // Auto-grade: fires when a locked, ungraded week loads
  useEffect(() => {
    if (!week || !week.locked || week.graded || autoRunning || autoStatus) return;
    (async () => {
      setAutoRunning(true);
      setAutoStatus({ status: "running", message: "Fetching scores from ESPN..." });
      const result = await autoGradeWeek(selectedWeek);
      setAutoStatus(result);
      setAutoRunning(false);
    })();
  }, [week?.weekNum, week?.locked, week?.graded]);

  useEffect(() => {
    const init = {};
    Object.entries(weekPicks).forEach(([slug, p]) => {
      if (p?.underdogPick) {
        init[slug] = p.underdogResult === true ? "yes" : p.underdogResult === false ? "no" : "";
      }
    });
    setUdStatuses(init);
  }, [selectedWeek, Object.keys(weekPicks).length]);

  // Reset auto-status when week changes so it re-triggers
  useEffect(() => {
    setAutoStatus(null);
  }, [selectedWeek]);

  if (!leagueMeta.weeks.length) {
    return <EmptyState title="No weeks yet" body="Create a week under Manage games first." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {leagueMeta.weeks
          .slice()
          .sort((a, b) => b - a)
          .map((w) => (
            <SecondaryButton key={w} onClick={() => setSelectedWeek(w)} disabled={selectedWeek === w}>
              week {w}
            </SecondaryButton>
          ))}
      </div>

      {!week && <Spinner label="Loading week..." />}

      {week && (
        <>
          {/* Auto-grade status */}
          {autoStatus?.status === "running" && (
            <div className="px-3 py-2 flex items-center gap-2 text-sm" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}`, color: COLORS.chalkDim }}>
              <RefreshCw size={14} className="animate-spin flex-shrink-0" />
              {autoStatus.message}
            </div>
          )}
          {autoStatus?.status === "graded" && (
            <div className="px-3 py-2 flex items-center gap-2 text-sm" style={{ background: "rgba(217,164,65,0.1)", border: `1px solid ${COLORS.gold}`, color: COLORS.goldBright }}>
              <CheckCircle2 size={14} className="flex-shrink-0" />
              {autoStatus.message}
              <button onClick={() => { setAutoStatus(null); }} className="cfb-mono text-xs ml-auto opacity-60 hover:opacity-100">re-fetch</button>
            </div>
          )}
          {autoStatus?.status === "pending" && (
            <div className="px-3 py-2 space-y-1" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.lineStrong}` }}>
              <div className="text-sm flex items-center gap-2" style={{ color: COLORS.chalkDim }}>
                <RefreshCw size={14} className="flex-shrink-0" /> {autoStatus.message}
              </div>
              <div className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
                {autoStatus.completedCount} of {autoStatus.totalCount} games final so far.
              </div>
              <button onClick={() => { setAutoStatus(null); }} className="cfb-mono text-xs" style={{ color: COLORS.gold }}>check again</button>
            </div>
          )}
          {autoStatus?.status === "partial" && (
            <div className="px-3 py-2 space-y-1" style={{ background: "rgba(179,55,42,0.1)", border: `1px solid ${COLORS.red}` }}>
              <div className="text-sm" style={{ color: COLORS.redBright }}>{autoStatus.message}</div>
              <button onClick={() => { setAutoStatus(null); }} className="cfb-mono text-xs" style={{ color: COLORS.gold }}>try again</button>
            </div>
          )}
          {autoStatus?.status === "error" && (
            <div className="px-3 py-2 space-y-1" style={{ background: "rgba(179,55,42,0.1)", border: `1px solid ${COLORS.red}` }}>
              <div className="text-sm" style={{ color: COLORS.redBright }}>{autoStatus.message}</div>
              <button onClick={() => { setAutoStatus(null); }} className="cfb-mono text-xs" style={{ color: COLORS.gold }}>retry</button>
            </div>
          )}
          {autoStatus?.status === "no-dates" && (
            <div className="px-3 py-2 text-sm" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalkDim }}>
              {autoStatus.message}
            </div>
          )}
          {!week.locked && (
            <div className="px-3 py-2 text-sm" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}`, color: COLORS.chalkDim }}>
              Lock the week first — results can only be entered once picks are locked.
            </div>
          )}
          {week.graded && !autoStatus && (
            <Banner kind="info">This week is fully graded. Edit scores below and re-save if anything needs correcting.</Banner>
          )}
          <div className="space-y-2">
            {week.games.map((g, idx) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
                <span className="cfb-mono text-xs w-6" style={{ color: COLORS.muted }}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="text-sm flex-1 truncate">{g.away} @ {g.home}</span>
                <div style={{ width: 60, flexShrink: 0 }}>
                  <FieldInput
                    type="number"
                    value={scores[g.id]?.awayScore ?? ""}
                    onChange={(v) => setScores((p) => ({ ...p, [g.id]: { ...p[g.id], awayScore: v } }))}
                    placeholder="aw"
                  />
                </div>
                <div style={{ width: 60, flexShrink: 0 }}>
                  <FieldInput
                    type="number"
                    value={scores[g.id]?.homeScore ?? ""}
                    onChange={(v) => setScores((p) => ({ ...p, [g.id]: { ...p[g.id], homeScore: v } }))}
                    placeholder="hm"
                  />
                </div>
              </div>
            ))}
          </div>
          <PrimaryButton
            full
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const gamesWithScores = week.games.map((g) => ({
                ...g,
                homeScore: scores[g.id]?.homeScore,
                awayScore: scores[g.id]?.awayScore,
              }));
              await saveResults(selectedWeek, gamesWithScores);
              setBusy(false);
            }}
          >
            {busy ? "Saving..." : "Save results"}
          </PrimaryButton>

          {Object.entries(weekPicks).filter(([, p]) => p?.underdogPick).length > 0 && (
            <div className="mt-2 pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
              <div className="cfb-display text-lg uppercase mb-2">Underdog of the week</div>
              <div className="text-xs mb-3" style={{ color: COLORS.muted }}>
                Mark each submitted underdog pick yes/no once that game's final is known. The underdog must have won
                outright to hit.
              </div>
              <div className="space-y-2">
                {Object.entries(weekPicks)
                  .filter(([, p]) => p?.underdogPick)
                  .map(([slug, p]) => (
                    <div
                      key={slug}
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{p.name || slug}</div>
                        <div className="cfb-mono text-xs truncate" style={{ color: COLORS.muted }}>
                          {p.underdogPick.team} +{p.underdogPick.spread} vs {p.underdogPick.opponent}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {["yes", "no"].map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setUdStatuses((prev) => ({ ...prev, [slug]: opt }))}
                            className="cfb-mono cfb-btn text-xs font-semibold px-2.5 py-2 capitalize"
                            style={{
                              background:
                                udStatuses[slug] === opt
                                  ? opt === "yes"
                                    ? "rgba(217,164,65,0.18)"
                                    : "rgba(179,55,42,0.18)"
                                  : "transparent",
                              border: `1px solid ${
                                udStatuses[slug] === opt ? (opt === "yes" ? COLORS.gold : COLORS.red) : COLORS.lineStrong
                              }`,
                              color: udStatuses[slug] === opt ? (opt === "yes" ? COLORS.goldBright : COLORS.redBright) : COLORS.chalkDim,
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
              <div className="mt-3">
                <SecondaryButton
                  disabled={udBusy}
                  onClick={async () => {
                    setUdBusy(true);
                    const mapped = {};
                    Object.entries(udStatuses).forEach(([slug, v]) => {
                      mapped[slug] = v === "yes" ? true : v === "no" ? false : null;
                    });
                    await saveUnderdogResults(selectedWeek, mapped);
                    setUdBusy(false);
                  }}
                >
                  {udBusy ? "Saving..." : "Save underdog results"}
                </SecondaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------- shared -------------------------------- */

/* ------------------------------- win totals tab ----------------------------- */

const WT_SLOTS = [
  { key: "ACC", label: "ACC", conference: "ACC" },
  { key: "Big Ten", label: "Big Ten", conference: "Big Ten" },
  { key: "Big 12", label: "Big 12", conference: "Big 12" },
  { key: "SEC", label: "SEC", conference: "SEC" },
  { key: "wild1", label: "Wildcard #1", conference: null },
  { key: "wild2", label: "Wildcard #2", conference: null },
];

function WinTotalsTab({ leagueMeta, selectedYear, setSelectedYear, board, loading, picksCache, myName, saveWinTotalsPicks, slugToName }) {
  const mySlug = slugify(myName);
  const [selections, setSelections] = useState({}); // slotKey -> {teamId, side}
  const [saving, setSaving] = useState(false);
  const [loadedExisting, setLoadedExisting] = useState(false);

  useEffect(() => {
    setLoadedExisting(false);
    setSelections({});
  }, [selectedYear]);

  useEffect(() => {
    if (!loadedExisting && board && picksCache[selectedYear]) {
      const mine = picksCache[selectedYear][mySlug];
      if (mine) {
        const sel = {};
        (mine.picks || []).forEach((p) => {
          sel[p.slotKey] = { teamId: p.teamId, side: p.side };
        });
        setSelections(sel);
      }
      setLoadedExisting(true);
    }
  }, [board, picksCache, selectedYear, mySlug, loadedExisting]);

  const years = leagueMeta.winTotalsYears || [];

  if (years.length === 0) {
    return (
      <EmptyState
        title="No win totals board yet"
        body="The commissioner hasn't set up preseason win totals. Check back once they do."
      />
    );
  }

  if (selectedYear == null) return <Spinner label="Loading..." />;
  if (loading && !board) return <Spinner label="Loading win totals board..." />;
  if (!board) return <EmptyState title={`${selectedYear} board not found`} body="This board may have been removed." />;

  const teamsById = {};
  board.teams.forEach((t) => (teamsById[t.id] = t));

  const usedTeamIds = new Set(Object.values(selections).map((s) => s?.teamId).filter(Boolean));

  function updateSlot(slotKey, patch) {
    setSelections((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], ...patch } }));
  }

  const allFilled = WT_SLOTS.every((s) => selections[s.key]?.teamId && selections[s.key]?.side);
  const conferenceOk = WT_SLOTS.filter((s) => s.conference).every((s) => {
    const sel = selections[s.key];
    if (!sel) return false;
    const team = teamsById[sel.teamId];
    return team && normalizeConf(team.conference) === s.conference;
  });
  const noDuplicates = (() => {
    const ids = WT_SLOTS.map((s) => selections[s.key]?.teamId).filter(Boolean);
    return new Set(ids).size === ids.length;
  })();
  const canSubmit = allFilled && conferenceOk && noDuplicates;

  const picksForYear = picksCache[selectedYear] || {};
  const submittedCount = Object.values(picksForYear).filter((v) => v && (v.picks || []).length > 0).length;

  const leaderboardRows = Object.values(picksForYear)
    .filter((p) => p?.name)
    .map((p) => {
      let correct = 0;
      let graded = 0;
      (p.picks || []).forEach((pick) => {
        const team = teamsById[pick.teamId];
        if (!team) return;
        const cover = winTotalCover(team);
        if (!cover) return;
        graded++;
        if (cover !== "push" && pick.side === cover) correct++;
      });
      return { name: p.name, correct, graded };
    })
    .sort((a, b) => b.correct - a.correct);

  return (
    <div className="cfb-fade-in space-y-4">
      {years.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto cfb-scroll pb-1">
          {years
            .slice()
            .sort((a, b) => a - b)
            .map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className="cfb-mono cfb-btn text-xs font-bold px-3 py-2 flex-shrink-0"
                style={{
                  background: selectedYear === y ? COLORS.gold : "transparent",
                  color: selectedYear === y ? COLORS.ink : COLORS.chalkDim,
                  border: `1px solid ${selectedYear === y ? COLORS.gold : COLORS.lineStrong}`,
                }}
              >
                {y}
              </button>
            ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">{selectedYear} Win Totals</div>
        {board.locked ? (
          <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.muted }}>
            <Lock size={12} /> locked
          </span>
        ) : (
          <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.goldBright }}>
            <Unlock size={12} /> open
          </span>
        )}
      </div>

      {!board.locked && (
        <div className="text-sm" style={{ color: COLORS.chalkDim }}>
          Pick one team from each Power 4 conference to go Over or Under their win total, plus 2 wildcard picks
          from any Power 4 team. {submittedCount} of {leagueMeta.members.length} have submitted picks.
        </div>
      )}

      <div className="space-y-3">
        {WT_SLOTS.map((slot) => {
          const sel = selections[slot.key] || {};
          const team = sel.teamId ? teamsById[sel.teamId] : null;
          const options = board.teams.filter(
            (t) =>
              (!slot.conference || normalizeConf(t.conference) === slot.conference) &&
              (!usedTeamIds.has(t.id) || t.id === sel.teamId)
          );
          const disabled = board.locked;
          return (
            <div key={slot.key} className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
              <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.gold }}>
                {slot.label}
                {!slot.conference && " (any Power 4 team)"}
              </div>
              <select
                disabled={disabled}
                value={sel.teamId || ""}
                onChange={(e) => updateSlot(slot.key, { teamId: e.target.value || null, side: null })}
                className="cfb-mono text-base sm:text-sm px-2 py-2.5 sm:py-2 w-full mb-2"
                style={{ background: COLORS.fieldDark, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              >
                <option value="">Select a team...</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.school} ({t.conference}) — {t.line}
                  </option>
                ))}
              </select>
              {team && (
                <div className="grid grid-cols-2 gap-2">
                  {["over", "under"].map((side) => {
                    const isPicked = sel.side === side;
                    const cover = winTotalCover(team);
                    const isCorrect = cover === side && cover !== "push";
                    const isWrong = isPicked && cover && cover !== side && cover !== "push";
                    let bg = "transparent";
                    let borderColor = COLORS.lineStrong;
                    let textColor = COLORS.chalk;
                    if (isPicked && !cover) {
                      bg = COLORS.gold;
                      borderColor = COLORS.gold;
                      textColor = COLORS.ink;
                    }
                    if (cover) {
                      if (isCorrect) {
                        bg = "rgba(217,164,65,0.18)";
                        borderColor = COLORS.gold;
                      } else if (isPicked && isWrong) {
                        bg = "rgba(179,55,42,0.18)";
                        borderColor = COLORS.red;
                      }
                    }
                    return (
                      <button
                        key={side}
                        disabled={disabled}
                        onClick={() => updateSlot(slot.key, { side })}
                        className="cfb-btn px-2.5 py-2 text-sm font-semibold capitalize"
                        style={{ background: bg, border: `1px solid ${borderColor}`, color: textColor, cursor: disabled ? "default" : "pointer" }}
                      >
                        {side} {team.line}
                      </button>
                    );
                  })}
                </div>
              )}
              {team && team.finalWins != null && (
                <div className="cfb-mono text-xs mt-1.5" style={{ color: COLORS.muted }}>
                  final: {team.finalWins} wins{winTotalCover(team) === "push" ? " (push)" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!board.locked && (
        <>
          <PrimaryButton
            full
            disabled={!canSubmit || saving}
            onClick={async () => {
              setSaving(true);
              const picks = WT_SLOTS.map((s) => ({
                slotKey: s.key,
                teamId: selections[s.key].teamId,
                side: selections[s.key].side,
              }));
              await saveWinTotalsPicks(selectedYear, picks);
              setSaving(false);
            }}
          >
            {saving ? "Saving..." : "Save my picks"}
          </PrimaryButton>
          {!canSubmit && (
            <div className="text-xs" style={{ color: COLORS.muted }}>
              Fill all 6 picks (one per Power 4 conference, plus 2 wildcards) with no repeated teams to save.
            </div>
          )}
        </>
      )}

      {board.locked && (
        <WinTotalsGrid leagueMeta={leagueMeta} board={board} picksCache={picksForYear} slugToName={slugToName} />
      )}

      {board.locked && (
        <div className="mt-2">
          <div className="cfb-display text-lg uppercase mb-2">Win Totals Leaderboard</div>
          {leaderboardRows.length === 0 || leaderboardRows.every((r) => r.graded === 0) ? (
            <div className="text-sm" style={{ color: COLORS.muted }}>
              No results entered yet.
            </div>
          ) : (
            <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
              <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: COLORS.fieldDeep }}>
                    <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>#</th>
                    <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
                    <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>correct</th>
                    <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>graded</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.map((r, i) => (
                    <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                      <td className="px-3 py-2" style={{ color: i === 0 ? COLORS.gold : COLORS.muted }}>
                        {i === 0 && r.correct > 0 ? <Trophy size={14} /> : i + 1}
                      </td>
                      <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{r.name}</td>
                      <td className="px-3 py-2 text-right">{r.correct}</td>
                      <td className="px-3 py-2 text-right">{r.graded}/6</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WinTotalsGrid({ leagueMeta, board, picksCache, slugToName }) {
  const teamsById = {};
  board.teams.forEach((t) => (teamsById[t.id] = t));
  const members = leagueMeta.members;
  return (
    <div className="mt-2">
      <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.chalkDim }}>
        Everyone's picks
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-xs w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                slot
              </th>
              {members.map((m) => (
                <th key={m} className="text-left px-2 py-1.5 whitespace-nowrap" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WT_SLOTS.map((slot) => (
              <tr key={slot.key} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>
                  {slot.label}
                </td>
                {members.map((m) => {
                  const slugM = slugify(m);
                  const pdoc = picksCache[slugM];
                  const pick = (pdoc?.picks || []).find((p) => p.slotKey === slot.key);
                  const team = pick ? teamsById[pick.teamId] : null;
                  const label = team ? `${team.school} ${pick.side} ${team.line}` : "—";
                  let color = COLORS.chalkDim;
                  if (team) {
                    const cover = winTotalCover(team);
                    if (cover === "push") color = COLORS.muted;
                    else if (cover) color = pick.side === cover ? COLORS.goldBright : COLORS.redBright;
                  }
                  return (
                    <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                      {label}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------- win totals commissioner ------------------------- */

function WinTotalsBoardManager({ leagueMeta, winTotalsCache, loadWinTotals, saveWinTotalsBoard, toggleWinTotalsLock }) {
  const years = leagueMeta.winTotalsYears || [];
  const [selectedYear, setSelectedYear] = useState(null); // null = new board
  const [yearInput, setYearInput] = useState(String(defaultWinTotalsYear()));
  const [teams, setTeams] = useState([]);
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (selectedYear != null && !winTotalsCache[selectedYear]) {
      loadWinTotals(selectedYear, false);
    } else if (selectedYear != null && winTotalsCache[selectedYear] && !loadedExisting) {
      setTeams(winTotalsCache[selectedYear].teams.map((t) => ({ ...t, line: String(t.line) })));
      setYearInput(String(selectedYear));
      setLoadedExisting(true);
    }
  }, [selectedYear, winTotalsCache, loadWinTotals, loadedExisting]);

  function startNew() {
    setSelectedYear(null);
    setLoadedExisting(false);
    setTeams([]);
    setYearInput(String(defaultWinTotalsYear()));
  }
  function startEdit(y) {
    setLoadedExisting(false);
    setSelectedYear(y);
  }

  function updateTeam(idx, patch) {
    setTeams((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function addRow() {
    setTeams((prev) => [...prev, newWinTotalsTeam()]);
  }
  function removeRow(idx) {
    setTeams((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleParseImport() {
    setImportError(null);
    let data;
    try {
      data = JSON.parse(importText);
    } catch (e) {
      setImportError("That doesn't look like valid JSON. Make sure you copied the whole list, brackets included.");
      return;
    }
    if (!Array.isArray(data)) {
      setImportError("Expected a JSON array of teams.");
      return;
    }
    try {
      const existingByName = {};
      teams.forEach((t) => {
        existingByName[normalizeTeam(t.school)] = t.id;
      });
      const cleaned = data.map((t, i) => {
        if (!t.school || t.line == null || isNaN(Number(t.line))) {
          throw new Error(`Entry ${i + 1} is missing a school name or numeric line.`);
        }
        const conf = normalizeConf(t.conference);
        if (!P4_CONFERENCES.includes(conf)) {
          throw new Error(
            `Entry ${i + 1} (${t.school}) has an unrecognized conference "${t.conference}". Must be ACC, Big Ten, Big 12, or SEC.`
          );
        }
        const existingId = existingByName[normalizeTeam(t.school)];
        return { id: existingId || newId(), school: String(t.school), conference: conf, line: String(t.line) };
      });
      setTeams(cleaned);
      setImportText("");
      setImportOpen(false);
    } catch (e) {
      setImportError(e.message);
    }
  }

  const currentBoard = selectedYear != null ? winTotalsCache[selectedYear] : null;
  const valid =
    yearInput.trim() &&
    !isNaN(Number(yearInput)) &&
    teams.length > 0 &&
    teams.every((t) => t.school.trim() && t.line !== "" && !isNaN(Number(t.line)) && P4_CONFERENCES.includes(t.conference));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={startNew} disabled={selectedYear === null}>
          <span className="flex items-center gap-1"><Plus size={12} /> new board</span>
        </SecondaryButton>
        {years
          .slice()
          .sort((a, b) => b - a)
          .map((y) => (
            <SecondaryButton key={y} onClick={() => startEdit(y)} disabled={selectedYear === y}>
              edit {y}
            </SecondaryButton>
          ))}
      </div>

      {selectedYear != null && currentBoard && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: COLORS.chalkDim }}>{selectedYear} board is currently</span>
          <button
            onClick={() => toggleWinTotalsLock(selectedYear)}
            className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2 flex items-center gap-1"
            style={{
              background: currentBoard.locked ? "rgba(179,55,42,0.16)" : "rgba(217,164,65,0.16)",
              border: `1px solid ${currentBoard.locked ? COLORS.red : COLORS.gold}`,
              color: currentBoard.locked ? COLORS.redBright : COLORS.goldBright,
            }}
          >
            {currentBoard.locked ? <Lock size={12} /> : <Unlock size={12} />}
            {currentBoard.locked ? "locked — click to open" : "open — click to lock"}
          </button>
        </div>
      )}

      <div>
        <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
          Season year
        </div>
        <div style={{ maxWidth: 120 }}>
          <FieldInput type="number" value={yearInput} onChange={setYearInput} disabled={selectedYear != null} />
        </div>
      </div>

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => setImportOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}
        >
          <Upload size={13} /> Paste win totals list
          <span className="flex-1" />
          {importOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {importOpen && (
          <div className="mt-3 space-y-2">
            <div className="text-xs" style={{ color: COLORS.chalkDim }}>
              Ask me in chat for this year's Power 4 win total lines, then paste the list here. This replaces the
              team list below — review it before saving.
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              className="cfb-mono text-base sm:text-xs w-full p-2"
              style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              placeholder='[{"school":"Ohio State","conference":"Big Ten","line":10.5}, {"school":"Georgia","conference":"SEC","line":9.5}]'
            />
            {importError && <Banner onDismiss={() => setImportError(null)}>{importError}</Banner>}
            <SecondaryButton onClick={handleParseImport} disabled={!importText.trim()}>
              Load list
            </SecondaryButton>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {teams.map((t, idx) => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
            <div className="flex-1">
              <FieldInput value={t.school} onChange={(v) => updateTeam(idx, { school: v })} placeholder="School" />
            </div>
            <div style={{ width: 110, flexShrink: 0 }}>
              <select
                value={t.conference}
                onChange={(e) => updateTeam(idx, { conference: e.target.value })}
                className="cfb-mono text-base sm:text-sm px-2 py-2.5 sm:py-2 w-full"
                style={{ background: COLORS.fieldDark, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              >
                {P4_CONFERENCES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ width: 70, flexShrink: 0 }}>
              <FieldInput type="number" value={t.line} onChange={(v) => updateTeam(idx, { line: v })} placeholder="line" />
            </div>
            <button onClick={() => removeRow(idx)} style={{ color: COLORS.muted }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <SecondaryButton onClick={addRow}>
        <span className="flex items-center gap-1"><Plus size={12} /> add team</span>
      </SecondaryButton>

      <PrimaryButton
        full
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          const yr = Number(yearInput);
          const cleanTeams = teams.map((t) => ({ id: t.id, school: t.school.trim(), conference: t.conference, line: Number(t.line) }));
          const ok = await saveWinTotalsBoard(yr, cleanTeams, currentBoard?.locked || false);
          setBusy(false);
          if (ok) setSelectedYear(yr);
        }}
      >
        {busy ? "Saving..." : selectedYear != null ? "Save changes" : "Create board"}
      </PrimaryButton>
    </div>
  );
}

function WinTotalsResultsManager({ leagueMeta, winTotalsCache, loadWinTotals, saveWinTotalsResults }) {
  const years = leagueMeta.winTotalsYears || [];
  const [selectedYear, setSelectedYear] = useState(years.length ? Math.max(...years) : null);
  const [finals, setFinals] = useState({});
  const [busy, setBusy] = useState(false);
  const board = selectedYear != null ? winTotalsCache[selectedYear] : null;

  useEffect(() => {
    if (selectedYear != null && !winTotalsCache[selectedYear]) loadWinTotals(selectedYear, false);
  }, [selectedYear, winTotalsCache, loadWinTotals]);

  useEffect(() => {
    if (board) {
      const init = {};
      board.teams.forEach((t) => {
        init[t.id] = t.finalWins ?? "";
      });
      setFinals(init);
    }
  }, [board?.year]);

  if (!years.length) {
    return <EmptyState title="No win totals board yet" body="Set one up under Win totals board first." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {years
          .slice()
          .sort((a, b) => b - a)
          .map((y) => (
            <SecondaryButton key={y} onClick={() => setSelectedYear(y)} disabled={selectedYear === y}>
              {y}
            </SecondaryButton>
          ))}
      </div>

      {!board && <Spinner label="Loading board..." />}

      {board && (
        <>
          <div className="text-xs" style={{ color: COLORS.muted }}>
            Enter each team's final regular-season win count. Picks grade automatically as you fill these in.
          </div>
          <div className="space-y-2">
            {board.teams.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
                <span className="text-sm flex-1 truncate">
                  {t.school}{" "}
                  <span className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
                    ({t.conference}, line {t.line})
                  </span>
                </span>
                <div style={{ width: 70, flexShrink: 0 }}>
                  <FieldInput
                    type="number"
                    value={finals[t.id] ?? ""}
                    onChange={(v) => setFinals((p) => ({ ...p, [t.id]: v }))}
                    placeholder="wins"
                  />
                </div>
              </div>
            ))}
          </div>
          <PrimaryButton
            full
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const teamsWithFinal = board.teams.map((t) => ({
                ...t,
                finalWins: finals[t.id] === "" || finals[t.id] == null ? null : Number(finals[t.id]),
              }));
              await saveWinTotalsResults(selectedYear, teamsWithFinal);
              setBusy(false);
            }}
          >
            {busy ? "Saving..." : "Save results"}
          </PrimaryButton>
        </>
      )}
    </div>
  );
}

/* -------------------------------- playoff tab -------------------------------- */

function PlayoffTab({ leagueMeta, selectedYear, setSelectedYear, board, loading, picksCache, myName, savePlayoffPicks, slugToName }) {
  const mySlug = slugify(myName);
  const [selections, setSelections] = useState({}); // slotKey -> teamId
  const [saving, setSaving] = useState(false);
  const [loadedExisting, setLoadedExisting] = useState(false);

  useEffect(() => {
    setLoadedExisting(false);
    setSelections({});
  }, [selectedYear]);

  useEffect(() => {
    if (!loadedExisting && board && picksCache[selectedYear]) {
      const mine = picksCache[selectedYear][mySlug];
      if (mine) {
        const sel = {};
        (mine.picks || []).forEach((p) => {
          sel[p.slotKey] = p.teamId;
        });
        setSelections(sel);
      }
      setLoadedExisting(true);
    }
  }, [board, picksCache, selectedYear, mySlug, loadedExisting]);

  const years = leagueMeta.playoffYears || [];

  if (years.length === 0) {
    return (
      <EmptyState
        title="No playoff board yet"
        body="The commissioner hasn't set up playoff picks. Check back once they do."
      />
    );
  }

  if (selectedYear == null) return <Spinner label="Loading..." />;
  if (loading && !board) return <Spinner label="Loading playoff board..." />;
  if (!board) return <EmptyState title={`${selectedYear} board not found`} body="This board may have been removed." />;

  const { tiersById, tier1, tier2, tier3 } = computePlayoffTiers(board.teams);
  const teamsById = {};
  board.teams.forEach((t) => (teamsById[t.id] = t));

  const usedTeamIds = new Set(Object.values(selections).filter(Boolean));

  function updateSlot(slotKey, teamId) {
    setSelections((prev) => ({ ...prev, [slotKey]: teamId || null }));
  }

  function tierOptions(tier) {
    if (tier === 1) return tier1;
    if (tier === 2) return tier2;
    return tier3;
  }

  const allFilled = PLAYOFF_SLOTS.every((s) => selections[s.key]);
  const tierOk = PLAYOFF_SLOTS.filter((s) => s.tier).every((s) => {
    const teamId = selections[s.key];
    if (!teamId) return false;
    return tiersById[teamId] === s.tier;
  });
  const noDuplicates = (() => {
    const ids = PLAYOFF_SLOTS.map((s) => selections[s.key]).filter(Boolean);
    return new Set(ids).size === ids.length;
  })();
  const canSubmit = allFilled && tierOk && noDuplicates;

  const picksForYear = picksCache[selectedYear] || {};
  const submittedCount = Object.values(picksForYear).filter((v) => v && (v.picks || []).length > 0).length;

  return (
    <div className="cfb-fade-in space-y-4">
      {years.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto cfb-scroll pb-1">
          {years
            .slice()
            .sort((a, b) => a - b)
            .map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className="cfb-mono cfb-btn text-xs font-bold px-3 py-2 flex-shrink-0"
                style={{
                  background: selectedYear === y ? COLORS.gold : "transparent",
                  color: selectedYear === y ? COLORS.ink : COLORS.chalkDim,
                  border: `1px solid ${selectedYear === y ? COLORS.gold : COLORS.lineStrong}`,
                }}
              >
                {y}
              </button>
            ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">{selectedYear} Playoff Picks</div>
        {board.locked ? (
          <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.muted }}>
            <Lock size={12} /> locked
          </span>
        ) : (
          <span className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.goldBright }}>
            <Unlock size={12} /> open
          </span>
        )}
      </div>

      {!board.locked && (
        <div className="text-sm" style={{ color: COLORS.chalkDim }}>
          Pick 3 teams from Tier 1, 2 from Tier 2, and 1 from Tier 3. Correct picks count
          toward your total on the Standings tab. {submittedCount} of {leagueMeta.members.length} have submitted picks.
        </div>
      )}

      <div className="space-y-3">
        {PLAYOFF_SLOTS.map((slot) => {
          const teamId = selections[slot.key];
          const team = teamId ? teamsById[teamId] : null;
          const options = tierOptions(slot.tier).filter((t) => !usedTeamIds.has(t.id) || t.id === teamId);
          const disabled = board.locked;
          let resultColor = null;
          if (team && team.madePlayoff != null) {
            resultColor = team.madePlayoff ? COLORS.goldBright : COLORS.redBright;
          }
          return (
            <div key={slot.key} className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
              <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.gold }}>{slot.label}</div>
              <select
                disabled={disabled}
                value={teamId || ""}
                onChange={(e) => updateSlot(slot.key, e.target.value || null)}
                className="cfb-mono text-base sm:text-sm px-2 py-2.5 sm:py-2 w-full"
                style={{
                  background: COLORS.fieldDark,
                  color: resultColor || COLORS.chalk,
                  border: `1px solid ${resultColor || COLORS.lineStrong}`,
                }}
              >
                <option value="">Select a team...</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.school} (+{t.odds})
                  </option>
                ))}
              </select>
              {team && team.madePlayoff != null && (
                <div className="cfb-mono text-xs mt-1.5" style={{ color: resultColor }}>
                  {team.madePlayoff ? "made the playoff" : "did not make it"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!board.locked && (
        <>
          <PrimaryButton
            full
            disabled={!canSubmit || saving}
            onClick={async () => {
              setSaving(true);
              const picks = PLAYOFF_SLOTS.map((s) => ({ slotKey: s.key, teamId: selections[s.key] }));
              await savePlayoffPicks(selectedYear, picks);
              setSaving(false);
            }}
          >
            {saving ? "Saving..." : "Save my picks"}
          </PrimaryButton>
          {!canSubmit && (
            <div className="text-xs" style={{ color: COLORS.muted }}>
              Fill all 6 picks (3 from Tier 1, 2 from Tier 2, 1 from Tier 3) with no repeated teams to save.
            </div>
          )}
        </>
      )}

      {board.locked && (
        <>
          <PlayoffGrid leagueMeta={leagueMeta} board={board} picksCache={picksForYear} slugToName={slugToName} />
          <div className="text-xs" style={{ color: COLORS.muted }}>
            Correct picks count toward your total on the Standings tab.
          </div>
        </>
      )}
    </div>
  );
}

function PlayoffGrid({ leagueMeta, board, picksCache, slugToName }) {
  const teamsById = {};
  board.teams.forEach((t) => (teamsById[t.id] = t));
  const members = leagueMeta.members;
  return (
    <div className="mt-2">
      <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.chalkDim }}>
        Everyone's picks
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-xs w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                slot
              </th>
              {members.map((m) => (
                <th key={m} className="text-left px-2 py-1.5 whitespace-nowrap" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAYOFF_SLOTS.map((slot) => (
              <tr key={slot.key} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>
                  {slot.label}
                </td>
                {members.map((m) => {
                  const slugM = slugify(m);
                  const pdoc = picksCache[slugM];
                  const pick = (pdoc?.picks || []).find((p) => p.slotKey === slot.key);
                  const team = pick ? teamsById[pick.teamId] : null;
                  const label = team ? `${team.school} (+${team.odds})` : "—";
                  let color = COLORS.chalkDim;
                  if (team && team.madePlayoff != null) color = team.madePlayoff ? COLORS.goldBright : COLORS.redBright;
                  return (
                    <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                      {label}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------- playoff commissioner --------------------------- */

function PlayoffBoardManager({ leagueMeta, playoffCache, loadPlayoff, savePlayoffBoard, togglePlayoffLock }) {
  const years = leagueMeta.playoffYears || [];
  const [selectedYear, setSelectedYear] = useState(null);
  const [yearInput, setYearInput] = useState(String(defaultWinTotalsYear()));
  const [teams, setTeams] = useState([]);
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState(null);
  const [importNotice, setImportNotice] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (selectedYear != null && !playoffCache[selectedYear]) {
      loadPlayoff(selectedYear, false);
    } else if (selectedYear != null && playoffCache[selectedYear] && !loadedExisting) {
      setTeams(playoffCache[selectedYear].teams.map((t) => ({ ...t, odds: String(t.odds) })));
      setYearInput(String(selectedYear));
      setLoadedExisting(true);
    }
  }, [selectedYear, playoffCache, loadPlayoff, loadedExisting]);

  function startNew() {
    setSelectedYear(null);
    setLoadedExisting(false);
    setTeams([]);
    setYearInput(String(defaultWinTotalsYear()));
  }
  function startEdit(y) {
    setLoadedExisting(false);
    setSelectedYear(y);
  }

  function updateTeam(idx, patch) {
    setTeams((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function addRow() {
    setTeams((prev) => [...prev, newPlayoffTeam()]);
  }
  function removeRow(idx) {
    setTeams((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleParseImport() {
    setImportError(null);
    setImportNotice(null);
    let data;
    try {
      data = JSON.parse(importText);
    } catch (e) {
      setImportError("That doesn't look like valid JSON. Make sure you copied the whole list, brackets included.");
      return;
    }
    if (!Array.isArray(data)) {
      setImportError("Expected a JSON array of teams.");
      return;
    }
    try {
      const existingByName = {};
      teams.forEach((t) => {
        existingByName[normalizeTeam(t.school)] = t.id;
      });
      let excludedCount = 0;
      const cleaned = [];
      data.forEach((t, i) => {
        if (!t.school || t.odds == null || isNaN(Number(t.odds))) {
          throw new Error(`Entry ${i + 1} is missing a school name or numeric odds.`);
        }
        const odds = Number(t.odds);
        if (odds <= 0) {
          excludedCount++;
          return;
        }
        const existingId = existingByName[normalizeTeam(t.school)];
        cleaned.push({ id: existingId || newId(), school: String(t.school), odds: String(odds) });
      });
      setTeams(cleaned);
      setImportText("");
      setImportOpen(false);
      if (excludedCount > 0) {
        setImportNotice(
          `Excluded ${excludedCount} team${excludedCount === 1 ? "" : "s"} with negative odds (favorites aren't pick-able).`
        );
      }
    } catch (e) {
      setImportError(e.message);
    }
  }

  const currentBoard = selectedYear != null ? playoffCache[selectedYear] : null;
  const valid =
    yearInput.trim() &&
    !isNaN(Number(yearInput)) &&
    teams.length >= 7 &&
    teams.every((t) => t.school.trim() && t.odds !== "" && !isNaN(Number(t.odds)) && Number(t.odds) > 0);

  const { tier1, tier2, tier3 } = computePlayoffTiers(
    teams.map((t) => ({ ...t, odds: Number(t.odds) })).filter((t) => !isNaN(t.odds))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={startNew} disabled={selectedYear === null}>
          <span className="flex items-center gap-1"><Plus size={12} /> new board</span>
        </SecondaryButton>
        {years
          .slice()
          .sort((a, b) => b - a)
          .map((y) => (
            <SecondaryButton key={y} onClick={() => startEdit(y)} disabled={selectedYear === y}>
              edit {y}
            </SecondaryButton>
          ))}
      </div>

      {selectedYear != null && currentBoard && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: COLORS.chalkDim }}>{selectedYear} board is currently</span>
          <button
            onClick={() => togglePlayoffLock(selectedYear)}
            className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2 flex items-center gap-1"
            style={{
              background: currentBoard.locked ? "rgba(179,55,42,0.16)" : "rgba(217,164,65,0.16)",
              border: `1px solid ${currentBoard.locked ? COLORS.red : COLORS.gold}`,
              color: currentBoard.locked ? COLORS.redBright : COLORS.goldBright,
            }}
          >
            {currentBoard.locked ? <Lock size={12} /> : <Unlock size={12} />}
            {currentBoard.locked ? "locked — click to open" : "open — click to lock"}
          </button>
        </div>
      )}

      <div>
        <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>
          Season year
        </div>
        <div style={{ maxWidth: 120 }}>
          <FieldInput type="number" value={yearInput} onChange={setYearInput} disabled={selectedYear != null} />
        </div>
      </div>

      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button
          onClick={() => setImportOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}
        >
          <Upload size={13} /> Paste playoff odds list
          <span className="flex-1" />
          {importOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {importOpen && (
          <div className="mt-3 space-y-2">
            <div className="text-xs" style={{ color: COLORS.chalkDim }}>
              Ask me in chat for this year's "to make the playoff" odds, then paste the list here. Teams with
              negative odds are automatically excluded. This replaces the team list below — review it before saving.
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              className="cfb-mono text-base sm:text-xs w-full p-2"
              style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              placeholder='[{"school":"Ohio State","odds":150}, {"school":"Boise State","odds":900}]'
            />
            {importError && <Banner onDismiss={() => setImportError(null)}>{importError}</Banner>}
            <SecondaryButton onClick={handleParseImport} disabled={!importText.trim()}>
              Load list
            </SecondaryButton>
          </div>
        )}
        {importNotice && (
          <div className="text-xs mt-2" style={{ color: COLORS.muted }}>
            {importNotice}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {teams.map((t, idx) => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
            <div className="flex-1">
              <FieldInput value={t.school} onChange={(v) => updateTeam(idx, { school: v })} placeholder="School" />
            </div>
            <div style={{ width: 90, flexShrink: 0 }}>
              <FieldInput type="number" value={t.odds} onChange={(v) => updateTeam(idx, { odds: v })} placeholder="+odds" />
            </div>
            <button onClick={() => removeRow(idx)} style={{ color: COLORS.muted }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <SecondaryButton onClick={addRow}>
        <span className="flex items-center gap-1"><Plus size={12} /> add team</span>
      </SecondaryButton>

      {teams.length > 0 && (
        <div className="px-3 py-3 text-xs space-y-1.5" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}`, color: COLORS.chalkDim }}>
          <div className="cfb-mono uppercase mb-1" style={{ color: COLORS.gold }}>
            Tier preview (auto-computed from odds)
          </div>
          <div><span style={{ color: COLORS.chalk }}>Tier 1</span> ({tier1.length}): {tier1.map((t) => t.school).join(", ") || "—"}</div>
          <div><span style={{ color: COLORS.chalk }}>Tier 2</span> ({tier2.length}): {tier2.map((t) => t.school).join(", ") || "—"}</div>
          <div><span style={{ color: COLORS.chalk }}>Tier 3</span> ({tier3.length}): {tier3.map((t) => t.school).join(", ") || "—"}</div>
        </div>
      )}

      <PrimaryButton
        full
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          const yr = Number(yearInput);
          const cleanTeams = teams.map((t) => ({ id: t.id, school: t.school.trim(), odds: Number(t.odds) }));
          const ok = await savePlayoffBoard(yr, cleanTeams, currentBoard?.locked || false);
          setBusy(false);
          if (ok) setSelectedYear(yr);
        }}
      >
        {busy ? "Saving..." : selectedYear != null ? "Save changes" : "Create board"}
      </PrimaryButton>
      {!valid && teams.length > 0 && teams.length < 7 && (
        <div className="text-xs" style={{ color: COLORS.muted }}>
          Add at least 7 teams — Tier 1 needs 3, and an even three-way split only gives Tier 1 enough teams once
          there are 7 or more total.
        </div>
      )}
    </div>
  );
}

function PlayoffResultsManager({ leagueMeta, playoffCache, loadPlayoff, savePlayoffResults }) {
  const years = leagueMeta.playoffYears || [];
  const [selectedYear, setSelectedYear] = useState(years.length ? Math.max(...years) : null);
  const [statuses, setStatuses] = useState({}); // teamId -> "yes" | "no" | ""
  const [busy, setBusy] = useState(false);
  const board = selectedYear != null ? playoffCache[selectedYear] : null;

  useEffect(() => {
    if (selectedYear != null && !playoffCache[selectedYear]) loadPlayoff(selectedYear, false);
  }, [selectedYear, playoffCache, loadPlayoff]);

  useEffect(() => {
    if (board) {
      const init = {};
      board.teams.forEach((t) => {
        init[t.id] = t.madePlayoff === true ? "yes" : t.madePlayoff === false ? "no" : "";
      });
      setStatuses(init);
    }
  }, [board?.year]);

  if (!years.length) {
    return <EmptyState title="No playoff board yet" body="Set one up under Playoff board first." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {years
          .slice()
          .sort((a, b) => b - a)
          .map((y) => (
            <SecondaryButton key={y} onClick={() => setSelectedYear(y)} disabled={selectedYear === y}>
              {y}
            </SecondaryButton>
          ))}
      </div>

      {!board && <Spinner label="Loading board..." />}

      {board && (
        <>
          <div className="text-xs" style={{ color: COLORS.muted }}>
            Mark each team yes/no once the playoff field is announced. Picks grade automatically into the main
            standings total.
          </div>
          <div className="space-y-2">
            {board.teams.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
                <span className="text-sm flex-1 truncate">
                  {t.school}{" "}
                  <span className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
                    (+{t.odds})
                  </span>
                </span>
                <div className="flex gap-1.5 flex-shrink-0">
                  {["yes", "no"].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setStatuses((p) => ({ ...p, [t.id]: opt }))}
                      className="cfb-mono cfb-btn text-xs font-semibold px-2.5 py-2 capitalize"
                      style={{
                        background:
                          statuses[t.id] === opt ? (opt === "yes" ? "rgba(217,164,65,0.18)" : "rgba(179,55,42,0.18)") : "transparent",
                        border: `1px solid ${statuses[t.id] === opt ? (opt === "yes" ? COLORS.gold : COLORS.red) : COLORS.lineStrong}`,
                        color: statuses[t.id] === opt ? (opt === "yes" ? COLORS.goldBright : COLORS.redBright) : COLORS.chalkDim,
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <PrimaryButton
            full
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const teamsWithResult = board.teams.map((t) => ({
                ...t,
                madePlayoff: statuses[t.id] === "yes" ? true : statuses[t.id] === "no" ? false : null,
              }));
              await savePlayoffResults(selectedYear, teamsWithResult);
              setBusy(false);
            }}
          >
            {busy ? "Saving..." : "Save results"}
          </PrimaryButton>
        </>
      )}
    </div>
  );
}

/* ---------------------------------- money ------------------------------------ */

function MoneyTab({ leagueMeta, moneyData, loading, onRefresh }) {
  if (loading && !moneyData) return <Spinner label="Tallying the money..." />;
  if (!moneyData) {
    return (
      <div className="cfb-fade-in space-y-4">
        <div className="flex items-center justify-between">
          <div className="cfb-display text-xl uppercase">Money</div>
          <button onClick={onRefresh} className="cfb-mono text-xs flex items-center gap-1 opacity-70 hover:opacity-100">
            <RefreshCw size={12} /> refresh
          </button>
        </div>
        <EmptyState title="No money data yet" body="Once a week is graded, weekly and lock payouts will show up here." />
      </div>
    );
  }

  const settings = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
  const rows = leagueMeta.members
    .map((name) => {
      const m = moneyData.perMember[name] || { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0, underdogWin: 0 };
      const weeklyNet = m.weeklyWin - m.weeklyLoss;
      const lockNet = m.lockWin - m.lockLoss;
      const underdogWin = m.underdogWin || 0;
      const seasonPayout = leagueMeta.seasonFinalized ? leagueMeta.seasonPayouts?.[name] || 0 : 0;
      const total = weeklyNet + lockNet + underdogWin + seasonPayout;
      return { name, weeklyNet, lockNet, underdogWin, seasonPayout, total };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div className="cfb-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="cfb-display text-xl uppercase">Money</div>
        <button onClick={onRefresh} className="cfb-mono text-xs flex items-center gap-1 opacity-70 hover:opacity-100">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> refresh
        </button>
      </div>

      {leagueMeta.seasonFinalized && (
        <div
          className="px-3 py-2 flex items-center gap-2"
          style={{ background: "rgba(217,164,65,0.12)", border: `1px solid ${COLORS.gold}` }}
        >
          <Trophy size={16} style={{ color: COLORS.gold }} />
          <span className="text-sm font-semibold">Season finalized — final payouts are reflected below.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
          <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.chalkDim }}>Pot (buy-ins)</div>
          <div className="text-lg font-bold cfb-mono">{fmtMoney(moneyData.totalBuyIns)}</div>
        </div>
        <div className="px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
          <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.chalkDim }}>Pot remaining</div>
          <div className="text-lg font-bold cfb-mono" style={{ color: moneyData.potRemaining < 0 ? COLORS.redBright : COLORS.chalk }}>
            {fmtMoney(moneyData.potRemaining)}
          </div>
        </div>
      </div>
      <div className="text-xs" style={{ color: COLORS.muted }}>
        Buy-in is {fmtMoney(settings.buyIn)} per person. Paid out so far:{" "}
        {fmtMoney(moneyData.totalWeeklyWinsPaid + moneyData.totalLockWinsPaid + moneyData.totalUnderdogWinsPaid)}. Owed back to the pot:{" "}
        {fmtMoney(moneyData.totalWeeklyLossesOwed + moneyData.totalLockLossesOwed)}.
      </div>

      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weekly</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>lock</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>underdog</th>
              {leagueMeta.seasonFinalized && (
                <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>payout</th>
              )}
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{r.name}</td>
                <td
                  className="px-3 py-2 text-right"
                  style={{ color: r.weeklyNet > 0 ? COLORS.goldBright : r.weeklyNet < 0 ? COLORS.redBright : COLORS.chalkDim }}
                >
                  {fmtMoney(r.weeklyNet)}
                </td>
                <td
                  className="px-3 py-2 text-right"
                  style={{ color: r.lockNet > 0 ? COLORS.goldBright : r.lockNet < 0 ? COLORS.redBright : COLORS.chalkDim }}
                >
                  {fmtMoney(r.lockNet)}
                </td>
                <td
                  className="px-3 py-2 text-right"
                  style={{ color: r.underdogWin > 0 ? COLORS.goldBright : COLORS.chalkDim }}
                >
                  {fmtMoney(r.underdogWin)}
                </td>
                {leagueMeta.seasonFinalized && (
                  <td className="px-3 py-2 text-right" style={{ color: COLORS.goldBright }}>{fmtMoney(r.seasonPayout)}</td>
                )}
                <td
                  className="px-3 py-2 text-right font-bold"
                  style={{ color: r.total > 0 ? COLORS.goldBright : r.total < 0 ? COLORS.redBright : COLORS.chalk }}
                >
                  {fmtMoney(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs" style={{ color: COLORS.muted }}>
        Negative numbers mean money owed. This is a running ledger, not a payment processor — settle up with each other directly.
      </div>
    </div>
  );
}

function MoneySettingsManager({
  leagueMeta,
  moneyData,
  loadMoneyData,
  saveMoneySettings,
  standings,
  loadStandings,
  finalizeSeasonPayouts,
  unfinalizeSeasonPayouts,
}) {
  const current = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
  const [form, setForm] = useState({
    buyIn: String(current.buyIn),
    weeklyWinAmount: String(current.weeklyWinAmount),
    weeklyLossAmount: String(current.weeklyLossAmount),
    lockAmount: String(current.lockAmount),
    underdogTier1Amount: String(current.underdogTier1Amount),
    underdogTier2Amount: String(current.underdogTier2Amount),
    underdogTier3Amount: String(current.underdogTier3Amount),
    secondPlacePayout: String(current.secondPlacePayout),
    thirdPlacePayout: String(current.thirdPlacePayout),
  });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    loadMoneyData();
    loadStandings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  const valid = Object.values(form).every((v) => v !== "" && !isNaN(Number(v)) && Number(v) >= 0);

  const standingsRows = Object.entries(standings || {})
    .map(([name, s]) => ({ name, totalWins: s.totalWins }))
    .sort((a, b) => b.totalWins - a.totalWins);

  return (
    <div className="space-y-5">
      <div>
        <div className="cfb-display text-lg uppercase mb-2">Money settings</div>
        <div className="space-y-2">
          {[
            ["buyIn", "Buy-in (per person)"],
            ["weeklyWinAmount", "Weekly best-record prize"],
            ["weeklyLossAmount", "Weekly worst-record fee"],
            ["lockAmount", "Lock of the week"],
            ["underdogTier1Amount", "Underdog +14 to +19.5"],
            ["underdogTier2Amount", "Underdog +20 to +27.5"],
            ["underdogTier3Amount", "Underdog +28 or more"],
            ["secondPlacePayout", "Season 2nd place"],
            ["thirdPlacePayout", "Season 3rd place"],
          ].map(([field, label]) => (
            <div key={field} className="flex items-center gap-2">
              <div className="text-sm flex-1" style={{ color: COLORS.chalkDim }}>{label}</div>
              <div style={{ width: 90, flexShrink: 0 }}>
                <FieldInput type="number" value={form[field]} onChange={(v) => update(field, v)} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2">
          <SecondaryButton
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              await saveMoneySettings({
                buyIn: Number(form.buyIn),
                weeklyWinAmount: Number(form.weeklyWinAmount),
                weeklyLossAmount: Number(form.weeklyLossAmount),
                lockAmount: Number(form.lockAmount),
                underdogTier1Amount: Number(form.underdogTier1Amount),
                underdogTier2Amount: Number(form.underdogTier2Amount),
                underdogTier3Amount: Number(form.underdogTier3Amount),
                secondPlacePayout: Number(form.secondPlacePayout),
                thirdPlacePayout: Number(form.thirdPlacePayout),
              });
              await loadMoneyData();
              setBusy(false);
            }}
          >
            {busy ? "Saving..." : "Save settings"}
          </SecondaryButton>
        </div>
      </div>

      <div className="pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
        <div className="cfb-display text-lg uppercase mb-2">Season payouts</div>
        {leagueMeta.seasonFinalized ? (
          <div className="space-y-3">
            <div className="text-sm" style={{ color: COLORS.chalkDim }}>Season is finalized. Final payouts:</div>
            <div className="space-y-1">
              {Object.entries(leagueMeta.seasonPayouts || {})
                .sort((a, b) => b[1] - a[1])
                .map(([name, amt]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span>{name}</span>
                    <span className="cfb-mono font-bold" style={{ color: COLORS.goldBright }}>{fmtMoney(amt)}</span>
                  </div>
                ))}
            </div>
            <SecondaryButton onClick={unfinalizeSeasonPayouts}>Undo finalize</SecondaryButton>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm" style={{ color: COLORS.chalkDim }}>
              Pot remaining right now:{" "}
              <span className="cfb-mono font-bold" style={{ color: COLORS.chalk }}>
                {moneyData ? fmtMoney(moneyData.potRemaining) : "—"}
              </span>
              . 3rd gets {fmtMoney(current.thirdPlacePayout)}, 2nd gets {fmtMoney(current.secondPlacePayout)}, 1st gets
              whatever's left. This locks in the current Standings as final — only do this once the season is actually over.
            </div>
            {standingsRows.length > 0 && (
              <div className="text-xs space-y-0.5" style={{ color: COLORS.muted }}>
                {standingsRows.slice(0, 5).map((r, i) => (
                  <div key={r.name}>{i + 1}. {r.name} — {r.totalWins} wins</div>
                ))}
              </div>
            )}
            {!confirming ? (
              <SecondaryButton onClick={() => setConfirming(true)}>Finalize season payouts</SecondaryButton>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold" style={{ color: COLORS.redBright }}>
                  Lock in payouts based on current standings?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setFinalizing(true);
                      await finalizeSeasonPayouts();
                      setFinalizing(false);
                      setConfirming(false);
                    }}
                    disabled={finalizing}
                    className="cfb-mono cfb-btn text-xs font-bold uppercase tracking-wider px-3 py-2"
                    style={{ background: COLORS.gold, color: COLORS.ink, border: `1px solid ${COLORS.gold}`, opacity: finalizing ? 0.6 : 1 }}
                  >
                    {finalizing ? "Finalizing..." : "Yes, finalize"}
                  </button>
                  <SecondaryButton onClick={() => setConfirming(false)} disabled={finalizing}>
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── HISTORY TAB ─────────────────────────────── */

function HistoryTab({ historyData, loading }) {
  const years = Object.keys(historyData).map(Number).sort((a, b) => b - a);
  // "all-time" is a special sentinel value
  const [selectedYear, setSelectedYear] = useState(null);
  const [view, setView] = useState("standings");

  useEffect(() => {
    if (years.length && selectedYear === null) setSelectedYear(years[0]);
  }, [years.length]);

  // Reset sub-view when year changes
  useEffect(() => { setView("standings"); }, [selectedYear]);

  const data = selectedYear && selectedYear !== "all-time" ? historyData[selectedYear] : null;

  if (loading && !years.length) return <Spinner label="Loading history..." />;
  if (!years.length) {
    return (
      <EmptyState
        title="No history yet"
        body="The commissioner can import past season data under Commish → Import history."
      />
    );
  }

  const pickerOptions = [...years, "all-time"];

  return (
    <div className="cfb-fade-in space-y-4">
      <div className="cfb-display text-xl uppercase">Season History</div>

      <div className="flex gap-2 flex-wrap">
        {pickerOptions.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className="cfb-mono cfb-btn text-xs font-bold px-3 py-2"
            style={{
              background: selectedYear === y ? COLORS.gold : "transparent",
              color: selectedYear === y ? COLORS.ink : COLORS.chalkDim,
              border: `1px solid ${selectedYear === y ? COLORS.gold : COLORS.lineStrong}`,
            }}
          >
            {y === "all-time" ? "All-Time" : y}
          </button>
        ))}
      </div>

      {selectedYear === "all-time" && (
        <HistoryAllTime historyData={historyData} years={years} />
      )}

      {data && (
        <>
          <div className="flex overflow-x-auto cfb-tab-nav" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
            {[
              { id: "standings", label: "Standings" },
              { id: "weeks", label: "Weeks" },
              { id: "playoff", label: "Playoff" },
              { id: "wintotals", label: "Win Totals" },
              { id: "money", label: "Money" },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className="cfb-mono cfb-btn flex-shrink-0 text-xs font-bold uppercase tracking-wider px-4 py-2.5"
                style={{
                  color: view === v.id ? COLORS.goldBright : COLORS.chalkDim,
                  borderBottom: view === v.id ? `2px solid ${COLORS.gold}` : "2px solid transparent",
                  background: view === v.id ? "rgba(217,164,65,0.06)" : "transparent",
                  whiteSpace: "nowrap",
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {view === "standings" && <HistoryStandings data={data} />}
          {view === "weeks" && <HistoryWeeks data={data} />}
          {view === "playoff" && <HistoryPlayoff data={data} />}
          {view === "wintotals" && <HistoryWinTotals data={data} />}
          {view === "money" && <HistoryMoney data={data} />}
        </>
      )}
    </div>
  );
}

function HistoryAllTime({ historyData, years }) {
  // Aggregate stats across all years per member
  const statsMap = {};

  years.forEach((year) => {
    const d = historyData[year];
    if (!d) return;

    (d.finalStandings || []).forEach((s) => {
      if (!statsMap[s.name]) statsMap[s.name] = { totalWins: 0, totalLosses: 0, seasons: 0, money: 0, seasonPayouts: 0 };
      statsMap[s.name].totalWins += s.totalWins;
      statsMap[s.name].totalLosses += s.totalLosses;
      statsMap[s.name].seasons += 1;
    });

    Object.entries(d.finalPayments || {}).forEach(([name, amt]) => {
      if (!statsMap[name]) statsMap[name] = { totalWins: 0, totalLosses: 0, seasons: 0, money: 0, seasonPayouts: 0 };
      statsMap[name].money += amt;
    });

    Object.entries(d.seasonPayouts || {}).forEach(([name, amt]) => {
      if (!statsMap[name]) statsMap[name] = { totalWins: 0, totalLosses: 0, seasons: 0, money: 0, seasonPayouts: 0 };
      statsMap[name].seasonPayouts += amt;
    });
  });

  const rows = Object.entries(statsMap)
    .map(([name, s]) => ({ name, ...s, total: s.money + s.seasonPayouts }))
    .sort((a, b) => b.totalWins - a.totalWins);

  return (
    <div className="space-y-4 cfb-fade-in">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        Combined records and money across {years.join(" + ")}. Sorted by total wins.
      </div>

      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>#</th>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>seasons</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>W-L</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>win %</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weekly+lock</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>prizes</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>total $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const winPct = r.totalWins + r.totalLosses > 0
                ? ((r.totalWins / (r.totalWins + r.totalLosses)) * 100).toFixed(1)
                : "—";
              return (
                <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2" style={{ color: i === 0 ? COLORS.gold : COLORS.muted }}>
                    {i === 0 ? <Trophy size={14} /> : i + 1}
                  </td>
                  <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{r.name}</td>
                  <td className="px-3 py-2 text-right" style={{ color: COLORS.chalkDim }}>{r.seasons}</td>
                  <td className="px-3 py-2 text-right font-bold whitespace-nowrap" style={{ color: COLORS.chalk }}>
                    {r.totalWins}-{r.totalLosses}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: COLORS.chalkDim }}>{winPct}%</td>
                  <td className="px-3 py-2 text-right" style={{ color: r.money > 0 ? COLORS.goldBright : r.money < 0 ? COLORS.redBright : COLORS.chalkDim }}>
                    {fmtMoney(r.money)}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: r.seasonPayouts > 0 ? COLORS.goldBright : COLORS.muted }}>
                    {r.seasonPayouts > 0 ? fmtMoney(r.seasonPayouts) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: r.total > 0 ? COLORS.goldBright : r.total < 0 ? COLORS.redBright : COLORS.chalk }}>
                    {fmtMoney(r.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs" style={{ color: COLORS.muted }}>
        "Weekly+lock" = net from weekly winner/loser and lock picks each season, excluding buy-ins.
        "Prizes" = season-end placement payouts (1st/2nd/3rd) only.
      </div>
    </div>
  );
}

function HistoryStandings({ data }) {
  const rows = data.finalStandings || [];
  return (
    <div className="space-y-3">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        Final {data.year} season standings. "Game picks" = weekly spreads only. "Total" includes win totals and CFP picks.
      </div>
      {data.seasonPlaces && (
        <div className="flex gap-3 flex-wrap">
          {[["1st", COLORS.gold], ["2nd", COLORS.chalkDim], ["3rd", "#CD7F32"]].map(([place, color]) => {
            const winner = Object.entries(data.seasonPlaces || {}).find(([, p]) => p === place)?.[0];
            const payout = data.seasonPayouts?.[winner];
            if (!winner) return null;
            return (
              <div key={place} className="px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${color}` }}>
                <div className="cfb-mono text-xs uppercase" style={{ color }}>{place} place</div>
                <div className="font-semibold text-sm" style={{ color: COLORS.chalk }}>{winner}</div>
                {payout != null && <div className="cfb-mono text-xs" style={{ color }}>{fmtMoney(payout)}</div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>#</th>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>game picks</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <td className="px-3 py-2" style={{ color: i === 0 ? COLORS.gold : COLORS.muted }}>
                  {i === 0 ? <Trophy size={14} /> : i + 1}
                </td>
                <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>
                  {r.name}
                  {data.seasonPlaces?.[r.name] && (
                    <span className="cfb-mono text-xs ml-1.5" style={{ color: COLORS.gold }}>
                      ({data.seasonPlaces[r.name]})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{r.gameWins}-{r.gameLosses}</td>
                <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{r.totalWins}-{r.totalLosses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryWeeks({ data }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const week = data.weeks?.[selectedIdx];
  if (!week) return null;

  return (
    <div className="space-y-3">
      <div className="flex overflow-x-auto cfb-scroll gap-1.5 pb-1">
        {data.weeks.map((w, i) => (
          <button
            key={i}
            onClick={() => setSelectedIdx(i)}
            className="cfb-mono cfb-btn flex-shrink-0 text-xs font-bold px-2.5 py-1.5"
            style={{
              background: selectedIdx === i ? COLORS.gold : "transparent",
              color: selectedIdx === i ? COLORS.ink : COLORS.chalkDim,
              border: `1px solid ${selectedIdx === i ? COLORS.gold : COLORS.lineStrong}`,
            }}
          >
            {w.label === "Championships" ? "Champ" : w.label === "Bowl Games" ? "Bowls" : w.label.replace("Week ", "Wk ")}
          </button>
        ))}
      </div>

      {/* Games + picks grid */}
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-xs w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDeep, color: COLORS.chalkDim, minWidth: 160 }}>
                game
              </th>
              {data.members.map((m) => (
                <th key={m} className="text-left px-2 py-1.5 whitespace-nowrap" style={{ color: COLORS.chalkDim }}>
                  {m.split(" ")[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.games.map((g, gi) => (
              <tr key={gi} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.game}
                </td>
                {data.members.map((m) => {
                  const pick = week.members[m]?.picks?.[gi];
                  const winner = g.winner;
                  let color = COLORS.chalkDim;
                  if (pick && winner) {
                    color = pick === winner ? COLORS.goldBright : COLORS.redBright;
                  }
                  return (
                    <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                      {pick || "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Summary rows */}
            <tr style={{ borderTop: `2px solid ${COLORS.lineStrong}`, background: COLORS.fieldDeep }}>
              <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDeep, color: COLORS.muted }}>record</td>
              {data.members.map((m) => {
                const md = week.members[m];
                const missed = md?.missed;
                return (
                  <td key={m} className="px-2 py-1.5 whitespace-nowrap font-semibold" style={{ color: missed ? COLORS.muted : COLORS.chalk }}>
                    {missed ? "MISSED" : `${md?.wins ?? 0}-${md?.losses ?? 0}`}
                  </td>
                );
              })}
            </tr>
            <tr style={{ borderTop: `1px solid ${COLORS.line}` }}>
              <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>
                <span className="inline-flex items-center gap-1"><Flame size={11} style={{ color: COLORS.gold }} /> lock</span>
              </td>
              {data.members.map((m) => {
                const lr = week.members[m]?.lockResult ?? 0;
                return (
                  <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color: lr > 0 ? COLORS.goldBright : lr < 0 ? COLORS.redBright : COLORS.muted }}>
                    {lr !== 0 ? fmtMoney(lr) : "—"}
                  </td>
                );
              })}
            </tr>
            <tr style={{ borderTop: `1px solid ${COLORS.line}` }}>
              <td className="px-2 py-1.5 sticky left-0" style={{ background: COLORS.fieldDark, color: COLORS.muted }}>underdog</td>
              {data.members.map((m) => {
                const ud = week.members[m]?.underdogPick;
                return (
                  <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color: COLORS.chalkDim }}>
                    {ud || "—"}
                  </td>
                );
              })}
            </tr>
            <tr style={{ borderTop: `1px solid ${COLORS.line}`, background: COLORS.fieldDeep }}>
              <td className="px-2 py-1.5 sticky left-0 font-bold" style={{ background: COLORS.fieldDeep, color: COLORS.chalk }}>$ week</td>
              {data.members.map((m) => {
                const amt = week.members[m]?.weekMoney ?? 0;
                return (
                  <td key={m} className="px-2 py-1.5 whitespace-nowrap font-bold" style={{ color: amt > 0 ? COLORS.goldBright : amt < 0 ? COLORS.redBright : COLORS.muted }}>
                    {amt !== 0 ? fmtMoney(amt) : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryPlayoff({ data }) {
  const picks = data.playoffPicks || {};
  const members = data.members || [];
  const hasPicks = Object.values(picks).some((p) => p?.picks?.length);

  if (!hasPicks) {
    return (
      <EmptyState
        title="No playoff picks"
        body={`${data.year} predates the expanded CFP — no playoff picks were part of the pool that year.`}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        {data.year} CFP picks. 3 from Tier 1, 2 from Tier 2, 1 from Tier 3. Teams that actually made the playoff shown in gold.
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              {[1,2,3,4,5,6].map((n) => (
                <th key={n} className="text-left px-3 py-2 whitespace-nowrap" style={{ color: COLORS.chalkDim }}>pick {n}</th>
              ))}
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>record</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const p = picks[m];
              if (!p) return null;
              return (
                <tr key={m} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{m}</td>
                  {(p.picks || []).map((pick, i) => (
                    <td key={i} className="px-3 py-2 whitespace-nowrap" style={{ color: COLORS.chalkDim }}>{pick || "—"}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color: p.wins > p.losses ? COLORS.goldBright : COLORS.chalk }}>
                    {p.wins}-{p.losses}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryWinTotals({ data }) {
  const picks = data.winTotalsPicks || {};
  const members = data.members || [];
  // Pick count varies by year: 2023=10, 2024/2025=6
  const maxPicks = Math.max(...Object.values(picks).map((p) => (p.picks || []).length), 0);
  const noPicksRecorded = maxPicks === 0;
  const hasAnyRecords = Object.values(picks).some((p) => p && (p.wins > 0 || p.losses > 0));

  if (!hasAnyRecords && Object.keys(picks).length === 0) {
    return (
      <EmptyState
        title="No win total picks"
        body={`${data.year} didn't include a win total O/U contest.`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        {data.year} win total over/under picks.{" "}
        {noPicksRecorded
          ? "Individual picks were not recorded this year — showing W-L record only."
          : `${maxPicks} picks per person across conferences.`}
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              {Array.from({ length: maxPicks }, (_, n) => (
                <th key={n} className="text-left px-3 py-2 whitespace-nowrap" style={{ color: COLORS.chalkDim }}>pick {n + 1}</th>
              ))}
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>record</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const p = picks[m];
              if (!p) return null;
              return (
                <tr key={m} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{m}</td>
                  {Array.from({ length: maxPicks }, (_, i) => (
                    <td key={i} className="px-3 py-2 whitespace-nowrap" style={{ color: COLORS.chalkDim, fontSize: "0.7rem" }}>
                      {(p.picks || [])[i] || "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color: p.wins > p.losses ? COLORS.goldBright : COLORS.chalk }}>
                    {p.wins}-{p.losses}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryMoney({ data }) {
  const members = data.members || [];
  const payments = data.finalPayments || {};
  const withSeason = data.finalWithSeasonPayouts || {};
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="px-3 py-2" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
          <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.chalkDim }}>Total pot</div>
          <div className="text-lg font-bold cfb-mono">{fmtMoney(data.pot || 0)}</div>
        </div>
      </div>
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weekly + locks</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>season payout</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>total</th>
            </tr>
          </thead>
          <tbody>
            {[...members].sort((a, b) => (withSeason[b] || 0) - (withSeason[a] || 0)).map((m) => {
              const yearly = payments[m] ?? 0;
              const total = withSeason[m] ?? yearly;
              const seasonBonus = total - yearly;
              return (
                <tr key={m} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>
                    {m}
                    {data.seasonPlaces?.[m] && (
                      <span className="cfb-mono text-xs ml-1.5" style={{ color: COLORS.gold }}>({data.seasonPlaces[m]})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: yearly > 0 ? COLORS.goldBright : yearly < 0 ? COLORS.redBright : COLORS.chalkDim }}>
                    {fmtMoney(yearly)}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: seasonBonus > 0 ? COLORS.goldBright : COLORS.muted }}>
                    {seasonBonus > 0 ? fmtMoney(seasonBonus) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: total > 0 ? COLORS.goldBright : total < 0 ? COLORS.redBright : COLORS.chalk }}>
                    {fmtMoney(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs" style={{ color: COLORS.muted }}>
        "Weekly + locks" = net from weekly winner/loser and lock results across the season, before the season-end placement payout.
      </div>
    </div>
  );
}

function MembersManager({ leagueMeta, deleteMember }) {
  const [confirmDelete, setConfirmDelete] = useState(null); // member name pending delete
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4 cfb-fade-in">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        Remove a member who isn't participating this season. Their picks stay stored in case you need them later.
      </div>
      <div className="space-y-2">
        {leagueMeta.members.map((m) => (
          <div
            key={m}
            className="flex items-center justify-between px-3 py-2.5"
            style={{ border: `1px solid ${COLORS.line}`, background: COLORS.fieldMid }}
          >
            <span className="text-sm font-semibold" style={{ color: COLORS.chalk }}>{m}</span>
            {confirmDelete === m ? (
              <div className="flex items-center gap-2">
                <span className="cfb-mono text-xs" style={{ color: COLORS.redBright }}>Remove {m.split(" ")[0]}?</span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await deleteMember(m);
                    setConfirmDelete(null);
                    setBusy(false);
                  }}
                  className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-1.5"
                  style={{ background: "rgba(179,55,42,0.22)", border: `1px solid ${COLORS.red}`, color: COLORS.redBright }}
                >
                  {busy ? "…" : "yes, remove"}
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="cfb-mono cfb-btn text-xs px-2.5 py-1.5"
                  style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalkDim }}
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(m)}
                className="cfb-mono cfb-btn text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}
              >
                <Trash2 size={12} /> remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryImportManager({ historyData, saveHistoryData }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);
  const existingYears = Object.keys(historyData).map(Number).sort((a, b) => a - b);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.year || !parsed.members || !parsed.weeks) {
        setErr("This doesn't look like a valid season history file. Make sure you're uploading the history JSON I generated.");
        setBusy(false);
        return;
      }
      const ok = await saveHistoryData(parsed.year, parsed);
      if (ok) setNotice(`${parsed.year} season imported successfully — it'll now appear on the History tab.`);
    } catch (ex) {
      setErr(`Couldn't parse the file: ${ex.message}`);
    }
    setBusy(false);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="cfb-display text-lg uppercase">Import season history</div>
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        Upload a <span className="cfb-mono">history_YYYY.json</span> file generated from a past season spreadsheet.
        Each year is stored separately and appears in the History tab's year picker.
      </div>

      {existingYears.length > 0 && (
        <div className="text-xs" style={{ color: COLORS.muted }}>
          Already imported: {existingYears.join(", ")}. Uploading the same year again will overwrite it.
        </div>
      )}

      {err && <Banner onDismiss={() => setErr(null)}>{err}</Banner>}
      {notice && (
        <div className="px-3 py-2 text-sm" style={{ background: "rgba(217,164,65,0.1)", border: `1px solid ${COLORS.gold}`, color: COLORS.goldBright }}>
          {notice}
        </div>
      )}

      <label
        className="cfb-mono cfb-btn text-xs font-bold uppercase tracking-wider px-4 py-2.5 flex items-center gap-2 cursor-pointer"
        style={{
          background: "transparent",
          border: `1px solid ${COLORS.lineStrong}`,
          color: busy ? COLORS.muted : COLORS.chalk,
          opacity: busy ? 0.6 : 1,
          display: "inline-flex",
        }}
      >
        <Upload size={13} />
        {busy ? "Importing..." : "Choose history_2025.json"}
        <input type="file" accept=".json" onChange={handleFile} disabled={busy} style={{ display: "none" }} />
      </label>
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="cfb-display text-lg uppercase mb-1" style={{ color: COLORS.chalkDim }}>
        {title}
      </div>
      <div className="text-sm" style={{ color: COLORS.muted }}>{body}</div>
    </div>
  );
}
