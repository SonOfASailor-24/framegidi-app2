import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw, Lock, Eye, User, Plus, AlertTriangle, Clock, CheckCircle2,
  X, Zap, ArrowUp, Trash2, ChevronRight, Search
} from "lucide-react";

const APCS = ["Dare", "Ope", "Lambo", "Ayo", "Ebuka", "Ezekiel"];
const CONTACTS = ["Ghiazat", "Vincent", "Matthew", "QD"];
const POLL_MS = 5000;
const REWORK_CATEGORIES = ["Frame", "Canvas", "TBR", "Other"];
const REWORK_STATUSES = ["PENDING", "IN_PROGRESS", "DONE"];
const TRACK_MATERIALS = ["Frame", "Glass", "Mat Board", "Foam Board", "Hardboard", "Canvas", "Stretcher", "Bracing", "Other"];
const INSTALL_STATUSES = ["PENDING", "ASSIGNED", "ON_THE_WAY", "INSTALLING", "COMPLETED"];

const SIZES = ["10x12", "12x16", "16x20", "18x24", "20x28", "24x36", "34x46", "36x47.5", "36x48", "Other"];
const FRAME_RECOMMEND = {
  "10x12": "2022", "12x16": "2022", "16x20": "2022",
  "18x24": "2030", "20x28": "2030", "24x36": "2030",
  "34x46": "2030", "36x47.5": "2030", "36x48": "2030",
};
const COLOURS = [
  ["B", "Black"], ["W", "White"], ["DB", "Dark Brown"], ["MOB", "Mocha Brown"], ["LB", "Light Brown"],
  ["GD", "Gold"], ["RD", "Red"], ["SG", "Stain Gold"], ["GR", "Gray"], ["SL", "Silver"],
];
const FRAMING_STYLES = ["Normal Framing", "Double Glass", "Float Mounting", "Shadowbox", "Other"];
const MAT_COLOURS = ["White", "Cream", "Black", "Custom"];
const MATTING_STD = ["0.5\"", "1\"", "1.5\"", "2\"", "Custom"];
const CANVAS_QUALITY = ["HQ", "SQ"];
const CANVAS_STYLE = ["S+F", "SO", "Other"];
const STRETCHER = ["1727", "2030", "2035"];
const STRETCHER_LABELS = STRETCHER.map((s) => `${s} — ${s === "2030" ? "Slope" : "No slope"}`);
const TBR_CATEGORIES = ["Canvas", "Image", "Item", "Other"];
const DELAY_REASONS = ["Image/Print", "Material", "Frame", "Glass", "Mat Board", "Foam Board", "Hardboard", "Canvas", "Water Taping", "Other"];
const JOB_TYPES = ["Framed", "Canvas", "Item", "Other"];
const FRAMED_MATERIAL_OPTIONS = ["Frame", "Glass", "Mat Board", "Foam Board", "Hardboard", "Bracing"];
const CANVAS_MATERIAL_OPTIONS = ["Frame", "Stretcher", "Canvas", "Foam Board", "Hardboard", "Mat Board", "Glass", "Bracing"];
const TBR_MATERIAL_OPTIONS = ["Frame", "Glass", "Mat Board", "Foam Board", "Hardboard", "Bracing", "Stretcher", "Canvas", "Other"];

// ---------- inventory constants ----------
const INV_CATEGORIES = ["Frame", "Glass", "Mat Board", "Hardboard", "Foam Board", "Bracing", "Stretcher"];
const INV_SIZED_CATEGORIES = ["Frame", "Glass", "Mat Board", "Hardboard", "Foam Board"]; // categories that use the standard size grid
const INV_STANDARD_SIZES = ["10x12", "12x16", "16x20", "18x24", "20x28", "24x36", "34x46", "36x47.5", "36x48"];
const FULL_SHEET_MATERIALS = ["Glass", "Hardboard", "Foam Board", "Mat Board"];
const MOVEMENT_REASONS = ["Restock", "Production", "Manual Adjustment", "Job Cut"];
const HARDBOARD_ORIENTATION_SIZES = ["18x24", "20x28", "24x36"]; // per the original locked spec: these use hanging wire and need orientation tracked
const LAID_FOAM_MAT_TYPES = [["1in", "1\""], ["1_5in", "1.5\""], ["2in", "2\""]];
// Sizes that get the full Unmatted + 3 matted options. 36x48/36x47.5 are handled as a special pair below,
// per the locked rule: 36x48 unmatted = itself; 36x48 matted = recorded under 36x47.5 instead.
const LAID_FOAM_FULL_SIZES = INV_STANDARD_SIZES.filter((s) => s !== "36x48" && s !== "36x47.5");
function invItemId(category, kind, size) {
  const cat = category.replace(/\s+/g, "").toLowerCase();
  const sz = (size || "na").replace(/\s+/g, "").toLowerCase();
  return `${cat}_${kind}_${sz}`;
}

// ---------- storage layer (shared = true for all production data) ----------
async function safeGet(key) {
  try { const r = await window.storage.get(key, true); return r ? JSON.parse(r.value) : null; }
  catch (e) { console.error("storage.get failed", key, e); return null; }
}
async function safeSet(key, value, attempt = 0) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch (e) {
    // A genuine code/data bug — the object itself can't be serialized (e.g. circular ref).
    return { ok: false, reason: "serialize", detail: String(e?.message || e) };
  }
  try {
    if (typeof window === "undefined" || !window.storage) {
      return { ok: false, reason: "unavailable", detail: "Storage bridge not ready yet." };
    }
    await window.storage.set(key, json, true);
    return { ok: true };
  } catch (e) {
    if (attempt < 2) {
      // Transient bridge hiccups are common — back off and retry twice before giving up.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return safeSet(key, value, attempt + 1);
    }
    console.error("storage.set failed", key, e);
    return { ok: false, reason: "storage", detail: String(e?.message || e) };
  }
}
async function listKeys(prefix) {
  try { const r = await window.storage.list(prefix, true); return r?.keys || []; }
  catch (e) { console.error("storage.list failed", prefix, e); return []; }
}
async function listJobKeys() { return listKeys("job:"); }

// ---------- inventory storage (same shared window.storage, ledger-derived stock — no separate/fake store) ----------
async function loadRecords(prefix) {
  const keys = await listKeys(prefix);
  const results = (await Promise.all(keys.map(safeGet))).filter(Boolean);
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

async function loadReworks() {
  const keys = await listKeys("rework:");
  const results = (await Promise.all(keys.map(safeGet))).filter(Boolean);
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

async function loadInventory() {
  const itemKeys = await listKeys("inv:item:");
  const items = (await Promise.all(itemKeys.map(safeGet))).filter(Boolean);
  const moveKeys = await listKeys("stockmove:");
  const moves = (await Promise.all(moveKeys.map(safeGet))).filter(Boolean);
  const stockByItem = {};
  for (const m of moves) stockByItem[m.itemId] = (stockByItem[m.itemId] || 0) + m.qtyChange;
  return { items, moves, stockByItem };
}
async function ensureInventoryItem(itemId, meta) {
  const existing = await safeGet(`inv:item:${itemId}`);
  if (existing) return existing;
  const item = { id: itemId, unit: "pcs", threshold: 5, createdAt: Date.now(), ...meta };
  await safeSet(`inv:item:${itemId}`, item);
  return item;
}
async function recordMovement(itemId, qtyChange, reason, person, jobId, jobRef) {
  const ts = Date.now();
  const key = `stockmove:${itemId}:${ts}_${Math.random().toString(36).slice(2, 6)}`;
  return safeSet(key, { itemId, qtyChange, reason, person, timestamp: ts, jobId: jobId || null, jobRef: jobRef || null });
}
function stockStatus(stock, threshold) {
  if (stock <= 0) return "OUT";
  if (stock <= threshold) return "LOW";
  return "READY";
}
function newId(prefix) { return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }
function elapsed(ts, now = Date.now()) {
  if (!ts) return "—";
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function formatHMS(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function materialsFor(jobType) {
  if (jobType === "Framed") return ["Frame", "Glass", "Mat Board", "Foam Board", "Hardboard"];
  if (jobType === "Canvas") return ["Canvas", "Stretcher", "Frame / finishing materials"];
  return ["General materials as applicable"];
}
const STATUS_BADGE = {
  ACTIVE: { label: "In Production", cls: "bg-neutral-800 text-neutral-400" },
  READY_FOR_FULFILLMENT: { label: "Ready for Fulfillment", cls: "bg-amber-500/20 text-amber-400" },
  IN_FULFILLMENT: { label: "In Fulfillment", cls: "bg-blue-500/20 text-blue-400" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-500/20 text-emerald-400" },
};
const LARGE_SIZES = ["34x46", "36x47.5", "36x48"];
function requiredMaterials(job) {
  // Legacy fallback only — new jobs use each module's own explicit `materials` selection instead.
  const base = materialsFor(job.jobType || "Framed");
  const needsBracing = (job.jobType === "Framed") && job.sizeLines.some((l) => LARGE_SIZES.includes(l.size));
  return needsBracing ? [...base, "Bracing"] : base;
}
// Connects Materials Needed to real per-size-line inventory. Framed/Canvas/TBR are checked
// independently and never merged — each module owns its own explicit material selection, which
// the APC can add to or remove from (never auto-forced to "every material").
function materialsStatusForJob(job, stockByItem, items) {
  const results = [];
  const types = getJobTypes(job);
  const lookup = (category, size) => {
    const id = invItemId(category, "sized", size);
    const stock = stockByItem[id] || 0;
    const meta = items.find((i) => i.id === id);
    return stockStatus(stock, meta?.threshold ?? 5);
  };
  // Custom/random-size inventory answers AVAILABLE / INSUFFICIENT / unavailable — it never uses the
  // standard low-stock threshold system, since a small quantity (1, 2) is completely normal for a
  // one-off custom cut and must not be flagged as "LOW STOCK".
  const lookupCustom = (category, sizeLabel, neededQty = 1) => {
    const id = invItemId(category, "custom", sizeLabel);
    const meta = items.find((i) => i.id === id);
    if (!meta) return "REQUIRED"; // no matching custom stock recorded for this size yet
    const stock = stockByItem[id] || 0;
    if (stock <= 0) return "OUT";
    if (stock < neededQty) return "INSUFFICIENT";
    return "READY";
  };

  if (types.framed) {
    const selected = job.framed?.materials || requiredMaterials(job);
    const standardSizes = [...new Set(job.sizeLines.map((l) => (l.size === "Other" ? null : l.size)).filter(Boolean))];
    // Aggregate needed quantity per unique custom size across all lines, so sufficiency is checked
    // against the real total demand, not just "does any stock exist".
    const customQtyMap = {};
    job.sizeLines.filter((l) => l.size === "Other" && l.customSize.trim()).forEach((l) => {
      const key = l.customSize.trim();
      customQtyMap[key] = (customQtyMap[key] || 0) + (l.qty || 1);
    });
    for (const mat of selected) {
      if (mat === "Bracing") { results.push({ label: "Bracing [Framed]", status: lookup("Bracing", "na") }); continue; }
      for (const size of standardSizes) results.push({ label: `${mat} @ ${size} [Framed]`, status: lookup(mat, size) });
      for (const [size, qty] of Object.entries(customQtyMap)) {
        results.push({ label: `${mat} @ ${size} (custom) [Framed]`, status: lookupCustom(mat, size, qty) });
      }
    }
  }
  if (types.canvas) {
    const selected = job.canvas?.materials || ["Frame", "Stretcher"];
    const frameSize = job.canvas?.frameCutting?.size?.trim();
    const stretcherSize = job.canvas?.stretcherCutting?.size?.trim();
    const fallbackSize = frameSize || stretcherSize;
    for (const mat of selected) {
      if (mat === "Canvas") continue; // canvas fabric itself is no longer inventory-tracked
      if (mat === "Stretcher") {
        if (stretcherSize) results.push({ label: `Stretcher @ ${stretcherSize} (custom) [Canvas]`, status: lookupCustom("Stretcher", stretcherSize, job.canvas.stretcherCutting.qty || 1) });
        continue;
      }
      if (mat === "Frame") {
        if (frameSize) results.push({ label: `Frame @ ${frameSize} (custom) [Canvas]`, status: lookupCustom("Frame", frameSize, job.canvas.frameCutting.qty || 1) });
        continue;
      }
      if (fallbackSize) results.push({ label: `${mat} @ ${fallbackSize} (custom) [Canvas]`, status: lookupCustom(mat, fallbackSize) });
    }
  }
  if (types.tbr) {
    const tbrCats = getTbrCategories(job);
    const imageSize = tbrCats.includes("Image") ? job.tbr?.imageSub?.size?.trim() : null;
    const tbrFrameSize = tbrCats.includes("Canvas") ? job.tbr?.canvasSub?.frameCutting?.size?.trim() : null;
    const tbrStretcherSize = tbrCats.includes("Canvas") ? job.tbr?.canvasSub?.stretcherCutting?.size?.trim() : null;
    for (const mat of job.tbr?.materials || []) {
      if (mat === "Canvas") continue;
      if (imageSize) { results.push({ label: `${mat} @ ${imageSize} (custom) [TBR-Image]`, status: lookupCustom(mat, imageSize) }); continue; }
      if (mat === "Stretcher" && tbrStretcherSize) { results.push({ label: `Stretcher @ ${tbrStretcherSize} (custom) [TBR-Canvas]`, status: lookupCustom("Stretcher", tbrStretcherSize, job.tbr.canvasSub.stretcherCutting.qty || 1) }); continue; }
      if (mat === "Frame" && tbrFrameSize) { results.push({ label: `Frame @ ${tbrFrameSize} (custom) [TBR-Canvas]`, status: lookupCustom("Frame", tbrFrameSize, job.tbr.canvasSub.frameCutting.qty || 1) }); continue; }
      results.push({ label: `${mat} [TBR]`, status: lookup(mat, "na") });
    }
  }
  return results;
}

function bottleneckOf(job) {
  if (job.materials === "MISSING") return { label: "WAITING FOR MATERIAL", stage: "materials" };
  if (job.imageStatus === "WAITING") return { label: "WAITING FOR IMAGE", stage: "image" };
  if (job.assembly !== "DONE") return { label: job.assembly === "IN_PROGRESS" ? "ASSEMBLY IN PROGRESS" : "ASSEMBLY PENDING", stage: "assembly" };
  if (job.fulfillment.status === "PENDING") return { label: "FULFILLMENT", stage: "fulfillment" };
  if (job.fulfillment.status === "IN_FULFILLMENT") return { label: "FULFILLMENT — IN PROGRESS", stage: "fulfillment" };
  if (job.fulfillment.status === "WATER_TAPING") return { label: "WATER TAPING", stage: "fulfillment" };
  return { label: "COMPLETED", stage: "done" };
}
// Production completion (Materials/Image/Assembly) is NOT final completion — it only means the
// job is ready to move into Fulfillment. Water Taping is now an optional stage inside Fulfillment
// itself (PENDING → IN_FULFILLMENT → [WATER_TAPING] → COMPLETED), not a separate prerequisite gate.
function computeStatus(job) {
  const productionDone = job.materials === "READY" && job.imageStatus === "READY" && job.assembly === "DONE";
  if (!productionDone) return "ACTIVE";
  if (job.fulfillment.status === "COMPLETED") return "COMPLETED";
  if (job.fulfillment.status === "IN_FULFILLMENT" || job.fulfillment.status === "WATER_TAPING") return "IN_FULFILLMENT";
  return "READY_FOR_FULFILLMENT";
}

function defaultJob(apcName) {
  return {
    id: newId("job"),
    clientName: "",
    jobRef: "",
    quantity: 1,
    jobTypes: { framed: true, canvas: false, tbr: false }, // independently toggleable — not mutually exclusive
    sizeLines: [{ id: newId("sl"), size: "12x16", customSize: "", colours: [], frameType: "2022", frameTypeCustom: "", frameTypeTouched: false, qty: 1 }],
    framed: {
      paperType: "PLP", paperTypeCustom: "",
      framingStyles: ["Normal Framing"], framingStyleCustom: "", // multi-select now
      matColour: "White", matColourCustom: "",
      mattingStyle: "1\"", mattingCustom: "",
      materials: ["Frame", "Glass", "Mat Board", "Foam Board", "Hardboard"], // smart default, APC can add/remove
    },
    canvas: {
      quality: "HQ",
      size: "", qty: 1, // manual dimensions only — Canvas is not a standard/inventory size
      style: "S+F", styleCustom: "",
      stretcher: "1727",
      frameSpec: "", // open/free text — Canvas frame is not forced into the rigid Framed frame-type structure
      materials: ["Frame", "Stretcher"],
      stretcherCutting: { size: "", qty: 1 },
      frameCutting: { size: "", qty: 1 },
    },
    tbr: {
      active: false,
      categories: [], // multi-select: Canvas / Image / Item / Other — dynamic sub-sections per category
      kinds: { IN: false, ER: false }, // independent, both can be true at once
      materials: [], // TBR's own Materials Needed — never merged with Framed/Canvas
      canvasSub: { size: "", style: "S+F", styleCustom: "", stretcher: "1727", frameSpec: "", stretcherCutting: { size: "", qty: 1 }, frameCutting: { size: "", qty: 1 } },
      imageSub: { size: "", frameSpec: "" }, // manual dimensions + open frame spec — not a standard/inventory size
      itemSub: { description: "", size: "", frameSpec: "", notes: "" },
      otherSub: { notes: "" },
    },
    priority: "normal", // normal | high | express
    expressStartedAt: null,
    notes: "",
    materials: "MISSING",
    imageStatus: "READY",
    imageWaitingSince: null,
    imageRequests: [],
    delayed: { active: false, reason: "", customReason: "" },
    assembly: "NOT_STARTED",
    waterTaping: { status: "NOT_READY", doneAt: null, doneBy: null },
    fulfillment: { status: "PENDING", startedAt: null, startedBy: null, completedAt: null, completedBy: null },
    managementMessages: [], // distinct from Notes — appended by Management/QD, visible to APC on the job
    createdAt: Date.now(), createdBy: apcName,
    lastUpdatedBy: apcName, updatedAt: Date.now(),
  };
}

// ---- legacy-safe readers: any job saved before this change still renders without crashing ----
function getJobTypes(job) {
  return job.jobTypes || { framed: job.jobType !== "Canvas", canvas: job.jobType === "Canvas", tbr: !!job.tbr?.active };
}
function getTbrCategories(job) {
  return job.tbr?.categories || (job.tbr?.category ? [job.tbr.category] : []);
}
function getTbrKinds(job) {
  return job.tbr?.kinds || (job.tbr?.kind ? { [job.tbr.kind]: true } : { IN: false, ER: false });
}

export default function FrameGidiApp() {
  const [role, setRole] = useState(null);
  const [apcName, setApcName] = useState(APCS[0]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(Date.now());
  const [inventoryItems, setInventoryItems] = useState([]);
  const [stockByItem, setStockByItem] = useState({});
  const [inventoryMoves, setInventoryMoves] = useState([]);
  const [reworks, setReworks] = useState([]);
  const [cutRecords, setCutRecords] = useState([]);
  const [coupleRecords, setCoupleRecords] = useState([]);
  const [installRecords, setInstallRecords] = useState([]);
  const [activeModule, setActiveModule] = useState("production"); // production | tracking | installation
  const pollRef = useRef(null);
  const invPollRef = useRef(null);
  const reworkPollRef = useRef(null);
  const trackPollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  const loadJobs = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const keys = await listJobKeys();
      const results = await Promise.all(keys.map(safeGet));
      setJobs(results.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt));
      setLastSynced(Date.now());
    } catch { setError("Could not reach shared storage. Retrying on next sync."); }
    finally { setLoading(false); }
  }, []);

  const loadInv = useCallback(async () => {
    const { items, stockByItem: stock, moves } = await loadInventory();
    setInventoryItems(items);
    setStockByItem(stock);
    setInventoryMoves(moves);
  }, []);

  const loadReworkList = useCallback(async () => {
    setReworks(await loadReworks());
  }, []);

  const loadTracking = useCallback(async () => {
    setCutRecords(await loadRecords("cut:"));
    setCoupleRecords(await loadRecords("couple:"));
  }, []);

  const loadInstalls = useCallback(async () => {
    setInstallRecords(await loadRecords("install:"));
  }, []);

  useEffect(() => {
    if (!role) return;
    loadJobs(false);
    loadInv();
    loadReworkList();
    loadTracking();
    loadInstalls();
    pollRef.current = setInterval(() => loadJobs(true), POLL_MS);
    invPollRef.current = setInterval(loadInv, POLL_MS);
    reworkPollRef.current = setInterval(loadReworkList, POLL_MS);
    trackPollRef.current = setInterval(() => { loadTracking(); loadInstalls(); }, POLL_MS);
    return () => {
      clearInterval(pollRef.current); clearInterval(invPollRef.current);
      clearInterval(reworkPollRef.current); clearInterval(trackPollRef.current);
    };
  }, [role, loadJobs, loadInv, loadReworkList, loadTracking, loadInstalls]);

  function describePatch(patch, current, jobRef) {
    if (patch.assembly && patch.assembly !== current.assembly) {
      const map = { NOT_STARTED: "Not Started", IN_PROGRESS: "Assembly", DONE: "Assembly Done" };
      return `Updated ${jobRef} → ${map[patch.assembly] || patch.assembly}`;
    }
    if (patch.materials && patch.materials !== current.materials) {
      return `Updated ${jobRef} → Materials ${patch.materials}`;
    }
    if (patch.fulfillment && patch.fulfillment.status === "WATER_TAPING" && current.fulfillment.status !== "WATER_TAPING") {
      return `Updated ${jobRef} → Fulfillment: Water Taping`;
    }
    if (patch.delayed && patch.delayed.active && !current.delayed.active) {
      return `Flagged ${jobRef} blocked by ${patch.delayed.reason}`;
    }
    if (patch.delayed && patch.delayed.active === false && current.delayed.active) {
      return `Cleared blocker on ${jobRef}`;
    }
    if (patch.imageRequests && patch.imageRequests.length > current.imageRequests.length) {
      const last = patch.imageRequests[patch.imageRequests.length - 1];
      if (last.requestedBy === "HR" && last.note === "Acknowledged") {
        return `HR acknowledged image request for ${jobRef}`;
      }
      return `Requested print update on ${jobRef} from ${last.contact}`;
    }
    if (patch.imageStatus === "READY" && current.imageStatus === "WAITING") {
      return `Image marked ready for ${jobRef}`;
    }
    return null;
  }

  async function logActivity(action, job, actor = apcName) {
    const ts = Date.now();
    await safeSet(`activity:${ts}_${Math.random().toString(36).slice(2, 6)}`, {
      person: actor, timestamp: ts, jobId: job.id, jobRef: job.jobRef || job.clientName, action,
    });
  }

  async function saveJob(job, activityLabel, actor = apcName) {
    const oldStatus = job.status; // status as it was before this save, for transition detection below
    job.quantity = job.sizeLines.reduce((sum, l) => sum + (l.qty || 0), 0);
    job.status = computeStatus(job);
    job.updatedAt = Date.now();
    job.lastUpdatedBy = actor;
    const result = await safeSet(`job:${job.id}`, job);
    if (result.ok) {
      // Explicit label for the specific field that changed (assembly, blocker, image request, etc.)
      if (activityLabel) logActivity(activityLabel, job, actor);
      // Plus automatic logs for the higher-level stage transitions, never overlapping with the above.
      if (oldStatus !== "READY_FOR_FULFILLMENT" && job.status === "READY_FOR_FULFILLMENT") {
        logActivity(`${job.jobRef || job.clientName} → Ready for Fulfillment`, job, actor);
      }
      if (oldStatus !== "IN_FULFILLMENT" && job.status === "IN_FULFILLMENT") {
        logActivity("Fulfillment started", job, actor);
      }
      if (oldStatus !== "COMPLETED" && job.status === "COMPLETED") {
        logActivity(`Completed ${job.jobRef || job.clientName} → Completed`, job, actor);
      }
      loadJobs(true);
    } else {
      setError(
        result.reason === "unavailable"
          ? "Storage isn't ready yet — wait a moment and try Save again."
          : `Save failed (${result.reason}): ${result.detail}`
      );
    }
    return result.ok;
  }

  async function patchJob(jobId, patch, actor = apcName) {
    const current = await safeGet(`job:${jobId}`);
    if (!current) { setError("Job no longer exists — refreshing."); return loadJobs(true); }
    const updated = { ...current, ...patch };
    const jobRef = current.jobRef || current.clientName;
    const activityLabel = describePatch(patch, current, jobRef);

    // Image waiting streak: timer starts the instant status truly becomes WAITING,
    // not when a request is later logged. Ends (cleared) the instant it becomes READY.
    if (patch.imageStatus && patch.imageStatus !== current.imageStatus) {
      if (patch.imageStatus === "WAITING") updated.imageWaitingSince = Date.now();
      else if (patch.imageStatus === "READY") updated.imageWaitingSince = null;
    }

    // Express timer: only (re)start the instant priority actually transitions into "express".
    // Never touched by any other patch, so it can't be reset by unrelated re-renders/saves.
    if (patch.priority && patch.priority === "express" && current.priority !== "express") {
      updated.expressStartedAt = Date.now();
    }

    // Fulfillment: only stamp startedAt/completedAt on the real transition into that state,
    // never automatically and never from elapsed time.
    if (patch.fulfillment && patch.fulfillment.status !== current.fulfillment.status) {
      if (patch.fulfillment.status === "IN_FULFILLMENT") {
        updated.fulfillment = { ...updated.fulfillment, startedAt: Date.now(), startedBy: actor };
      } else if (patch.fulfillment.status === "COMPLETED") {
        updated.fulfillment = { ...updated.fulfillment, completedAt: Date.now(), completedBy: actor };
      }
    }

    await saveJob(updated, activityLabel);
  }

  // Post-creation edits (APC only): re-fetch current first so we never clobber a
  // concurrent production-state change (image request, assembly, water taping, delayed)
  // made by another APC while this one was editing the order's specs.
  async function saveJobEdits(jobId, formJob) {
    const current = await safeGet(`job:${jobId}`);
    if (!current) { setError("Job no longer exists — refreshing."); return loadJobs(true); }
    const merged = {
      ...current,
      clientName: formJob.clientName,
      jobRef: formJob.jobRef,
      jobTypes: formJob.jobTypes,
      sizeLines: formJob.sizeLines,
      framed: formJob.framed,
      canvas: formJob.canvas,
      tbr: formJob.tbr,
      notes: formJob.notes,
      priority: formJob.priority,
    };
    if (formJob.priority === "express" && current.priority !== "express") {
      merged.expressStartedAt = Date.now();
    }
    return saveJob(merged);
  }

  async function adjustStock(itemId, meta, qtyChange, reason, jobId, jobRef) {
    await ensureInventoryItem(itemId, meta);
    const result = await recordMovement(itemId, qtyChange, reason, apcName, jobId, jobRef);
    if (!result.ok) {
      setError(`Stock update failed (${result.reason}): ${result.detail}`);
    } else {
      loadInv();
    }
    return result.ok;
  }

  async function setThreshold(itemId, meta, threshold) {
    const item = await ensureInventoryItem(itemId, meta);
    const result = await safeSet(`inv:item:${itemId}`, { ...item, threshold, updatedAt: Date.now(), updatedBy: apcName });
    if (!result.ok) setError(`Threshold update failed (${result.reason}): ${result.detail}`);
    else loadInv();
    return result.ok;
  }

  // Finds active jobs whose size lines use this exact custom size (case-insensitive) — used to
  // suggest a Job ID link for a custom material cut. Never auto-links; the UI always asks for
  // confirmation before attaching a job reference, per the explicit instruction not to guess.
  function findJobsForCustomSize(sizeLabel) {
    const q = sizeLabel.trim().toLowerCase();
    if (!q) return [];
    return jobs.filter((j) => j.status !== "COMPLETED" && j.sizeLines.some((l) => l.size === "Other" && l.customSize.trim().toLowerCase() === q));
  }

  async function recordCustomCut(category, sizeLabel, qty, job) {
    const itemId = invItemId(category, "custom", sizeLabel);
    await ensureInventoryItem(itemId, { category, kind: "custom", size: sizeLabel, createdBy: apcName });
    const result = await recordMovement(itemId, qty, "Job Cut", apcName, job?.id, job?.jobRef || job?.clientName);
    if (!result.ok) setError(`Cut record failed (${result.reason}): ${result.detail}`);
    else loadInv();
    return result.ok;
  }

  async function addManagementMessage(jobId, text) {
    const current = await safeGet(`job:${jobId}`);
    if (!current) { setError("Job no longer exists — refreshing."); return loadJobs(true); }
    const messages = [...(current.managementMessages || []), { text, by: "Management/QD", at: Date.now() }];
    return saveJob({ ...current, managementMessages: messages }, `Management message added on ${current.jobRef || current.clientName}`, "Management/QD");
  }

  async function createRework(rework) {
    const result = await safeSet(`rework:${rework.id}`, rework);
    if (!result.ok) setError(`Rework save failed (${result.reason}): ${result.detail}`);
    else loadReworkList();
    return result.ok;
  }

  async function updateReworkStatus(reworkId, status) {
    const current = await safeGet(`rework:${reworkId}`);
    if (!current) { setError("Rework record no longer exists — refreshing."); return loadReworkList(); }
    const result = await safeSet(`rework:${reworkId}`, { ...current, status, updatedAt: Date.now(), lastUpdatedBy: apcName });
    if (!result.ok) setError(`Rework update failed (${result.reason}): ${result.detail}`);
    else loadReworkList();
    return result.ok;
  }

  async function createCutRecord(rec) {
    const result = await safeSet(`cut:${rec.id}`, rec);
    if (!result.ok) setError(`Cutting record failed (${result.reason}): ${result.detail}`);
    else loadTracking();
    return result.ok;
  }

  async function createCoupleRecord(rec) {
    const result = await safeSet(`couple:${rec.id}`, rec);
    if (!result.ok) setError(`Coupling record failed (${result.reason}): ${result.detail}`);
    else loadTracking();
    return result.ok;
  }

  async function saveInstallRecord(rec) {
    const result = await safeSet(`install:${rec.id}`, { ...rec, updatedAt: Date.now() });
    if (!result.ok) setError(`Installation save failed (${result.reason}): ${result.detail}`);
    else loadInstalls();
    return result.ok;
  }

  if (!role) return <LoginScreen onLogin={(r, name) => { setRole(r); if (name) setApcName(name); }} />;

  const filtered = jobs.filter((j) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const sizeMatch = j.sizeLines.some((l) => (l.size === "Other" ? l.customSize : l.size).toLowerCase().includes(q));
      const matches = j.clientName.toLowerCase().includes(q) || j.jobRef.toLowerCase().includes(q) || sizeMatch;
      if (!matches) return false;
    }
    if (filter === "All") return true;
    if (filter === "High Priority") return j.priority === "high";
    if (filter === "Express") return j.priority === "express";
    if (filter === "Waiting for Image") return j.imageStatus === "WAITING";
    if (filter === "Delayed") return j.delayed?.active;
    if (filter === "Water Taping") return j.fulfillment.status === "WATER_TAPING";
    if (filter === "Ready for Fulfillment") return j.status === "READY_FOR_FULFILLMENT";
    if (filter === "Fulfillment") return j.status === "IN_FULFILLMENT";
    if (filter === "Completed") return j.status === "COMPLETED";
    if (filter === "TBR") return getJobTypes(j).tbr;
    if (filter === "IN") return getJobTypes(j).tbr && getTbrKinds(j).IN;
    if (filter === "ER") return getJobTypes(j).tbr && getTbrKinds(j).ER;
    return true;
  });

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 font-sans">
      <style>{`
        html, body { background-color: rgb(10 10 10); margin: 0; padding: 0; }
        .input{width:100%;border:1px solid rgb(64 64 64);background:rgb(38 38 38);border-radius:0.375rem;padding:0.5rem 0.75rem;font-size:0.875rem;color:rgb(245 245 245)}
        .input:focus{outline:none;border-color:rgb(245 158 11)}
        .input::placeholder{color:rgb(115 115 115)}
        .wheel-scroll::-webkit-scrollbar{display:none}
      `}</style>
      <TopBar role={role} apcName={apcName} loading={loading} lastSynced={lastSynced}
        onRefresh={() => loadJobs(false)} onLogout={() => { setRole(null); setJobs([]); setActiveTab("dashboard"); setShowForm(false); setEditingJob(null); }} />

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={16} className="shrink-0" />{error}
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        {(role === "apc" || role === "management") && (
          <ModuleAccordion activeModule={activeModule} setActiveModule={setActiveModule} />
        )}

        {(role === "apc" || role === "management") && activeModule === "production" && (
          <NavTabs tab={activeTab} setTab={setActiveTab} />
        )}

        {activeModule === "production" && (
          <>
        {role === "apc" && activeTab === "dashboard" && (
          <>
            <DashboardStats jobs={jobs} />
            <InventoryWarnings items={inventoryItems} stockByItem={stockByItem} />
            <AttentionList jobs={jobs} now={now} onOpenJobs={() => setActiveTab("jobs")} />
            <ActivityLog />
          </>
        )}
        {role === "apc" && activeTab === "jobs" && (
          <>
            {!showForm && !editingJob && (
              <button onClick={() => setShowForm(true)}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 font-semibold text-neutral-950 active:bg-amber-400">
                <Plus size={18} /> New Order
              </button>
            )}
            {showForm && (
              <JobForm apcName={apcName} mode="create"
                onCancel={() => setShowForm(false)}
                onSave={async (job) => { const ok = await saveJob(job); if (ok) setShowForm(false); }} />
            )}
            {editingJob && (
              <JobForm apcName={apcName} mode="edit" initial={editingJob}
                onCancel={() => setEditingJob(null)}
                onSave={async (job) => { const ok = await saveJobEdits(editingJob.id, job); if (ok) setEditingJob(null); }} />
            )}
            <SearchBar value={search} onChange={setSearch} />
            <FilterBar filter={filter} setFilter={setFilter} />
            <div className="space-y-2">
              {filtered.length === 0 && <EmptyState text="No jobs match this filter." />}
              {filtered.map((job) => (
                <JobCard key={job.id} job={job} apcName={apcName} now={now} editable
                  stockByItem={stockByItem} inventoryItems={inventoryItems}
                  onPatch={(patch) => patchJob(job.id, patch)}
                  onRecordCut={recordCustomCut}
                  onEdit={() => { setEditingJob(job); setShowForm(false); }} />
              ))}
            </div>
          </>
        )}
        {role === "apc" && activeTab === "rework" && (
          <ReworkView reworks={reworks} apcName={apcName} onCreate={createRework} onUpdateStatus={updateReworkStatus} editable />
        )}
        {role === "apc" && activeTab === "handover" && <HandoverView jobs={jobs} apcName={apcName} editable />}
        {role === "apc" && activeTab === "inventory" && (
          <InventoryView items={inventoryItems} stockByItem={stockByItem} moves={inventoryMoves}
            onAdjust={adjustStock} onSetThreshold={setThreshold}
            onRecordCut={recordCustomCut} findJobsForCustomSize={findJobsForCustomSize} editable />
        )}

        {role === "management" && activeTab === "dashboard" && (
          <>
            <DashboardStats jobs={jobs} />
            <InventoryWarnings items={inventoryItems} stockByItem={stockByItem} />
            <PriorityAndDelaySections jobs={jobs} now={now} />
            <LatestHandoverNote />
            <ActivityLog />
          </>
        )}
        {role === "management" && activeTab === "jobs" && (
          <>
            <SearchBar value={search} onChange={setSearch} />
            <FilterBar filter={filter} setFilter={setFilter} />
            <div className="space-y-2">
              {filtered.length === 0 && <EmptyState text="No jobs recorded yet." />}
              {filtered.map((job) => <JobCard key={job.id} job={job} now={now} editable={false} canMessage onAddMessage={addManagementMessage} stockByItem={stockByItem} inventoryItems={inventoryItems} />)}
            </div>
          </>
        )}
        {role === "management" && activeTab === "rework" && <ReworkView reworks={reworks} editable={false} />}
        {role === "management" && activeTab === "handover" && <HandoverView jobs={jobs} editable={false} />}
        {role === "management" && activeTab === "inventory" && (
          <InventoryView items={inventoryItems} stockByItem={stockByItem} moves={inventoryMoves} editable={false} />
        )}
          </>
        )}

        {(role === "apc" || role === "management") && activeModule === "tracking" && (
          <JobTrackingModule jobs={jobs} apcName={apcName} cutRecords={cutRecords} coupleRecords={coupleRecords}
            onCreateCut={createCutRecord} onCreateCouple={createCoupleRecord} editable={role === "apc"} />
        )}
        {(role === "apc" || role === "management") && activeModule === "installation" && (
          <InstallationModule jobs={jobs} apcName={apcName} installRecords={installRecords}
            onSave={saveInstallRecord} editable={role === "apc"} />
        )}

        {role === "hr" && <HRView jobs={jobs} onUpdateImage={(jobId, patch) => patchJob(jobId, patch, "HR")} />}
      </main>
    </div>
  );
}

// ---------------- LOGIN ----------------
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 3;

function ScrollWheelPicker({ items, value, onChange, itemHeight = WHEEL_ITEM_H, visible = WHEEL_VISIBLE }) {
  const containerRef = useRef(null);
  const settleTimer = useRef(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const idx = Math.max(0, items.indexOf(value));
    if (containerRef.current) containerRef.current.scrollTop = idx * itemHeight;
  }, [items, value, itemHeight]);

  function settle(scrollTop) {
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(scrollTop / itemHeight)));
    containerRef.current?.scrollTo({ top: idx * itemHeight, behavior: "smooth" });
    if (items[idx] !== value) onChange(items[idx]);
  }

  function handleScroll(e) {
    const scrollTop = e.currentTarget.scrollTop;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(scrollTop), 130);
  }

  function tap(idx) {
    containerRef.current?.scrollTo({ top: idx * itemHeight, behavior: "smooth" });
    onChange(items[idx]);
  }

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 -translate-y-1/2 rounded-md border-y-2 border-amber-500"
        style={{ height: itemHeight }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{ height: itemHeight, background: "linear-gradient(to bottom, rgb(23 23 23), transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={{ height: itemHeight, background: "linear-gradient(to top, rgb(23 23 23), transparent)" }}
      />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="wheel-scroll overflow-y-scroll"
        style={{
          height: itemHeight * visible,
          scrollSnapType: "y mandatory",
          paddingTop: itemHeight,
          paddingBottom: itemHeight,
          scrollbarWidth: "none",
        }}
      >
        {items.map((it, idx) => (
          <div
            key={it}
            onClick={() => tap(idx)}
            style={{ height: itemHeight, scrollSnapAlign: "center" }}
            className={`flex cursor-pointer items-center justify-center text-sm transition-all ${
              it === value ? "font-bold text-amber-400" : "text-neutral-600"
            }`}
          >
            {it}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState(APCS[0]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-1 font-mono text-xs uppercase tracking-[0.3em] text-amber-500">FrameGidi</div>
          <h1 className="text-2xl font-semibold">Production OS</h1>
          <p className="mt-1 text-sm text-neutral-500">Orders, inventory & production tracking</p>
        </div>
        <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <label className="mb-2 block text-center text-xs font-medium uppercase tracking-wide text-neutral-500">Welcome — scroll to select APC</label>
          <ScrollWheelPicker items={APCS} value={selected} onChange={setSelected} />
          <style>{`.wheel-scroll::-webkit-scrollbar{display:none}`}</style>
          <button onClick={() => onLogin("apc", selected)}
            className="mt-3 w-full rounded-md bg-amber-500 py-3 font-semibold text-neutral-950 active:bg-amber-400">
            Log in as {selected}
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onLogin("management")} className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 py-2.5 text-sm text-neutral-300 active:bg-neutral-800">Management / QD</button>
          <button onClick={() => onLogin("hr")} className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 py-2.5 text-sm text-neutral-300 active:bg-neutral-800">HR / Ghiazat</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- TOP BAR ----------------
function TopBar({ role, apcName, loading, lastSynced, onRefresh, onLogout }) {
  const label = role === "apc" ? `APC · ${apcName}` : role === "management" ? "Management / QD" : "HR / Ghiazat";
  const Icon = role === "apc" ? User : Lock;
  return (
    <div className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon size={16} className={role === "apc" ? "text-amber-500" : "text-neutral-500"} />
          <span className="text-sm font-medium">{label}</span>
          {role !== "apc" && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">read-only</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="text-neutral-500 active:text-amber-500"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
          <button onClick={onLogout} className="text-xs text-neutral-500 underline">switch</button>
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 pb-2 font-mono text-[10px] text-neutral-600">
        {lastSynced ? `Synced ${elapsed(lastSynced)} ago` : "Syncing…"}
      </div>
    </div>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div className="relative mb-3">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search client, job ID, size…"
        className="input pl-9"
      />
    </div>
  );
}

function FilterBar({ filter, setFilter }) {
  const opts = ["All", "High Priority", "Express", "TBR", "IN", "ER", "Waiting for Image", "Delayed", "Water Taping", "Ready for Fulfillment", "Fulfillment", "Completed"];
  return (
    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
      {opts.map((o) => (
        <button key={o} onClick={() => setFilter(o)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${filter === o ? "bg-amber-500 text-neutral-950" : "bg-neutral-900 text-neutral-400 border border-neutral-800"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function ModuleAccordion({ activeModule, setActiveModule }) {
  const modules = [
    ["production", "Production OS"],
    ["tracking", "Job Tracking"],
    ["installation", "Installation"],
  ];
  return (
    <div className="mb-4 space-y-1.5">
      {modules.map(([key, label]) => (
        <button key={key} onClick={() => setActiveModule(key)}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-semibold ${activeModule === key ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-neutral-800 bg-neutral-900 text-neutral-400"}`}>
          {label}
          <ChevronRight size={14} className={`transition-transform ${activeModule === key ? "rotate-90" : ""}`} />
        </button>
      ))}
    </div>
  );
}

function NavTabs({ tab, setTab }) {
  const tabs = [["dashboard", "Dashboard"], ["jobs", "Jobs"], ["rework", "Rework"], ["handover", "Handover"], ["inventory", "Inventory"]];
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-1">
      {tabs.map(([key, label]) => (
        <button key={key} onClick={() => setTab(key)}
          className={`shrink-0 rounded-md px-4 py-2 text-xs font-semibold ${tab === key ? "bg-amber-500 text-neutral-950" : "text-neutral-400"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function AttentionList({ jobs, now, onOpenJobs }) {
  const urgent = jobs.filter((j) =>
    j.status !== "COMPLETED" &&
    (j.priority === "express" || j.delayed?.active || j.imageStatus === "WAITING" ||
     j.fulfillment.status === "WATER_TAPING" || j.status === "READY_FOR_FULFILLMENT" || j.status === "IN_FULFILLMENT")
  );
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Needs attention ({urgent.length})</span>
        <button onClick={onOpenJobs} className="text-xs text-amber-500 underline">open jobs</button>
      </div>
      <div className="space-y-2">
        {urgent.length === 0 && <EmptyState text="Nothing urgent right now." />}
        {urgent.slice(0, 8).map((job) => (
          <div key={job.id} onClick={onOpenJobs} className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{job.clientName}</span>
              <div className="flex flex-wrap justify-end gap-1">
                {job.priority === "express" && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-bold uppercase text-red-400">Express · {elapsed(job.expressStartedAt, now)}</span>}
                {job.delayed?.active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-red-400">Delayed</span>}
                {job.imageStatus === "WAITING" && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400">Waiting image</span>}
                {job.fulfillment.status === "WATER_TAPING" && <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-blue-400">Water taping</span>}
                {job.status === "READY_FOR_FULFILLMENT" && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400">Ready for fulfillment</span>}
                {job.status === "IN_FULFILLMENT" && <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase text-blue-400">In fulfillment</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- ACTIVITY LOG (real shared data — recorded on actual stage transitions only) ----------------
// ---------------- CURRENT PRIORITIES / CURRENT DELAYS (Management view) ----------------
function PriorityAndDelaySections({ jobs, now }) {
  const priorityJobs = jobs.filter((j) => j.status !== "COMPLETED" && (j.priority === "express" || j.priority === "high"));
  const delayedJobs = jobs.filter((j) => j.delayed?.active);

  function JobLine({ job }) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{job.clientName} <span className="font-mono text-[10px] text-neutral-500">{job.jobRef}</span></span>
          <div className="flex gap-1">
            {job.priority === "express" && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-bold uppercase text-red-400">Express · {elapsed(job.expressStartedAt, now)}</span>}
            {job.priority === "high" && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-orange-400">High priority</span>}
            {job.delayed?.active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-red-400">{job.delayed.reason === "Other" ? job.delayed.customReason : job.delayed.reason}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-4">
      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Current Priorities</div>
        <div className="space-y-2">
          {priorityJobs.length === 0 && <EmptyState text="No Express or High Priority jobs right now." />}
          {priorityJobs.map((job) => <JobLine key={job.id} job={job} />)}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Current Delays</div>
        <div className="space-y-2">
          {delayedJobs.length === 0 && <EmptyState text="No delayed jobs." />}
          {delayedJobs.map((job) => <JobLine key={job.id} job={job} />)}
        </div>
      </div>
    </div>
  );
}

function LatestHandoverNote() {
  const [latest, setLatest] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const keys = await listKeys("handover:");
      const results = await Promise.all(keys.map(safeGet));
      const sorted = results.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
      if (!cancelled) setLatest(sorted[0] || null);
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div className="mb-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Handover</div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
        {latest?.notes ? (
          <>
            <div className="whitespace-pre-wrap text-neutral-200">{latest.notes}</div>
            <div className="mt-1.5 font-mono text-[10px] text-neutral-500">— {latest.apc}, {elapsed(latest.createdAt)} ago</div>
          </>
        ) : (
          <span className="text-neutral-600">No handover notes yet.</span>
        )}
      </div>
    </div>
  );
}

function ActivityLog() {
  const [entries, setEntries] = useState([]);
  const load = useCallback(async () => {
    const keys = await listKeys("activity:");
    const results = await Promise.all(keys.map(safeGet));
    setEntries(results.filter(Boolean).sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mb-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Recent Activity</div>
      <div className="space-y-1.5">
        {entries.length === 0 && <EmptyState text="No activity recorded yet." />}
        {entries.map((e, i) => (
          <div key={i} className="rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-400">
            <span className="text-neutral-200">{e.action}</span> — {e.jobRef} · {e.person} · {elapsed(e.timestamp)} ago
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- shared job picker (reuses existing jobs — no duplicate job-entry system) ----------------
function JobSelector({ jobs, selectedId, onSelect }) {
  const [query, setQuery] = useState("");
  const selected = jobs.find((j) => j.id === selectedId);
  const matches = query.trim()
    ? jobs.filter((j) => j.clientName.toLowerCase().includes(query.toLowerCase()) || j.jobRef.toLowerCase().includes(query.toLowerCase()))
    : jobs.slice(0, 8);

  if (selected) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-md border border-amber-700/50 bg-amber-950/10 p-2.5">
        <span className="font-medium">{selected.clientName} <span className="font-mono text-[10px] text-neutral-500">{selected.jobRef}</span></span>
        <button onClick={() => onSelect(null)} className="text-xs text-neutral-500 underline">change</button>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Select Job</div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search client or job reference…" className="input mb-2" />
      <div className="space-y-1.5">
        {matches.length === 0 && <div className="text-xs text-neutral-600">No jobs found.</div>}
        {matches.map((j) => (
          <button key={j.id} onClick={() => onSelect(j.id)} className="block w-full rounded-md border border-neutral-800 bg-neutral-900 p-2 text-left text-sm">
            {j.clientName} <span className="font-mono text-[10px] text-neutral-500">{j.jobRef}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function JobInfoCard({ job }) {
  const types = getJobTypes(job);
  const typeLabel = [types.framed && "Framed", types.canvas && "Canvas", types.tbr && "TBR"].filter(Boolean).join(" + ");
  return (
    <div className="mb-4 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-sm">
      <div className="font-medium">{job.clientName} <span className="font-mono text-[10px] text-neutral-500">{job.jobRef}</span></div>
      <div className="mt-1 text-xs text-neutral-500">{typeLabel || "—"} · Total {job.quantity} pcs</div>
      {types.framed && (
        <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-neutral-500">
          {job.sizeLines.map((l) => <span key={l.id}>{l.size === "Other" ? l.customSize : l.size} × {l.qty}</span>)}
        </div>
      )}
    </div>
  );
}

// ---------------- JOB TRACKING (productivity — who cut/coupled; separate from the APC audit trail) ----------------
function JobTrackingModule({ jobs, apcName, cutRecords, coupleRecords, onCreateCut, onCreateCouple, editable }) {
  const [selectedId, setSelectedId] = useState(null);
  const job = jobs.find((j) => j.id === selectedId);

  return (
    <div>
      <div className="mb-3 text-lg font-semibold">Job Tracking</div>
      <JobSelector jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
      {job ? (
        <>
          <JobInfoCard job={job} />
          {editable && <CuttingForm job={job} apcName={apcName} onCreate={onCreateCut} />}
          {editable && <CouplingForm job={job} apcName={apcName} onCreate={onCreateCouple} />}
          <TrackingHistory job={job} cutRecords={cutRecords} coupleRecords={coupleRecords} />
        </>
      ) : (
        <EmptyState text="Select a job to record cutting or coupling." />
      )}
    </div>
  );
}

function CuttingForm({ job, apcName, onCreate }) {
  const [expanded, setExpanded] = useState(false);
  const [material, setMaterial] = useState(TRACK_MATERIALS[0]);
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [cutBy, setCutBy] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!cutBy.trim()) return;
    onCreate({
      id: newId("cut"), jobId: job.id, jobRef: job.jobRef || job.clientName, clientName: job.clientName,
      material, size: size.trim(), qty, cutBy: cutBy.trim(), notes: notes.trim(),
      recordedBy: apcName, createdAt: Date.now(),
    });
    setSize(""); setQty(1); setCutBy(""); setNotes(""); setExpanded(false);
  }

  return (
    <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-950/40 p-3">
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-amber-500">
        Cutting <ChevronRight size={13} className={expanded ? "rotate-90" : ""} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <Segmented options={TRACK_MATERIALS} value={material} onChange={setMaterial} />
          <div className="grid grid-cols-2 gap-2">
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className="input" />
            <NumberField value={qty} onCommit={setQty} min={1} />
          </div>
          <input value={cutBy} onChange={(e) => setCutBy(e.target.value)} placeholder="Cut by — worker name" className="input" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="input" />
          <button onClick={submit} disabled={!cutBy.trim()} className="w-full rounded-md bg-amber-500 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40">Save Cutting Record</button>
        </div>
      )}
    </div>
  );
}

function CouplingForm({ job, apcName, onCreate }) {
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [coupledBy, setCoupledBy] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!coupledBy.trim()) return;
    onCreate({
      id: newId("couple"), jobId: job.id, jobRef: job.jobRef || job.clientName, clientName: job.clientName,
      size: size.trim(), qty, coupledBy: coupledBy.trim(), notes: notes.trim(),
      recordedBy: apcName, createdAt: Date.now(),
    });
    setSize(""); setQty(1); setCoupledBy(""); setNotes(""); setExpanded(false);
  }

  return (
    <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-950/40 p-3">
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-amber-500">
        Frame Coupling <ChevronRight size={13} className={expanded ? "rotate-90" : ""} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className="input" />
            <NumberField value={qty} onCommit={setQty} min={1} />
          </div>
          <input value={coupledBy} onChange={(e) => setCoupledBy(e.target.value)} placeholder="Coupled by — worker name" className="input" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="input" />
          <button onClick={submit} disabled={!coupledBy.trim()} className="w-full rounded-md bg-amber-500 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40">Save Coupling Record</button>
        </div>
      )}
    </div>
  );
}

function TrackingHistory({ job, cutRecords, coupleRecords }) {
  const cuts = cutRecords.filter((r) => r.jobId === job.id).map((r) => ({ ...r, kind: "Cutting", by: r.cutBy }));
  const couples = coupleRecords.filter((r) => r.jobId === job.id).map((r) => ({ ...r, kind: "Coupling", by: r.coupledBy }));
  const all = [...cuts, ...couples].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">History</div>
      <div className="space-y-1.5">
        {all.length === 0 && <div className="text-xs text-neutral-600">No records yet for this job.</div>}
        {all.map((r, i) => (
          <div key={i} className="rounded-md border border-neutral-800 bg-neutral-900 p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-200">{r.kind}{r.material ? ` — ${r.material}` : ""}</span>
              <span className="text-neutral-500">{new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="mt-1 text-neutral-400">{r.size} × {r.qty} · {r.kind} by: {r.by}</div>
            {r.notes && <div className="mt-0.5 text-neutral-500">{r.notes}</div>}
            <div className="mt-0.5 font-mono text-[9px] text-neutral-600">Recorded by {r.recordedBy}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- INSTALLATION (separate operational event from production completion) ----------------
function InstallationModule({ jobs, apcName, installRecords, onSave, editable }) {
  const [selectedId, setSelectedId] = useState(null);
  const job = jobs.find((j) => j.id === selectedId);
  const existing = job ? installRecords.find((r) => r.jobId === job.id) : null;

  return (
    <div>
      <div className="mb-3 text-lg font-semibold">Installation</div>
      <JobSelector jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
      {job && <JobInfoCard job={job} />}
      {job && editable && <InstallForm job={job} apcName={apcName} existing={existing} onSave={onSave} />}
      {job && !editable && existing && <InstallSummary rec={existing} />}
      {job && !editable && !existing && <div className="mb-4 text-xs text-neutral-600">No installation scheduled for this job yet.</div>}
      <div className="mt-2">
        <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Installation History</div>
        <div className="space-y-1.5">
          {installRecords.length === 0 && <div className="text-xs text-neutral-600">No installation records yet.</div>}
          {installRecords.map((r) => <InstallSummary key={r.id} rec={r} />)}
        </div>
      </div>
    </div>
  );
}

function InstallForm({ job, apcName, existing, onSave }) {
  const [installers, setInstallers] = useState(existing?.installers?.join(", ") || "");
  const [date, setDate] = useState(existing?.date || "");
  const [time, setTime] = useState(existing?.time || "");
  const [location, setLocation] = useState(existing?.location || "");
  const [contact, setContact] = useState(existing?.contact || "");
  const [instructions, setInstructions] = useState(existing?.instructions || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [status, setStatus] = useState(existing?.status || "PENDING");

  function submit() {
    onSave({
      id: existing?.id || newId("install"),
      jobId: job.id, jobRef: job.jobRef || job.clientName, clientName: job.clientName,
      installers: installers.split(",").map((s) => s.trim()).filter(Boolean),
      date, time, location: location.trim(), contact: contact.trim(),
      instructions: instructions.trim(), notes: notes.trim(), status,
      createdBy: existing?.createdBy || apcName, createdAt: existing?.createdAt || Date.now(),
    });
  }

  return (
    <div className="mb-4 space-y-2 rounded-md border border-neutral-800 bg-neutral-950/40 p-3">
      <Field label="Installer(s)">
        <input value={installers} onChange={(e) => setInstallers(e.target.value)} placeholder="e.g. Dare, Ope" className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" /></Field>
        <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" /></Field>
      </div>
      <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Installation address" className="input" /></Field>
      <Field label="Contact"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Client contact" className="input" /></Field>
      <Field label="Instructions"><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="input resize-none" /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" /></Field>
      <Field label="Status"><Segmented small options={INSTALL_STATUSES} value={status} onChange={setStatus} /></Field>
      <button onClick={submit} className="w-full rounded-md bg-amber-500 py-2 text-xs font-semibold text-neutral-950">Save Installation</button>
    </div>
  );
}

function InstallSummary({ rec }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-200">{rec.clientName} <span className="font-mono text-[10px] text-neutral-500">{rec.jobRef}</span></span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${rec.status === "COMPLETED" ? "bg-emerald-500/20 text-emerald-400" : "bg-neutral-800 text-neutral-400"}`}>{rec.status.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-1 text-neutral-400">{rec.date || "—"} {rec.time || ""} · {rec.location || "no location set"}</div>
      {rec.installers?.length > 0 && <div className="text-neutral-500">Installer(s): {rec.installers.join(", ")}</div>}
    </div>
  );
}

function ReworkView({ reworks, apcName, onCreate, onUpdateStatus, editable }) {
  const [showForm, setShowForm] = useState(false);
  const [clientName, setClientName] = useState("");
  const [category, setCategory] = useState("Frame");
  const [note, setNote] = useState("");
  const [originalJobRef, setOriginalJobRef] = useState("");

  function submit() {
    if (!clientName.trim()) return;
    const rework = {
      id: newId("rw"),
      clientName: clientName.trim(),
      category,
      note: note.trim(),
      originalJobRef: originalJobRef.trim() || null,
      status: "PENDING",
      createdBy: apcName, createdAt: Date.now(),
      lastUpdatedBy: apcName, updatedAt: Date.now(),
    };
    onCreate(rework);
    setShowForm(false); setClientName(""); setCategory("Frame"); setNote(""); setOriginalJobRef("");
  }

  return (
    <div>
      {editable && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 font-semibold text-neutral-950 active:bg-amber-400">
          <Plus size={18} /> New Rework
        </button>
      )}
      {editable && showForm && (
        <div className="mb-4 rounded-lg border border-amber-700/40 bg-neutral-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">New Rework</h2>
            <button onClick={() => setShowForm(false)} className="text-neutral-500"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            <Field label="Client name">
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Olajire" className="input" />
            </Field>
            <Field label="Rework Type">
              <Segmented options={REWORK_CATEGORIES} value={category} onChange={setCategory} />
            </Field>
            <Field label="Original Job Reference (if known)">
              <input value={originalJobRef} onChange={(e) => setOriginalJobRef(e.target.value)} placeholder="optional — job may be old / not in the system" className="input" />
            </Field>
            <Field label="Rework Note">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="Describe what needs to be reworked" className="input resize-none" />
            </Field>
            <button onClick={submit} disabled={!clientName.trim()}
              className="w-full rounded-md bg-amber-500 py-3 font-semibold text-neutral-950 disabled:opacity-40">
              Save Rework
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {reworks.length === 0 && <EmptyState text="No rework records yet." />}
        {reworks.map((rw) => (
          <div key={rw.id} className="rounded-lg border border-orange-800/50 bg-orange-950/10 p-3">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-400">Rework · {rw.category}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${rw.status === "DONE" ? "bg-emerald-500/20 text-emerald-400" : rw.status === "IN_PROGRESS" ? "bg-blue-500/20 text-blue-400" : "bg-neutral-800 text-neutral-400"}`}>
                {rw.status.replace("_", " ")}
              </span>
            </div>
            <div className="mt-1 font-medium">{rw.clientName}</div>
            {rw.originalJobRef && <div className="font-mono text-[10px] text-neutral-500">Original job: {rw.originalJobRef}</div>}
            {rw.note && <div className="mt-1.5 text-sm text-neutral-300">{rw.note}</div>}
            <div className="mt-1.5 font-mono text-[10px] text-neutral-600">Logged by {rw.createdBy} · {elapsed(rw.createdAt)} ago</div>
            {editable && (
              <div className="mt-2 border-t border-neutral-800 pt-2">
                <Segmented small options={REWORK_STATUSES} value={rw.status} onChange={(v) => onUpdateStatus(rw.id, v)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HandoverView({ jobs, apcName, editable }) {
  const [entries, setEntries] = useState([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [hError, setHError] = useState(null);

  const pending = jobs.filter((j) => j.status === "ACTIVE");
  const expressJobs = pending.filter((j) => j.priority === "express");
  const delayedJobs = pending.filter((j) => j.delayed?.active);
  const waitingImage = pending.filter((j) => j.imageStatus === "WAITING");
  const waterPending = jobs.filter((j) => j.fulfillment.status === "WATER_TAPING");
  const readyForFulfillment = jobs.filter((j) => j.status === "READY_FOR_FULFILLMENT");
  const inFulfillment = jobs.filter((j) => j.status === "IN_FULFILLMENT");

  const loadEntries = useCallback(async () => {
    const keys = await listKeys("handover:");
    const results = await Promise.all(keys.map(safeGet));
    setEntries(results.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt));
  }, []);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  async function createHandover() {
    setSaving(true);
    setHError(null);
    const ts = Date.now();
    const entry = {
      id: ts, apc: apcName, notes, createdAt: ts,
      snapshot: {
        pending: pending.map((j) => j.clientName),
        express: expressJobs.map((j) => j.clientName),
        delayed: delayedJobs.map((j) => j.clientName),
        waitingImage: waitingImage.map((j) => j.clientName),
        waterTaping: waterPending.map((j) => j.clientName),
        readyForFulfillment: readyForFulfillment.map((j) => j.clientName),
        inFulfillment: inFulfillment.map((j) => j.clientName),
      },
    };
    const result = await safeSet(`handover:${ts}`, entry);
    setSaving(false);
    if (!result.ok) { setHError(`Save failed (${result.reason}): ${result.detail}`); return; }
    setNotes("");
    loadEntries();
  }

  return (
    <div>
      <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Current situation (live)</div>
        <div className="flex flex-wrap gap-1.5">
          <HandoverChip label="Pending" value={pending.length} />
          <HandoverChip label="Express" value={expressJobs.length} tone={expressJobs.length ? "red" : "neutral"} />
          <HandoverChip label="Delayed" value={delayedJobs.length} tone={delayedJobs.length ? "red" : "neutral"} />
          <HandoverChip label="Waiting image" value={waitingImage.length} tone={waitingImage.length ? "amber" : "neutral"} />
          <HandoverChip label="Water taping" value={waterPending.length} tone={waterPending.length ? "blue" : "neutral"} />
          <HandoverChip label="Ready for fulfillment" value={readyForFulfillment.length} tone={readyForFulfillment.length ? "amber" : "neutral"} />
          <HandoverChip label="In fulfillment" value={inFulfillment.length} tone={inFulfillment.length ? "blue" : "neutral"} />
        </div>

        {editable && (
          <div className="mt-4 border-t border-neutral-800 pt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Handover Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes for the next APC…&#10;e.g. 24x36 glass low. 3 TBR jobs waiting for measurements."
              rows={4} className="input resize-none leading-relaxed" />
            {hError && <div className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">{hError}</div>}
            <button onClick={createHandover} disabled={saving}
              className="mt-2 w-full rounded-md bg-amber-500 py-2.5 text-sm font-semibold text-neutral-950 disabled:opacity-40">
              {saving ? "Saving…" : "Create Handover"}
            </button>
          </div>
        )}
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Handover history</div>
      <div className="space-y-2">
        {entries.length === 0 && <EmptyState text="No handovers recorded yet." />}
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
            <div className="font-mono text-[10px] text-neutral-500">{new Date(e.createdAt).toLocaleString()} · {e.apc}</div>
            {e.notes && <div className="mt-1.5 whitespace-pre-wrap text-neutral-200">{e.notes}</div>}
            <div className="mt-2 flex flex-wrap gap-1 border-t border-neutral-800 pt-2">
              <HandoverChip small label="Pending" value={e.snapshot.pending.length} />
              <HandoverChip small label="Express" value={e.snapshot.express.length} />
              <HandoverChip small label="Delayed" value={e.snapshot.delayed.length} />
              <HandoverChip small label="Waiting image" value={e.snapshot.waitingImage.length} />
              <HandoverChip small label="Water taping" value={e.snapshot.waterTaping.length} />
              <HandoverChip small label="Ready for fulfillment" value={e.snapshot.readyForFulfillment?.length || 0} />
              <HandoverChip small label="In fulfillment" value={e.snapshot.inFulfillment?.length || 0} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HandoverChip({ label, value, tone = "neutral", small }) {
  const tones = {
    neutral: "border-neutral-700 bg-neutral-800 text-neutral-300",
    red: "border-red-700/60 bg-red-950/40 text-red-300",
    amber: "border-amber-700/60 bg-amber-950/30 text-amber-300",
    blue: "border-blue-700/60 bg-blue-950/30 text-blue-300",
  };
  return (
    <span className={`rounded-full border px-2 py-1 font-medium ${small ? "text-[9px]" : "text-[11px]"} ${tones[tone]}`}>
      {label}: {value}
    </span>
  );
}

function sizeRowsForCategory(category) {
  if (category === "Hardboard") {
    return INV_STANDARD_SIZES.flatMap((size) =>
      HARDBOARD_ORIENTATION_SIZES.includes(size)
        ? [
            { label: `${size} · Portrait`, size: `${size}-portrait` },
            { label: `${size} · Landscape`, size: `${size}-landscape` },
          ]
        : [{ label: size, size }]
    );
  }
  return INV_STANDARD_SIZES.map((size) => ({ label: size, size }));
}
function laidFoamRows() {
  const rows = [];
  for (const size of LAID_FOAM_FULL_SIZES) {
    rows.push({ label: `${size} · Unmatted`, size, kind: "laid_unmatted" });
    for (const [matKey, matLabel] of LAID_FOAM_MAT_TYPES) {
      rows.push({ label: `${size} · Matted ${matLabel}`, size, kind: `laid_${matKey}` });
    }
  }
  // 36x48: unmatted only. 36x47.5: matted options only. Never mixed — per the locked rule that
  // the mat board doesn't reach the full 48" dimension once matting is applied.
  rows.push({ label: "36x48 · Unmatted", size: "36x48", kind: "laid_unmatted" });
  for (const [matKey, matLabel] of LAID_FOAM_MAT_TYPES) {
    rows.push({ label: `36x47.5 · Matted ${matLabel}`, size: "36x47.5", kind: `laid_${matKey}` });
  }
  return rows;
}

function InventoryView({ items, stockByItem, moves = [], onAdjust, onSetThreshold, onRecordCut, findJobsForCustomSize, editable }) {
  const [category, setCategory] = useState(INV_CATEGORIES[0]);
  const isSized = INV_SIZED_CATEGORIES.includes(category);
  const hasFullSheet = FULL_SHEET_MATERIALS.includes(category);
  const isFoamBoard = category === "Foam Board";
  const customItems = items.filter((i) => i.category === category && i.kind === "custom");

  function rowFor(kind, size) {
    const id = invItemId(category, kind, size);
    const meta = items.find((i) => i.id === id);
    return { id, stock: stockByItem[id] || 0, threshold: meta?.threshold ?? 5 };
  }

  return (
    <div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {INV_CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${category === c ? "bg-amber-500 text-neutral-950" : "border border-neutral-800 bg-neutral-900 text-neutral-400"}`}>
            {c}
          </button>
        ))}
      </div>

      {isSized ? (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{category} — Standard Sizes</div>
          <div className="space-y-1.5">
            {sizeRowsForCategory(category).map((row) => {
              const r = rowFor("sized", row.size);
              return (
                <InventoryRow key={row.size} label={row.label} id={r.id} stock={r.stock} threshold={r.threshold}
                  category={category} kind="sized" size={row.size} editable={editable}
                  onAdjust={onAdjust} onSetThreshold={onSetThreshold} />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{category}</div>
          {(() => {
            const r = rowFor("sized", "na");
            return (
              <InventoryRow label={category} id={r.id} stock={r.stock} threshold={r.threshold}
                category={category} kind="sized" size={null} editable={editable}
                onAdjust={onAdjust} onSetThreshold={onSetThreshold} />
            );
          })()}
        </div>
      )}

      {hasFullSheet && (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{category} — Full Sheet</div>
          {(() => {
            const r = rowFor("fullsheet", "sheet");
            return (
              <InventoryRow label="Full Sheet" unit="sheets" id={r.id} stock={r.stock} threshold={r.threshold}
                category={category} kind="fullsheet" size="sheet" editable={editable}
                onAdjust={onAdjust} onSetThreshold={onSetThreshold} />
            );
          })()}
        </div>
      )}

      {isFoamBoard && (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Pre-Laid Foam Board</div>
          <div className="space-y-1.5">
            {laidFoamRows().map((row) => {
              const r = rowFor(row.kind, row.size);
              return (
                <InventoryRow key={`${row.size}-${row.kind}`} label={row.label} id={r.id} stock={r.stock} threshold={r.threshold}
                  category={category} kind={row.kind} size={row.size} editable={editable}
                  onAdjust={onAdjust} onSetThreshold={onSetThreshold} />
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Custom Materials Cut — {category}</div>
        <div className="space-y-1.5">
          {customItems.length === 0 && <div className="text-xs text-neutral-600">No custom cuts recorded for {category}.</div>}
          {customItems.map((ci) => (
            <InventoryRow key={ci.id} label={ci.size} id={ci.id} stock={stockByItem[ci.id] || 0} threshold={ci.threshold ?? 5}
              category={category} kind="custom" size={ci.size} editable={editable}
              onAdjust={onAdjust} onSetThreshold={onSetThreshold} />
          ))}
        </div>
        {editable && <CustomMaterialsCut category={category} onRecordCut={onRecordCut} findJobsForCustomSize={findJobsForCustomSize} />}
      </div>

      <MovementHistory moves={moves} items={items} category={category} />
    </div>
  );
}

// Compact quantity picker — a real mini scroll-wheel, not a large dropdown, per the explicit
// "lightweight, mobile-friendly" requirement.
function MiniQtyWheel({ value, onChange, max = 30 }) {
  const numbers = Array.from({ length: max }, (_, i) => String(i + 1));
  return <ScrollWheelPicker items={numbers} value={String(value)} onChange={(v) => onChange(Number(v))} itemHeight={30} visible={3} />;
}

function InventoryRow({ label, unit = "pcs", id, stock, threshold, editable, onAdjust, onSetThreshold, category, kind, size }) {
  const [expanded, setExpanded] = useState(false);
  const [moveQty, setMoveQty] = useState(1);
  const isCustom = kind === "custom";
  const status = isCustom ? (stock <= 0 ? "OUT" : "AVAILABLE") : stockStatus(stock, threshold);
  const badgeCls = status === "OUT" ? "bg-red-500/20 text-red-400" : status === "LOW" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400";
  const meta = { category, kind, size, unit };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${badgeCls}`}>{status}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-xs text-neutral-400">Current stock: {stock} {unit}</span>
        {editable && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onAdjust(id, meta, -1, "Manual Adjustment")}
              className="h-7 w-7 rounded-md border border-neutral-700 text-neutral-400 active:bg-neutral-800">−</button>
            <button onClick={() => onAdjust(id, meta, 1, "Manual Adjustment")}
              className="h-7 w-7 rounded-md border border-neutral-700 text-neutral-400 active:bg-neutral-800">+</button>
            <button onClick={() => setExpanded((e) => !e)} className="text-[10px] text-amber-500 underline">restock / consume</button>
          </div>
        )}
      </div>
      {editable && expanded && (
        <div className="mt-2 space-y-2 border-t border-neutral-800 pt-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">Quantity</span>
            <MiniQtyWheel value={moveQty} onChange={setMoveQty} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onAdjust(id, meta, moveQty, "Restock")}
              className="rounded-md bg-emerald-600/80 py-2 text-xs font-semibold text-white">
              RESTOCK · IN +{moveQty}
              <div className="mt-0.5 font-mono text-[10px] font-normal opacity-80">{stock} → {stock + moveQty}</div>
            </button>
            <button onClick={() => onAdjust(id, meta, -moveQty, "Production")}
              className="rounded-md bg-red-600/80 py-2 text-xs font-semibold text-white">
              CONSUME · OUT −{moveQty}
              <div className="mt-0.5 font-mono text-[10px] font-normal opacity-80">{stock} → {Math.max(0, stock - moveQty)}</div>
            </button>
          </div>
          {!isCustom && (
            <div className="flex items-center gap-2 pt-1">
              <span className="shrink-0 text-[10px] text-neutral-500">Low stock threshold</span>
              <NumberField value={threshold} onCommit={(v) => onSetThreshold(id, meta, v)} min={0} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomMaterialsCut({ category, onRecordCut, findJobsForCustomSize }) {
  const [text, setText] = useState("");
  const [qty, setQty] = useState(1);
  const [matches, setMatches] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [checked, setChecked] = useState(false);

  function checkForJob() {
    const found = findJobsForCustomSize(text);
    setMatches(found);
    setSelectedJob(found.length === 1 ? found[0] : null);
    setChecked(true);
  }

  function submit() {
    if (!text.trim()) return;
    onRecordCut(category, text.trim(), qty, selectedJob);
    setText(""); setQty(1); setMatches([]); setSelectedJob(null); setChecked(false);
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-neutral-800 bg-neutral-950/40 p-2.5">
      <div className="flex gap-2">
        <input value={text} onChange={(e) => { setText(e.target.value); setChecked(false); }}
          placeholder="e.g. 30x56" className="input text-xs" />
        <NumberField value={qty} onCommit={setQty} min={1} />
      </div>
      {!checked && text.trim() && (
        <button onClick={checkForJob} className="w-full rounded-md border border-neutral-700 py-1.5 text-xs text-neutral-300">
          Check for matching job
        </button>
      )}
      {checked && matches.length === 0 && (
        <p className="text-[10px] text-neutral-500">No active job uses this custom size — will be recorded without a job link.</p>
      )}
      {checked && matches.length === 1 && (
        <div className="rounded-md border border-amber-700/60 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-300">
          Detected: <strong>{matches[0].clientName}</strong> {matches[0].jobRef ? `#${matches[0].jobRef}` : ""} — this cut will be linked to that job.
        </div>
      )}
      {checked && matches.length > 1 && (
        <div className="space-y-1">
          <p className="text-[10px] text-neutral-500">Multiple jobs use this size — pick one:</p>
          <select value={selectedJob?.id || ""} onChange={(e) => setSelectedJob(matches.find((j) => j.id === e.target.value) || null)} className="input text-xs">
            <option value="">— no job link —</option>
            {matches.map((j) => <option key={j.id} value={j.id}>{j.clientName} {j.jobRef ? `#${j.jobRef}` : ""}</option>)}
          </select>
        </div>
      )}
      {checked && (
        <button onClick={submit} className="w-full rounded-md bg-amber-500 py-1.5 text-xs font-semibold text-neutral-950">
          Record Cut{selectedJob ? ` → ${selectedJob.clientName}` : ""}
        </button>
      )}
    </div>
  );
}

function MovementHistory({ moves, items, category }) {
  const categoryItemIds = new Set(items.filter((i) => i.category === category).map((i) => i.id));
  // Standard/full-sheet items may not have an inv:item record yet (lazily created on first movement),
  // so also match by itemId prefix for this category as a fallback.
  const catSlug = category.replace(/\s+/g, "").toLowerCase();
  const relevant = moves
    .filter((m) => categoryItemIds.has(m.itemId) || m.itemId.startsWith(`${catSlug}_`))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Recent Movement — {category}</div>
      <div className="space-y-1.5">
        {relevant.length === 0 && <div className="text-xs text-neutral-600">No stock movements recorded yet for {category}.</div>}
        {relevant.map((m, i) => (
          <div key={i} className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px]">
            <span className={m.qtyChange >= 0 ? "text-emerald-400" : "text-red-400"}>
              {m.qtyChange >= 0 ? "+" : ""}{m.qtyChange} · {m.reason}{m.jobRef ? ` · Job: ${m.jobRef}` : ""}
            </span>
            <span className="font-mono text-neutral-500">Recorded by {m.person} · {elapsed(m.timestamp)} ago</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- JOB FORM ----------------
function CollapsibleModule({ title, active, children }) {
  const [expanded, setExpanded] = useState(true);
  if (!active) return null; // unmounting does NOT delete data — it lives on the job object regardless
  return (
    <div className="rounded-md border border-amber-800/40 bg-neutral-950/50 p-3">
      <button onClick={() => setExpanded((e) => !e)} className="mb-2 flex w-full items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-amber-500">{title}</span>
        <ChevronRight size={14} className={`text-neutral-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && <div className="space-y-2.5">{children}</div>}
    </div>
  );
}
function MaterialsMultiSelect({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button key={opt} onClick={() => onToggle(opt)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${selected.includes(opt) ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function JobForm({ apcName, initial, mode = "create", onSave, onCancel }) {
  const [job, setJob] = useState(() => (initial ? { ...initial } : defaultJob(apcName)));

  function updateLine(id, patch) {
    setJob((j) => ({ ...j, sizeLines: j.sizeLines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setJob((j) => ({ ...j, sizeLines: [...j.sizeLines, { id: newId("sl"), size: "12x16", customSize: "", colours: [], frameType: "2022", frameTypeCustom: "", frameTypeTouched: false, qty: 1 }] }));
  }
  function removeLine(id) {
    setJob((j) => ({ ...j, sizeLines: j.sizeLines.length > 1 ? j.sizeLines.filter((l) => l.id !== id) : j.sizeLines }));
  }
  function toggleColour(lineId, code) {
    setJob((j) => ({
      ...j,
      sizeLines: j.sizeLines.map((l) => l.id !== lineId ? l : {
        ...l, colours: l.colours.includes(code) ? l.colours.filter((c) => c !== code) : [...l.colours, code],
      }),
    }));
  }
  function setPriority(p) {
    setJob((j) => ({ ...j, priority: p, expressStartedAt: p === "express" && !j.expressStartedAt ? Date.now() : j.expressStartedAt }));
  }
  function toggleJobType(key) {
    setJob((j) => ({ ...j, jobTypes: { ...j.jobTypes, [key]: !j.jobTypes[key] } }));
  }
  function patchFramed(p) { setJob((j) => ({ ...j, framed: { ...j.framed, ...p } })); }
  function patchCanvas(p) { setJob((j) => ({ ...j, canvas: { ...j.canvas, ...p } })); }
  function patchTbr(p) { setJob((j) => ({ ...j, tbr: { ...j.tbr, ...p } })); }
  function toggleFramingStyle(style) {
    patchFramed({ framingStyles: job.framed.framingStyles.includes(style) ? job.framed.framingStyles.filter((s) => s !== style) : [...job.framed.framingStyles, style] });
  }
  function toggleFramedMaterial(mat) {
    patchFramed({ materials: job.framed.materials.includes(mat) ? job.framed.materials.filter((m) => m !== mat) : [...job.framed.materials, mat] });
  }
  function toggleCanvasMaterial(mat) {
    patchCanvas({ materials: job.canvas.materials.includes(mat) ? job.canvas.materials.filter((m) => m !== mat) : [...job.canvas.materials, mat] });
  }
  function toggleTbrCategory(cat) {
    patchTbr({ categories: job.tbr.categories.includes(cat) ? job.tbr.categories.filter((c) => c !== cat) : [...job.tbr.categories, cat] });
  }
  function toggleTbrKind(kind) {
    patchTbr({ kinds: { ...job.tbr.kinds, [kind]: !job.tbr.kinds[kind] } });
  }
  function toggleTbrMaterial(mat) {
    patchTbr({ materials: job.tbr.materials.includes(mat) ? job.tbr.materials.filter((m) => m !== mat) : [...job.tbr.materials, mat] });
  }

  const canSave = job.clientName.trim().length > 0;

  return (
    <div className="mb-4 rounded-lg border border-amber-700/40 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{mode === "edit" ? "Edit Order" : "New Order"}</h2>
        <button onClick={onCancel} className="text-neutral-500"><X size={18} /></button>
      </div>

      <div className="space-y-3">
        <Field label="Client name">
          <input value={job.clientName} onChange={(e) => setJob({ ...job, clientName: e.target.value })}
            placeholder="e.g. Olajire" className="input" />
        </Field>
        <Field label="Job / Order Reference">
          <input value={job.jobRef} onChange={(e) => setJob({ ...job, jobRef: e.target.value })}
            placeholder="internal reference for this order" className="input" />
        </Field>

        <Field label="Job Type — select all that apply">
          <div className="flex gap-2">
            {[["framed", "Framed"], ["canvas", "Canvas"], ["tbr", "TBR"]].map(([key, label]) => (
              <button key={key} onClick={() => toggleJobType(key)}
                className={`flex-1 rounded-md border py-2 text-xs font-semibold ${job.jobTypes[key] ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        {/* ---------------- FRAMED MODULE ---------------- */}
        <CollapsibleModule title="Framed" active={job.jobTypes.framed}>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Size lines</span>
              <button onClick={addLine} className="flex items-center gap-1 text-xs text-amber-500"><Plus size={13} /> Add size</button>
            </div>
            <div className="space-y-2">
              {job.sizeLines.map((line, idx) => (
                <SizeLineEditor key={line.id} line={line} idx={idx}
                  onChange={(patch) => updateLine(line.id, patch)}
                  onToggleColour={(c) => toggleColour(line.id, c)}
                  onRemove={() => removeLine(line.id)}
                  removable={job.sizeLines.length > 1} />
              ))}
            </div>
          </div>

          <Field label="Paper type">
            <Segmented options={["PLP", "FAP", "Other"]} value={job.framed.paperType} onChange={(v) => patchFramed({ paperType: v })} />
            {job.framed.paperType === "Other" && <input value={job.framed.paperTypeCustom} onChange={(e) => patchFramed({ paperTypeCustom: e.target.value })} placeholder="specify" className="input mt-1.5" />}
          </Field>

          <Field label="Framing style">
            <MaterialsMultiSelect options={FRAMING_STYLES} selected={job.framed.framingStyles} onToggle={toggleFramingStyle} />
            {job.framed.framingStyles.includes("Other") && <input value={job.framed.framingStyleCustom} onChange={(e) => patchFramed({ framingStyleCustom: e.target.value })} placeholder="specify" className="input mt-1.5" />}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mat colour">
              <ScrollWheelPicker items={MAT_COLOURS} value={job.framed.matColour} onChange={(v) => patchFramed({ matColour: v })} itemHeight={32} visible={3} />
              {job.framed.matColour === "Custom" && <input value={job.framed.matColourCustom} onChange={(e) => patchFramed({ matColourCustom: e.target.value })} placeholder="colour" className="input mt-1.5" />}
            </Field>
            <Field label="Matting style">
              <ScrollWheelPicker items={MATTING_STD} value={job.framed.mattingStyle} onChange={(v) => patchFramed({ mattingStyle: v })} itemHeight={32} visible={3} />
              {job.framed.mattingStyle === "Custom" && <input value={job.framed.mattingCustom} onChange={(e) => patchFramed({ mattingCustom: e.target.value })} placeholder="e.g. uneven / multi-window" className="input mt-1.5" />}
            </Field>
          </div>

          <Field label="Materials Needed">
            <MaterialsMultiSelect options={FRAMED_MATERIAL_OPTIONS} selected={job.framed.materials} onToggle={toggleFramedMaterial} />
          </Field>
        </CollapsibleModule>

        {/* ---------------- CANVAS MODULE ---------------- */}
        <CollapsibleModule title="Canvas" active={job.jobTypes.canvas}>
          <Field label="Quality">
            <Segmented options={CANVAS_QUALITY} value={job.canvas.quality} onChange={(v) => patchCanvas({ quality: v })} />
          </Field>
          <Field label="Style">
            <Segmented options={CANVAS_STYLE} value={job.canvas.style} onChange={(v) => patchCanvas({ style: v })} />
            {job.canvas.style === "Other" && <input value={job.canvas.styleCustom} onChange={(e) => patchCanvas({ styleCustom: e.target.value })} placeholder="specify" className="input mt-1.5" />}
          </Field>
          <Field label="Stretcher">
            <ScrollWheelPicker items={STRETCHER_LABELS} value={STRETCHER_LABELS.find((l) => l.startsWith(job.canvas.stretcher))}
              onChange={(label) => patchCanvas({ stretcher: label.split(" ")[0] })} itemHeight={36} visible={3} />
          </Field>

          <Field label="Stretcher Cutting">
            <CuttingRow value={job.canvas.stretcherCutting} onChange={(v) => patchCanvas({ stretcherCutting: v })} />
          </Field>
          {job.canvas.style !== "SO" && (
            <Field label="Frame Cutting">
              <CuttingRow value={job.canvas.frameCutting} onChange={(v) => patchCanvas({ frameCutting: v })} />
            </Field>
          )}

          <Field label="Frame specification">
            <input value={job.canvas.frameSpec} onChange={(e) => patchCanvas({ frameSpec: e.target.value })}
              placeholder="e.g. 2030 black, or client-supplied frame" className="input" />
          </Field>
          <Field label="Materials Needed">
            <MaterialsMultiSelect options={CANVAS_MATERIAL_OPTIONS} selected={job.canvas.materials} onToggle={toggleCanvasMaterial} />
          </Field>
        </CollapsibleModule>

        {/* ---------------- TBR MODULE ---------------- */}
        <CollapsibleModule title="TBR" active={job.jobTypes.tbr}>
          <Field label="TBR Category">
            <MaterialsMultiSelect options={TBR_CATEGORIES} selected={job.tbr.categories} onToggle={toggleTbrCategory} />
          </Field>

          {job.tbr.categories.includes("Canvas") && (
            <div className="rounded-md border border-neutral-800 p-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">TBR → Canvas requirements</div>
              <Field label="Style">
                <Segmented options={CANVAS_STYLE} value={job.tbr.canvasSub.style} onChange={(v) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, style: v } })} />
                {job.tbr.canvasSub.style === "Other" && <input value={job.tbr.canvasSub.styleCustom} onChange={(e) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, styleCustom: e.target.value } })} placeholder="specify" className="input mt-1.5" />}
              </Field>
              <Field label="Stretcher">
                <ScrollWheelPicker items={STRETCHER_LABELS} value={STRETCHER_LABELS.find((l) => l.startsWith(job.tbr.canvasSub.stretcher))}
                  onChange={(label) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, stretcher: label.split(" ")[0] } })} itemHeight={32} visible={3} />
              </Field>
              <Field label="Stretcher Cutting">
                <CuttingRow value={job.tbr.canvasSub.stretcherCutting} onChange={(v) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, stretcherCutting: v } })} />
              </Field>
              {job.tbr.canvasSub.style !== "SO" && (
                <Field label="Frame Cutting">
                  <CuttingRow value={job.tbr.canvasSub.frameCutting} onChange={(v) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, frameCutting: v } })} />
                </Field>
              )}
              <Field label="Frame specification">
                <input value={job.tbr.canvasSub.frameSpec} onChange={(e) => patchTbr({ canvasSub: { ...job.tbr.canvasSub, frameSpec: e.target.value } })} placeholder="specify" className="input" />
              </Field>

            </div>
          )}
          {job.tbr.categories.includes("Image") && (
            <div className="rounded-md border border-neutral-800 p-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">TBR → Image requirements</div>
              <Field label="Size">
                <input value={job.tbr.imageSub.size} onChange={(e) => patchTbr({ imageSub: { ...job.tbr.imageSub, size: e.target.value } })}
                  placeholder="e.g. 23 x 34" className="input" />
              </Field>
              <Field label="Frame specification">
                <input value={job.tbr.imageSub.frameSpec} onChange={(e) => patchTbr({ imageSub: { ...job.tbr.imageSub, frameSpec: e.target.value } })}
                  placeholder="specify frame" className="input" />
              </Field>
            </div>
          )}
          {job.tbr.categories.includes("Item") && (
            <div className="rounded-md border border-neutral-800 p-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">TBR → Item requirements</div>
              <Field label="Item description">
                <input value={job.tbr.itemSub.description} onChange={(e) => patchTbr({ itemSub: { ...job.tbr.itemSub, description: e.target.value } })} placeholder="what is the item" className="input" />
              </Field>
              <Field label="Size (if applicable)">
                <input value={job.tbr.itemSub.size} onChange={(e) => patchTbr({ itemSub: { ...job.tbr.itemSub, size: e.target.value } })} placeholder="e.g. 30x56 or describe" className="input" />
              </Field>
              <Field label="Frame / specification">
                <input value={job.tbr.itemSub.frameSpec} onChange={(e) => patchTbr({ itemSub: { ...job.tbr.itemSub, frameSpec: e.target.value } })} placeholder="specify" className="input" />
              </Field>
            </div>
          )}
          {job.tbr.categories.includes("Other") && (
            <div className="rounded-md border border-neutral-800 p-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">TBR → Other requirements</div>
              <textarea value={job.tbr.otherSub.notes} onChange={(e) => patchTbr({ otherSub: { notes: e.target.value } })}
                placeholder="describe what's required" rows={2} className="input resize-none" />
            </div>
          )}

          <Field label="TBR Type">
            <div className="flex gap-2">
              <button onClick={() => toggleTbrKind("IN")}
                className={`flex-1 rounded-md border py-2 text-sm font-semibold ${job.tbr.kinds.IN ? "border-blue-500 bg-blue-500/20 text-blue-400" : "border-neutral-700 text-neutral-500"}`}>IN</button>
              <button onClick={() => toggleTbrKind("ER")}
                className={`flex-1 rounded-md border py-2 text-sm font-semibold ${job.tbr.kinds.ER ? "border-red-500 bg-red-500/20 text-red-400" : "border-neutral-700 text-neutral-500"}`}>ER</button>
            </div>
          </Field>

          <Field label="TBR Materials Needed">
            <MaterialsMultiSelect options={TBR_MATERIAL_OPTIONS} selected={job.tbr.materials} onToggle={toggleTbrMaterial} />
          </Field>
        </CollapsibleModule>

        <Field label="Priority">
          <div className="flex gap-2">
            {[["normal", "Normal", null], ["high", "High Priority", ArrowUp], ["express", "Express", Zap]].map(([val, lab, Icon]) => (
              <button key={val} onClick={() => setPriority(val)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md border py-2 text-xs font-semibold ${job.priority === val ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
                {Icon && <Icon size={13} />} {lab}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes">
          <textarea value={job.notes} onChange={(e) => setJob({ ...job, notes: e.target.value })} rows={2} className="input resize-none" />
        </Field>

        <button onClick={() => onSave(job)} disabled={!canSave}
          className="w-full rounded-md bg-amber-500 py-3 font-semibold text-neutral-950 disabled:opacity-40">
          {mode === "edit" ? "Save Changes" : "Save Order"}
        </button>
      </div>

    </div>
  );
}

function SizeLineEditor({ line, idx, onChange, onToggleColour, onRemove, removable }) {
  const recommended = line.size !== "Other" ? FRAME_RECOMMEND[line.size] : null;

  function handleSizeChange(newSize) {
    onChange({
      size: newSize,
      // Only auto-fill the recommendation if the APC hasn't deliberately chosen a frame type
      // for this line yet — a deliberate choice must never be silently overwritten.
      frameType: line.frameTypeTouched ? line.frameType : (FRAME_RECOMMEND[newSize] || line.frameType),
    });
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/50 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-neutral-500">Size line {idx + 1}</span>
        {removable && <button onClick={onRemove} className="text-neutral-600"><Trash2 size={14} /></button>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-center text-[9px] uppercase tracking-wide text-neutral-600">Size</div>
          <ScrollWheelPicker items={SIZES} value={line.size} onChange={handleSizeChange} itemHeight={36} visible={3} />
        </div>
        <div>
          <div className="mb-1 text-center text-[9px] uppercase tracking-wide text-neutral-600">Quantity</div>
          <div className="flex h-full items-center">
            <NumberField value={line.qty} onCommit={(v) => onChange({ qty: v })} />
          </div>
        </div>
      </div>
      {line.size === "Other" && (
        <input value={line.customSize} onChange={(e) => onChange({ customSize: e.target.value })} placeholder="specify size" className="input mt-2" />
      )}

      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">
          Frame type {recommended && <span className="text-amber-500">· recommended {recommended}</span>}
        </div>
        <div className="flex gap-1.5">
          {["2022", "2030", "Other"].map((t) => (
            <button key={t} onClick={() => onChange({ frameType: t, frameTypeTouched: true })}
              className={`flex-1 rounded-md border py-1.5 text-xs font-medium ${line.frameType === t ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
              {t}{t === recommended ? " ★" : ""}
            </button>
          ))}
        </div>
        {line.frameType === "Other" && <input value={line.frameTypeCustom} onChange={(e) => onChange({ frameTypeCustom: e.target.value })} placeholder="specify frame type" className="input mt-1.5" />}
      </div>

      <div className="mt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">Frame colour (multi-select)</div>
        <div className="flex flex-wrap gap-1.5">
          {COLOURS.map(([code, label]) => (
            <button key={code} onClick={() => onToggleColour(code)} title={label}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${line.colours.includes(code) ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
              {code}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CuttingRow({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value })}
        placeholder="e.g. 30 x 56" className="input" />
      <NumberField value={value.qty} onCommit={(v) => onChange({ ...value, qty: v })} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</label>
      {children}
    </div>
  );
}
function NumberField({ value, onCommit, min = 1 }) {
  // Local string state so the field can be fully cleared/retyped on mobile —
  // the min-1 clamp only applies on blur, not on every keystroke.
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  function commit() {
    const n = parseInt(text, 10);
    const clamped = Number.isFinite(n) && n >= min ? n : min;
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onCommit(Math.max(min, value - 1))}
        className="h-9 w-9 shrink-0 rounded-md border border-neutral-700 text-lg text-neutral-400 active:bg-neutral-800">−</button>
      <input inputMode="numeric" pattern="[0-9]*" value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()}
        className="input w-full text-center" />
      <button type="button" onClick={() => onCommit(value + 1)}
        className="h-9 w-9 shrink-0 rounded-md border border-neutral-700 text-lg text-neutral-400 active:bg-neutral-800">+</button>
    </div>
  );
}
function Segmented({ options, value, onChange, small }) {
  return (
    <div className={`flex gap-1.5 ${small ? "" : "flex-wrap"}`}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={`rounded-md border ${small ? "px-3 py-1 text-xs" : "px-2.5 py-1.5 text-xs"} font-medium ${value === o ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-700 text-neutral-500"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------------- JOB CARD ----------------
function JobCard({ job, apcName, now = Date.now(), editable, onPatch, onEdit, onRecordCut, canMessage, onAddMessage, stockByItem = {}, inventoryItems = [] }) {
  const [expanded, setExpanded] = useState(false);
  const bn = bottleneckOf(job);
  const isExpress = job.priority === "express";
  const isHigh = job.priority === "high";
  const materialsStatus = materialsStatusForJob(job, stockByItem, inventoryItems);

  return (
    <div className={`rounded-lg border p-3 ${isExpress ? "border-red-700/60 bg-red-950/10" : "border-neutral-800 bg-neutral-900"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{job.clientName || "(unnamed)"}</span>
            {job.jobRef && <span className="font-mono text-[10px] text-neutral-500">#{job.jobRef}</span>}
          </div>
          {getJobTypes(job).framed && (
            <div className="mt-0.5 flex flex-wrap gap-1 font-mono text-[10px] text-neutral-500">
              {job.sizeLines.map((l) => {
                const ft = l.frameType === "Other" ? (l.frameTypeCustom || "Other") : l.frameType;
                return (
                  <span key={l.id}>
                    {l.size === "Other" ? l.customSize : l.size} × {l.qty} — {ft}{l.colours.length ? ` — ${l.colours.join("/")}` : ""}
                  </span>
                );
              })}
              <span className="text-neutral-600">· Total: {job.quantity} pcs</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isExpress && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-red-400">
              <Zap size={10} /> Express · {elapsed(job.expressStartedAt, now)}
            </span>
          )}
          {isHigh && !isExpress && (
            <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-400">
              <ArrowUp size={10} /> High priority
            </span>
          )}
          {getJobTypes(job).tbr && (
            <>
              {getTbrCategories(job).map((cat) => {
                const kinds = getTbrKinds(job);
                const kindLabel = [kinds.IN && "IN", kinds.ER && "ER"].filter(Boolean).join("+") || "—";
                const tone = kinds.ER ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400";
                return (
                  <span key={cat} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>
                    TBR • {cat} • {kindLabel}
                  </span>
                );
              })}
              {getTbrCategories(job).length === 0 && (
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-400">TBR</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">Materials Needed</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {materialsStatus.length > 0 ? (
            materialsStatus.map((m, i) => {
              const cls = m.status === "OUT" ? "border-red-700 bg-red-950/40 text-red-300"
                : m.status === "LOW" ? "border-amber-700 bg-amber-950/30 text-amber-300"
                : m.status === "INSUFFICIENT" ? "border-orange-700 bg-orange-950/30 text-orange-300"
                : m.status === "REQUIRED" ? "border-neutral-600 bg-neutral-800/60 text-neutral-400"
                : "border-emerald-700 bg-emerald-950/30 text-emerald-300";
              return <span key={i} className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{m.label} · {m.status}</span>;
            })
          ) : (
            <span className="text-[10px] text-neutral-600">No materials selected</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_BADGE[job.status].cls}`}>
          {STATUS_BADGE[job.status].label}
        </span>
      </div>

      <ProgressStepper job={job} />

      <div className="mt-2 flex items-center justify-between">
        <span className={`text-xs font-semibold ${bn.stage === "done" ? "text-emerald-400" : "text-amber-400"}`}>{bn.label}</span>
        {job.delayed.active && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-400">
            DELAYED • {job.delayed.reason === "Other" ? job.delayed.customReason : job.delayed.reason}
          </span>
        )}
      </div>
      {job.imageStatus === "WAITING" && (
        <div className="mt-1 font-mono text-xs text-amber-400">
          Waiting: {job.imageWaitingSince ? formatHMS(now - job.imageWaitingSince) : "—"}
        </div>
      )}

      {editable && (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-1 text-xs text-neutral-500 underline">
            <ChevronRight size={12} className={expanded ? "rotate-90" : ""} /> {expanded ? "hide controls" : "manage job"}
          </button>
          {onEdit && <button onClick={onEdit} className="text-xs text-amber-500 underline">edit order</button>}
        </div>
      )}

      {editable && expanded && <JobControls job={job} apcName={apcName} onPatch={onPatch} onRecordCut={onRecordCut} />}

      {(job.managementMessages?.length > 0 || canMessage) && (
        <JobMessageBlock job={job} canMessage={canMessage} onAddMessage={onAddMessage} />
      )}
    </div>
  );
}

function JobMessageBlock({ job, canMessage, onAddMessage }) {
  const [text, setText] = useState("");
  const messages = job.managementMessages || [];
  return (
    <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Job Message</div>
      {messages.length === 0 && <div className="text-[10px] text-neutral-600">No messages yet.</div>}
      <div className="space-y-1">
        {messages.map((m, i) => (
          <div key={i} className="text-[11px] text-neutral-300">
            <span className="text-neutral-500">{m.by}:</span> {m.text}
          </div>
        ))}
      </div>
      {canMessage && (
        <div className="mt-1.5 flex gap-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a message for this job…" className="input text-xs" />
          <button
            onClick={() => { if (text.trim()) { onAddMessage(job.id, text.trim()); setText(""); } }}
            className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-neutral-950"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function ProgressStepper({ job }) {
  const stages = [
    { key: "materials", label: "Materials", tone: job.materials === "READY" ? "done" : "pending" },
    { key: "image", label: "Image", tone: job.imageStatus === "READY" ? "done" : "pending" },
    { key: "assembly", label: "Assembly", tone: job.assembly === "DONE" ? "done" : "pending" },
    {
      key: "fulfillment", label: "Fulfillment",
      tone: job.fulfillment.status === "COMPLETED" ? "done"
        : (job.fulfillment.status === "IN_FULFILLMENT" || job.fulfillment.status === "WATER_TAPING") ? "active" : "pending",
    },
  ];
  const barColor = { done: "bg-emerald-500", active: "bg-blue-500", pending: "bg-neutral-700" };
  return (
    <div className="mt-2 flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center gap-1">
          <div className={`h-1.5 flex-1 rounded-full ${barColor[s.tone]}`} />
          {i < stages.length - 1 && <div className="h-1 w-1" />}
        </div>
      ))}
    </div>
  );
}

function JobControls({ job, apcName, onPatch, onRecordCut }) {
  const [contact, setContact] = useState(CONTACTS[0]);
  const [note, setNote] = useState("");
  const [delayReason, setDelayReason] = useState(DELAY_REASONS[0]);
  const [delayCustom, setDelayCustom] = useState("");

  return (
    <div className="mt-3 space-y-3 border-t border-neutral-800 pt-3">
      {/* priority (editable after creation) */}
      <MiniRow label="Priority">
        <Segmented small options={["normal", "high", "express"]} value={job.priority} onChange={(v) => onPatch({ priority: v })} />
      </MiniRow>

      {/* materials — manual overall status only; NOT a real inventory check (Step 3) */}
      <MiniRow label="Materials Status">
        <Segmented small options={["MISSING", "READY"]} value={job.materials} onChange={(v) => onPatch({ materials: v })} />
      </MiniRow>

      {/* image */}
      <MiniRow label="Image / Print">
        <Segmented small options={["WAITING", "READY"]} value={job.imageStatus} onChange={(v) => onPatch({ imageStatus: v })} />
      </MiniRow>
      {job.imageStatus === "WAITING" && (
        <div className="rounded-md bg-neutral-950/50 p-2">
          <div className="flex flex-wrap gap-2">
            <select value={contact} onChange={(e) => setContact(e.target.value)} className="input !w-auto text-xs">
              {CONTACTS.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional note" className="input !w-auto flex-1 text-xs" />
            <button onClick={() => {
              onPatch({ imageRequests: [...job.imageRequests, { contact, requestedBy: apcName, requestedAt: Date.now(), note: note || undefined }] });
              setNote("");
            }} className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-neutral-950">Request update</button>
          </div>
          {job.imageRequests.length > 0 && (
            <div className="mt-2 space-y-0.5 font-mono text-[10px] text-neutral-500">
              {job.imageRequests.map((r, i) => (
                <div key={i}>{new Date(r.requestedAt).toLocaleString()} · {r.requestedBy} → {r.contact}{r.note ? ` · "${r.note}"` : ""}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* assembly */}
      <MiniRow label="Assembly">
        <Segmented small options={["NOT_STARTED", "IN_PROGRESS", "DONE"]} value={job.assembly}
          onChange={(v) => onPatch({ assembly: v })} />
      </MiniRow>

      {(getJobTypes(job).canvas || getTbrCategories(job).includes("Canvas")) && (
        <CutSyncBlock job={job} onRecordCut={onRecordCut} />
      )}

      {/* fulfillment — single status; Water Taping is an optional stage within it, not a separate gate.
          Flow: PENDING → IN_FULFILLMENT → (optionally) WATER_TAPING → COMPLETED */}
      <MiniRow label="Fulfillment">
        {job.assembly !== "DONE" ? (
          <span className="text-xs text-neutral-600">unlocks after Assembly is done</span>
        ) : (
          <Segmented small options={["PENDING", "IN_FULFILLMENT", "WATER_TAPING", "COMPLETED"]} value={job.fulfillment.status}
            onChange={(v) => onPatch({ fulfillment: { ...job.fulfillment, status: v } })} />
        )}
      </MiniRow>

      {/* blocker — same underlying delayed{active,reason} data, presented as one pill row (None = not delayed) */}
      <div>
        <div className="mb-1.5 text-xs text-neutral-500">Blocker</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onPatch({ delayed: { active: false, reason: "", customReason: "" } })}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${!job.delayed.active ? "border-emerald-600 bg-emerald-500/15 text-emerald-400" : "border-neutral-700 text-neutral-500"}`}
          >
            None
          </button>
          {DELAY_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => onPatch({ delayed: { active: true, reason: r, customReason: job.delayed.reason === r ? job.delayed.customReason : "", markedBy: apcName, markedAt: Date.now() } })}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${job.delayed.active && job.delayed.reason === r ? "border-red-600 bg-red-500/15 text-red-400" : "border-neutral-700 text-neutral-500"}`}
            >
              {r}
            </button>
          ))}
        </div>
        {job.delayed.active && job.delayed.reason === "Other" && (
          <input value={job.delayed.customReason} onChange={(e) => onPatch({ delayed: { ...job.delayed, customReason: e.target.value } })} placeholder="specify" className="input mt-1.5 text-xs" />
        )}
      </div>
    </div>
  );
}

function CutSyncBlock({ job, onRecordCut }) {
  const [synced, setSynced] = useState({});
  const entries = [];
  if (getJobTypes(job).canvas) {
    entries.push({ key: "canvas-stretcher", label: "Stretcher Cutting (Canvas)", category: "Stretcher", cut: job.canvas.stretcherCutting });
    if (job.canvas.style !== "SO") entries.push({ key: "canvas-frame", label: "Frame Cutting (Canvas)", category: "Frame", cut: job.canvas.frameCutting });
  }
  if (getTbrCategories(job).includes("Canvas")) {
    entries.push({ key: "tbr-stretcher", label: "Stretcher Cutting (TBR)", category: "Stretcher", cut: job.tbr.canvasSub.stretcherCutting });
    if (job.tbr.canvasSub.style !== "SO") entries.push({ key: "tbr-frame", label: "Frame Cutting (TBR)", category: "Frame", cut: job.tbr.canvasSub.frameCutting });
  }
  const usable = entries.filter((e) => e.cut?.size?.trim());
  if (usable.length === 0) return null;

  async function sync(entry) {
    const ok = await onRecordCut(entry.category, entry.cut.size.trim(), entry.cut.qty || 1, job);
    if (ok) setSynced((s) => ({ ...s, [entry.key]: `${entry.cut.size.trim()}|${entry.cut.qty}` }));
  }

  return (
    <div className="rounded-md bg-neutral-950/50 p-2 space-y-1.5">
      <div className="text-xs text-neutral-500">Sync cuts to Inventory</div>
      {usable.map((e) => {
        const currentKey = `${e.cut.size.trim()}|${e.cut.qty}`;
        const isSynced = synced[e.key] === currentKey;
        return (
          <div key={e.key} className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-400">{e.label}: {e.cut.size} × {e.cut.qty}</span>
            {isSynced ? (
              <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> Synced</span>
            ) : (
              <button onClick={() => sync(e)} className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-semibold text-neutral-950">Sync</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </div>
  );
}

// ---------------- DASHBOARD STATS (shared by APC + Management, same live shared data) ----------------
function InventoryWarnings({ items, stockByItem }) {
  if (items.length === 0) return null; // no real inventory data recorded yet — show nothing, never fabricate
  const alerts = items
    .map((i) => {
      const stock = stockByItem[i.id] || 0;
      // Custom/random-size stock never triggers the standard low-stock-threshold warning —
      // a quantity of 1 or 2 is completely normal for a one-off custom cut.
      const status = i.kind === "custom" ? (stock <= 0 ? "OUT" : "READY") : stockStatus(stock, i.threshold ?? 5);
      return { ...i, stock, status };
    })
    .filter((i) => i.status !== "READY");
  if (alerts.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Inventory Warnings</div>
      <div className="space-y-1.5">
        {alerts.map((a) => (
          <div key={a.id} className={`rounded-md border px-2.5 py-1.5 text-[11px] ${a.status === "OUT" ? "border-red-700 bg-red-950/30 text-red-300" : "border-amber-700 bg-amber-950/20 text-amber-300"}`}>
            {a.category}{a.size && a.size !== "na" ? ` @ ${a.size}` : ""}{a.kind === "custom" ? " (custom)" : ""} — {a.status} ({a.stock} {a.unit})
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardStats({ jobs }) {
  const count = (f) => jobs.filter(f).length;
  const stats = [
    ["Total Jobs", jobs.length],
    ["In Production", count((j) => j.status === "ACTIVE")],
    ["Ready for Fulfillment", count((j) => j.status === "READY_FOR_FULFILLMENT")],
    ["In Fulfillment", count((j) => j.status === "IN_FULFILLMENT")],
    ["Final Completed", count((j) => j.status === "COMPLETED")],
    ["Express", count((j) => j.priority === "express")],
    ["High Priority", count((j) => j.priority === "high")],
    ["Waiting for Image", count((j) => j.imageStatus === "WAITING")],
    ["Delayed", count((j) => j.delayed?.active)],
    ["Water Taping Pending", count((j) => j.fulfillment.status === "WATER_TAPING")],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      {stats.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-center">
          <div className="text-xl font-semibold">{value}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-neutral-500">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- HR (image/print workflow only) ----------------
function HRView({ jobs, onUpdateImage }) {
  const relevant = jobs.filter((j) => j.imageStatus === "WAITING" || j.imageRequests.length > 0);
  return (
    <div>
      <div className="mb-4 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-500">
        HR view is scoped to the image/print follow-up workflow only.
      </div>
      <div className="space-y-2">
        {relevant.length === 0 && <EmptyState text="No jobs are currently waiting on image/print." />}
        {relevant.map((job) => {
          const last = job.imageRequests[job.imageRequests.length - 1];
          const acknowledged = last?.requestedBy === "HR" && last?.note === "Acknowledged";
          return (
            <div key={job.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{job.clientName}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${job.imageStatus === "WAITING" ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                  {job.imageStatus === "WAITING" ? "Waiting for image" : "Ready"}
                </span>
              </div>
              {last && <div className="mt-1 font-mono text-[11px] text-neutral-400">latest: requested from {last.contact} · {elapsed(last.requestedAt)} ago</div>}
              <div className="mt-2 space-y-0.5 border-t border-neutral-800 pt-2 font-mono text-[10px] text-neutral-500">
                {job.imageRequests.map((r, i) => (
                  <div key={i}>{new Date(r.requestedAt).toLocaleString()} · {r.requestedBy} → {r.contact}{r.note ? ` · "${r.note}"` : ""}</div>
                ))}
              </div>
              {job.imageStatus === "WAITING" && (
                <div className="mt-2 flex gap-2 border-t border-neutral-800 pt-2">
                  {!acknowledged && (
                    <button
                      onClick={() => onUpdateImage(job.id, { imageRequests: [...job.imageRequests, { contact: "Ghiazat", requestedBy: "HR", requestedAt: Date.now(), note: "Acknowledged" }] })}
                      className="flex-1 rounded-md border border-neutral-700 py-1.5 text-xs text-neutral-300"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => onUpdateImage(job.id, { imageStatus: "READY" })}
                    className="flex-1 rounded-md border border-emerald-800 bg-emerald-950/40 py-1.5 text-xs text-emerald-400"
                  >
                    Mark Ready
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-500"><Eye size={14} /> {text}</div>;
}
