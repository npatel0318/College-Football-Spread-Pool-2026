import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { storage } from "./storage";
import { db } from "./firebase";
import { collection, getDocs, writeBatch, onSnapshot, doc, query, where } from "firebase/firestore";
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
  ChevronLeft,
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
  MoreHorizontal,
  Search,
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

// Convert American odds to the fractional "wins" payout for a correct pick.
// −140 → 100/140 = 0.71 ; +114 → 114/100 = 1.14 ; even (+100/−100) → 1.00
function oddsToWins(odds) {
  const n = Number(odds);
  if (!n || isNaN(n)) return 1; // default to even money if missing
  if (n > 0) return n / 100;
  return 100 / Math.abs(n);
}

// The payout a member stands to gain for a given pick side, given the team's odds.
function pickPayout(team, side) {
  if (!team) return 1;
  const odds = side === "over" ? team.overOdds : team.underOdds;
  return oddsToWins(odds);
}

// Format American odds for display: always show the sign
function formatOdds(odds) {
  const n = Number(odds);
  if (!n || isNaN(n)) return "even";
  return n > 0 ? `+${n}` : `${n}`;
}

function newWinTotalsTeam() {
  return { id: newId(), school: "", conference: "ACC", line: "", overOdds: "", underOdds: "" };
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
  return { id: newId(), school: "", odds: "", tier: 1 };
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
// Each game locks at its own scheduled kickoff time.
// kickoffISO is stored as a UTC ISO string from the Odds API (e.g. "2025-09-06T19:30:00Z").
// Date.now() is also UTC, so the comparison is timezone-agnostic — works correctly
// for any user anywhere in the world.
// Games without a kickoffISO (manually entered) are never auto-locked; they only
// lock when the commissioner manually locks the whole week.
function computeAutoLockStatus(games, now = Date.now()) {
  const locked = new Set();
  games.forEach((g) => {
    if (!g.kickoffISO) return;
    const kickoffMs = new Date(g.kickoffISO).getTime();
    if (isNaN(kickoffMs)) return;
    if (now >= kickoffMs) locked.add(g.id);
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

// Groups teams by their manually-assigned tier property.
// Returns { tiersById: {teamId: 1|2|3}, tier1: [...], tier2: [...], tier3: [...] }
// Within each tier, teams are ordered strongest-favorite first.
// For "to make the playoff" odds, more negative = bigger favorite (−800 > −200 > +150).
function playoffImpliedProb(odds) {
  const n = Number(odds);
  if (!n || isNaN(n)) return 0;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}
function computePlayoffTiers(teams) {
  // Higher implied probability (bigger favorite) sorts first
  const byFavorite = (a, b) => playoffImpliedProb(b.odds) - playoffImpliedProb(a.odds);
  const tier1 = teams.filter((t) => Number(t.tier) === 1).slice().sort(byFavorite);
  const tier2 = teams.filter((t) => Number(t.tier) === 2).slice().sort(byFavorite);
  const tier3 = teams.filter((t) => Number(t.tier) === 3).slice().sort(byFavorite);
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

// Returns [{key, value}] in one network round trip instead of list() + N getGets.
async function safeListValues(prefix, shared) {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8000)
    );
    const r = await Promise.race([storage.listValues(prefix, shared), timeout]);
    return r || [];
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

// Same idea as Spinner, but for spots where loads have been unreliable on mobile
// Safari (Win Totals / Playoff). Shows which network call is in flight and how
// long it's been running, offers a cheap in-app retry first (re-runs the fetch
// without losing app state), and only falls back to a full page reload as a
// last resort. The stage/elapsed readout also means if it DOES hang again, you
// can read off exactly what's stuck and report it back instead of guessing.
function DiagnosticSpinner({ label, stage, onRetry }) {
  const [elapsed, setElapsed] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const stageLabel = { board: "fetching board", picks: "fetching picks", done: "wrapping up" }[stage] || stage;
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2" style={{ color: COLORS.chalkDim }}>
        <RefreshCw size={14} className="animate-spin" />
        <span className="text-sm cfb-mono">{label || "Loading..."}</span>
      </div>
      {elapsed >= 3 && (
        <div className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
          {stageLabel ? `${stageLabel} — ` : ""}{elapsed}s elapsed
        </div>
      )}
      {elapsed >= 6 && (
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setRetrying(true);
              await onRetry?.();
              setRetrying(false);
            }}
            disabled={retrying}
            className="cfb-mono text-xs px-3 py-2 cfb-btn"
            style={{ border: `1px solid ${COLORS.gold}`, color: COLORS.goldBright }}
          >
            {retrying ? "Retrying..." : "Stuck? Tap to retry"}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="cfb-mono text-xs px-3 py-2 cfb-btn"
            style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalk }}
          >
            Still stuck? Full reload
          </button>
        </div>
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

const TOKEN_KEY = "cfbpool:my-token"; // localStorage key for stored member token

// ---------- token utilities ----------
function generateToken() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => chars[b % chars.length])
      .join("");
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
function readTokenFromHash() {
  const h = window.location.hash.slice(1);
  if (!h) return null;
  if (h.startsWith("join/")) return h.slice(5); // explicit invite link: #join/TOKEN
  if (/^[a-z0-9]{8}$/.test(h)) return h;        // bare token: #TOKEN (home screen shortcut)
  return null;
}

// After authentication, replace the URL hash with just the token.
// This means the URL becomes yoursite.com/#abc12345 — a clean permanent link
// that works perfectly as a home screen shortcut on iOS: every launch from the
// shortcut re-authenticates from the hash, bypassing localStorage entirely.
function setAuthHash(token) {
  try {
    history.replaceState(
      null, "",
      window.location.pathname + window.location.search + "#" + token
    );
  } catch {}
}
function inviteUrl(token) {
  return `${window.location.origin}${window.location.pathname}#join/${token}`;
}

// ---------- bootstrap helpers ----------
// We cache a snapshot of leagueMeta + myName in localStorage so that every
// session starts instantly, even on iOS Safari where the first cold Firestore
// connection can take 5-10s.  The Firestore fetch still runs in the background
// and will overwrite with fresh data — this is stale-while-revalidate.
const BOOT_KEY = "cfbpool:__boot__";
const NAME_KEY = "cfbpool:my-name";   // matches storage.js LOCAL_PREFIX + "my-name"

function readBootstrap() {
  try {
    const raw = localStorage.getItem(BOOT_KEY);
    const name = localStorage.getItem(NAME_KEY);
    if (!raw || !name) return null;
    const meta = JSON.parse(raw);
    if (!meta?.members?.includes(name)) return null;
    // If the pool hasn't had tokens generated yet (pre-invite-link deploy),
    // skip the token check — the init effect will issue a token via grace period.
    if (!meta.memberTokens) return { meta, name };
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    if (meta.memberTokens[slugify(name)] !== token) return null;
    return { meta, name, token };
  } catch {
    return null;
  }
}

function saveBootstrap(meta) {
  try { localStorage.setItem(BOOT_KEY, JSON.stringify(meta)); } catch {}
}

function derivePhaseState(meta, name) {
  const wtYears = meta.winTotalsYears || [];
  const pYears  = meta.playoffYears  || [];
  return {
    phase:                   "app",
    leagueMeta:              meta,
    myName:                  name,
    selectedWeek:            meta.weeks?.length ? Math.max(...meta.weeks) : null,
    selectedWinTotalsYear:   wtYears.length ? Math.max(...wtYears) : null,
    selectedPlayoffYear:     pYears.length  ? Math.max(...pYears)  : null,
  };
}

/* --------------------------------- App ------------------------------------ */

export default function App() {
  // Derive initial state synchronously from localStorage bootstrap so the very
  // first render already has the correct phase / selectedYear values — no
  // waiting for Firestore on iOS Safari's cold connection.
  const boot = readBootstrap();

  const [phase, setPhase] = useState(boot ? "app" : "loading");
  const [leagueMeta, setLeagueMeta] = useState(boot?.meta ?? null);
  const [myName, setMyName] = useState(boot?.name ?? null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("picks");
  const [selectedWeek, setSelectedWeek] = useState(
    boot?.meta?.weeks?.length ? Math.max(...(boot.meta.weeks)) : null
  );

  const [weekCache, setWeekCache] = useState({}); // weekNum -> {weekNum, games, locked, graded}
  const [picksCache, setPicksCache] = useState({}); // weekNum -> { memberSlug: {picks, name} }
  const [weekLoading, setWeekLoading] = useState(false);
  const [savingGameId, setSavingGameId] = useState(null);

  const [standings, setStandings] = useState(null);
  const [standingsLoading, setStandingsLoading] = useState(false);

  const [selectedWinTotalsYear, setSelectedWinTotalsYear] = useState(
    (boot?.meta?.winTotalsYears || []).length ? Math.max(...(boot.meta.winTotalsYears)) : null
  );
  const [winTotalsCache, setWinTotalsCache] = useState({}); // year -> {year, teams, locked}
  const [winTotalsPicksCache, setWinTotalsPicksCache] = useState({}); // year -> { slug: {name, picks, submittedAt} }
  const [winTotalsLoading, setWinTotalsLoading] = useState(false);
  const [winTotalsLoadStage, setWinTotalsLoadStage] = useState(null); // diagnostic: which await is in flight

  const [selectedPlayoffYear, setSelectedPlayoffYear] = useState(
    (boot?.meta?.playoffYears || []).length ? Math.max(...(boot.meta.playoffYears)) : null
  );
  const [playoffCache, setPlayoffCache] = useState({}); // year -> {year, teams, locked}
  const [playoffPicksCache, setPlayoffPicksCache] = useState({}); // year -> { slug: {name, picks, submittedAt} }
  const [playoffLoading, setPlayoffLoading] = useState(false);
  const [playoffLoadStage, setPlayoffLoadStage] = useState(null); // diagnostic: which await is in flight

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
      const inviteToken = readTokenFromHash(); // read before any async work
      const metaRaw = await safeGet("league-meta", true);
      if (!metaRaw) {
        if (!boot) setPhase("setup");
        return; // stay on "app" with cached bootstrap if Firestore timed out
      }

      let meta = JSON.parse(metaRaw);

      // Ensure every member has a token — generate any that are missing.
      // This runs silently on first deployment (migration) and when new members are added.
      const tokens = { ...(meta.memberTokens || {}) };
      let tokensChanged = false;
      meta.members.forEach((m) => {
        const s = slugify(m);
        if (!tokens[s]) { tokens[s] = generateToken(); tokensChanged = true; }
      });
      if (tokensChanged) {
        meta = { ...meta, memberTokens: tokens };
        await storage.set("league-meta", JSON.stringify(meta), true).catch(() => null);
      }
      saveBootstrap(meta);
      setLeagueMeta(meta);

      // Helper: transition to "app" phase after a successful auth
      function goToApp(name) {
        setMyName(name);
        setPhase("app");
        setSelectedWeek(meta.weeks?.length ? Math.max(...meta.weeks) : null);
        const wtYears = meta.winTotalsYears || [];
        setSelectedWinTotalsYear(wtYears.length ? Math.max(...wtYears) : null);
        const pYears = meta.playoffYears || [];
        setSelectedPlayoffYear(pYears.length ? Math.max(...pYears) : null);
        saveBootstrap(meta);
      }

      // 1. INVITE LINK or HOME SCREEN SHORTCUT: token present in URL hash
      if (inviteToken) {
        const slug = Object.keys(tokens).find((s) => tokens[s] === inviteToken);
        const name = slug ? meta.members.find((m) => slugify(m) === slug) : null;
        if (name) {
          setAuthHash(inviteToken); // keep token in URL for home screen shortcut
          await storage.set("my-name", name, false).catch(() => null);
          localStorage.setItem(TOKEN_KEY, inviteToken);
          goToApp(name);
          return;
        }
        // Token not recognised (expired / regenerated) — fall through to identify
      }

      // 2. STORED SESSION: verify name + token still match
      const nameRaw = await safeGet("my-name", false);
      if (nameRaw && meta.members.includes(nameRaw)) {
        const expectedToken = tokens[slugify(nameRaw)];
        const storedToken = localStorage.getItem(TOKEN_KEY);

        if (storedToken && storedToken === expectedToken) {
          // Valid token on file — set URL hash so home screen shortcuts work
          setAuthHash(expectedToken);
          goToApp(nameRaw);
          return;
        }

        if (!storedToken && expectedToken) {
          // GRACE PERIOD: member was authenticated before tokens existed.
          // Auto-grant their token once so existing sessions aren't disrupted.
          localStorage.setItem(TOKEN_KEY, expectedToken);
          setAuthHash(expectedToken);
          goToApp(nameRaw);
          return;
        }

        // Token mismatch (link was regenerated) — require fresh invite link
      }

      // 3. NO VALID SESSION
      if (!boot) setPhase("identify");
    })();
  }, []);

  const slugToName = useMemo(() => {
    const map = {};
    (leagueMeta?.members || []).forEach((m) => (map[slugify(m)] = m));
    return map;
  }, [leagueMeta]);

  /* ---------- league setup / identity ---------- */

  async function createLeague(leagueName, yourName, passcode) {
    const slug = slugify(yourName.trim());
    const meta = {
      leagueName: leagueName.trim(),
      members: [yourName.trim()],
      memberTokens: { [slug]: generateToken() },
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
    saveBootstrap(meta);
    setMyName(yourName.trim());
    setPhase("app");
  }

  async function joinExisting(name) {
    const token = leagueMeta?.memberTokens?.[slugify(name)];
    await storage.set("my-name", name, false).catch(() => null);
    if (token) localStorage.setItem(TOKEN_KEY, token);
    setMyName(name);
    setPhase("app");
    setSelectedWeek(leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) : null);
    const wtYears = leagueMeta.winTotalsYears || [];
    setSelectedWinTotalsYear(wtYears.length ? Math.max(...wtYears) : null);
    const pYears = leagueMeta.playoffYears || [];
    setSelectedPlayoffYear(pYears.length ? Math.max(...pYears) : null);
    saveBootstrap(leagueMeta);
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
    setLeagueMeta(updated); saveBootstrap(updated);
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
        const entries = await safeListValues(`week:${weekNum}:picks:`, true);
        const picksObj = {};
        entries.forEach(({ key: k, value: raw2 }) => {
          if (!raw2) return;
          const slug = k.slice(`week:${weekNum}:picks:`.length);
          try { picksObj[slug] = JSON.parse(raw2); } catch {}
        });
        setPicksCache((prev) => ({ ...prev, [weekNum]: picksObj }));
      }
    } catch (e) {
      console.error("loadWeek error", e);
    } finally {
      setWeekLoading(false);
    }
  }, []);

  // Real-time listeners for the picks tab — week games + all member picks.
  // Fires within ~300ms whenever anyone saves a pick or the commissioner
  // updates scores. Cleans up listeners on tab/week change.
  const picksTabListenerRef = useRef(null);

  useEffect(() => {
    // Tear down any existing listener when conditions change
    if (picksTabListenerRef.current) {
      picksTabListenerRef.current();
      picksTabListenerRef.current = null;
    }

    if (phase !== "app" || selectedWeek == null || activeTab !== "picks") return;

    setWeekLoading(true);

    // Track when each listener fires for the first time so we can clear loading
    let weekReady = false, picksReady = false;
    function maybeReady() {
      if (weekReady && picksReady) setWeekLoading(false);
    }

    // 1. Listen to the week games document (scores, lock status, etc.)
    const weekUnsub = onSnapshot(
      doc(db, "weeks", String(selectedWeek)),
      (snap) => {
        if (snap.exists()) {
          try {
            const weekObj = JSON.parse(snap.data().value);
            setWeekCache((prev) => ({ ...prev, [selectedWeek]: weekObj }));
          } catch {}
        }
        weekReady = true;
        maybeReady();
      },
      (err) => {
        console.error("Week listener error:", err);
        weekReady = true;
        maybeReady();
      }
    );

    // 2. Listen to all picks for this week (every member's picks doc)
    const picksUnsub = onSnapshot(
      query(collection(db, "picks"), where("week", "==", selectedWeek)),
      (snap) => {
        const picksObj = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (!data.slug || !data.value) return;
          try { picksObj[data.slug] = JSON.parse(data.value); } catch {}
        });
        setPicksCache((prev) => ({ ...prev, [selectedWeek]: picksObj }));
        picksReady = true;
        maybeReady();
      },
      (err) => {
        console.error("Picks listener error:", err);
        picksReady = true;
        maybeReady();
      }
    );

    picksTabListenerRef.current = () => { weekUnsub(); picksUnsub(); };
    return () => {
      if (picksTabListenerRef.current) {
        picksTabListenerRef.current();
        picksTabListenerRef.current = null;
      }
    };
  }, [phase, selectedWeek, activeTab]);

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
      hidePicksUntilKickoff: existing?.hidePicksUntilKickoff || false,
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
      setLeagueMeta(updatedMeta); saveBootstrap(updatedMeta);
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
    setLeagueMeta(updatedMeta); saveBootstrap(updatedMeta);
    setWeekCache((prev) => { const n = { ...prev }; delete n[weekNum]; return n; });
    setPicksCache((prev) => { const n = { ...prev }; delete n[weekNum]; return n; });
  }

  async function addMember(name) {
    const slug = slugify(name);
    const existingTokens = leagueMeta.memberTokens || {};
    const token = existingTokens[slug] || generateToken();
    const updated = {
      ...leagueMeta,
      members: [...leagueMeta.members, name],
      memberTokens: { ...existingTokens, [slug]: token },
    };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) { setLeagueMeta(updated); saveBootstrap(updated); }
  }

  async function saveWeeklyAdjustments(weekNum, adjustmentsForWeek) {
    // adjustmentsForWeek: { [memberSlug]: dollarAmount }
    const existing = leagueMeta.weeklyAdjustments || {};
    const merged = { ...existing, [weekNum]: adjustmentsForWeek };
    const updated = { ...leagueMeta, weeklyAdjustments: merged };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) { setLeagueMeta(updated); saveBootstrap(updated); }
    return !!r;
  }

  async function regenerateMemberToken(name) {
    const slug = slugify(name);
    const newToken = generateToken();
    const updated = {
      ...leagueMeta,
      memberTokens: { ...(leagueMeta.memberTokens || {}), [slug]: newToken },
    };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) { setLeagueMeta(updated); saveBootstrap(updated); }
    return r ? newToken : null;
  }

  async function deleteMember(name) {
    const updated = { ...leagueMeta, members: leagueMeta.members.filter((m) => m !== name) };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) setLeagueMeta(updated); saveBootstrap(updated);
  }

  async function toggleLock(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return;
    const payload = { ...week, locked: !week.locked };
    const r = await storage.set(`week:${weekNum}:games`, JSON.stringify(payload), true).catch(() => null);
    if (r) setWeekCache((prev) => ({ ...prev, [weekNum]: payload }));
  }

  async function toggleHidePicksUntilKickoff(weekNum) {
    const week = weekCache[weekNum];
    if (!week) return;
    const payload = { ...week, hidePicksUntilKickoff: !week.hidePicksUntilKickoff };
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

    // At this point every matched game is final. If some games couldn't be
    // matched to ESPN, save what we have so the Results tab pre-fills those
    // scores and the commissioner only needs to enter the unmatched ones.
    // graded stays false until all scores are present.
    if (unmatched.length > 0) {
      const partialGames = week.games.map((game) => {
        const m = matched.find((x) => x.game.id === game.id);
        return m ? { ...game, homeScore: m.espn.homeScore, awayScore: m.espn.awayScore } : game;
      });
      await saveResults(weekNum, partialGames);
      const names = unmatched.map((g) => `${g.away} @ ${g.home}`).join(", ");
      return {
        status: "partial",
        message: `${matched.length} of ${week.games.length} games auto-scored. Couldn't match: ${names}. Fill those in manually to finish grading.`,
        unmatched,
      };
    }

    // All matched and final — save and mark graded
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
    setWinTotalsLoadStage("board");
    try {
      const raw = await safeGet(`wintotals:${year}:board`, true);
      const board = raw ? JSON.parse(raw) : null;
      setWinTotalsCache((prev) => ({ ...prev, [year]: board }));
      if (withPicks) {
        setWinTotalsLoadStage("picks");
        const entries = await safeListValues(`wintotals:${year}:picks:`, true);
        const picksObj = {};
        entries.forEach(({ key: k, value: raw2 }) => {
          if (!raw2) return;
          const slug = k.slice(`wintotals:${year}:picks:`.length);
          try { picksObj[slug] = JSON.parse(raw2); } catch {}
        });
        setWinTotalsPicksCache((prev) => ({ ...prev, [year]: picksObj }));
      }
      setWinTotalsLoadStage("done");
    } catch (e) {
      console.error("loadWinTotals error", e);
      setWinTotalsLoadStage("error: " + (e?.message || "unknown"));
    } finally {
      setWinTotalsLoading(false);
    }
  }, []);

  // Win totals: board loads once (changes only when commissioner edits it),
  // picks use a real-time listener so everyone sees submissions as they happen.
  const winTotalsPicksListenerRef = useRef(null);

  useEffect(() => {
    if (winTotalsPicksListenerRef.current) {
      winTotalsPicksListenerRef.current();
      winTotalsPicksListenerRef.current = null;
    }

    if (phase !== "app" || selectedWinTotalsYear == null || activeTab !== "wintotals") return;

    // One-time fetch for the board
    loadWinTotals(selectedWinTotalsYear, false);

    // Real-time listener for picks
    const year = selectedWinTotalsYear;
    const unsub = onSnapshot(
      query(collection(db, "winTotalsPicks"), where("wtYear", "==", year)),
      (snap) => {
        const picksObj = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (!data.slug || !data.value) return;
          try { picksObj[data.slug] = JSON.parse(data.value); } catch {}
        });
        setWinTotalsPicksCache((prev) => ({ ...prev, [year]: picksObj }));
      },
      (err) => console.error("Win totals picks listener error:", err)
    );

    winTotalsPicksListenerRef.current = unsub;
    return () => {
      if (winTotalsPicksListenerRef.current) {
        winTotalsPicksListenerRef.current();
        winTotalsPicksListenerRef.current = null;
      }
    };
  }, [phase, selectedWinTotalsYear, activeTab]);

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

    // Auto-fetch first-game kickoff dates from ESPN (best-effort)
    const existingDates = {};
    if (existing) {
      existing.teams.forEach((t) => {
        if (t.firstGameISO) existingDates[t.school.toLowerCase()] = t.firstGameISO;
      });
    }
    // Only fetch from ESPN if any team is missing a date
    const anyMissing = teams.some((t) => !existingDates[t.school.toLowerCase()]);
    let espnDates = {};
    if (anyMissing) {
      try {
        espnDates = await fetchFirstGameDates(year);
      } catch { /* non-fatal */ }
    }

    let payload;
    if (existing) {
      const finalMap = {};
      existing.teams.forEach((t) => (finalMap[t.id] = t.finalWins));
      payload = {
        year,
        locked,
        teams: teams.map((t) => ({
          ...t,
          finalWins: finalMap[t.id] ?? null,
          firstGameISO: existingDates[t.school.toLowerCase()]
            || espnDates[t.school.toLowerCase()]
            || null,
        })),
      };
    } else {
      payload = {
        year,
        locked,
        teams: teams.map((t) => ({
          ...t,
          finalWins: null,
          firstGameISO: espnDates[t.school.toLowerCase()] || null,
        })),
      };
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
      setLeagueMeta(updatedMeta); saveBootstrap(updatedMeta);
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
    setPlayoffLoadStage("board");
    try {
      const raw = await safeGet(`playoff:${year}:board`, true);
      const board = raw ? JSON.parse(raw) : null;
      setPlayoffCache((prev) => ({ ...prev, [year]: board }));
      if (withPicks) {
        setPlayoffLoadStage("picks");
        const entries = await safeListValues(`playoff:${year}:picks:`, true);
        const picksObj = {};
        entries.forEach(({ key: k, value: raw2 }) => {
          if (!raw2) return;
          const slug = k.slice(`playoff:${year}:picks:`.length);
          try { picksObj[slug] = JSON.parse(raw2); } catch {}
        });
        setPlayoffPicksCache((prev) => ({ ...prev, [year]: picksObj }));
      }
      setPlayoffLoadStage("done");
    } catch (e) {
      console.error("loadPlayoff error", e);
      setPlayoffLoadStage("error: " + (e?.message || "unknown"));
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
      setLeagueMeta(updatedMeta); saveBootstrap(updatedMeta);
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
      setLeagueMeta(freshMeta); saveBootstrap(freshMeta);
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
      try { localStorage.removeItem(BOOT_KEY); } catch {}
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
      const entries = await safeListValues(`week:${w}:picks:`, true);
      const weekWins = {};
      for (const { key: k, value: raw2 } of entries) {
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
        const entries = await safeListValues(`wintotals:${wtYear}:picks:`, true);
        for (const { value: raw2 } of entries) {
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
            if (p.side === cover) wins += pickPayout(team, p.side); // weighted by odds
            else losses += 1;
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
        const entries = await safeListValues(`playoff:${pYear}:picks:`, true);
        for (const { value: raw2 } of entries) {
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
      const pickEntries = await safeListValues(`week:${w}:picks:`, true);
      const weekWins = {}; // member -> wins this week (only members who played)
      const picksByMember = {};
      const allPicksByMember = {}; // includes members who only submitted an underdog pick
      for (const { key: k, value: raw2 } of pickEntries) {
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

    // Apply commissioner adjustments on top of computed amounts
    const adjustments = leagueMeta.weeklyAdjustments || {};
    let totalAdjustments = 0;
    Object.entries(adjustments).forEach(([weekNum, weekAdj]) => {
      Object.entries(weekAdj).forEach(([slug, amt]) => {
        const name = slugToName[slug];
        if (!name || !perMember[name]) return;
        perMember[name].adjustments = (perMember[name].adjustments || 0) + amt;
        totalAdjustments += amt;
      });
    });

    const potRemaining =
      totalBuyIns - totalWeeklyWinsPaid + totalWeeklyLossesOwed - totalLockWinsPaid + totalLockLossesOwed - totalUnderdogWinsPaid - totalAdjustments;

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
    setLeagueMeta(updated); saveBootstrap(updated);
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
    setLeagueMeta(updated); saveBootstrap(updated);
    return true;
  }

  async function unfinalizeSeasonPayouts() {
    const updated = { ...leagueMeta, seasonFinalized: false, seasonPayouts: {} };
    const r = await storage.set("league-meta", JSON.stringify(updated), true).catch(() => null);
    if (r) setLeagueMeta(updated); saveBootstrap(updated);
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

  // Win Totals / Playoff: mobile Safari suspends background tabs, so cached state can
  // go stale silently. Refetch whenever the app becomes visible again while one of
  // these tabs is open, same fix already applied to the Picks tab's auto-grading.
  const reloadActiveTabRef = useRef(null);
  reloadActiveTabRef.current = () => {
    if (phase !== "app") return;
    if (activeTab === "wintotals" && selectedWinTotalsYear != null) {
      loadWinTotals(selectedWinTotalsYear, true);
    } else if (activeTab === "playoff" && selectedPlayoffYear != null) {
      loadPlayoff(selectedPlayoffYear, true);
    }
  };
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        reloadActiveTabRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, []); // intentionally empty — ref keeps it current without re-attaching

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
        <IdentifyScreen leagueName={leagueMeta.leagueName} />
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

        {/* week selector — shown in header only on picks tab */}
        {activeTab === "picks" && leagueMeta.weeks.length > 0 && (
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

      {/* main content — padded bottom so nothing hides behind the tab bar */}
      <div
        className={`p-4 mx-auto ${activeTab === "commish" ? "max-w-5xl" : "max-w-2xl"}`}
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
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
            loadStage={winTotalsLoadStage}
            onRetry={() => loadWinTotals(selectedWinTotalsYear, true)}
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
            loadStage={playoffLoadStage}
            onRetry={() => loadPlayoff(selectedPlayoffYear, true)}
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
            toggleHidePicksUntilKickoff={toggleHidePicksUntilKickoff}
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
            addMember={addMember}
            regenerateMemberToken={regenerateMemberToken}
            saveWeeklyAdjustments={saveWeeklyAdjustments}
          />
        )}
      </div>

      <BottomTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}

/* ----------------------------- bottom tab bar ------------------------------ */

const TAB_BAR_HEIGHT = 56;

const PRIMARY_TABS = [
  { id: "picks",     label: "Picks",     icon: CheckCircle2 },
  { id: "standings", label: "Standings", icon: Trophy       },
  { id: "wintotals", label: "Win Tot.",  icon: Target       },
  { id: "playoff",   label: "Playoff",   icon: Award        },
];
const MORE_TABS = [
  { id: "money",   label: "Money",   icon: DollarSign },
  { id: "history", label: "History", icon: Clock      },
  { id: "commish", label: "Commish", icon: Shield     },
];

function BottomTabBar({ activeTab, setActiveTab }) {
  const [showMore, setShowMore] = useState(false);
  const activeMore = MORE_TABS.find((t) => t.id === activeTab);

  const tabBarStyle = {
    position: "fixed",
    bottom: 0, left: 0, right: 0,
    zIndex: 50,
    background: COLORS.fieldDark,
    borderTop: `1px solid ${COLORS.line}`,
    display: "flex",
    height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
    paddingBottom: "env(safe-area-inset-bottom)",
  };

  const tabBtn = (active) => ({
    flex: 1,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 3,
    background: "transparent",
    color: active ? COLORS.goldBright : "#55555e",
    WebkitTapHighlightColor: "transparent",
    cursor: "pointer",
    border: "none",
    padding: 0,
    minWidth: 0,
  });

  return (
    <>
      {/* backdrop — closes the More menu when tapping outside */}
      {showMore && (
        <div
          onClick={() => setShowMore(false)}
          style={{ position: "fixed", inset: 0, zIndex: 48 }}
        />
      )}

      {/* More slide-up panel */}
      {showMore && (
        <div
          style={{
            position: "fixed",
            bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
            left: 0, right: 0,
            background: COLORS.fieldMid,
            borderTop: `1px solid ${COLORS.lineStrong}`,
            zIndex: 49,
          }}
        >
          {MORE_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); setShowMore(false); }}
                style={{
                  display: "flex", width: "100%", alignItems: "center",
                  gap: 16, padding: "16px 24px",
                  background: active ? "rgba(217,164,65,0.07)" : "transparent",
                  color: active ? COLORS.goldBright : COLORS.chalk,
                  borderBottom: `1px solid ${COLORS.line}`,
                  WebkitTapHighlightColor: "transparent",
                  cursor: "pointer", border: "none",
                  borderBottom: `1px solid ${COLORS.line}`,
                }}
                className="cfb-mono text-sm font-bold uppercase tracking-wider"
              >
                <Icon size={18} style={{ color: active ? COLORS.goldBright : COLORS.chalkDim, flexShrink: 0 }} />
                {t.label}
                {active && <CheckCircle2 size={14} style={{ color: COLORS.goldBright, marginLeft: "auto" }} />}
              </button>
            );
          })}
        </div>
      )}

      {/* the bar itself */}
      <div style={tabBarStyle}>
        {PRIMARY_TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setShowMore(false); }}
              style={tabBtn(active)}
              aria-label={t.label}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span className="cfb-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {t.label}
              </span>
            </button>
          );
        })}

        {/* More button — shows dot if a secondary tab is active */}
        <button
          onClick={() => setShowMore((s) => !s)}
          style={{ ...tabBtn(!!activeMore || showMore), position: "relative" }}
          aria-label="More tabs"
        >
          {activeMore ? (
            <activeMore.icon size={22} strokeWidth={2.2} />
          ) : (
            <MoreHorizontal size={22} strokeWidth={1.8} />
          )}
          <span className="cfb-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {activeMore ? activeMore.label : "More"}
          </span>
          {activeMore && (
            <div style={{
              position: "absolute", top: 8, right: "calc(50% - 16px)",
              width: 6, height: 6, borderRadius: "50%",
              background: COLORS.gold,
            }} />
          )}
        </button>
      </div>
    </>
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

function IdentifyScreen({ leagueName }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm cfb-fade-in text-center space-y-5">
        <div className="cfb-mono text-xs uppercase tracking-widest" style={{ color: COLORS.gold }}>
          {leagueName}
        </div>
        <div className="cfb-display text-3xl uppercase">Join the Pool</div>
        <div className="text-sm leading-relaxed" style={{ color: COLORS.chalkDim }}>
          You need your personal invite link to access the pool. Check your messages for a link from the commissioner.
        </div>
        <div className="cfb-mono text-xs" style={{ color: COLORS.muted }}>
          Already have your link? Open it on this device and you'll be let in automatically.
        </div>
        <div className="cfb-mono text-xs" style={{ color: COLORS.muted, marginTop: 16 }}>
          If your link stopped working, ask the commissioner to send you a new one.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- picks tab --------------------------------- */

function LiveScorePanel({ game, data }) {
  if (!data) return null;
  // Don't render if the game hasn't started (no period yet)
  if (!data.inProgress && !data.completed) return null;

  const {
    homeScore, awayScore, completed, inProgress,
    period, clock, shortDetail, downDistance,
    isRedZone, possession,
  } = data;

  const awayAbbr = teamAbbrev(game.away);
  const homeAbbr = teamAbbrev(game.home);

  const periodLabel =
    period > 4
      ? period === 5 ? "OT" : `${period - 4}OT`
      : period > 0 ? `Q${period}` : "";

  const isHalf =
    !completed &&
    (shortDetail?.toLowerCase().includes("half") ||
      (period === 2 && clock === "0:00"));

  const clockLine = isHalf
    ? "HALFTIME"
    : completed
    ? shortDetail || "FINAL"
    : clock
    ? `${periodLabel} · ${clock}`
    : periodLabel;

  const awayNum = parseInt(awayScore, 10);
  const homeNum = parseInt(homeScore, 10);
  const awayLeads = !isNaN(awayNum) && !isNaN(homeNum) && awayNum > homeNum;
  const homeLeads = !isNaN(homeNum) && !isNaN(awayNum) && homeNum > awayNum;

  return (
    <div
      style={{
        background: "#0e0e11",
        border: `1px solid ${isRedZone && inProgress ? "rgba(220,60,60,0.45)" : COLORS.lineStrong}`,
        borderRadius: 5,
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      {/* Status row */}
      <div
        className="cfb-mono flex items-center justify-between"
        style={{ marginBottom: 8, fontSize: "0.67rem", letterSpacing: "0.06em" }}
      >
        <span
          className="flex items-center gap-1.5"
          style={{ color: inProgress ? "#e05050" : COLORS.chalkDim, fontWeight: 700 }}
        >
          {inProgress && (
            <span
              className="animate-pulse"
              style={{ width: 6, height: 6, borderRadius: "50%", background: "#e05050", display: "inline-block" }}
            />
          )}
          {completed ? "FINAL" : inProgress ? "LIVE" : ""}
        </span>
        <span style={{ color: COLORS.chalkDim }}>{clockLine}</span>
      </div>

      {/* Scores */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 8,
          textAlign: "center",
        }}
      >
        {/* Away */}
        <div>
          <div
            className="cfb-mono flex items-center justify-center gap-1"
            style={{
              fontSize: "0.62rem", letterSpacing: "0.07em", marginBottom: 3,
              color: possession === "away" ? COLORS.goldBright : COLORS.muted,
            }}
          >
            {possession === "away" && <span>🏈</span>}
            <span>{awayAbbr}</span>
          </div>
          <div
            className="cfb-mono font-bold"
            style={{ fontSize: "2.1rem", lineHeight: 1, color: awayLeads ? COLORS.chalk : COLORS.chalkDim }}
          >
            {awayScore}
          </div>
        </div>

        {/* Middle: down & distance */}
        <div style={{ paddingTop: 16, minWidth: 72 }}>
          {!isHalf && !completed && downDistance ? (
            <div
              className="cfb-mono"
              style={{
                fontSize: "0.6rem",
                color: isRedZone ? "#e05050" : COLORS.muted,
                whiteSpace: "nowrap",
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              {downDistance}
            </div>
          ) : (
            <div style={{ color: COLORS.muted, textAlign: "center" }}>—</div>
          )}
        </div>

        {/* Home */}
        <div>
          <div
            className="cfb-mono flex items-center justify-center gap-1"
            style={{
              fontSize: "0.62rem", letterSpacing: "0.07em", marginBottom: 3,
              color: possession === "home" ? COLORS.goldBright : COLORS.muted,
            }}
          >
            <span>{homeAbbr}</span>
            {possession === "home" && <span>🏈</span>}
          </div>
          <div
            className="cfb-mono font-bold"
            style={{ fontSize: "2.1rem", lineHeight: 1, color: homeLeads ? COLORS.chalk : COLORS.chalkDim }}
          >
            {homeScore}
          </div>
        </div>
      </div>
    </div>
  );
}

function PicksTab({ leagueMeta, selectedWeek, week, weekLoading, picksCache, myName, savePick, savingGameId, slugToName, toggleMyLock, saveUnderdogPick, lastAutoCheckTime }) {
  const [viewMode, setViewMode] = useState("mine");
  const [autoLockTick, setAutoLockTick] = useState(0);

  // Live score state — declared before any early returns (rules of hooks)
  const [liveScores, setLiveScores] = useState({});
  const liveTimerRef = useRef(null);

  useEffect(() => {
    setViewMode("mine");
  }, [selectedWeek]);

  // Timer that fires precisely when the next game day's first kickoff passes
  useEffect(() => {
    if (!week?.games?.length) return;
    const ms = msUntilNextKickoff(week.games);
    if (ms == null) return;
    const id = setTimeout(() => setAutoLockTick((t) => t + 1), ms + 1500);
    return () => clearTimeout(id);
  }, [week?.games, autoLockTick]);

  // Compute locked games even before early-returns so the useEffect below
  // is always called unconditionally (rules of hooks)
  const autoLockedGameIds = computeAutoLockStatus(week?.games || []);
  const lockedCount = autoLockedGameIds.size;

  // Live score polling — starts when games lock, refreshes every 30 s
  useEffect(() => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    if (!week || lockedCount === 0 || week.graded) return;
    let stale = false;
    async function refresh() {
      const data = await fetchLiveGameDetails(week).catch(() => null);
      if (!stale && data) setLiveScores(data);
    }
    refresh();
    liveTimerRef.current = setInterval(refresh, 30_000);
    return () => { stale = true; clearInterval(liveTimerRef.current); };
  }, [selectedWeek, lockedCount, week?.graded]); // eslint-disable-line

  // --- early returns after all hooks ---

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
          {week.hidePicksUntilKickoff
            ? "Picks are hidden — they'll reveal game by game as each kickoff passes."
            : "Picks are visible to everyone."}
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

      {viewMode === "everyone" && (
        <PicksGrid
          leagueMeta={leagueMeta}
          week={week}
          picksCache={picksCache[selectedWeek] || {}}
          slugToName={slugToName}
          hideUntilKickoff={!!week.hidePicksUntilKickoff}
          autoLockedGameIds={autoLockedGameIds}
        />
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
                  {/* Away @ Home / Away vs. Home line */}
                  <div
                    className="cfb-mono mb-2"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.72rem",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        textAlign: "right",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: COLORS.chalkDim,
                      }}
                    >
                      {g.awayRank ? <span style={{ color: COLORS.gold }}>#{g.awayRank} </span> : null}{g.away}
                    </span>
                    {g.neutral ? (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: COLORS.muted,
                          border: `1px solid ${COLORS.line}`,
                          borderRadius: 10,
                          padding: "2px 6px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        vs · neutral
                      </span>
                    ) : (
                      <span style={{ color: COLORS.gold, fontWeight: "bold", fontSize: "0.85rem", textAlign: "center" }}>@</span>
                    )}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: COLORS.chalkDim,
                      }}
                    >
                      {g.homeRank ? <span style={{ color: COLORS.gold }}>#{g.homeRank} </span> : null}{g.home}
                    </span>
                  </div>

                  {/* Live score panel — shows for any locked game that ESPN has data for */}
                  {(autoLockedGameIds.has(g.id) || week.locked) && (
                    <LiveScorePanel game={g} data={liveScores[g.id]} />
                  )}

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
                            position: "relative",
                            background: bg,
                            border: `${borderWidth} solid ${borderColor}`,
                            cursor: disabled ? "default" : "pointer",
                            opacity: isOtherPicked ? 0.4 : 1,
                            transition: "opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease",
                            minHeight: 90,
                          }}
                        >
                          {/* AWAY / HOME chip — hidden for neutral-site games */}
                          {!g.neutral && (
                            <span
                              className="cfb-mono"
                              style={{
                                position: "absolute",
                                top: 4,
                                left: side === "away" ? 4 : undefined,
                                right: side === "home" ? 4 : undefined,
                                fontSize: "0.58rem",
                                letterSpacing: "0.07em",
                                textTransform: "uppercase",
                                color: isPicked ? COLORS.goldBright : COLORS.muted,
                                opacity: 0.9,
                              }}
                            >
                              {side}
                            </span>
                          )}
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
  const settings = leagueMeta.moneySettings || DEFAULT_MONEY_SETTINGS;
  const totalGames = week.games.length;
  const gamesWithScores = week.games.filter((g) => g.homeScore != null && g.awayScore != null);
  const completedCount = gamesWithScores.length;
  const allDone = completedCount === totalGames;

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

  // Push games are decided but count as neither win nor loss
  const pushGameCount = week.games.filter((g) => {
    if (g.homeScore == null || g.awayScore == null) return false;
    return coveringSide(g) === "push";
  }).length;

  // ── Base rows (actual picks vs results) ─────────────────────────────────
  const baseRows = members.map((name) => {
    const slug = slugify(name);
    const memberPicks = picksCache[slug]?.picks || {};
    const lockedGameId = picksCache[slug]?.lockedGameId || null;
    const underdogPick = picksCache[slug]?.underdogPick || null;
    const underdogResult = picksCache[slug]?.underdogResult ?? null;
    const submitted = Object.keys(memberPicks).length > 0;

    let wins = 0, losses = 0, lockResult = null;

    week.games.forEach((g) => {
      const pick = memberPicks[g.id];
      if (!pick || g.homeScore == null || g.awayScore == null) return;
      const cover = coveringSide(g);
      if (!cover || cover === "push") return;
      if (pick === cover) wins++;
      else losses++;
      if (g.id === lockedGameId) {
        lockResult = cover === "push" ? "push" : pick === cover ? "won" : "lost";
      }
    });

    // Underdog money
    let udAmount = 0;
    if (underdogPick && underdogResult === true) {
      const udGame = week.games.find((g) => {
        const dog = g.favorite === "home" ? g.away : g.home;
        return dog?.toLowerCase() === underdogPick.toLowerCase();
      });
      udAmount = underdogPayout(udGame?.spread || 0, settings);
    }

    return { name, wins, losses, lockResult, submitted, underdogResult, udAmount, synthetic: false };
  });

  // ── Synthetic records for non-submitters ─────────────────────────────────
  // Non-submitters get 1 fewer win than the worst submitted record, clamped at 0.
  // This makes them the automatic loser without going negative.
  const rows = (() => {
    if (completedCount === 0) {
      return baseRows.map((r) => ({
        ...r,
        pending: totalGames - r.wins - r.losses - pushGameCount,
      }));
    }
    const submittedWins = baseRows.filter((r) => r.submitted).map((r) => r.wins);
    const worstWins = submittedWins.length > 0 ? Math.min(...submittedWins) : 0;
    const synWins   = Math.max(worstWins - 1, 0);
    const synLosses = completedCount - synWins;

    return baseRows.map((r) => {
      if (r.submitted) {
        return { ...r, pending: totalGames - r.wins - r.losses - pushGameCount };
      }
      return {
        ...r,
        wins:    synWins,
        losses:  synLosses,
        pending: Math.max(totalGames - completedCount, 0),
        synthetic: true,
      };
    });
  })();

  // ── Sort: most wins first, ties broken by fewest losses ──────────────────
  rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  // ── Winner / loser money ─────────────────────────────────────────────────
  const winnerMoney = {};
  const loserMoney  = {};
  let perfectWeek   = false;

  if (completedCount > 0 && rows.length > 1) {
    const maxWins = rows[0].wins;
    const minWins = rows[rows.length - 1].wins;

    if (maxWins > minWins) {
      // WINNERS — submitted members only; can't win if you didn't pick
      const submittedWinners = rows.filter((r) => r.submitted && r.wins === maxWins);
      if (submittedWinners.length > 0) {
        perfectWeek = allDone && maxWins === totalGames && totalGames > 0;
        const prizePool = perfectWeek ? settings.weeklyWinAmount * 2 : settings.weeklyWinAmount;
        const winShare  = Math.round((prizePool / submittedWinners.length) * 100) / 100;
        submittedWinners.forEach((r) => { winnerMoney[r.name] = winShare; });
      }

      // LOSERS — worst record overall (includes synthetic no-picks records)
      const minLosers = rows.filter((r) => r.wins === minWins);
      const maxLossesAtMin = Math.max(...minLosers.map((r) => r.losses));
      const losers = minLosers.filter((r) => r.losses === maxLossesAtMin);

      // Guard: skip if a loser is also the winner (degenerate single-player case)
      const winnerSet = new Set(Object.keys(winnerMoney));
      const actualLosers = losers.filter((r) => !winnerSet.has(r.name));

      if (actualLosers.length > 0) {
        // Doubling rule: any submitted member going 0-10 doubles the pool.
        // Two no-picks members (synthetic 0-10) do NOT trigger doubling.
        const submittedZeroWins = rows.filter((r) => r.submitted && r.wins === 0);
        const doubled = allDone && minWins === 0 && submittedZeroWins.length >= 1;
        const losePool = doubled ? settings.weeklyLossAmount * 2 : settings.weeklyLossAmount;
        const loseShare = Math.round((losePool / actualLosers.length) * 100) / 100;
        actualLosers.forEach((r) => { loserMoney[r.name] = -loseShare; });
      }
    }
  }

  const noScoresYet = completedCount === 0;

  // Money formatter: +$X or −$X (no sign for 0)
  function moneyCell(amount, projected) {
    if (amount === 0) return <span style={{ color: COLORS.muted }}>—</span>;
    const pos = amount > 0;
    return (
      <span style={{ color: pos ? COLORS.goldBright : COLORS.redBright }}>
        {pos ? "+" : "−"}${Math.abs(amount).toFixed(2).replace(/\.00$/, "")}
        {projected && <span style={{ color: COLORS.muted, fontSize: "0.65rem" }}>~</span>}
      </span>
    );
  }

  return (
    <div className="space-y-3 cfb-fade-in">
      <div className="flex items-center justify-between">
        <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.chalkDim }}>
          Week {week.weekNum} standings
        </div>
        <div className="cfb-mono text-xs flex items-center gap-1.5" style={{ color: COLORS.muted }}>
          {completedCount} of {totalGames} scored
          {checkAgoLabel && <span>· checked {checkAgoLabel}</span>}
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
              <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>
                <span className="inline-flex items-center gap-1"><DollarSign size={11} style={{ color: COLORS.gold }} /> $</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLeading = i === 0 && r.wins > 0 && (rows[0].wins > (rows[1]?.wins ?? -1));

              const lockMoney = r.lockResult === "won"  ?  settings.lockAmount
                              : r.lockResult === "lost" ? -settings.lockAmount
                              : 0;
              const weeklyMoney = (winnerMoney[r.name] || 0) + (loserMoney[r.name] || 0);
              const total = lockMoney + weeklyMoney + r.udAmount;
              // Projected if week not fully done or winner/loser not yet final
              const projected = !allDone && (weeklyMoney !== 0);

              return (
                <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-2" style={{ color: isLeading ? COLORS.gold : COLORS.muted }}>
                    {isLeading ? <Trophy size={14} /> : i + 1}
                  </td>
                  <td className="px-3 py-2 font-semibold" style={{ color: r.submitted ? COLORS.chalk : COLORS.muted }}>
                    {r.name}
                    {!r.submitted && <span className="cfb-mono font-normal text-xs ml-1.5" style={{ color: COLORS.muted }}>no picks</span>}
                    {perfectWeek && winnerMoney[r.name] && (
                      <span className="cfb-mono font-bold text-xs ml-1.5" style={{ color: COLORS.gold }}>🎯 perfect!</span>
                    )}
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
                    {r.lockResult === "won"  && <span style={{ color: COLORS.goldBright }}>+${settings.lockAmount}</span>}
                    {r.lockResult === "lost" && <span style={{ color: COLORS.redBright }}>−${settings.lockAmount}</span>}
                    {r.lockResult === "push" && <span style={{ color: COLORS.muted }}>push</span>}
                    {r.lockResult === null   && <span style={{ color: COLORS.muted }}>—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {moneyCell(total, projected)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!week.graded && completedCount > 0 && (
        <div className="text-xs" style={{ color: COLORS.muted }}>
          {!allDone && "~ projected. "}Updates automatically when you open the app.{" "}
          {totalGames - completedCount > 0 && `${totalGames - completedCount} game${totalGames - completedCount === 1 ? "" : "s"} still to play.`}
        </div>
      )}
    </div>
  );
}

function PicksGrid({ leagueMeta, week, picksCache, slugToName, hideUntilKickoff, autoLockedGameIds }) {
  const members = leagueMeta.members;

  // Dot helper: small colored circle representing a team
  function TeamDot({ color, size = 9 }) {
    if (!color) return null;
    return (
      <span style={{
        display: "inline-block", width: size, height: size,
        borderRadius: "50%", background: color, flexShrink: 0,
        verticalAlign: "middle",
      }} />
    );
  }

  return (
    <div className="mt-2">
      <div className="cfb-mono text-xs uppercase mb-2" style={{ color: COLORS.chalkDim }}>
        Everyone's picks
      </div>
      {hideUntilKickoff && !week.locked && (
        <div className="cfb-mono text-xs mb-2" style={{ color: COLORS.muted }}>
          <Lock size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          picks hidden until each game kicks off
        </div>
      )}
      <div className="overflow-x-auto cfb-scroll" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="cfb-mono text-xs" style={{ borderCollapse: "collapse", minWidth: "max-content" }}>
          <colgroup>
            {/* sticky game column */}
            <col style={{ width: 112 }} />
            {/* member columns — wide enough for "Firstname L." without clipping */}
            {members.map((m) => <col key={m} style={{ width: 68 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th
                className="text-left px-2 py-1.5"
                style={{ position: "sticky", left: 0, background: COLORS.fieldDeep, color: COLORS.chalkDim, zIndex: 2 }}
              >
                matchup
              </th>
              {members.map((m) => {
                const parts = m.trim().split(/\s+/);
                const label = parts.length > 1
                  ? `${parts[0]} ${parts[parts.length - 1][0]}.`
                  : parts[0];
                return (
                  <th
                    key={m}
                    className="px-1 py-1.5 text-center"
                    style={{
                      background: COLORS.fieldDeep,
                      color: COLORS.chalkDim,
                      whiteSpace: "nowrap",
                      fontSize: "0.65rem",
                      letterSpacing: "0.03em",
                    }}
                    title={m}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {week.games.map((g, idx) => {
              const cover = coveringSide(g);
              const revealed = !hideUntilKickoff || autoLockedGameIds?.has(g.id) || week.graded;
              const awayAbbr = g.awayAbbr || teamAbbrev(g.away);
              const homeAbbr = g.homeAbbr || teamAbbrev(g.home);
              const favAbbr  = g.favorite === "home" ? homeAbbr : awayAbbr;

              return (
                <tr key={g.id} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  {/* Sticky game column */}
                  <td
                    className="px-2 py-1.5"
                    style={{ position: "sticky", left: 0, background: COLORS.fieldDark, zIndex: 1, verticalAlign: "top" }}
                  >
                    {/* Away @ Home with color dots */}
                    <div className="inline-flex items-center gap-1 flex-wrap" style={{ lineHeight: 1.4 }}>
                      <TeamDot color={g.awayColor} />
                      <span style={{ color: COLORS.chalk, fontSize: "0.72rem", fontWeight: 600 }}>{awayAbbr}</span>
                      <span style={{ color: COLORS.muted, fontSize: "0.65rem" }}>@</span>
                      <TeamDot color={g.homeColor} />
                      <span style={{ color: COLORS.chalk, fontSize: "0.72rem", fontWeight: 600 }}>{homeAbbr}</span>
                    </div>
                    {/* Spread + time */}
                    <div style={{ fontSize: "0.62rem", color: COLORS.muted, marginTop: 1, lineHeight: 1.3 }}>
                      {g.spread ? `${favAbbr} -${g.spread}` : ""}
                      {g.spread && g.kickoffTime ? " · " : ""}
                      {g.kickoffTime || ""}
                    </div>
                  </td>

                  {/* Member pick cells */}
                  {members.map((m) => {
                    if (!revealed) {
                      return (
                        <td key={m} className="px-1 py-1.5 text-center" style={{ color: COLORS.muted }}>
                          <Lock size={9} />
                        </td>
                      );
                    }
                    const slug = slugify(m);
                    const pick = picksCache[slug]?.picks?.[g.id];
                    const isLock = picksCache[slug]?.lockedGameId === g.id;
                    const pickAbbr = pick ? (pick === "home" ? homeAbbr : awayAbbr) : null;
                    const pickColor = pick ? (pick === "home" ? g.homeColor : g.awayColor) : null;
                    let textColor = COLORS.chalkDim;
                    if (week.graded && pick) {
                      if (cover === "push") textColor = COLORS.muted;
                      else textColor = pick === cover ? COLORS.goldBright : COLORS.redBright;
                    }
                    return (
                      <td key={m} className="px-1 py-1.5 text-center" style={{ color: textColor }}>
                        {pick ? (
                          <span className="inline-flex items-center justify-center gap-0.5">
                            <TeamDot color={pickColor} size={7} />
                            <span style={{ fontSize: "0.65rem", fontWeight: 600 }}>{pickAbbr}</span>
                            {isLock && <Flame size={9} style={{ color: COLORS.gold, flexShrink: 0 }} />}
                          </span>
                        ) : (
                          <span style={{ color: COLORS.muted, fontSize: "0.65rem" }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Underdog row */}
            <tr style={{ borderTop: `2px solid ${COLORS.lineStrong}` }}>
              <td
                className="px-2 py-1.5"
                style={{ position: "sticky", left: 0, background: COLORS.fieldDark, color: COLORS.muted }}
              >
                <span className="inline-flex items-center gap-1">
                  <Flame size={10} style={{ color: COLORS.gold }} />
                  <span style={{ fontSize: "0.65rem" }}>underdog</span>
                </span>
              </td>
              {members.map((m) => {
                if (hideUntilKickoff && !week.locked && !week.graded) {
                  return (
                    <td key={m} className="px-1 py-1.5 text-center" style={{ color: COLORS.muted }}>
                      <Lock size={9} />
                    </td>
                  );
                }
                const slug = slugify(m);
                const pick = picksCache[slug]?.underdogPick;
                const result = picksCache[slug]?.underdogResult;
                const udGame = pick
                  ? week.games.find((g) => {
                      const dog = g.favorite === "home" ? g.away : g.home;
                      return dog?.toLowerCase() === pick?.team?.toLowerCase();
                    })
                  : null;
                const udColor = udGame
                  ? (udGame.favorite === "home" ? udGame.awayColor : udGame.homeColor)
                  : null;
                let textColor = COLORS.chalkDim;
                if (pick && result === true)  textColor = COLORS.goldBright;
                if (pick && result === false) textColor = COLORS.redBright;
                return (
                  <td key={m} className="px-1 py-1.5 text-center" style={{ color: textColor }}>
                    {pick ? (
                      <span className="inline-flex items-center justify-center gap-0.5">
                        <TeamDot color={udColor} size={7} />
                        <span style={{ fontSize: "0.62rem", fontWeight: 600 }}>
                          {teamAbbrev(pick.team || pick)}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: COLORS.muted, fontSize: "0.65rem" }}>—</span>
                    )}
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
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.winTotalsWins.toFixed(2)}-{r.winTotalsLosses}</td>
                  )}
                  {hasPlayoff && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.playoffWins}-{r.playoffLosses}</td>
                  )}
                  <td className="px-3 py-2 text-right font-bold whitespace-nowrap">
                    {Number.isInteger(r.totalWins) ? r.totalWins : r.totalWins.toFixed(2)}-{r.totalLosses}
                  </td>
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
  toggleHidePicksUntilKickoff,
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
  addMember,
  regenerateMemberToken,
  saveWeeklyAdjustments,
}) {
  const [mode, setMode] = useState("games");
  const [editingWeek, setEditingWeek] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.innerWidth >= 768
  );
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

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

  const NAV_GROUPS = [
    {
      label: "This week",
      items: [
        { id: "games",   label: "Manage games",      short: "Games",    icon: Target      },
        { id: "results", label: "Enter results",      short: "Results",  icon: CheckCircle2 },
      ],
    },
    {
      label: "Preseason",
      items: [
        { id: "wtBoard",   label: "Win totals board",   short: "WT Board",    icon: Trophy  },
        { id: "wtResults", label: "Win totals results", short: "WT Results",  icon: TrendingUp },
        { id: "pBoard",    label: "Playoff board",      short: "CFP Board",   icon: Award   },
        { id: "pResults",  label: "Playoff results",    short: "CFP Results", icon: Award   },
      ],
    },
    {
      label: "Admin",
      items: [
        { id: "members",     label: "Members",        short: "Members",  icon: Users      },
        { id: "money",       label: "Money",          short: "Money",    icon: DollarSign },
        { id: "adjustments", label: "Adjustments",    short: "Adjust.",  icon: Flame      },
        { id: "history",     label: "Import history", short: "History",  icon: Clock      },
      ],
    },
  ];

  function goMode(id) {
    setMode(id);
    if (id === "games") setEditingWeek(null);
  }

  // Mode content — shared between desktop and mobile layouts
  const modeContent = (
    <div className="space-y-4 cfb-fade-in">
      <div className="text-xs" style={{ color: COLORS.muted }}>
        <Users size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
        {leagueMeta.members.length} in the pool: {leagueMeta.members.join(", ")}
      </div>

      {mode === "games" && (
        <GamesManager
          leagueMeta={leagueMeta}
          weekCache={weekCache}
          loadWeek={loadWeek}
          saveWeekGames={saveWeekGames}
          toggleLock={toggleLock}
          toggleShowPicksEarly={toggleShowPicksEarly}
          toggleHidePicksUntilKickoff={toggleHidePicksUntilKickoff}
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
        <MembersManager leagueMeta={leagueMeta} deleteMember={deleteMember} addMember={addMember} regenerateMemberToken={regenerateMemberToken} />
      )}
      {mode === "adjustments" && (
        <AdjustmentsManager leagueMeta={leagueMeta} saveWeeklyAdjustments={saveWeeklyAdjustments} />
      )}
    </div>
  );

  // Danger zone — shown at the bottom of the content area in both layouts
  const dangerZone = (
    <div className="pt-4 mt-6" style={{ borderTop: `1px solid ${COLORS.line}` }}>
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
            Permanently deletes every member, week, pick, win totals board, and playoff board, and resets money settings and season payouts. League name and passcode are kept. Remove this before opening the pool to real members.
          </div>
          {!resetConfirming ? (
            <SecondaryButton onClick={() => setResetConfirming(true)} disabled={resetting}>
              Reset all data
            </SecondaryButton>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-semibold" style={{ color: COLORS.redBright }}>
                Are you sure? This can't be undone.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => { setResetting(true); await resetAllData(); setResetting(false); }}
                  disabled={resetting}
                  className="cfb-mono cfb-btn text-xs font-bold uppercase tracking-wider px-3 py-2"
                  style={{ background: COLORS.red, color: COLORS.chalk, border: `1px solid ${COLORS.red}`, opacity: resetting ? 0.6 : 1 }}
                >
                  {resetting ? "Deleting everything..." : "Yes, delete everything"}
                </button>
                <SecondaryButton onClick={() => setResetConfirming(false)} disabled={resetting}>Cancel</SecondaryButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="cfb-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="cfb-display text-xl uppercase">Commissioner</div>
        <div className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.goldBright }}>
          <Shield size={12} /> unlocked
        </div>
      </div>

      {isDesktop ? (
        /* ── DESKTOP: persistent sidebar + content panel ── */
        <div style={{ display: "flex", gap: 0, minHeight: 600 }}>
          {/* Sidebar */}
          <div style={{
            width: 220,
            flexShrink: 0,
            borderRight: `1px solid ${COLORS.line}`,
            background: COLORS.fieldDeep,
            display: "flex",
            flexDirection: "column",
            paddingTop: 8,
          }}>
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div
                  className="cfb-mono text-xs uppercase px-4 pt-4 pb-2"
                  style={{ color: COLORS.muted, letterSpacing: "0.08em", fontSize: "0.6rem" }}
                >
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => goMode(item.id)}
                      className="cfb-mono cfb-btn w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
                      style={{
                        fontSize: "0.8rem",
                        background: active ? "rgba(217,164,65,0.09)" : "transparent",
                        color: active ? COLORS.goldBright : COLORS.chalkDim,
                        borderLeft: `3px solid ${active ? COLORS.gold : "transparent"}`,
                        borderRadius: 0,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      <Icon size={14} style={{ flexShrink: 0, opacity: active ? 1 : 0.6 }} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Danger zone at bottom of sidebar */}
            <div style={{ marginTop: "auto", borderTop: `1px solid ${COLORS.line}`, padding: "14px 16px 16px" }}>
              <button
                onClick={() => { setResetOpen((o) => !o); setResetConfirming(false); }}
                className="cfb-mono text-xs flex items-center gap-1.5"
                style={{ color: COLORS.red, opacity: 0.55 }}
              >
                <AlertCircle size={12} /> Danger zone
              </button>
            </div>
          </div>

          {/* Content area — takes remaining space, no border box */}
          <div style={{ flex: 1, minWidth: 0, padding: "24px 32px", overflowY: "auto" }}>
            {modeContent}
            {resetOpen && dangerZone}
          </div>
        </div>
      ) : (
        /* ── MOBILE: scrollable tab strip + content below ── */
        <>
          <div className="overflow-x-auto cfb-scroll" style={{ borderBottom: `1px solid ${COLORS.line}`, marginBottom: 16 }}>
            <div style={{ display: "flex", minWidth: "max-content" }}>
              {NAV_GROUPS.map((group, gi) => (
                <div key={group.label} style={{ display: "flex", borderRight: gi < NAV_GROUPS.length - 1 ? `1px solid ${COLORS.line}` : "none" }}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = mode === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => goMode(item.id)}
                        className="cfb-mono cfb-btn flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs"
                        style={{
                          color: active ? COLORS.goldBright : COLORS.chalkDim,
                          borderBottom: `2px solid ${active ? COLORS.gold : "transparent"}`,
                          background: active ? "rgba(217,164,65,0.06)" : "transparent",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Icon size={12} />
                        {item.short}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {modeContent}
          {dangerZone}
        </>
      )}
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

// ESPN conference ID → short name. Stable across seasons.
const CONF_ID_MAP = {
  "1":"ACC","4":"C-USA","5":"Big Ten","8":"SEC","9":"Pac-12",
  "10":"Mountain West","12":"Big 12","15":"Sun Belt","18":"MAC",
  "37":"Independents","151":"American","152":"Independents",
};

// Full ESPN displayName (lowercase) → conference short name.
// Covers all FBS teams for conference grouping in the import preview.
// Update as needed after realignment.
const TEAM_CONF = {
  // SEC
  "alabama crimson tide":"SEC","georgia bulldogs":"SEC","lsu tigers":"SEC",
  "florida gators":"SEC","tennessee volunteers":"SEC","auburn tigers":"SEC",
  "ole miss rebels":"SEC","texas a&m aggies":"SEC","mississippi state bulldogs":"SEC",
  "south carolina gamecocks":"SEC","arkansas razorbacks":"SEC",
  "vanderbilt commodores":"SEC","missouri tigers":"SEC","kentucky wildcats":"SEC",
  "oklahoma sooners":"SEC","texas longhorns":"SEC",
  // Big Ten
  "ohio state buckeyes":"Big Ten","michigan wolverines":"Big Ten",
  "penn state nittany lions":"Big Ten","iowa hawkeyes":"Big Ten",
  "wisconsin badgers":"Big Ten","minnesota golden gophers":"Big Ten",
  "illinois fighting illini":"Big Ten","indiana hoosiers":"Big Ten",
  "michigan state spartans":"Big Ten","northwestern wildcats":"Big Ten",
  "purdue boilermakers":"Big Ten","rutgers scarlet knights":"Big Ten",
  "maryland terrapins":"Big Ten","nebraska cornhuskers":"Big Ten",
  "ucla bruins":"Big Ten","usc trojans":"Big Ten",
  "oregon ducks":"Big Ten","washington huskies":"Big Ten",
  // Big 12
  "kansas state wildcats":"Big 12","texas tech red raiders":"Big 12",
  "baylor bears":"Big 12","tcu horned frogs":"Big 12",
  "west virginia mountaineers":"Big 12","oklahoma state cowboys":"Big 12",
  "iowa state cyclones":"Big 12","kansas jayhawks":"Big 12",
  "cincinnati bearcats":"Big 12","houston cougars":"Big 12",
  "byu cougars":"Big 12","ucf knights":"Big 12",
  "colorado buffaloes":"Big 12","arizona wildcats":"Big 12",
  "arizona state sun devils":"Big 12","utah utes":"Big 12",
  // ACC
  "clemson tigers":"ACC","florida state seminoles":"ACC","miami hurricanes":"ACC",
  "nc state wolfpack":"ACC","wake forest demon deacons":"ACC","duke blue devils":"ACC",
  "louisville cardinals":"ACC","pittsburgh panthers":"ACC","virginia tech hokies":"ACC",
  "boston college eagles":"ACC","virginia cavaliers":"ACC",
  "georgia tech yellow jackets":"ACC","syracuse orange":"ACC",
  "north carolina tar heels":"ACC","cal golden bears":"ACC",
  "smu mustangs":"ACC","stanford cardinal":"ACC",
  // Mountain West
  "boise state broncos":"Mountain West","unlv rebels":"Mountain West",
  "san diego state aztecs":"Mountain West","fresno state bulldogs":"Mountain West",
  "air force falcons":"Mountain West","hawaii rainbow warriors":"Mountain West",
  "colorado state rams":"Mountain West","utah state aggies":"Mountain West",
  "nevada wolf pack":"Mountain West","san jose state spartans":"Mountain West",
  "san josé state spartans":"Mountain West","wyoming cowboys":"Mountain West",
  "new mexico lobos":"Mountain West",
  // American
  "tulane green wave":"American","tulsa golden hurricane":"American",
  "uab blazers":"American","memphis tigers":"American",
  "east carolina pirates":"American","florida atlantic owls":"American",
  "charlotte 49ers":"American","rice owls":"American",
  "utsa roadrunners":"American","north texas mean green":"American",
  "south florida bulls":"American","usf bulls":"American",
  "navy midshipmen":"American","temple owls":"American",
  "middle tennessee blue raiders":"American",
  // Sun Belt
  "louisiana ragin' cajuns":"Sun Belt","louisiana ragin cajuns":"Sun Belt",
  "appalachian state mountaineers":"Sun Belt","texas state bobcats":"Sun Belt",
  "georgia state panthers":"Sun Belt","south alabama jaguars":"Sun Belt",
  "troy trojans":"Sun Belt","old dominion monarchs":"Sun Belt",
  "georgia southern eagles":"Sun Belt","arkansas state red wolves":"Sun Belt",
  "marshall thundering herd":"Sun Belt","james madison dukes":"Sun Belt",
  "southern miss golden eagles":"Sun Belt","coastal carolina chanticleers":"Sun Belt",
  // MAC
  "ohio bobcats":"MAC","miami oh redhawks":"MAC","miami (oh) redhawks":"MAC",
  "bowling green falcons":"MAC","kent state golden flashes":"MAC",
  "northern illinois huskies":"MAC","akron zips":"MAC",
  "central michigan chippewas":"MAC","eastern michigan eagles":"MAC",
  "western michigan broncos":"MAC","ball state cardinals":"MAC",
  "buffalo bulls":"MAC","toledo rockets":"MAC",
  // C-USA
  "florida international panthers":"C-USA","fiu panthers":"C-USA",
  "jacksonville state gamecocks":"C-USA","louisiana tech bulldogs":"C-USA",
  "new mexico state aggies":"C-USA","utep miners":"C-USA",
  "western kentucky hilltoppers":"C-USA","liberty flames":"C-USA",
  "sam houston bearkats":"C-USA","kennesaw state owls":"C-USA",
  // Independents
  "notre dame fighting irish":"Independents",
  "connecticut huskies":"Independents",
  "army black knights":"Independents",
};
function teamAbbrev(name) {
  if (!name) return "";
  const words = name.split(/\s+/).filter((w) => w && w !== "&");
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  if (words.length === 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

// Fetch live ESPN game data (score, clock, down/distance, possession) for all
// games in a week. Returns a map of { [game.id]: liveData }. Non-fatal — any
// game that doesn't match ESPN is simply absent from the result.
async function fetchLiveGameDetails(week) {
  const games = week?.games || [];
  if (!games.length) return {};

  // Date range from stored weekDates, individual kickoffISO fields, or today
  let dates = [];
  if (week.weekDates?.from && week.weekDates?.to) {
    dates = getDatesInRange(week.weekDates.from, week.weekDates.to);
  } else {
    const isoSet = new Set();
    for (const g of games) {
      if (g.kickoffISO) isoSet.add(g.kickoffISO.slice(0, 10).replace(/-/g, ""));
    }
    dates = isoSet.size
      ? [...isoSet]
      : [new Date().toISOString().slice(0, 10).replace(/-/g, "")];
  }

  const liveData = {};

  for (const yyyymmdd of dates) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yyyymmdd}&limit=200`
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of data.events || []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const homeComp = comp.competitors?.find((c) => c.homeAway === "home");
        const awayComp = comp.competitors?.find((c) => c.homeAway === "away");
        if (!homeComp || !awayComp) continue;

        const espnHome = (homeComp.team?.displayName || "").toLowerCase();
        const espnAway = (awayComp.team?.displayName || "").toLowerCase();

        // 3-level matching (same as matchGameToEspn in App)
        const game = games.find((g) => {
          const h = (g.home || "").toLowerCase();
          const a = (g.away || "").toLowerCase();
          if (espnHome === h && espnAway === a) return true;
          if (espnHome === h) return true;
          return (
            espnHome.startsWith(h.split(" ")[0]) &&
            espnAway.startsWith(a.split(" ")[0])
          );
        });
        if (!game) continue;

        const status = comp.status;
        const sit = comp.situation;
        const possId = sit?.possession;
        const period = status.period || 0;
        const completed = status.type?.completed === true;

        liveData[game.id] = {
          homeScore: homeComp.score ?? "—",
          awayScore: awayComp.score ?? "—",
          completed,
          inProgress: !completed && period > 0,
          period,
          clock: status.displayClock || "",
          shortDetail: status.type?.shortDetail || "",
          downDistance:
            sit?.downDistanceText || sit?.shortDownDistanceText || "",
          isRedZone: sit?.isRedZone || false,
          possession:
            possId === homeComp.id
              ? "home"
              : possId === awayComp.id
              ? "away"
              : null,
        };
      }
    } catch (_) { /* non-fatal */ }
  }

  return liveData;
}

// Fetches the date range ESPN assigns to a regular-season week.
// Returns { from: "YYYY-MM-DD", to: "YYYY-MM-DD" } or null on failure.
async function fetchEspnWeekDates(year, week) {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
      `?seasontype=2&week=${week}&year=${year}&limit=200`
    );
    if (!res.ok) return null;
    const data = await res.json();
    // ESPN top-level week object has startDate / endDate
    if (data.week?.startDate && data.week?.endDate) {
      return {
        from: data.week.startDate.slice(0, 10),
        to:   data.week.endDate.slice(0, 10),
      };
    }
    // Fallback: derive from individual game dates
    const dates = (data.events || [])
      .map((e) => e.competitions?.[0]?.date?.slice(0, 10))
      .filter(Boolean)
      .sort();
    if (!dates.length) return null;
    return { from: dates[0], to: dates[dates.length - 1] };
  } catch {
    return null;
  }
}

// Fetch each team's first regular-season game kickoff date from ESPN.
// Returns a map: { "alabama": "2026-08-30T00:00:00Z", ... }
async function fetchFirstGameDates(year) {
  const teamDates = {};
  // Fetch weeks 0–2 to cover all early-season kickoffs
  for (const week of [0, 1, 2]) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
        `?seasontype=2&week=${week}&year=${year}&limit=200`
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const event of data.events || []) {
        const comp = event.competitions?.[0];
        if (!comp?.date) continue;
        const kickoffISO = comp.date; // full ISO string from ESPN
        for (const competitor of comp.competitors || []) {
          const name = competitor.team?.displayName;
          if (!name) continue;
          const key = name.toLowerCase();
          // Keep the earliest game date for each team
          if (!teamDates[key] || new Date(kickoffISO) < new Date(teamDates[key])) {
            teamDates[key] = kickoffISO;
          }
        }
      }
    } catch { /* non-fatal */ }
  }
  return teamDates;
}

function getDatesInRange(fromDateStr, toDateStr) {  const dates = [];
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
  const teams = {};    // lowerName -> { logo, color, altColor, rank, conference }
  const neutralGames = new Set(); // sorted "teamA__teamB" keys for neutral-site games
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
        // Neutral site: ESPN sets competition.neutralSite = true for bowl games,
        // CFP games, and neutral-site kickoff classic games
        const isNeutral = comp.neutralSite === true;
        // Game-level conference: only populated for same-conference matchups.
        // Cross-conference games have no group or a generic "FBS" group.
        const gameConf = comp.groups?.shortName || comp.groups?.name || "";
        const gameConfIsReal = gameConf &&
          !["fbs","ncaa","college football","fcs"].includes(gameConf.toLowerCase());

        const competitorNames = [];
        for (const competitor of comp.competitors || []) {
          const team = competitor.team;
          const name = team?.displayName;
          if (!name) continue;
          const key = name.toLowerCase();
          networks[key] = network;
          competitorNames.push(key);
          if (!teams[key]) {
            const rawRank = competitor.curatedRank?.current;
            const rank = rawRank != null && rawRank >= 1 && rawRank <= 25 ? rawRank : null;
            // Three-layer conference detection:
            // Do NOT use ESPN's team.conferenceId — the numeric IDs vary across
            // ESPN API endpoints and are unreliable (e.g. ESPN uses 18 for FBS
            // Independents in some responses, but 18 maps to MAC in others).
            // TEAM_CONF covers all ~130 FBS teams and is authoritative.
            const conference = TEAM_CONF[key]
              || (gameConfIsReal ? gameConf : "")
              || "";
            teams[key] = {
              logo: team.logo || "",
              color: team.color ? `#${team.color}` : "",
              altColor: team.alternateColor ? `#${team.alternateColor}` : "",
              abbreviation: team.abbreviation || "",
              rank,
              conference,
            };
          }
        }
        // Store neutral-site marker keyed by sorted team pair
        if (isNeutral && competitorNames.length === 2) {
          neutralGames.add(competitorNames.slice().sort().join("__"));
        }
      }
    } catch (_) {
      // Non-fatal — ESPN is unofficial and may not have all dates yet
    }
  }
  return { networks, teams, neutralGames };
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
    kickoffTime: "", kickoffISO: "", network: "", neutral: false,
    homeLogo: "", awayLogo: "", homeColor: "", awayColor: "",
  };
}

function GamesManager({ leagueMeta, weekCache, loadWeek, saveWeekGames, toggleLock, toggleShowPicksEarly, toggleHidePicksUntilKickoff, deleteWeek }) {
  const nextWeekNum = leagueMeta.weeks.length ? Math.max(...leagueMeta.weeks) + 1 : 1;
  const defaultYear = new Date().getFullYear();

  // ── core state ──────────────────────────────────────────────────────────
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [games, setGames] = useState([]);
  const [weekNumInput, setWeekNumInput] = useState(String(nextWeekNum));
  const [busy, setBusy] = useState(false);
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [confirmDeleteWeek, setConfirmDeleteWeek] = useState(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  // ── odds api ─────────────────────────────────────────────────────────────
  const [oddsOpen, setOddsOpen] = useState(false);
  const [oddsKeyInput, setOddsKeyInput] = useState("");
  const [oddsKeySaved, setOddsKeySaved] = useState(false);
  const [oddsKeyLoading, setOddsKeyLoading] = useState(true);
  const [oddsYear, setOddsYear] = useState(defaultYear);
  const [oddsWeek, setOddsWeek] = useState(nextWeekNum || 1);
  const [oddsShowCustomRange, setOddsShowCustomRange] = useState(false);
  const [oddsFrom, setOddsFrom] = useState(isoDateInput(new Date()));
  const [oddsTo, setOddsTo] = useState(isoDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [oddsBusy, setOddsBusy] = useState(false);
  const [oddsError, setOddsError] = useState(null);
  const [weekDatesFrom, setWeekDatesFrom] = useState("");
  const [weekDatesTo, setWeekDatesTo] = useState("");

  // ── import preview ────────────────────────────────────────────────────────
  const [importPreview, setImportPreview] = useState(null);
  const [importSelected, setImportSelected] = useState({});
  const [confirmingGames, setConfirmingGames] = useState(null);

  // ── responsive layout (import panel) ─────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" && window.innerWidth >= 768);
  const [expandedSections, setExpandedSections] = useState(new Set(["Top 25"]));
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const prevTotalRef = useRef(0);

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    if (importPreview) {
      setExpandedSections(new Set(["Top 25"]));
      setShowMobileSheet(false);
      setSearchQuery("");
    }
  }, [!!importPreview]);

  // Kickoff sort key
  const KICKOFF_DAY = { thu: 0, fri: 1, sat: 2, sun: 3, mon: 4, tue: 5, wed: 6 };
  function kickoffSortKey(t) {
    if (!t) return 9999;
    const lower = t.toLowerCase();
    const day  = lower.match(/^(mon|tue|wed|thu|fri|sat|sun)/);
    const time = lower.match(/(\d+):(\d+)\s*(am|pm)/);
    if (!day || !time) return 9999;
    let h = Number(time[1]);
    const m = Number(time[2]);
    if (time[3] === "pm" && h !== 12) h += 12;
    if (time[3] === "am" && h === 12) h = 0;
    return (KICKOFF_DAY[day[1]] ?? 9) * 10000 + h * 100 + m;
  }

  // Selected games list for the right panel (sorted by kickoff)
  const totalSelected = Object.values(importSelected).filter(Boolean).length;
  const selectedGamesList = importPreview
    ? importPreview
        .map((g, i) => ({ ...g, _idx: i }))
        .filter((g) => importSelected[g._idx])
        .sort((a, b) => {
          if (a.kickoffISO && b.kickoffISO) return new Date(a.kickoffISO) - new Date(b.kickoffISO);
          return kickoffSortKey(a.kickoffTime) - kickoffSortKey(b.kickoffTime);
        })
    : [];

  // Auto-open mobile sheet on first selection
  useEffect(() => {
    if (!isDesktop && prevTotalRef.current === 0 && totalSelected > 0) setShowMobileSheet(true);
    prevTotalRef.current = totalSelected;
  }, [totalSelected, isDesktop]);

  // ── week management ───────────────────────────────────────────────────────
  function startNew() {
    setSelectedWeek(null);
    setLoadedExisting(false);
    setGames([]);
    setWeekNumInput(String(nextWeekNum));
    setImportPreview(null);
    setImportSelected({});
    setConfirmingGames(null);
    setShowManualEntry(false);
  }

  function startEdit(w) {
    setLoadedExisting(false);
    setSelectedWeek(w);
    setImportPreview(null);
    setImportSelected({});
    setConfirmingGames(null);
    setShowManualEntry(false);
  }

  function updateGame(idx, patch) {
    setGames((prev) => prev.map((g, i) => {
      if (i !== idx) return g;
      const updated = { ...g, ...patch };
      if ("away" in patch && patch.away !== g.away) { updated.awayLogo = null; updated.awayColor = null; }
      if ("home" in patch && patch.home !== g.home) { updated.homeLogo = null; updated.homeColor = null; }
      return updated;
    }));
  }

  function addRow() { setGames((prev) => [...prev, emptyGame()]); }
  function removeRow(idx) { setGames((prev) => prev.filter((_, i) => i !== idx)); }

  function applyImportSelection() {
    const chosen = importPreview.filter((_, i) => importSelected[i]);
    if (!chosen.length) return;
    const sorted = [...chosen].sort((a, b) => kickoffSortKey(a.kickoffTime) - kickoffSortKey(b.kickoffTime));
    setConfirmingGames(sorted.map((g) => ({ ...g, id: newId(), spread: String(g.spread) })));
  }

  function handleConfirmGames() {
    if (!confirmingGames) return;
    setGames(confirmingGames);
    setImportPreview(null);
    setImportSelected({});
    setConfirmingGames(null);
  }

  // ── fetch from Odds API ───────────────────────────────────────────────────
  async function fetchOddsApiWeek() {
    setOddsError(null);
    setOddsBusy(true);
    try {
      const key = localStorage.getItem("cfbpool:odds-api-key") || oddsKeyInput.trim();
      if (!key) { setOddsError("Enter your Odds API key first."); return; }

      let from = oddsFrom, to = oddsTo;
      if (!oddsShowCustomRange) {
        const espnDates = await fetchEspnWeekDates(oddsYear, oddsWeek);
        if (!espnDates) {
          setOddsError(`Couldn't find ESPN dates for ${oddsYear} Week ${oddsWeek}. Try the custom date range option.`);
          return;
        }
        from = espnDates.from; to = espnDates.to;
      }

      const params = new URLSearchParams({ apiKey: key, regions: "us", markets: "spreads", oddsFormat: "american" });
      if (from) params.set("commenceTimeFrom", `${from}T00:00:00Z`);
      if (to)   params.set("commenceTimeTo",   `${to}T23:59:59Z`);
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds?${params}`);
      if (!res.ok) { setOddsError(`Odds API error ${res.status} — check your key and try again.`); return; }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) { setOddsError("No games found for this date range."); return; }

      const { networks: espnNetworks, teams: espnTeams, neutralGames } = await fetchEspnGameMetadata(from, to)
        .catch(() => ({ networks: {}, teams: {}, neutralGames: new Set() }));

      const enriched = [];
      for (const ev of data) {
        const spreadsMarket = ev.bookmakers?.[0]?.markets?.find((m) => m.key === "spreads");
        if (!spreadsMarket) continue;
        const home = ev.home_team, away = ev.away_team;
        const homeOut = spreadsMarket.outcomes?.find((o) => o.name === home);
        const awayOut = spreadsMarket.outcomes?.find((o) => o.name === away);
        if (!homeOut || !awayOut) continue;
        const homePoint = homeOut.point;
        const homeKey = home.toLowerCase(), awayKey = away.toLowerCase();
        const ht = espnTeams[homeKey] || {}, at = espnTeams[awayKey] || {};
        const homeConf = ht.conference || "", awayConf = at.conference || "";
        enriched.push({
          away, home,
          favorite: homePoint < 0 ? "home" : "away",
          spread: Math.abs(homePoint),
          kickoffTime: toCST(ev.commence_time),
          kickoffISO: ev.commence_time || "",
          network: espnNetworks[homeKey] || espnNetworks[awayKey] || "",
          homeLogo: ht.logo || "", awayLogo: at.logo || "",
          homeColor: ht.color || "", awayColor: at.color || "",
          homeAbbr: ht.abbreviation || teamAbbrev(home),
          awayAbbr: at.abbreviation || teamAbbrev(away),
          conference: homeConf === awayConf ? homeConf : (homeConf || awayConf || ""),
          homeConf, awayConf,
          homeRank: ht.rank || null, awayRank: at.rank || null,
          neutral: neutralGames.has([homeKey, awayKey].sort().join("__")),
        });
      }

      setWeekDatesFrom(from); setWeekDatesTo(to);
      setImportPreview(enriched);
      setImportSelected({});
    } catch (e) {
      setOddsError(`Error: ${e?.message || "Unknown error"}`);
    } finally {
      setOddsBusy(false);
    }
  }

  // ── import preview panel (inline to access state via closure) ─────────────
  function ImportPreviewPanel() {
    const CONF_ORDER = ["SEC","Big Ten","Big 12","ACC","Mountain West","Sun Belt","American","MAC","C-USA","Independents"];
    const NOT_A_CONF_SET = new Set(["FBS","NCAA","College Football","FCS",""]);
    const indexed = importPreview.map((g, i) => ({ ...g, _idx: i }));
    const totalGames = indexed.length;

    const top25 = indexed.filter((g) => g.awayRank || g.homeRank)
      .sort((a, b) => Math.min(a.awayRank||99,a.homeRank||99) - Math.min(b.awayRank||99,b.homeRank||99));

    const confBuckets = {};
    indexed.forEach((g) => {
      const confs = new Set();
      if (g.homeConf && !NOT_A_CONF_SET.has(g.homeConf)) confs.add(g.homeConf);
      if (g.awayConf && !NOT_A_CONF_SET.has(g.awayConf)) confs.add(g.awayConf);
      if (!confs.size) confs.add("Other");
      confs.forEach((c) => { if (!confBuckets[c]) confBuckets[c] = []; confBuckets[c].push(g); });
    });
    const confSorted = Object.keys(confBuckets).sort((a, b) => {
      const ai = CONF_ORDER.indexOf(a), bi = CONF_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      if (a === "Other") return 1; if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    const sections = [...(top25.length ? [{ label: "Top 25", games: top25 }] : []), ...confSorted.map((c) => ({ label: c, games: confBuckets[c] }))];

    // search
    const q = searchQuery.toLowerCase().trim();
    const visibleSections = sections.map((s) => ({
      ...s, games: q ? s.games.filter((g) => g.away.toLowerCase().includes(q) || g.home.toLowerCase().includes(q)) : s.games,
    })).filter((s) => s.games.length > 0);

    // search input is rendered outside SectionList to prevent focus loss
    const searchInput = (
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.muted, pointerEvents: "none" }} />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search teams…"
          style={{ width: "100%", paddingLeft: 30, paddingRight: searchQuery ? 28 : 8, paddingTop: 7, paddingBottom: 7, background: COLORS.fieldDeep, border: `1px solid ${searchQuery ? COLORS.goldBright : COLORS.lineStrong}`, color: COLORS.chalk, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }} />
        {searchQuery && <button onClick={() => setSearchQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: COLORS.muted, fontSize: "1rem", lineHeight: 1 }}>×</button>}
      </div>
    );

    function SectionGameRow({ g }) {
      const checked = !!importSelected[g._idx];
      const favAbbr = g.favorite === "home" ? (g.homeAbbr || teamAbbrev(g.home)) : (g.awayAbbr || teamAbbrev(g.away));
      return (
        <label className="flex items-start gap-2 px-2 py-2.5 cfb-mono cursor-pointer"
          style={{ background: checked ? "rgba(217,164,65,0.1)" : COLORS.fieldDeep, border: `1px solid ${checked ? COLORS.lineStrong : COLORS.line}` }}>
          <input type="checkbox" checked={checked} onChange={() => setImportSelected((s) => ({ ...s, [g._idx]: !s[g._idx] }))}
            style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: "0.78rem", color: COLORS.chalk, lineHeight: 1.4 }}>{g.awayRank ? <span style={{ color: COLORS.gold }}>#{g.awayRank} </span> : null}{g.away}</div>
                <div style={{ fontSize: "0.78rem", color: COLORS.chalk, lineHeight: 1.4 }}><span style={{ color: COLORS.muted }}>@ </span>{g.homeRank ? <span style={{ color: COLORS.gold }}>#{g.homeRank} </span> : null}{g.home}</div>
              </div>
              {g.spread ? <div style={{ textAlign: "right", paddingTop: 1, flexShrink: 0 }}><span style={{ fontSize: "0.65rem", color: COLORS.muted }}>{favAbbr} </span><span style={{ fontSize: "0.78rem", color: COLORS.goldBright, fontWeight: 700 }}>-{g.spread}</span></div> : null}
            </div>
            <div style={{ fontSize: "0.67rem", color: COLORS.muted, marginTop: 3 }}>{[g.kickoffTime, g.network].filter(Boolean).join(" · ")}{g.homeConf && g.awayConf && g.homeConf !== g.awayConf ? ` · ${g.awayConf} @ ${g.homeConf}` : ""}</div>
          </div>
        </label>
      );
    }

    function SelectedPanel({ onUse }) {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="cfb-mono text-xs font-bold uppercase px-3 py-2" style={{ color: COLORS.goldBright, borderBottom: `1px solid ${COLORS.line}` }}>
            {totalSelected > 0 ? `${totalSelected} selected · sorted by kickoff` : "no games selected yet"}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
            {selectedGamesList.length === 0 ? (
              <div className="cfb-mono text-xs text-center py-6" style={{ color: COLORS.muted }}>Check a game on the left</div>
            ) : selectedGamesList.map((g) => {
              const awayAbbr = g.awayAbbr || teamAbbrev(g.away);
              const homeAbbr = g.homeAbbr || teamAbbrev(g.home);
              const favAbbr = g.favorite === "home" ? homeAbbr : awayAbbr;
              return (
                <div key={g._idx} className="cfb-mono" style={{ background: COLORS.fieldMid, border: `1px solid ${COLORS.line}`, padding: "8px 10px", marginBottom: 4 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, lineHeight: 1.5 }}>{g.awayColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.awayColor, flexShrink: 0, display: "inline-block" }} />}<span style={{ fontSize: "0.78rem", fontWeight: 600, color: COLORS.chalk }}>{awayAbbr}</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, lineHeight: 1.5 }}><span style={{ fontSize: "0.62rem", color: COLORS.muted, width: 8, textAlign: "center" }}>@</span>{g.homeColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.homeColor, flexShrink: 0, display: "inline-block" }} />}<span style={{ fontSize: "0.78rem", fontWeight: 600, color: COLORS.chalk }}>{homeAbbr}</span></div>
                      {g.kickoffTime && <div style={{ fontSize: "0.62rem", color: COLORS.muted, marginTop: 2 }}>{g.kickoffTime}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      {g.spread ? <div><span style={{ fontSize: "0.6rem", color: COLORS.muted }}>{favAbbr} </span><span style={{ fontSize: "0.78rem", fontWeight: 700, color: COLORS.goldBright }}>-{g.spread}</span></div> : null}
                      <button onClick={() => setImportSelected((s) => ({ ...s, [g._idx]: false }))} style={{ color: COLORS.muted, fontSize: "0.9rem", lineHeight: 1 }}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 space-y-1.5" style={{ borderTop: `1px solid ${COLORS.line}` }}>
            {totalSelected > 0 && <button onClick={() => setImportSelected({})} className="cfb-mono text-xs w-full py-1.5" style={{ color: COLORS.muted, border: `1px solid ${COLORS.lineStrong}` }}>clear all</button>}
            <PrimaryButton full onClick={onUse} disabled={totalSelected === 0}>Use these {totalSelected} game{totalSelected === 1 ? "" : "s"}</PrimaryButton>
          </div>
        </div>
      );
    }

    function SectionList({ q: sq, visibleSecs }) {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { const s = {}; importPreview.forEach((_, i) => (s[i] = true)); setImportSelected(s); }} className="cfb-mono text-xs px-2 py-1" style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.goldBright }}>select all</button>
            <button onClick={() => setImportSelected({})} className="cfb-mono text-xs px-2 py-1" style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}>clear all</button>
            <span className="cfb-mono text-xs" style={{ color: COLORS.muted }}>{sq ? `${visibleSecs.reduce((n, s) => n + s.games.length, 0)} result${visibleSecs.reduce((n,s)=>n+s.games.length,0)===1?"":"s"}` : `${totalGames} available`}</span>
          </div>
          {sq && visibleSecs.length === 0 && <div className="cfb-mono text-xs text-center py-4" style={{ color: COLORS.muted }}>No games match "{sq}"</div>}
          {visibleSecs.map((section) => {
            const idxs = section.games.map((g) => g._idx);
            const sel = idxs.filter((i) => importSelected[i]).length;
            const allOn = sel === idxs.length;
            const expanded = sq ? true : expandedSections.has(section.label);
            return (
              <div key={section.label}>
                <div className="flex items-center justify-between px-2 py-1.5 mb-1 cursor-pointer"
                  style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.lineStrong}` }}
                  onClick={() => { if (sq) return; setExpandedSections((p) => { const n = new Set(p); n.has(section.label) ? n.delete(section.label) : n.add(section.label); return n; }); }}>
                  <span className="cfb-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: section.label === "Top 25" ? COLORS.goldBright : COLORS.chalkDim }}>
                    {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {section.label === "Top 25" ? "🏆 Top 25" : section.label}
                    <span className="font-normal" style={{ color: COLORS.muted }}>{sel}/{section.games.length}</span>
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); const p = {}; idxs.forEach((i) => (p[i] = !allOn)); setImportSelected((s) => ({ ...s, ...p })); }}
                    className="cfb-mono text-xs px-2 py-0.5" style={{ border: `1px solid ${COLORS.lineStrong}`, color: allOn ? COLORS.muted : COLORS.goldBright }}>
                    {allOn ? "deselect" : sel > 0 ? "select rest" : "select all"}
                  </button>
                </div>
                {expanded && <div className="space-y-1">{section.games.map((g) => <SectionGameRow key={g._idx} g={g} />)}</div>}
              </div>
            );
          })}
        </div>
      );
    }

    // Mobile: auto-open sheet on first selection
    const mobileSheet = showMobileSheet && (
      <>
        <div onClick={() => setShowMobileSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)" }} />
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 61, background: COLORS.fieldDark, borderTop: `1px solid ${COLORS.lineStrong}`, borderRadius: "14px 14px 0 0", maxHeight: "65vh", display: "flex", flexDirection: "column" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.lineStrong, margin: "10px auto 4px" }} />
          <div style={{ flex: 1, minHeight: 0 }}><SelectedPanel onUse={() => { setShowMobileSheet(false); applyImportSelection(); }} /></div>
        </div>
      </>
    );

    return (
      <>
        {mobileSheet}
        {isDesktop ? (
          <div style={{ display: "flex", height: "calc(100vh - 380px)", minHeight: 380, maxHeight: 720, border: `1px solid ${COLORS.gold}`, background: "rgba(217,164,65,0.04)" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${COLORS.lineStrong}` }}>
              <div style={{ flexShrink: 0, padding: "10px 12px", borderBottom: `1px solid ${COLORS.line}` }}>{searchInput}</div>
              <div style={{ flex: 1, overflowY: "auto", padding: 12 }}><SectionList q={q} visibleSecs={visibleSections} /></div>
            </div>
            <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <SelectedPanel onUse={applyImportSelection} />
            </div>
          </div>
        ) : (
          <>
            <div style={{ border: `1px solid ${COLORS.gold}`, background: "rgba(217,164,65,0.06)", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span className="cfb-mono text-sm font-bold" style={{ color: totalSelected > 0 ? COLORS.goldBright : COLORS.chalkDim }}>{totalSelected} <span className="font-normal text-xs" style={{ color: COLORS.chalkDim }}>/ {totalGames} selected</span></span>
              {totalSelected > 0 && <button onClick={() => setShowMobileSheet(true)} className="cfb-mono text-xs px-3 py-1.5 font-bold" style={{ background: COLORS.gold, color: COLORS.ink, borderRadius: 3 }}>Review ({totalSelected}) →</button>}
            </div>
            <div style={{ border: `1px solid ${COLORS.gold}`, background: "rgba(217,164,65,0.04)", padding: 12 }}>
              {searchInput}
              <SectionList q={q} visibleSecs={visibleSections} />
            </div>
          </>
        )}
      </>
    );
  }

  // ── odds api load key on mount ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const saved = await safeGet("odds-api-key", false);
      if (saved) { setOddsKeyInput(saved); setOddsKeySaved(true); }
      setOddsKeyLoading(false);
    })();
  }, []);

  // ── validation ────────────────────────────────────────────────────────────
  const valid = weekNumInput.trim() && !isNaN(Number(weekNumInput)) && games.length > 0 &&
    games.every((g) => g.away.trim() && g.home.trim() && g.spread !== "" && !isNaN(Number(g.spread)));

  const currentWeekData = selectedWeek != null ? weekCache[selectedWeek] : null;

  useEffect(() => {
    if (selectedWeek == null || loadedExisting) return;
    const cached = weekCache[selectedWeek];
    if (cached) {
      setGames(cached.games || []);
      setWeekNumInput(String(selectedWeek));
      setWeekDatesFrom(cached.weekDates?.from || "");
      setWeekDatesTo(cached.weekDates?.to || "");
      setLoadedExisting(true);
    } else {
      loadWeek(selectedWeek, false);
    }
  }, [selectedWeek, weekCache, loadedExisting, loadWeek]);


  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Confirmation modal */}
      {confirmingGames && (
        <>
          <div onClick={() => setConfirmingGames(null)}
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.65)" }} />
          <div style={{
            position: "fixed", zIndex: 201, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            width: "min(92vw, 680px)", maxHeight: "80vh",
            background: COLORS.fieldDark, border: `1px solid ${COLORS.lineStrong}`,
            display: "flex", flexDirection: "column", borderRadius: 4,
          }}>
            <div className="cfb-mono flex items-center justify-between px-5 py-4"
              style={{ borderBottom: `1px solid ${COLORS.line}`, flexShrink: 0 }}>
              <div>
                <div className="font-bold uppercase tracking-wider" style={{ color: COLORS.goldBright, fontSize: "0.85rem" }}>
                  Week {weekNumInput} — {confirmingGames.length} game{confirmingGames.length === 1 ? "" : "s"}
                </div>
                <div style={{ fontSize: "0.7rem", color: COLORS.muted, marginTop: 2 }}>Review before adding to the pool</div>
              </div>
              <button onClick={() => setConfirmingGames(null)} style={{ color: COLORS.muted, fontSize: "1.2rem", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                {confirmingGames.map((g, idx) => {
                  const awayAbbr = g.awayAbbr || teamAbbrev(g.away);
                  const homeAbbr = g.homeAbbr || teamAbbrev(g.home);
                  const favAbbr  = g.favorite === "home" ? homeAbbr : awayAbbr;
                  return (
                    <div key={idx} className="cfb-mono"
                      style={{ border: `1px solid ${COLORS.line}`, background: COLORS.fieldDeep, padding: "10px 12px", borderRadius: 3 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, lineHeight: 1.5 }}>
                            {g.awayColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.awayColor, flexShrink: 0, display: "inline-block" }} />}
                            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: COLORS.chalk }}>{awayAbbr}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, lineHeight: 1.5 }}>
                            <span style={{ fontSize: "0.62rem", color: COLORS.muted, width: 8, textAlign: "center" }}>@</span>
                            {g.homeColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.homeColor, flexShrink: 0, display: "inline-block" }} />}
                            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: COLORS.chalk }}>{homeAbbr}</span>
                          </div>
                          <div style={{ fontSize: "0.62rem", color: COLORS.muted, marginTop: 3 }}>
                            {[g.kickoffTime, g.network].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {g.spread && (
                          <div style={{ textAlign: "right", paddingTop: 2 }}>
                            <span style={{ fontSize: "0.62rem", color: COLORS.muted }}>{favAbbr} </span>
                            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: COLORS.goldBright }}>-{g.spread}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-4 gap-3"
              style={{ borderTop: `1px solid ${COLORS.line}`, flexShrink: 0 }}>
              <button onClick={() => setConfirmingGames(null)}
                className="cfb-mono cfb-btn text-sm px-4 py-2.5 flex items-center gap-1.5"
                style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.chalkDim }}>
                <ChevronLeft size={14} /> Back to selection
              </button>
              <PrimaryButton onClick={handleConfirmGames}>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Confirm — add to Week {weekNumInput}
                </span>
              </PrimaryButton>
            </div>
          </div>
        </>
      )}

    <div className="space-y-4">
      {/* ── Week navigation ── */}
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={startNew} disabled={selectedWeek === null}>
          <span className="flex items-center gap-1"><Plus size={12} /> new week</span>
        </SecondaryButton>
        {leagueMeta.weeks.slice().sort((a, b) => b - a).map((w) => (
          <div key={w} className="flex items-center gap-1">
            <SecondaryButton onClick={() => startEdit(w)} disabled={selectedWeek === w}>
              edit wk {w}
            </SecondaryButton>
            {confirmDeleteWeek === w ? (
              <>
                <button onClick={async () => { setConfirmDeleteWeek(null); if (selectedWeek === w) { setSelectedWeek(null); setLoadedExisting(false); } await deleteWeek(w); }}
                  className="cfb-mono cfb-btn text-xs font-bold px-2.5 py-2"
                  style={{ background: "rgba(179,55,42,0.2)", border: `1px solid ${COLORS.red}`, color: COLORS.redBright }}>yes, delete</button>
                <button onClick={() => setConfirmDeleteWeek(null)}
                  className="cfb-mono cfb-btn text-xs px-2.5 py-2"
                  style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}>cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmDeleteWeek(w)} style={{ color: COLORS.muted }}><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>

      {/* ── Week number ── */}
      <div>
        <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>Week number</div>
        <FieldInput type="number" value={weekNumInput} onChange={setWeekNumInput} placeholder="e.g. 1" />
      </div>

      {/* ── Lock / picks visibility (edit mode only) ── */}
      {selectedWeek != null && currentWeekData && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => toggleLock(selectedWeek)}
            className="cfb-mono cfb-btn text-xs font-semibold px-3 py-2 flex items-center gap-1.5"
            style={{ background: currentWeekData.locked ? "rgba(217,164,65,0.16)" : "transparent", border: `1px solid ${currentWeekData.locked ? COLORS.gold : COLORS.lineStrong}`, color: currentWeekData.locked ? COLORS.goldBright : COLORS.chalkDim }}>
            {currentWeekData.locked ? <><Lock size={12} /> locked — click to open</> : <><Unlock size={12} /> open — click to lock</>}
          </button>
          <button onClick={() => toggleHidePicksUntilKickoff(selectedWeek)}
            className="cfb-mono cfb-btn text-xs font-semibold px-3 py-2 flex items-center gap-1"
            style={{ background: currentWeekData.hidePicksUntilKickoff ? "rgba(217,164,65,0.16)" : "transparent", border: `1px solid ${currentWeekData.hidePicksUntilKickoff ? COLORS.gold : COLORS.lineStrong}`, color: currentWeekData.hidePicksUntilKickoff ? COLORS.goldBright : COLORS.chalkDim }}>
            <Eye size={12} />
            {currentWeekData.hidePicksUntilKickoff ? "picks hidden until kickoff — click to make visible" : "picks visible — click to hide until kickoff"}
          </button>
        </div>
      )}

      {/* ── Pull from Odds API ── */}
      <div className="px-3 py-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <button onClick={() => setOddsOpen((o) => !o)}
          className="cfb-mono text-xs uppercase tracking-wider flex items-center gap-1.5 w-full"
          style={{ color: COLORS.goldBright }}>
          <TrendingUp size={13} /> Pull from The Odds API
          <span className="flex-1" />
          {oddsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {oddsOpen && (
          <div className="mt-3 space-y-3">
            {/* API key */}
            {oddsKeyLoading ? (
              <Spinner label="Loading saved key..." />
            ) : oddsKeySaved ? (
              <div className="flex items-center justify-between">
                <span className="cfb-mono text-xs" style={{ color: COLORS.chalkDim }}>API key saved on this device</span>
                <button onClick={async () => { await storage.delete("odds-api-key", false).catch(() => null); setOddsKeyInput(""); setOddsKeySaved(false); }}
                  className="cfb-mono text-xs" style={{ color: COLORS.muted }}>clear</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: COLORS.chalkDim }}>
                  Paste your The Odds API key. It's saved only on this device, never shared.
                </div>
                <div className="flex gap-2">
                  <FieldInput type="password" value={oddsKeyInput} onChange={setOddsKeyInput} placeholder="Paste key" />
                  <PrimaryButton disabled={!oddsKeyInput.trim()} onClick={async () => { await storage.set("odds-api-key", oddsKeyInput.trim(), false).catch(() => null); setOddsKeySaved(true); }}>Save</PrimaryButton>
                </div>
              </div>
            )}

            {/* Year + week picker */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>year</div>
                <select value={oddsYear} onChange={(e) => setOddsYear(Number(e.target.value))}
                  style={{ width: "100%", background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}`, padding: "8px", fontSize: "0.85rem", fontFamily: "var(--font-mono)" }}>
                  {[defaultYear - 1, defaultYear, defaultYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <div className="cfb-mono text-xs uppercase mb-1" style={{ color: COLORS.chalkDim }}>week</div>
                <select value={oddsWeek} onChange={(e) => setOddsWeek(Number(e.target.value))}
                  style={{ width: "100%", background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}`, padding: "8px", fontSize: "0.85rem", fontFamily: "var(--font-mono)" }}>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
                </select>
              </div>
            </div>

            {/* Custom date range (bowls) */}
            <button onClick={() => setOddsShowCustomRange((v) => !v)}
              className="cfb-mono text-xs flex items-center gap-1" style={{ color: COLORS.muted }}>
              {oddsShowCustomRange ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {oddsShowCustomRange ? "hide custom date range" : "use custom date range instead (bowls / playoffs)"}
            </button>
            {oddsShowCustomRange && (
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
            )}

            {oddsError && <Banner onDismiss={() => setOddsError(null)}>{oddsError}</Banner>}
            <PrimaryButton full onClick={fetchOddsApiWeek} disabled={oddsBusy}>
              {oddsBusy ? "Fetching…" : oddsShowCustomRange ? "Fetch games in this range" : `Fetch ${oddsYear} Week ${oddsWeek} games`}
            </PrimaryButton>
          </div>
        )}
      </div>

      {/* ── Import preview ── */}
      {importPreview && ImportPreviewPanel()}

      {/* ── Manual entry (de-emphasized secondary option) ── */}
      <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 12 }}>
        {!showManualEntry ? (
          <button onClick={() => { setShowManualEntry(true); if (games.length === 0) addRow(); }}
            className="cfb-mono text-xs flex items-center gap-1.5 w-full justify-center py-1"
            style={{ color: COLORS.muted }}>
            <Plus size={11} /> Enter games manually
          </button>
        ) : (
          <div className="space-y-2">
            <div className="cfb-mono text-xs uppercase" style={{ color: COLORS.muted, letterSpacing: "0.07em" }}>
              Manual entry
            </div>
            {games.map((g, idx) => (
              <div key={g.id} className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="cfb-mono text-xs" style={{ color: COLORS.muted }}>game {String(idx + 1).padStart(2, "0")}</span>
                  {games.length > 1 && <button onClick={() => removeRow(idx)} style={{ color: COLORS.muted }}><Trash2 size={14} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <FieldInput value={g.away} onChange={(v) => updateGame(idx, { away: v })} placeholder="Away team" />
                  <FieldInput value={g.home} onChange={(v) => updateGame(idx, { home: v })} placeholder="Home team" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 grid grid-cols-2 gap-1">
                    <button onClick={() => updateGame(idx, { favorite: "away" })} className="cfb-mono text-xs px-2 py-2"
                      style={{ background: g.favorite === "away" ? COLORS.gold : "transparent", color: g.favorite === "away" ? COLORS.ink : COLORS.chalkDim, border: `1px solid ${COLORS.lineStrong}` }}>
                      fav: {g.away || "away"}
                    </button>
                    <button onClick={() => updateGame(idx, { favorite: "home" })} className="cfb-mono text-xs px-2 py-2"
                      style={{ background: g.favorite === "home" ? COLORS.gold : "transparent", color: g.favorite === "home" ? COLORS.ink : COLORS.chalkDim, border: `1px solid ${COLORS.lineStrong}` }}>
                      fav: {g.home || "home"}
                    </button>
                  </div>
                  <div style={{ width: 84, flexShrink: 0 }}>
                    <FieldInput type="number" value={g.spread} onChange={(v) => updateGame(idx, { spread: v })} placeholder="spread" />
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <FieldInput value={g.kickoffTime || ""} onChange={(v) => updateGame(idx, { kickoffTime: v })} placeholder="Kickoff (e.g. Sat 11:00 AM CT)" />
                  <button onClick={() => updateGame(idx, { neutral: !g.neutral })}
                    className="cfb-mono text-xs px-2.5 py-2 flex-shrink-0 flex items-center gap-1.5"
                    style={{ background: g.neutral ? "rgba(217,164,65,0.12)" : "transparent", border: `1px solid ${g.neutral ? COLORS.gold : COLORS.lineStrong}`, color: g.neutral ? COLORS.goldBright : COLORS.muted, whiteSpace: "nowrap" }}>
                    ⚑ {g.neutral ? "neutral" : "@ site"}
                  </button>
                </div>
                <div className="mt-1.5">
                  <FieldInput value={g.network || ""} onChange={(v) => updateGame(idx, { network: v })} placeholder="Network (e.g. ABC, ESPN)" />
                </div>
              </div>
            ))}
            <SecondaryButton onClick={addRow}>
              <span className="flex items-center gap-1"><Plus size={12} /> add game</span>
            </SecondaryButton>
          </div>
        )}
      </div>

      {/* ── Week dates (for auto-grading) ── */}
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

      {/* ── Sticky save button ── */}
      <div style={{ position: "sticky", bottom: 0, background: COLORS.fieldDark, borderTop: `1px solid ${COLORS.line}`, paddingTop: 12, paddingBottom: 16, marginTop: 8, zIndex: 10 }}>
        <PrimaryButton full disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            const wk = Number(weekNumInput);
            const cleanGames = games.map((g) => ({ ...g, spread: Number(g.spread) }));
            const weekDates = weekDatesFrom && weekDatesTo ? { from: weekDatesFrom, to: weekDatesTo } : null;
            const ok = await saveWeekGames(wk, cleanGames, currentWeekData?.locked || false, weekDates);
            setBusy(false);
            if (ok) setSelectedWeek(wk);
          }}>
          {busy ? "Saving..." : selectedWeek != null ? "Save changes" : "Create week"}
        </PrimaryButton>
      </div>
    </div>
    </>
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

function WinTotalsTab({ leagueMeta, selectedYear, setSelectedYear, board, loading, loadStage, onRetry, picksCache, myName, saveWinTotalsPicks, slugToName }) {
  const mySlug = slugify(myName);
  const [selections, setSelections] = useState({}); // slotKey -> {teamId, side}
  const [saving, setSaving] = useState(false);
  const [savingSlot, setSavingSlot] = useState(null);
  const [loadedExisting, setLoadedExisting] = useState(false);

  function updateSlot(slotKey, patch) {
    setSelections((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], ...patch } }));
  }

  // Auto-save as soon as team + side are both chosen — no button needed
  async function autoSaveSlot(slotKey, newSide) {
    const currentSel = selections[slotKey];
    if (!currentSel?.teamId) return; // team not yet chosen
    const merged = { ...selections, [slotKey]: { ...currentSel, side: newSide } };
    const picks = WT_SLOTS
      .filter((s) => merged[s.key]?.teamId && merged[s.key]?.side)
      .map((s) => ({ slotKey: s.key, teamId: merged[s.key].teamId, side: merged[s.key].side }));
    setSavingSlot(slotKey);
    await saveWinTotalsPicks(selectedYear, picks);
    setSavingSlot(null);
  }

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
  if (loading && !board) return <DiagnosticSpinner label="Loading win totals board..." stage={loadStage} onRetry={onRetry} />;
  if (!board) return <EmptyState title={`${selectedYear} board not found`} body="This board may have been removed." />;

  const teamsById = {};
  board.teams.forEach((t) => (teamsById[t.id] = t));

  const usedTeamIds = new Set(Object.values(selections).map((s) => s?.teamId).filter(Boolean));

  function updateSlot(slotKey, patch) {
    setSelections((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], ...patch } }));
  }

  // Partial picks allowed — validate only the slots the member has filled in
  const filledSlots = WT_SLOTS.filter((s) => selections[s.key]?.teamId && selections[s.key]?.side);
  const conferenceOk = WT_SLOTS.filter((s) => s.conference && selections[s.key]?.teamId).every((s) => {
    const sel = selections[s.key];
    if (!sel?.teamId) return true; // unfilled slots don't need validation
    const team = teamsById[sel.teamId];
    return team && normalizeConf(team.conference) === s.conference;
  });
  const noDuplicates = (() => {
    const ids = WT_SLOTS.map((s) => selections[s.key]?.teamId).filter(Boolean);
    return new Set(ids).size === ids.length;
  })();
  const canSubmit = filledSlots.length > 0 && conferenceOk && noDuplicates;

  const picksForYear = picksCache[selectedYear] || {};
  const submittedCount = Object.values(picksForYear).filter((v) => v && (v.picks || []).length > 0).length;

  const leaderboardRows = Object.values(picksForYear)
    .filter((p) => p?.name)
    .map((p) => {
      let winsGained = 0; // weighted by odds
      let losses = 0;     // full 1.0 per wrong pick
      let graded = 0;
      let pushes = 0;
      (p.picks || []).forEach((pick) => {
        const team = teamsById[pick.teamId];
        if (!team) return;
        const cover = winTotalCover(team);
        if (!cover) return;
        graded++;
        if (cover === "push") { pushes++; return; }
        if (pick.side === cover) winsGained += pickPayout(team, pick.side);
        else losses += 1;
      });
      const net = winsGained - losses;
      return { name: p.name, winsGained, losses, graded, pushes, net };
    })
    // Rank by net (wins gained − losses), tiebreak by fewer losses
    .sort((a, b) => (b.net - a.net) || (a.losses - b.losses));

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
          // Per-team lock: if the selected team's first game has kicked off, this slot is frozen
          const teamKickedOff = team?.firstGameISO && Date.now() >= new Date(team.firstGameISO).getTime();
          const disabled = board.locked || teamKickedOff;
          // Filter options: exclude teams whose first game has already kicked off (can't pick a team mid-season)
          const options = board.teams.filter(
            (t) =>
              (!slot.conference || normalizeConf(t.conference) === slot.conference) &&
              (!usedTeamIds.has(t.id) || t.id === sel.teamId) &&
              (!t.firstGameISO || Date.now() < new Date(t.firstGameISO).getTime() || t.id === sel.teamId)
          );
          return (
            <div key={slot.key} className="px-3 py-3" style={{ background: COLORS.fieldDeep, border: `1px solid ${COLORS.line}` }}>
              <div className="cfb-mono text-xs uppercase mb-2 flex items-center justify-between">
                <span style={{ color: COLORS.gold }}>
                  {slot.label}
                  {!slot.conference && " (any Power 4 team)"}
                </span>
                {savingSlot === slot.key ? (
                  <span className="flex items-center gap-1" style={{ color: COLORS.muted, textTransform: "none" }}>
                    <RefreshCw size={10} className="animate-spin" /> saving…
                  </span>
                ) : teamKickedOff ? (
                  <span className="flex items-center gap-1" style={{ color: COLORS.muted, textTransform: "none" }}>
                    <Lock size={10} /> locked — season started
                  </span>
                ) : null}
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
                    {(t.overOdds != null && t.overOdds !== "") || (t.underOdds != null && t.underOdds !== "") ? (
                      <span style={{ color: COLORS.muted }}> · O {formatOdds(t.overOdds)} / U {formatOdds(t.underOdds)}</span>
                    ) : null}
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
                    const sideOdds = side === "over" ? team.overOdds : team.underOdds;
                    const payout = pickPayout(team, side);
                    return (
                      <button
                        key={side}
                        disabled={disabled || savingSlot === slot.key}
                        onClick={() => {
                          updateSlot(slot.key, { side });
                          autoSaveSlot(slot.key, side);
                        }}
                        className="cfb-btn px-2.5 py-2 font-semibold capitalize"
                        style={{ background: bg, border: `1px solid ${borderColor}`, color: textColor, cursor: disabled ? "default" : "pointer", textAlign: "left" }}
                      >
                        <div className="text-sm">{side} {team.line}</div>
                        <div className="cfb-mono" style={{ fontSize: "0.62rem", opacity: 0.8, marginTop: 1 }}>
                          {formatOdds(sideOdds)} · +{payout.toFixed(2)} win{payout === 1 ? "" : "s"}
                        </div>
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

      {/* Everyone's picks — always visible */}
      <WinTotalsGrid leagueMeta={leagueMeta} board={board} picksCache={picksForYear} slugToName={slugToName} />

      {/* Leaderboard — always visible */}
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
                    <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>wins</th>
                    <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>losses</th>
                    <th className="text-right px-3 py-2" style={{ color: COLORS.chalkDim }}>net</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.map((r, i) => (
                    <tr key={r.name} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                      <td className="px-3 py-2" style={{ color: i === 0 ? COLORS.gold : COLORS.muted }}>
                        {i === 0 && r.graded > 0 ? <Trophy size={14} /> : i + 1}
                      </td>
                      <td className="px-3 py-2 font-semibold" style={{ color: COLORS.chalk }}>{r.name}</td>
                      <td className="px-3 py-2 text-right" style={{ color: COLORS.goldBright }}>{r.winsGained.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: COLORS.redBright }}>{r.losses}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: r.net >= 0 ? COLORS.goldBright : COLORS.redBright }}>
                        {r.net >= 0 ? "+" : ""}{r.net.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                  let color = COLORS.chalkDim;
                  let cover = null;
                  if (team) {
                    cover = winTotalCover(team);
                    if (cover === "push") color = COLORS.muted;
                    else if (cover) color = pick.side === cover ? COLORS.goldBright : COLORS.redBright;
                  }
                  return (
                    <td key={m} className="px-2 py-1.5 whitespace-nowrap" style={{ color }}>
                      {team ? (
                        <>
                          <div>{team.school} {pick.side} {team.line}</div>
                          <div style={{ fontSize: "0.6rem", color: COLORS.muted, marginTop: 1 }}>
                            {cover && cover !== "push"
                              ? (pick.side === cover
                                  ? `+${pickPayout(team, pick.side).toFixed(2)} ✓`
                                  : `−1.00 ✕`)
                              : cover === "push"
                              ? "push · 0"
                              : `+${pickPayout(team, pick.side).toFixed(2)} if hit`}
                          </div>
                        </>
                      ) : "—"}
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
      setTeams(winTotalsCache[selectedYear].teams.map((t) => ({ ...t, line: String(t.line), overOdds: t.overOdds != null ? String(t.overOdds) : "", underOdds: t.underOdds != null ? String(t.underOdds) : "" })));
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
        return {
          id: existingId || newId(),
          school: String(t.school),
          conference: conf,
          line: String(t.line),
          overOdds: t.overOdds != null ? String(t.overOdds) : "",
          underOdds: t.underOdds != null ? String(t.underOdds) : "",
        };
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
              placeholder='[{"school":"Ohio State","conference":"Big Ten","line":9.5,"overOdds":-120,"underOdds":100}, {"school":"SMU","conference":"ACC","line":8.5,"overOdds":-140,"underOdds":114}]'
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
          const cleanTeams = teams.map((t) => ({ id: t.id, school: t.school.trim(), conference: t.conference, line: Number(t.line), overOdds: t.overOdds !== "" ? Number(t.overOdds) : null, underOdds: t.underOdds !== "" ? Number(t.underOdds) : null }));
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

function PlayoffTab({ leagueMeta, selectedYear, setSelectedYear, board, loading, loadStage, onRetry, picksCache, myName, savePlayoffPicks, slugToName }) {
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
  if (loading && !board) return <DiagnosticSpinner label="Loading playoff board..." stage={loadStage} onRetry={onRetry} />;
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
                {options.map((t) => {
                  const hasOdds = t.odds != null && t.odds !== "";
                  return (
                    <option key={t.id} value={t.id}>
                      {t.school}{hasOdds ? ` (${formatOdds(t.odds)})` : ""}
                    </option>
                  );
                })}
              </select>
              {team && team.madePlayoff == null && (
                <div className="cfb-mono text-xs mt-1.5" style={{ color: COLORS.goldBright }}>
                  {team.odds != null && team.odds !== ""
                    ? `${team.school} · ${formatOdds(team.odds)} to make it`
                    : `${team.school} · longshot`}
                </div>
              )}
              {team && team.madePlayoff != null && (
                <div className="cfb-mono text-xs mt-1.5" style={{ color: resultColor }}>
                  {team.madePlayoff ? "made the playoff ✓" : "did not make it ✕"}
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
      setTeams(playoffCache[selectedYear].teams.map((t) => ({ ...t, odds: t.odds == null ? "" : String(t.odds), tier: Number(t.tier) || 3 })));
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
      const cleaned = [];
      data.forEach((t, i) => {
        if (!t.school) {
          throw new Error(`Entry ${i + 1} is missing a school name.`);
        }
        // Odds are optional — many FBS teams have no published playoff odds
        const hasOdds = t.odds != null && t.odds !== "" && !isNaN(Number(t.odds));
        if (t.odds != null && t.odds !== "" && isNaN(Number(t.odds))) {
          throw new Error(`Entry ${i + 1} (${t.school}) has non-numeric odds.`);
        }
        const oddsStr = hasOdds ? String(Number(t.odds)) : "";
        const existingId = existingByName[normalizeTeam(t.school)];
        // Preserve existing tier if this team was already on the board.
        // New teams default to tier 3 (the last tier) — commissioner promotes
        // contenders up to tiers 1 and 2; everyone left stays a tier-3 longshot.
        const existingTeam = teams.find((et) => normalizeTeam(et.school) === normalizeTeam(t.school));
        const tier = [1, 2, 3].includes(Number(t.tier))
          ? Number(t.tier)
          : (existingTeam ? Number(existingTeam.tier) || 3 : 3);
        cleaned.push({ id: existingId || newId(), school: String(t.school), odds: oddsStr, tier });
      });
      setTeams(cleaned);
      setImportText("");
      setImportOpen(false);
    } catch (e) {
      setImportError(e.message);
    }
  }

  const currentBoard = selectedYear != null ? playoffCache[selectedYear] : null;
  const valid =
    yearInput.trim() &&
    !isNaN(Number(yearInput)) &&
    teams.length >= 7 &&
    teams.every((t) => t.school.trim() && (t.odds === "" || !isNaN(Number(t.odds))));

  const { tier1, tier2, tier3 } = computePlayoffTiers(
    teams.map((t) => ({ ...t, odds: t.odds === "" ? null : Number(t.odds) }))
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
              Paste the full team list. Odds are optional — include "to make the playoff" odds for contenders;
              longshots can be left without odds. Every team imports into Tier 3 by default. Assign tiers below —
              promote contenders to Tiers 1 and 2, and everyone left stays a Tier 3 longshot.
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              className="cfb-mono text-base sm:text-xs w-full p-2"
              style={{ background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}` }}
              placeholder='[{"school":"Notre Dame","odds":-800}, {"school":"Kent State"}]'
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
            <div style={{ width: 80, flexShrink: 0 }}>
              <FieldInput type="number" value={t.odds} onChange={(v) => updateTeam(idx, { odds: v })} placeholder="+odds" />
            </div>
            <div style={{ width: 76, flexShrink: 0 }}>
              <select
                value={t.tier}
                onChange={(e) => updateTeam(idx, { tier: Number(e.target.value) })}
                style={{ width: "100%", background: COLORS.fieldDeep, color: COLORS.chalk, border: `1px solid ${COLORS.lineStrong}`, padding: "8px 6px", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}
              >
                <option value={1}>Tier 1</option>
                <option value={2}>Tier 2</option>
                <option value={3}>Tier 3</option>
              </select>
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
            Tier assignment
          </div>
          <div><span style={{ color: COLORS.chalk }}>Tier 1</span> ({tier1.length}): {tier1.map((t) => t.school).join(", ") || "—"}</div>
          <div><span style={{ color: COLORS.chalk }}>Tier 2</span> ({tier2.length}): {tier2.map((t) => t.school).join(", ") || "—"}</div>
          <div><span style={{ color: COLORS.chalk }}>Tier 3</span> ({tier3.length}): {tier3.map((t) => t.school).join(", ") || "—"}</div>
          <div className="mt-1.5" style={{ color: COLORS.muted }}>
            Members pick 3 from Tier 1, 2 from Tier 2, 1 from Tier 3. Make sure each tier has enough teams.
          </div>
        </div>
      )}

      <PrimaryButton
        full
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          const yr = Number(yearInput);
          const cleanTeams = teams.map((t) => ({ id: t.id, school: t.school.trim(), odds: t.odds === "" ? null : Number(t.odds), tier: Number(t.tier) || 3 }));
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

function AdjustmentsManager({ leagueMeta, saveWeeklyAdjustments }) {
  const weeks = (leagueMeta.weeks || []).slice().sort((a, b) => b - a);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? null);
  const [inputs, setInputs] = useState({});  // slug → string
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load existing adjustments for the selected week
  useEffect(() => {
    if (selectedWeek == null) return;
    const existing = leagueMeta.weeklyAdjustments?.[selectedWeek] || {};
    const init = {};
    leagueMeta.members.forEach((m) => {
      const slug = slugify(m);
      init[slug] = existing[slug] != null ? String(existing[slug]) : "";
    });
    setInputs(init);
    setSaved(false);
  }, [selectedWeek, leagueMeta.weeklyAdjustments]);

  async function handleSave() {
    if (selectedWeek == null) return;
    setBusy(true);
    const parsed = {};
    Object.entries(inputs).forEach(([slug, val]) => {
      const n = parseFloat(val);
      if (!isNaN(n) && n !== 0) parsed[slug] = n;
    });
    const ok = await saveWeeklyAdjustments(selectedWeek, parsed);
    setBusy(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  if (weeks.length === 0) {
    return <EmptyState title="No weeks yet" body="Create a week first, then you can add adjustments." />;
  }

  return (
    <div className="space-y-4 cfb-fade-in">
      <div className="text-sm" style={{ color: COLORS.chalkDim }}>
        Override the computed weekly payout for any member. Enter a dollar amount — positive adds money, negative subtracts. Leave blank for no adjustment.
      </div>

      {/* Week selector */}
      <div className="flex flex-wrap gap-2">
        {weeks.map((w) => (
          <button
            key={w}
            onClick={() => setSelectedWeek(w)}
            className="cfb-mono cfb-btn text-xs font-bold px-3 py-2"
            style={{
              background: selectedWeek === w ? COLORS.gold : "transparent",
              color: selectedWeek === w ? COLORS.ink : COLORS.chalkDim,
              border: `1px solid ${selectedWeek === w ? COLORS.gold : COLORS.lineStrong}`,
            }}
          >
            Wk {w}
          </button>
        ))}
      </div>

      {selectedWeek != null && (
        <div className="space-y-2">
          {leagueMeta.members.map((name) => {
            const slug = slugify(name);
            const val = inputs[slug] ?? "";
            return (
              <div key={name} className="flex items-center gap-3 px-3 py-2.5"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.fieldMid }}
              >
                <span className="text-sm font-semibold flex-1" style={{ color: COLORS.chalk }}>{name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="cfb-mono text-sm" style={{ color: COLORS.chalkDim }}>$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={val}
                    placeholder="0.00"
                    onChange={(e) => setInputs((prev) => ({ ...prev, [slug]: e.target.value }))}
                    style={{
                      width: 90,
                      background: COLORS.fieldDeep,
                      border: `1px solid ${COLORS.lineStrong}`,
                      color: parseFloat(val) > 0 ? COLORS.goldBright : parseFloat(val) < 0 ? COLORS.redBright : COLORS.chalk,
                      padding: "6px 8px",
                      borderRadius: 3,
                      fontSize: "0.85rem",
                      fontFamily: "var(--font-mono)",
                      textAlign: "right",
                    }}
                  />
                </div>
              </div>
            );
          })}
          <PrimaryButton full onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : saved ? "✓ Saved" : "Save adjustments"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

function MembersManager({ leagueMeta, deleteMember, addMember, regenerateMemberToken }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmRegen, setConfirmRegen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [addErr, setAddErr] = useState(null);
  const [copiedSlug, setCopiedSlug] = useState(null);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (leagueMeta.members.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      setAddErr("Already in the pool.");
      return;
    }
    setBusy(true);
    await addMember(trimmed);
    setNewName("");
    setAddErr(null);
    setBusy(false);
  }

  function copyLink(name) {
    const slug = slugify(name);
    const token = leagueMeta.memberTokens?.[slug];
    if (!token) return;
    const url = inviteUrl(token);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  }

  return (
    <div className="space-y-4 cfb-fade-in">
      {/* Add member */}
      <div className="space-y-2">
        <div className="cfb-mono text-xs uppercase tracking-wider" style={{ color: COLORS.chalkDim }}>Add member</div>
        <div className="flex gap-2">
          <FieldInput value={newName} onChange={(v) => { setNewName(v); setAddErr(null); }} placeholder="Full name" />
          <PrimaryButton disabled={!newName.trim() || busy} onClick={handleAdd}>
            <Plus size={14} />
          </PrimaryButton>
        </div>
        {addErr && <div className="text-xs" style={{ color: COLORS.redBright }}>{addErr}</div>}
      </div>

      <div style={{ height: 1, background: COLORS.line }} />

      {/* Member list with invite links */}
      <div className="cfb-mono text-xs uppercase tracking-wider" style={{ color: COLORS.chalkDim }}>Invite links</div>
      <div className="text-xs" style={{ color: COLORS.muted }}>
        Each member gets a unique link. They tap it once on their device and they're in — no login needed after that. If you regenerate someone's link their old one stops working.
      </div>
      <div className="space-y-2">
        {leagueMeta.members.map((m) => {
          const slug = slugify(m);
          const token = leagueMeta.memberTokens?.[slug];
          const copied = copiedSlug === slug;
          return (
            <div key={m} style={{ border: `1px solid ${COLORS.line}`, background: COLORS.fieldMid }}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-semibold" style={{ color: COLORS.chalk }}>{m}</span>
                <div className="flex items-center gap-2">
                  {/* Copy link */}
                  <button
                    onClick={() => copyLink(m)}
                    disabled={!token}
                    className="cfb-mono cfb-btn text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                    style={{ border: `1px solid ${copied ? COLORS.gold : COLORS.lineStrong}`, color: copied ? COLORS.goldBright : COLORS.chalkDim }}
                  >
                    {copied ? "✓ copied" : "copy link"}
                  </button>
                  {/* Regenerate */}
                  {confirmRegen === m ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          await regenerateMemberToken(m);
                          setConfirmRegen(null);
                          setBusy(false);
                        }}
                        className="cfb-mono cfb-btn text-xs px-2 py-1.5"
                        style={{ background: "rgba(179,55,42,0.2)", border: `1px solid ${COLORS.red}`, color: COLORS.redBright }}
                      >
                        {busy ? "…" : "confirm"}
                      </button>
                      <button onClick={() => setConfirmRegen(null)}
                        className="cfb-mono cfb-btn text-xs px-2 py-1.5"
                        style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmRegen(m)}
                      className="cfb-mono cfb-btn text-xs px-2 py-1.5"
                      style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}
                      title="Regenerate invite link (invalidates old link)">
                      ↻
                    </button>
                  )}
                  {/* Remove */}
                  {confirmDelete === m ? (
                    <>
                      <button disabled={busy} onClick={async () => { setBusy(true); await deleteMember(m); setConfirmDelete(null); setBusy(false); }}
                        className="cfb-mono cfb-btn text-xs px-2 py-1.5 font-bold"
                        style={{ background: "rgba(179,55,42,0.2)", border: `1px solid ${COLORS.red}`, color: COLORS.redBright }}>
                        {busy ? "…" : "remove"}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="cfb-mono cfb-btn text-xs px-2 py-1.5"
                        style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}>cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(m)}
                      className="cfb-mono cfb-btn text-xs px-2 py-1.5"
                      style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.muted }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              {/* Invite URL preview */}
              {token && (
                <div className="px-3 pb-2.5 cfb-mono text-xs truncate" style={{ color: COLORS.muted }}>
                  {inviteUrl(token)}
                </div>
              )}
            </div>
          );
        })}
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
