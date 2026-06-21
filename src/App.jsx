import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";

/* ----------------------------- design tokens ----------------------------- */

const COLORS = {
  fieldDeep: "#0E2516",
  fieldDark: "#13321D",
  fieldMid: "#1F5C32",
  chalk: "#F5F1E6",
  chalkDim: "#CFC9B8",
  gold: "#D9A441",
  goldBright: "#EFC169",
  red: "#B3372A",
  redBright: "#D14B3C",
  ink: "#16160F",
  muted: "#9C9586",
  line: "rgba(245,241,230,0.14)",
  lineStrong: "rgba(245,241,230,0.28)",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
.cfb-root { font-family: 'Inter', sans-serif; }
.cfb-display { font-family: 'Anton', sans-serif; letter-spacing: 0.02em; }
.cfb-mono { font-family: 'JetBrains Mono', monospace; }
.cfb-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
.cfb-scroll::-webkit-scrollbar-thumb { background: ${COLORS.lineStrong}; border-radius: 3px; }
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
  secondPlacePayout: 100,
  thirdPlacePayout: 50,
};

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
    const r = await storage.get(key, shared);
    return r ? r.value : null;
  } catch (e) {
    return null;
  }
}

/* -------------------------------- small UI -------------------------------- */

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2" style={{ color: COLORS.chalkDim }}>
      <RefreshCw size={14} className="animate-spin" />
      <span className="text-sm cfb-mono">{label || "Loading..."}</span>
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
    const raw = await safeGet(`week:${weekNum}:games`, true);
    const weekObj = raw ? JSON.parse(raw) : null;
    setWeekCache((prev) => ({ ...prev, [weekNum]: weekObj }));
    if (withPicks) {
      const list = await storage.list(`week:${weekNum}:picks:`, true).catch(() => null);
      const keys = list?.keys || [];
      const picksObj = {};
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const slug = k.slice(`week:${weekNum}:picks:`.length);
        picksObj[slug] = JSON.parse(raw2);
      }
      setPicksCache((prev) => ({ ...prev, [weekNum]: picksObj }));
    }
    setWeekLoading(false);
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
    const updatedPicks = { ...(existing.picks || {}), [gameId]: side };
    const payload = { name: myName, picks: updatedPicks, lockedGameId: existing.lockedGameId || null, submittedAt: Date.now() };
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

  /* ---------- commissioner actions ---------- */

  async function saveWeekGames(weekNum, games, locked) {
    const existing = weekCache[weekNum];
    const payload = {
      weekNum,
      games,
      locked,
      graded: existing?.graded && existing.games.length === games.length ? existing.graded : false,
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

  async function toggleLock(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return;
    const payload = { ...week, locked: !week.locked };
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

  /* ---------- win totals ---------- */

  const loadWinTotals = useCallback(async (year, withPicks) => {
    if (year == null) return;
    setWinTotalsLoading(true);
    const raw = await safeGet(`wintotals:${year}:board`, true);
    const board = raw ? JSON.parse(raw) : null;
    setWinTotalsCache((prev) => ({ ...prev, [year]: board }));
    if (withPicks) {
      const list = await storage.list(`wintotals:${year}:picks:`, true).catch(() => null);
      const keys = list?.keys || [];
      const picksObj = {};
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const slug = k.slice(`wintotals:${year}:picks:`.length);
        picksObj[slug] = JSON.parse(raw2);
      }
      setWinTotalsPicksCache((prev) => ({ ...prev, [year]: picksObj }));
    }
    setWinTotalsLoading(false);
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
    const raw = await safeGet(`playoff:${year}:board`, true);
    const board = raw ? JSON.parse(raw) : null;
    setPlayoffCache((prev) => ({ ...prev, [year]: board }));
    if (withPicks) {
      const list = await storage.list(`playoff:${year}:picks:`, true).catch(() => null);
      const keys = list?.keys || [];
      const picksObj = {};
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const slug = k.slice(`playoff:${year}:picks:`.length);
        picksObj[slug] = JSON.parse(raw2);
      }
      setPlayoffPicksCache((prev) => ({ ...prev, [year]: picksObj }));
    }
    setPlayoffLoading(false);
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
      const list = await storage.list(`week:${w}:picks:`, true).catch(() => null);
      const keys = list?.keys || [];
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
        const list = await storage.list(`wintotals:${wtYear}:picks:`, true).catch(() => null);
        const keys = list?.keys || [];
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
        const list = await storage.list(`playoff:${pYear}:picks:`, true).catch(() => null);
        const keys = list?.keys || [];
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
  }, [leagueMeta, slugToName]);

  useEffect(() => {
    if (phase === "app" && activeTab === "standings") loadStandings();
  }, [phase, activeTab, loadStandings]);

  /* ---------- money ---------- */

  const loadMoneyData = useCallback(async () => {
    if (!leagueMeta) return;
    setMoneyLoading(true);
    const settings = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
    const perMember = {};
    leagueMeta.members.forEach((m) => (perMember[m] = { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0 }));

    for (const w of leagueMeta.weeks) {
      const raw = await safeGet(`week:${w}:games`, true);
      if (!raw) continue;
      const weekObj = JSON.parse(raw);
      if (!weekObj.graded) continue;
      const list = await storage.list(`week:${w}:picks:`, true).catch(() => null);
      const keys = list?.keys || [];
      const weekWins = {}; // member -> wins this week (only members who played)
      const picksByMember = {};
      for (const k of keys) {
        const raw2 = await safeGet(k, true);
        if (!raw2) continue;
        const picksObj = JSON.parse(raw2);
        const member = picksObj.name || slugToName[k.slice(`week:${w}:picks:`.length)];
        if (!member || !picksObj.picks || Object.keys(picksObj.picks).length === 0) continue;
        picksByMember[member] = picksObj;
        let wins = 0;
        weekObj.games.forEach((g) => {
          const cover = coveringSide(g);
          if (cover && cover !== "push" && picksObj.picks[g.id] === cover) wins++;
        });
        weekWins[member] = wins;
        if (!perMember[member]) perMember[member] = { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0 };
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
    }

    const totalBuyIns = settings.buyIn * leagueMeta.members.length;
    let totalWeeklyWinsPaid = 0;
    let totalWeeklyLossesOwed = 0;
    let totalLockWinsPaid = 0;
    let totalLockLossesOwed = 0;
    Object.values(perMember).forEach((m) => {
      totalWeeklyWinsPaid += m.weeklyWin;
      totalWeeklyLossesOwed += m.weeklyLoss;
      totalLockWinsPaid += m.lockWin;
      totalLockLossesOwed += m.lockLoss;
    });
    const potRemaining = totalBuyIns - totalWeeklyWinsPaid + totalWeeklyLossesOwed - totalLockWinsPaid + totalLockLossesOwed;

    setMoneyData({
      perMember,
      totalBuyIns,
      totalWeeklyWinsPaid,
      totalWeeklyLossesOwed,
      totalLockWinsPaid,
      totalLockLossesOwed,
      potRemaining,
    });
    setMoneyLoading(false);
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

  /* ------------------------------- render ------------------------------- */

  const rootStyle = {
    minHeight: "100%",
    background: `linear-gradient(180deg, ${COLORS.fieldDark} 0%, ${COLORS.fieldDeep} 100%)`,
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
      <div className="flex" style={{ background: COLORS.fieldDark, borderBottom: `1px solid ${COLORS.line}` }}>
        {[
          { id: "picks", label: "Picks", icon: CheckCircle2 },
          { id: "standings", label: "Standings", icon: Trophy },
          { id: "wintotals", label: "Win Totals", icon: Target },
          { id: "playoff", label: "Playoff", icon: Award },
          { id: "money", label: "Money", icon: DollarSign },
          { id: "commish", label: "Commish", icon: Shield },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="cfb-mono cfb-btn flex-1 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider py-3"
              style={{
                color: active ? COLORS.goldBright : COLORS.chalkDim,
                borderBottom: active ? `2px solid ${COLORS.gold}` : "2px solid transparent",
                background: active ? "rgba(217,164,65,0.06)" : "transparent",
              }}
            >
              <Icon size={14} />
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

        {activeTab === "commish" && (
          <CommishTab
            leagueMeta={leagueMeta}
            commishUnlocked={commishUnlocked}
            passcodeInput={passcodeInput}
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
            saveResults={saveResults}
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
            resetAllData={resetAllData}
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

function PicksTab({ leagueMeta, selectedWeek, week, weekLoading, picksCache, myName, savePick, savingGameId, slugToName, toggleMyLock }) {
  const [viewMode, setViewMode] = useState("mine"); // "mine" | "everyone"

  useEffect(() => {
    setViewMode("mine");
  }, [selectedWeek]);

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
  const allEntries = Object.entries(picksCache[selectedWeek] || {});
  const submittedCount = allEntries.filter(([, v]) => v && Object.keys(v.picks || {}).length > 0).length;

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
          {submittedCount} of {leagueMeta.members.length} have submitted picks. Picks stay hidden from each other until the commissioner locks the week.
        </div>
      )}

      <div className="flex gap-2">
        {[
          { id: "mine", label: "My Picks" },
          { id: "everyone", label: "Everyone's Picks" },
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

      {viewMode === "everyone" && !week.locked && (
        <EmptyState
          title="Picks are still hidden"
          body="Everyone's picks stay private until the commissioner locks the week — check back after that."
        />
      )}

      {viewMode === "everyone" && week.locked && (
        <PicksGrid leagueMeta={leagueMeta} week={week} picksCache={picksCache[selectedWeek] || {}} slugToName={slugToName} />
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
            const disabled = week.locked;
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

                <div className="flex-1 px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
                  <div className="grid grid-cols-2 gap-2">
                    {["away", "home"].map((side) => {
                      const lbl = side === "home" ? homeL : awayL;
                      const isPicked = myPick === side;
                      const isCorrect = week.graded && cover === side && cover !== "push";
                      const isWrong = week.graded && isPicked && cover !== side && cover !== "push";
                      let bg = "transparent";
                      let borderColor = COLORS.lineStrong;
                      let textColor = COLORS.chalk;
                      if (isPicked && !week.graded) {
                        bg = COLORS.gold;
                        borderColor = COLORS.gold;
                        textColor = COLORS.ink;
                      }
                      if (week.graded) {
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
                          onClick={() => savePick(selectedWeek, g.id, side)}
                          className="cfb-btn flex flex-col items-start px-2.5 py-2 text-left"
                          style={{
                            background: bg,
                            border: `1px solid ${borderColor}`,
                            color: textColor,
                            cursor: disabled ? "default" : "pointer",
                            opacity: disabled && !isPicked ? 0.6 : 1,
                          }}
                        >
                          <span className="text-sm font-semibold leading-tight truncate w-full">{lbl.team}</span>
                          <span className="cfb-mono text-xs mt-0.5" style={{ color: isPicked && !week.graded ? COLORS.ink : COLORS.goldBright }}>
                            {lbl.num}
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                    {String(idx + 1).padStart(2, "0")}
                  </td>
                  {members.map((m) => {
                    const slug = slugify(m);
                    const pick = picksCache[slug]?.picks?.[g.id];
                    const isLock = picksCache[slug]?.lockedGameId === g.id;
                    const label = pick ? (pick === "home" ? g.home : g.away) : "—";
                    let color = COLORS.chalkDim;
                    if (week.graded && pick) {
                      if (cover === "push") color = COLORS.muted;
                      else color = pick === cover ? COLORS.goldBright : COLORS.redBright;
                    }
                    return (
                      <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {isLock && <Flame size={11} style={{ color: COLORS.gold, flexShrink: 0 }} />}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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
  setPasscodeInput,
  onUnlock,
  weekCache,
  loadWeek,
  saveWeekGames,
  toggleLock,
  saveResults,
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
  resetAllData,
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
        />
      )}

      {mode === "results" && (
        <ResultsManager leagueMeta={leagueMeta} weekCache={weekCache} loadWeek={loadWeek} saveResults={saveResults} />
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

function emptyGame() {
  return { id: newId(), away: "", home: "", favorite: "home", spread: "" };
}

function GamesManager({ leagueMeta, weekCache, loadWeek, saveWeekGames, toggleLock }) {
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
          return { home, away, homePoint };
        })
        .filter((g) => g.home && g.away && g.homePoint != null)
        .map((g) => ({
          away: g.away,
          home: g.home,
          favorite: g.homePoint < 0 ? "home" : "away",
          spread: Math.abs(g.homePoint),
          conference: "",
          awayRank: null,
          homeRank: null,
        }));

      if (!merged.length) {
        setOddsError(
          "No games with posted spreads in that date range. Sportsbooks usually post lines a few days before kickoff — try again closer to game day, or widen the date range."
        );
      } else {
        setImportPreview(merged);
        const sel = {};
        merged.forEach((_, i) => (sel[i] = true));
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
    setGames(
      chosen.map((g) => ({
        id: newId(),
        away: g.away,
        home: g.home,
        favorite: g.favorite,
        spread: String(g.spread),
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
            <SecondaryButton key={w} onClick={() => startEdit(w)} disabled={selectedWeek === w}>
              edit wk {w}
            </SecondaryButton>
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
              className="flex items-center gap-2 px-2 py-2 text-xs cfb-mono cursor-pointer"
              style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}
            >
              <input
                type="checkbox"
                checked={!!importSelected[i]}
                onChange={() => setImportSelected((s) => ({ ...s, [i]: !s[i] }))}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <span className="flex-1 truncate" style={{ color: COLORS.chalk }}>
                {g.awayRank ? `#${g.awayRank} ` : ""}
                {g.away} @ {g.homeRank ? `#${g.homeRank} ` : ""}
                {g.home}
              </span>
              <span style={{ color: COLORS.goldBright, flexShrink: 0 }}>
                {g.favorite === "home" ? g.home : g.away} -{g.spread}
              </span>
              {g.conference && <span style={{ color: COLORS.muted, flexShrink: 0 }}>{g.conference}</span>}
            </label>
          ))}
          <PrimaryButton full onClick={applyImportSelection} disabled={Object.values(importSelected).every((v) => !v)}>
            Use {Object.values(importSelected).filter(Boolean).length} selected game
            {Object.values(importSelected).filter(Boolean).length === 1 ? "" : "s"}
          </PrimaryButton>
        </div>
      )}

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
          const ok = await saveWeekGames(wk, cleanGames, currentWeekData?.locked || false);
          setBusy(false);
          if (ok) setSelectedWeek(wk);
        }}
      >
        {busy ? "Saving..." : selectedWeek != null ? "Save changes" : "Create week"}
      </PrimaryButton>
    </div>
  );
}

function ResultsManager({ leagueMeta, weekCache, loadWeek, saveResults }) {
  const [selectedWeek, setSelectedWeek] = useState(leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) : null);
  const [scores, setScores] = useState({});
  const [busy, setBusy] = useState(false);
  const week = selectedWeek != null ? weekCache[selectedWeek] : null;

  useEffect(() => {
    if (selectedWeek != null && !weekCache[selectedWeek]) {
      loadWeek(selectedWeek, false);
    }
  }, [selectedWeek, weekCache, loadWeek]);

  useEffect(() => {
    if (week) {
      const init = {};
      week.games.forEach((g) => {
        init[g.id] = { homeScore: g.homeScore ?? "", awayScore: g.awayScore ?? "" };
      });
      setScores(init);
    }
  }, [week?.weekNum]);

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
          {week.graded && (
            <Banner kind="info">This week is fully graded. Edit and re-save if a score needs correcting.</Banner>
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
      const m = moneyData.perMember[name] || { weeklyWin: 0, weeklyLoss: 0, lockWin: 0, lockLoss: 0 };
      const buyIn = -settings.buyIn;
      const weeklyNet = m.weeklyWin - m.weeklyLoss;
      const lockNet = m.lockWin - m.lockLoss;
      const seasonPayout = leagueMeta.seasonFinalized ? leagueMeta.seasonPayouts?.[name] || 0 : 0;
      const total = buyIn + weeklyNet + lockNet + seasonPayout;
      return { name, buyIn, weeklyNet, lockNet, seasonPayout, total };
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
        {fmtMoney(moneyData.totalWeeklyWinsPaid + moneyData.totalLockWinsPaid)}. Owed back to the pot:{" "}
        {fmtMoney(moneyData.totalWeeklyLossesOwed + moneyData.totalLockLossesOwed)}.
      </div>

      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-sm w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: COLORS.fieldDeep }}>
              <th className="text-left px-3 py-2" style={{ color: COLORS.chalkDim }}>name</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>buy-in</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>weekly</th>
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>lock</th>
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
                <td className="px-3 py-2 text-right" style={{ color: COLORS.redBright }}>{fmtMoney(r.buyIn)}</td>
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
