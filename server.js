const express = require("express");
const path = require("path");
require("dotenv").config();
const { initializeFirebaseAdmin, isFirebaseReady, readFromFirebase, writeToFirebase } = require("./firebaseAdmin");
const { isConfigured: isPostgresConfigured, readStore: readPostgresStore, writeStore: writePostgresStore, healthCheck: postgresHealthCheck } = require("./db/postgresStore");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";
const API_ACCESS_KEY = process.env.API_ACCESS_KEY || "";
const DB_MODE = String(process.env.DB_MODE || "firebase").trim().toLowerCase();
const SUPPORTED_DB_MODES = ["firebase", "postgres", "postgres_firebase_mirror"];
const USE_POSTGRES_PRIMARY = DB_MODE === "postgres" || DB_MODE === "postgres_firebase_mirror";
const USE_FIREBASE_PRIMARY = DB_MODE === "firebase";
const USE_FIREBASE_MIRROR_WRITE = DB_MODE === "postgres_firebase_mirror";

const DATA_FILE = path.join(__dirname, "data", "fa_leave_requests.json");
const WARDEN_LEAVE_FILE = path.join(__dirname, "data", "warden_leave_requests.json");
const WARDEN_STUDENTS_FILE = path.join(__dirname, "data", "warden_students.json");
const STUDENT_LEAVE_FILE = path.join(__dirname, "data", "leave_data.json");
const STUDENT_MASTER_FILE = path.join(__dirname, "data", "student_master.json");
const MESS_RATES_FILE = path.join(__dirname, "data", "mess_semester_rates.json");
const MESS_CONSTRAINTS_FILE = path.join(__dirname, "data", "mess_constraints.json");
const HOSTEL_WARDEN_FILE = path.join(__dirname, "data", "hostel_warden_mapping.json");
const CREDENTIALS_FILE = path.join(__dirname, "data", "credentials.json");
const FIREBASE_NODE_BY_FILE = {
    [path.basename(CREDENTIALS_FILE)]: "credentials",
    [path.basename(DATA_FILE)]: "fa_leave_requests",
    [path.basename(WARDEN_LEAVE_FILE)]: "warden_leave_requests",
    [path.basename(WARDEN_STUDENTS_FILE)]: "warden_students",
    [path.basename(STUDENT_LEAVE_FILE)]: "leave_data",
    [path.basename(STUDENT_MASTER_FILE)]: "student_master",
    [path.basename(MESS_RATES_FILE)]: "mess_semester_rates",
    [path.basename(MESS_CONSTRAINTS_FILE)]: "mess_constraints",
    [path.basename(HOSTEL_WARDEN_FILE)]: "hostel_warden_mapping"
};

const VALID_WARDEN_APPROVALS = ["Pending", "Approved", "Rejected"];
const VALID_FA_APPROVALS = ["Pending", "Approved", "Rejected"];
const VALID_FA_FINAL_STATUSES = ["Approved", "Rejected"];
const WARDEN_TRANSITIONS = {
    "pending warden approval": ["Pending FA Approval", "Rejected"]
};
const ALLOWED_REFUND_STATUSES = ["Awaiting Approval", "Processing", "Refunded", "No Refund"];
const ALLOWED_RATE_PERIODS = ["even2026", "odd2026", "even2025", "odd2025"];
const ALLOWED_ROLES = ["admin", "fa", "warden", "mess", "student"];

const ROUTE_ROLE_RULES = [
    { method: "GET", path: "/api/health/db", roles: ["admin", "fa", "warden", "mess", "student"] },
    { method: "GET", path: "/api/student-master", roles: ["admin", "fa", "warden"] },
    { method: "GET", path: "/api/student-master/:rollNumber", roles: ["admin", "fa", "warden", "student"] },
    { method: "PUT", path: "/api/student-master/:rollNumber", roles: ["admin"] },
    { method: "POST", path: "/api/student-master", roles: ["admin"] },
    { method: "DELETE", path: "/api/student-master/:rollNumber", roles: ["admin"] },
    { method: "GET", path: "/api/hostel-warden-mapping", roles: ["admin", "fa", "warden"] },
    { method: "GET", path: "/api/approvers", roles: ["admin"] },
    { method: "POST", path: "/api/approvers", roles: ["admin"] },
    { method: "DELETE", path: "/api/approvers/:role/:id", roles: ["admin"] },

    { method: "GET", path: "/api/leave-requests", roles: ["fa"] },
    { method: "POST", path: "/api/update-leave", roles: ["fa"] },

    { method: "GET", path: "/api/warden-leave-requests", roles: ["warden"] },
    { method: "POST", path: "/api/warden-update-leave", roles: ["warden"] },
    { method: "GET", path: "/api/warden-students", roles: ["warden", "admin"] },

    { method: "GET", path: "/api/mess-semester-rates", roles: ["mess", "admin"] },
    { method: "POST", path: "/api/mess-semester-rates", roles: ["mess", "admin"] },
    { method: "POST", path: "/api/mess-rate-lock", roles: ["mess", "admin"] },
    { method: "GET", path: "/api/mess-refunds", roles: ["mess", "admin"] },
    { method: "POST", path: "/api/mess-update-refund", roles: ["mess", "admin"] },

        { method: "GET", path: "/api/mess-constraints", roles: ["mess", "admin", "student"] },
        { method: "POST", path: "/api/mess-constraints", roles: ["mess", "admin"] },

    { method: "GET", path: "/api/student-leaves", roles: ["student", "fa", "warden", "admin"] },
    { method: "POST", path: "/api/submit-leave", roles: ["student"] }
];

app.use(express.json());

// Prevent direct download of raw JSON stores when serving static files.
app.use((req, res, next) => {
    if (req.method === "GET" && /\.json$/i.test(req.path)) {
        return res.status(403).send("Access denied");
    }
    next();
});

app.use(express.static(__dirname));

if (!SUPPORTED_DB_MODES.includes(DB_MODE)) {
    console.error(`[storage] Invalid DB_MODE=${DB_MODE}. Expected one of: ${SUPPORTED_DB_MODES.join(", ")}`);
    process.exit(1);
}

if (USE_POSTGRES_PRIMARY && !isPostgresConfigured()) {
    console.error("[storage] DATABASE_URL is required when DB_MODE uses PostgreSQL.");
    process.exit(1);
}

if (USE_FIREBASE_PRIMARY || USE_FIREBASE_MIRROR_WRITE) {
    initializeFirebaseAdmin();
    if (!isFirebaseReady()) {
        if (USE_FIREBASE_PRIMARY) {
            console.error("[firebase] Firebase Admin is required but not initialized. Check FIREBASE_ENABLED, FIREBASE_DB_URL, and service account credentials.");
            process.exit(1);
        } else {
            console.warn("[firebase] Firebase mirror is enabled but initialization failed. Writes will continue on PostgreSQL only.");
        }
    }
}

function pathMatchesTemplate(actualPath, templatePath) {
    const actual = String(actualPath || "").split("?")[0].split("/").filter(Boolean);
    const template = String(templatePath || "").split("/").filter(Boolean);
    if (actual.length !== template.length) return false;

    for (let i = 0; i < template.length; i += 1) {
        const expected = template[i];
        if (expected.startsWith(":")) continue;
        if (actual[i] !== expected) return false;
    }
    return true;
}

function findAllowedRoles(method, reqPath) {
    const normalizedMethod = String(method || "").toUpperCase();
    for (const rule of ROUTE_ROLE_RULES) {
        if (rule.method !== normalizedMethod) continue;
        if (pathMatchesTemplate(reqPath, rule.path)) return rule.roles;
    }
    return null;
}

function apiAccessMiddleware(req, res, next) {
    if (!req.path.startsWith("/api/")) return next();
    if (req.path === "/api/auth/login") return next();
    if (!AUTH_ENABLED) return next();

    const role = normText(req.headers["x-user-role"]).toLowerCase();
    if (!ALLOWED_ROLES.includes(role)) {
        return res.status(401).json({ error: "Unauthorized: missing or invalid role" });
    }

    if (API_ACCESS_KEY) {
        const providedKey = normText(req.headers["x-api-key"]);
        if (!providedKey || providedKey !== API_ACCESS_KEY) {
            return res.status(401).json({ error: "Unauthorized: invalid API key" });
        }
    }

    const allowedRoles = findAllowedRoles(req.method, req.path);
    if (!allowedRoles) {
        return res.status(403).json({ error: "Forbidden: route role mapping missing" });
    }
    if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: `Forbidden: role ${role} cannot access this route` });
    }

    req.authRole = role;
    next();
}

app.use(apiAccessMiddleware);

function normText(value) {
    return String(value || "").trim();
}

function normIdentity(value) {
    return normText(value).toLowerCase();
}

function normHostelKey(value) {
    return normText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeHostelName(value) {
    const key = normHostelKey(value);
    if (key === "krishna") return "Krishna";
    if (key === "tungabadra") return "Tungabadra";
    if (key === "bheema") return "Bheema";
    if (key === "federal") return "Federal";
    return "";
}

function normIdentityId(value) {
    return normText(value).toUpperCase();
}

function deriveMessFromHostel(hostelName) {
    return normHostelKey(hostelName) === "federal" ? "Federal" : "Bheema";
}

function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}

function deriveBranchFromRollNumber(rollNumber) {
    const normalized = normText(rollNumber).toUpperCase();
    if (normalized.startsWith("MC")) return "Mathematics and Computing";
    if (normalized.startsWith("AD")) return "Artificial intelligence and Data Science";
    if (normalized.startsWith("CS")) return "Computer Science";
    return "";
}

function buildPhone(seed, tail = "0") {
    const digits = digitsOnly(seed).slice(-9).padStart(9, "0");
    return `9${digits.slice(0, 8)}${tail}`;
}

function deriveLastName(fullName) {
    const parts = normText(fullName).split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Student";
}

async function readFirebaseNodeSafe(node) {
    if (!isFirebaseReady()) return null;
    try {
        return await readFromFirebase(node);
    } catch (err) {
        console.warn(`[firebase] Read failed for ${node}: ${err.message}`);
        return null;
    }
}

async function readFirebaseArraySafe(node) {
    const value = await readFirebaseNodeSafe(node);
    return Array.isArray(value) ? value : null;
}

async function readFirebaseObjectSafe(node) {
    const value = await readFirebaseNodeSafe(node);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
}

async function readArrayStore(filePath) {
    if (USE_POSTGRES_PRIMARY) {
        try {
            const storeKey = path.basename(filePath, path.extname(filePath));
            const rows = await readPostgresStore(storeKey, []);
            if (!Array.isArray(rows)) {
                return { data: [], error: `PostgreSQL store ${storeKey} is not an array` };
            }
            return { data: rows, error: null };
        } catch (err) {
            return { data: [], error: `PostgreSQL read failed for ${path.basename(filePath)}: ${err.message}` };
        }
    }

    const node = FIREBASE_NODE_BY_FILE[path.basename(filePath)];
    if (!node) {
        return { data: [], error: `No Firebase node configured for ${path.basename(filePath)}` };
    }
    const rows = await readFirebaseArraySafe(node);
    if (!rows) {
        return { data: [], error: `Failed to read ${node} from Firebase` };
    }
    return { data: rows, error: null };
}

async function readObjectStore(filePath, fallback = {}) {
    if (USE_POSTGRES_PRIMARY) {
        try {
            const storeKey = path.basename(filePath, path.extname(filePath));
            const obj = await readPostgresStore(storeKey, fallback);
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
                return { data: fallback, error: `PostgreSQL store ${storeKey} is not an object` };
            }
            return { data: obj, error: null };
        } catch (err) {
            return { data: fallback, error: `PostgreSQL read failed for ${path.basename(filePath)}: ${err.message}` };
        }
    }

    const node = FIREBASE_NODE_BY_FILE[path.basename(filePath)];
    if (!node) {
        return { data: fallback, error: `No Firebase node configured for ${path.basename(filePath)}` };
    }
    const obj = await readFirebaseObjectSafe(node);
    if (!obj) {
        return { data: fallback, error: `Failed to read ${node} from Firebase` };
    }
    return { data: obj, error: null };
}

async function mirrorWriteToFirebase(filePath, data) {
    if (!USE_FIREBASE_MIRROR_WRITE || !isFirebaseReady()) return;
    const node = FIREBASE_NODE_BY_FILE[path.basename(filePath)];
    if (!node) return;
    try {
        await writeToFirebase(node, data);
    } catch (err) {
        console.warn(`[firebase] Mirror write failed for ${node}: ${err.message}`);
    }
}

async function writeArrayStore(filePath, data) {
    if (USE_POSTGRES_PRIMARY) {
        const storeKey = path.basename(filePath, path.extname(filePath));
        await writePostgresStore(storeKey, data);
        await mirrorWriteToFirebase(filePath, data);
        return;
    }

    const node = FIREBASE_NODE_BY_FILE[path.basename(filePath)];
    if (!node) {
        throw new Error(`No Firebase node configured for ${path.basename(filePath)}`);
    }
    await writeToFirebase(node, data);
}

async function writeObjectStore(filePath, data) {
    if (USE_POSTGRES_PRIMARY) {
        const storeKey = path.basename(filePath, path.extname(filePath));
        await writePostgresStore(storeKey, data);
        await mirrorWriteToFirebase(filePath, data);
        return;
    }

    const node = FIREBASE_NODE_BY_FILE[path.basename(filePath)];
    if (!node) {
        throw new Error(`No Firebase node configured for ${path.basename(filePath)}`);
    }
    await writeToFirebase(node, data);
}

// Repository-style helpers for domain stores.
async function readFaLeaveStore() {
    return readArrayStore(DATA_FILE);
}

async function writeFaLeaveStore(rows) {
    return writeArrayStore(DATA_FILE, rows);
}

async function readWardenLeaveStore() {
    return readArrayStore(WARDEN_LEAVE_FILE);
}

async function writeWardenLeaveStore(rows) {
    return writeArrayStore(WARDEN_LEAVE_FILE, rows);
}

async function readStudentLeaveStore() {
    return readArrayStore(STUDENT_LEAVE_FILE);
}

async function writeStudentLeaveStore(rows) {
    return writeArrayStore(STUDENT_LEAVE_FILE, rows);
}

async function readStudentMasterStore() {
    if (USE_POSTGRES_PRIMARY) {
        return readArrayStore(STUDENT_MASTER_FILE);
    }

    if (!isFirebaseReady()) {
        return { data: [], error: "Firebase student master store is not available" };
    }

    const data = await readFirebaseArraySafe("student_master");
    if (!data) {
        return { data: [], error: "Failed to read student_master from Firebase" };
    }

    return { data, error: null };
}

async function writeStudentMasterStore(rows) {
    if (USE_POSTGRES_PRIMARY) {
        return writeArrayStore(STUDENT_MASTER_FILE, rows);
    }

    if (!isFirebaseReady()) {
        throw new Error("Firebase student master store is not available");
    }

    await writeToFirebase("student_master", rows);
}

async function readHostelWardenStore() {
    return readObjectStore(HOSTEL_WARDEN_FILE, {});
}

async function writeHostelWardenStore(mapping) {
    return writeObjectStore(HOSTEL_WARDEN_FILE, mapping);
}

async function readCredentialsObjectStore() {
    return readObjectStore(CREDENTIALS_FILE, {});
}

async function writeCredentialsObjectStore(store) {
    return writeObjectStore(CREDENTIALS_FILE, store);
}

async function readMessRatesStore() {
    return readObjectStore(MESS_RATES_FILE, {});
}

async function writeMessRatesStore(model) {
    return writeObjectStore(MESS_RATES_FILE, model);
}

async function readMessConstraintsStore() {
    return readObjectStore(MESS_CONSTRAINTS_FILE, { minDaysForRefund: 3, amountPerDay: 200 });
}

async function writeMessConstraintsStore(constraints) {
    return writeObjectStore(MESS_CONSTRAINTS_FILE, constraints);
}

function normalizeApproverRole(role) {
    const normalized = normText(role).toLowerCase();
    return normalized === "fa" || normalized === "warden" ? normalized : "";
}

function normalizeCredentialsStoreData(data = {}) {
    const normalizeRows = (rows, role) => (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        id: normIdentityId(row && row.id),
        name: normText(row && row.name),
        password: normText(row && row.password),
        role: normalizeApproverRole((row && row.role) || role),
        active: row && row.active === false ? false : true
    }));

    return {
        wardens: normalizeRows(data.wardens, "warden"),
        fas: normalizeRows(data.fas, "fa")
    };
}

async function readCredentialsStorePrimary() {
    const { data, error } = await readObjectStore(CREDENTIALS_FILE, {});
    if (error) return { data: { wardens: [], fas: [] }, error };
    return { data: normalizeCredentialsStoreData(data), error: null };
}

async function loadStudentMasterMapPrimary() {
    const { data, error } = await readStudentMasterStore();
    if (error) return { map: new Map(), error };

    const map = new Map();
    for (const row of data) {
        const normalized = normalizeMasterStudent(row || {});
        if (normalized.rollNumber) map.set(normalized.rollNumber, normalized);
    }
    return { map, error: null };
}

function getApproverRows(store, role) {
    return role === "fa" ? store.fas : store.wardens;
}

function normalizeApproverRow(row, role) {
    return {
        id: normIdentityId(row && row.id),
        name: normText(row && row.name),
        password: normText(row && row.password),
        role: normalizeApproverRole((row && row.role) || role),
        active: row && row.active === false ? false : true,
        hostelName: role === "warden" ? normalizeHostelName(row && row.hostelName) : ""
    };
}

function listApproversByRole(store, role, options = {}, hostelMap = null) {
    const normalizedRole = normalizeApproverRole(role);
    if (!normalizedRole) return [];
    const activeOnly = options.activeOnly !== false;
    return getApproverRows(store, normalizedRole)
        .map((row) => {
            const normalized = normalizeApproverRow(row, normalizedRole);
            if (normalizedRole !== "warden" || normalized.hostelName) return normalized;
            return {
                ...normalized,
                hostelName: findWardenHostelById(store, normalized.id, hostelMap) || ""
            };
        })
        .filter((row) => !activeOnly || row.active !== false);
}

function findApproverIndex(store, role, id) {
    const normalizedRole = normalizeApproverRole(role);
    if (!normalizedRole) return -1;
    return getApproverRows(store, normalizedRole).findIndex((row) => normIdentityId(row && row.id) === normIdentityId(id));
}

function findApproverById(store, role, id, options = {}) {
    const normalizedRole = normalizeApproverRole(role);
    if (!normalizedRole) return null;
    const activeOnly = options.activeOnly !== false;
    return getApproverRows(store, normalizedRole)
        .map((row) => normalizeApproverRow(row, normalizedRole))
        .find((row) => row.id === normIdentityId(id) && (!activeOnly || row.active !== false)) || null;
}

function approverExistsEverywhere(store, id) {
    const target = normIdentityId(id);
    if (!target) return false;
    return [...(store.wardens || []), ...(store.fas || [])].some((row) => normIdentityId(row && row.id) === target);
}

function findWardenHostelById(store, wardenId, hostelMap = null) {
    const target = normIdentityId(wardenId);
    const wardenRows = Array.isArray(store && store.wardens) ? store.wardens : [];

    const storedHostel = wardenRows.find((row) => normIdentityId(row && row.id) === target);
    if (storedHostel && normalizeHostelName(storedHostel.hostelName)) {
        return normalizeHostelName(storedHostel.hostelName);
    }

    const map = hostelMap instanceof Map ? hostelMap : new Map();
    for (const row of map.values()) {
        if (normIdentityId(row.wardenId) === target) return row.hostelName;
    }
    return "";
}

async function loadApproverDirectoryPrimary() {
    const { data, error } = await readCredentialsStorePrimary();
    if (error) {
        return {
            directory: { wardensById: new Map(), wardensByName: new Map(), fasById: new Map(), fasByName: new Map() },
            error
        };
    }

    const wardens = Array.isArray(data.wardens) ? data.wardens : [];
    const fas = Array.isArray(data.fas) ? data.fas : [];

    const byId = (rows) => {
        const map = new Map();
        for (const row of rows) {
            const id = normIdentityId(row && row.id);
            const name = normText(row && row.name);
            if (!id || !name) continue;
            map.set(id, { id, name });
        }
        return map;
    };

    const byName = (rows) => {
        const map = new Map();
        for (const row of rows) {
            const id = normIdentityId(row && row.id);
            const name = normText(row && row.name);
            if (!id || !name) continue;
            map.set(normIdentity(name), { id, name });
        }
        return map;
    };

    return {
        directory: {
            wardensById: byId(wardens),
            wardensByName: byName(wardens),
            fasById: byId(fas),
            fasByName: byName(fas)
        },
        error: null
    };
}

function buildHostelWardenMap(raw) {
    const map = new Map();
    const entries = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];

    for (const [hostelName, value] of entries) {
        const key = normHostelKey(hostelName);
        const wardenId = normIdentityId(value && value.wardenId);
        const warden = normText(value && value.warden);
        if (!key || !wardenId || !warden) continue;
        map.set(key, {
            hostelName: normText(hostelName),
            wardenId,
            warden
        });
    }

    return map;
}

async function loadHostelWardenMappingPrimary() {
    const { data, error } = await readObjectStore(HOSTEL_WARDEN_FILE, {});
    if (error) return { map: new Map(), error };
    return { map: buildHostelWardenMap(data), error: null };
}

function resolveFaIdentity(candidate, approvers) {
    const faId = normIdentityId(candidate && candidate.faId);
    const faName = normText(candidate && candidate.fa);

    if (!faId && !faName) {
        return { ok: true, value: null };
    }

    if (faId) {
        const byId = approvers.fasById.get(faId);
        if (!byId) {
            return { ok: false, error: `Unknown FA id: ${faId}` };
        }
        if (faName && normIdentity(byId.name) !== normIdentity(faName)) {
            return { ok: false, error: `FA id ${faId} does not match FA name ${faName}` };
        }
        return { ok: true, value: byId };
    }

    const byName = approvers.fasByName.get(normIdentity(faName));
    if (!byName) {
        return { ok: false, error: `Unknown FA name: ${faName}` };
    }
    return { ok: true, value: byName };
}

async function applyMasterAssignments(candidate, options = {}) {
    const errors = [];
    const next = { ...candidate };
    const { map: mapping, error: mappingError } = await loadHostelWardenMappingPrimary();
    const { directory: approvers, error: approverError } = await loadApproverDirectoryPrimary();

    if (mappingError) {
        errors.push(mappingError);
    }
    if (approverError) {
        errors.push(approverError);
    }

    const hostelName = normText(next.hostelName);
    const hostelKey = normHostelKey(hostelName);

    if (!hostelName) {
        errors.push("Hostel is required");
    } else if (!mapping.has(hostelKey)) {
        errors.push(`Unknown hostel: ${hostelName}`);
    } else {
        const assigned = mapping.get(hostelKey);
        next.hostelName = assigned.hostelName;
        next.warden = assigned.warden;
        next.wardenId = assigned.wardenId;

        const knownWarden = approvers.wardensById.get(assigned.wardenId);
        if (!knownWarden) {
            errors.push(`Hostel mapping for ${assigned.hostelName} points to unknown warden id ${assigned.wardenId}`);
        } else if (normIdentity(knownWarden.name) !== normIdentity(assigned.warden)) {
            errors.push(`Hostel mapping for ${assigned.hostelName} has inconsistent warden name/id`);
        }

        // Mess is always derived from hostel: Federal -> Federal, all others -> Bheema.
        next.messName = deriveMessFromHostel(assigned.hostelName);
    }

    const fa = resolveFaIdentity(next, approvers);
    if (!fa.ok) {
        errors.push(fa.error);
    } else if (fa.value) {
        next.fa = fa.value.name;
        next.faId = fa.value.id;
    }

    if (options.requireFa && !normText(next.faId)) {
        errors.push("FA is required");
    }

    return { errors, value: next };
}

function normalizeMasterStudent(student) {
    const rollNumber = normText(student.rollNumber).toUpperCase();
    const derivedBranch = deriveBranchFromRollNumber(rollNumber);
    const name = normText(student.name) || `Student ${rollNumber || "0000"}`;
    const fatherName = normText(student.fatherName) || `Mr. ${deriveLastName(name)}`;
    const motherName = normText(student.motherName) || `Mrs. ${deriveLastName(fatherName)}`;

    const year = Math.max(1, Math.min(4, Number(student.year) || 1));
    const inferredSemester = (year - 1) * 2 + 1;
    const semesterNum = Math.max(1, Math.min(8, Number(student.semester) || inferredSemester));

    const phone = digitsOnly(student.phone) || buildPhone(rollNumber, "1");
    const fatherPhone = digitsOnly(student.fatherPhone) || buildPhone(rollNumber, "2");
    const motherPhone = digitsOnly(student.motherPhone) || `${fatherPhone.slice(0, 9)}3`;

    const accountDigits = digitsOnly(student.bankAccountNumber || student.accountNumber) || digitsOnly(rollNumber).slice(-10).padStart(10, "0");
    const normalizedIfsc = normText(student.bankIfsc || student.ifsc).toUpperCase() || "SBIN0001234";
    const wardenId = normIdentityId(student.wardenId);
    const faId = normIdentityId(student.faId);
    const normalizedHostelName = normText(student.hostelName) || "Hostel A";
    const derivedMessName = deriveMessFromHostel(normalizedHostelName);

    return {
        rollNumber,
        name,
        fatherName,
        motherName,
        phone,
        fatherPhone,
        motherPhone,
        year,
        semester: semesterNum,
        hostelName: normalizedHostelName,
        warden: normText(student.warden) || "Mr. Ramesh Chand",
        wardenId,
        fa: normText(student.fa) || "Dr. Bharat Soni",
        faId,
        messName: derivedMessName,
        bankName: normText(student.bankName) || "SBI",
        accountNumber: accountDigits,
        bankAccountNumber: accountDigits,
        ifsc: normalizedIfsc,
        bankIfsc: normalizedIfsc,
        branch: derivedBranch || normText(student.branch) || "Computer Science",
        roomNumber: normText(student.roomNumber) || "A-101",
        email: normText(student.email) || `${rollNumber.toLowerCase()}@iiitr.ac.in`
    };
}

function normalizeMessRatesModel(raw) {
    const defaults = {
        rates: { even2026: 200, odd2026: 200, even2025: 200, odd2025: 200 },
        locks: { even2026: false, odd2026: false, even2025: false, odd2025: false }
    };

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;

    const hasModernShape = raw.rates && raw.locks;
    if (hasModernShape) {
        const next = {
            rates: { ...defaults.rates },
            locks: { ...defaults.locks }
        };
        for (const period of ALLOWED_RATE_PERIODS) {
            const r = Number(raw.rates[period]);
            if (Number.isFinite(r) && r >= 0) next.rates[period] = r;
            next.locks[period] = Boolean(raw.locks[period]);
        }
        return next;
    }

    return defaults;
}

function semesterToPeriod(semester, startDate) {
    const sem = Number(semester);
    const semParity = Number.isFinite(sem) ? (sem % 2 === 0 ? "even" : "odd") : "odd";
    const year = new Date(startDate).getFullYear();
    const fallbackYear = Number.isFinite(year) ? year : 2026;
    const candidate = `${semParity}${fallbackYear}`;
    return ALLOWED_RATE_PERIODS.includes(candidate) ? candidate : "odd2026";
}

function hydrateFromMaster(leave, master) {
    const relation = normText(leave.parentRelation).toLowerCase();
    const selectedParent = relation === "mother" ? master.motherPhone : master.fatherPhone;
    return {
        ...leave,
        fullName: master.name,
        name: master.name,
        fatherName: master.fatherName,
        motherName: master.motherName,
        phone: master.phone,
        fatherPhone: master.fatherPhone,
        motherPhone: master.motherPhone,
        parentPhone: selectedParent,
        semester: master.semester,
        year: master.year,
        hostelName: master.hostelName,
        warden: master.warden,
        wardenId: master.wardenId,
        fa: master.fa,
        faId: master.faId,
        messName: master.messName,
        bankName: master.bankName,
        bankAccountNumber: master.accountNumber,
        bankIfsc: master.ifsc,
        branch: master.branch || leave.branch,
        roomNumber: master.roomNumber || leave.roomNumber,
        email: master.email || leave.email
    };
}

function hydrateLeaveRows(rows, masterMap) {
    return rows.map((row) => {
        const roll = normText(row.rollNumber).toUpperCase();
        if (!roll || !masterMap.has(roll)) return row;
        return hydrateFromMaster(row, masterMap.get(roll));
    });
}

function buildLeaveCompositeKey(row) {
    return `${normText(row && row.rollNumber).toUpperCase()}|${normText(row && row.startDate)}|${normText(row && row.endDate)}`;
}

function findLeaveIndexByCompositeKey(rows, compositeKey) {
    if (!Array.isArray(rows) || !compositeKey) return -1;
    return rows.findIndex((row) => buildLeaveCompositeKey(row) === compositeKey);
}

function buildLeaveSyncPatch(source = {}) {
    const bankAccountNumber = normText(source.bankAccountNumber || source.accountNumber);
    const bankIfsc = normText(source.bankIfsc || source.ifsc).toUpperCase();
    const normalizedName = normText(source.fullName || source.name);
    const normalizedDepartment = normText(source.department || source.branch);
    const normalized = {
        fullName: normalizedName || undefined,
        name: normalizedName || undefined,
        department: normalizedDepartment || undefined,
        branch: normalizedDepartment || undefined,
        wardenId: normIdentityId(source.wardenId) || undefined,
        faId: normIdentityId(source.faId) || undefined,
        status: normText(source.status) || undefined,
        wardenApproval: normText(source.wardenApproval) || undefined,
        faApproval: normText(source.faApproval) || undefined,
        refundStatus: normText(source.refundStatus) || undefined,
        refundAmount: Number.isFinite(Number(source.refundAmount)) ? Number(source.refundAmount) : undefined,
        bankName: normText(source.bankName) || undefined,
        bankAccountNumber: bankAccountNumber || undefined,
        bankIfsc: bankIfsc || undefined,
        refundProcessedAt: normText(source.refundProcessedAt) || undefined,
            refundProcessedBy: normText(source.refundProcessedBy) || undefined,
            refundRuleMinDays: Number.isFinite(Number(source.refundRuleMinDays)) ? Number(source.refundRuleMinDays) : undefined,
            refundRuleAmountPerDay: Number.isFinite(Number(source.refundRuleAmountPerDay)) ? Number(source.refundRuleAmountPerDay) : undefined,
            refundRuleCapturedAt: normText(source.refundRuleCapturedAt) || undefined
    };
    return normalized;
}

function applyLeaveSyncPatch(target, patch) {
    if (!target || typeof target !== "object" || !patch || typeof patch !== "object") return;
    const keys = [
        "fullName",
        "name",
        "department",
        "branch",
        "wardenId",
        "faId",
        "status",
        "wardenApproval",
        "faApproval",
        "refundStatus",
        "refundAmount",
        "bankName",
        "bankAccountNumber",
        "bankIfsc",
        "refundProcessedAt",
            "refundProcessedBy",
            "refundRuleMinDays",
            "refundRuleAmountPerDay",
            "refundRuleCapturedAt"
    ];

    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        if (patch[key] === undefined) continue;
        target[key] = patch[key];
    }

    if (target.bankAccountNumber) target.accountNumber = target.bankAccountNumber;
    if (target.bankIfsc) target.ifsc = target.bankIfsc;

    const syncedName = normText(target.fullName || target.name);
    if (syncedName) {
        target.fullName = syncedName;
        target.name = syncedName;
    }

    const syncedDepartment = normText(target.department || target.branch);
    if (syncedDepartment) {
        target.department = syncedDepartment;
        target.branch = syncedDepartment;
    }
}

function syncLeaveRowByComposite(studentRows, sourceRecord, patch) {
    const compositeKey = buildLeaveCompositeKey(sourceRecord);
    const rowIndex = findLeaveIndexByCompositeKey(studentRows, compositeKey);
    if (rowIndex === -1) {
        return { ok: false, error: "Matching record not found in leave_data.json" };
    }

    applyLeaveSyncPatch(studentRows[rowIndex], patch);
    return { ok: true, index: rowIndex };
}

function getRequesterIdentity(req) {
    return {
        id: normIdentityId(req.headers["x-user-id"] || req.headers["x-approver-id"]),
        name: normIdentity(req.headers["x-user-name"] || req.headers["x-approver-name"])
    };
}

function getAssignedIdentity(row, masterMap, role) {
    const roll = normText(row && row.rollNumber).toUpperCase();
    const master = roll && masterMap && masterMap.has(roll) ? masterMap.get(roll) : null;

    if (role === "warden") {
        return {
            id: normIdentityId((row && row.wardenId) || (master && master.wardenId)),
            name: normIdentity((row && row.warden) || (master && master.warden))
        };
    }

    return {
        id: normIdentityId((row && row.faId) || (master && master.faId)),
        name: normIdentity((row && row.fa) || (master && master.fa))
    };
}

function isRequesterAssigned(row, masterMap, role, requester) {
    if (!requester || (!requester.id && !requester.name)) return true;
    const assigned = getAssignedIdentity(row, masterMap, role);
    if (requester.id && assigned.id) return requester.id === assigned.id;
    if (requester.name && assigned.name) return requester.name === assigned.name;
    return false;
}

function ensureApproverIdentity(req, res, options = {}) {
    const requireForRoles = Array.isArray(options.requireForRoles) ? options.requireForRoles : [];
    const role = normText(req.authRole).toLowerCase();
    const requester = getRequesterIdentity(req);
    const identityRequired = AUTH_ENABLED && requireForRoles.includes(role);
    if (identityRequired && !requester.id && !requester.name) {
        res.status(401).json({ error: "Unauthorized: missing approver identity (x-user-id or x-user-name)" });
        return null;
    }
    return requester;
}

app.post("/api/auth/login", async (req, res) => {
    const roleSelection = normText(req.body && (req.body.roleSelection || req.body.role || req.body.selectedRole)).toLowerCase();
    const usernameRaw = normText(req.body && (req.body.username || req.body.Username));
    const password = normText(req.body && (req.body.password || req.body.Password));
    const uppercaseUsername = usernameRaw.toUpperCase();
    const lowerUsername = usernameRaw.toLowerCase();

    if (!usernameRaw || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    const staticAccounts = [
        { username: "mess", password: "mess123", role: "mess", redirect: "/pages/mess/mess_dashboard.html" },
        { username: "admin", password: "admin123", role: "admin", redirect: "/pages/admin/admin.html" }
    ];
    const staticMatch = staticAccounts.find((user) => user.username === lowerUsername && user.password === password);

    const { data: credentials } = await readCredentialsStorePrimary();
    const { map: hostelMap } = await loadHostelWardenMappingPrimary();
    const wardenMatch = credentials.wardens.find((row) => row.active !== false && normIdentityId(row.id) === uppercaseUsername && normText(row.password) === password);
    const faMatch = credentials.fas.find((row) => row.active !== false && normIdentityId(row.id) === uppercaseUsername && normText(row.password) === password);

    const { map: studentMap } = await loadStudentMasterMapPrimary();
    const student = studentMap.get(uppercaseUsername);

    const wardenSession = (row) => ({
        username: normIdentityId(row.id),
        role: "warden",
        approverId: normIdentityId(row.id),
        approverName: normText(row.name),
        displayName: normText(row.name),
        hostelName: normalizeHostelName(row.hostelName) || findWardenHostelById(credentials, row.id, hostelMap) || ""
    });

    const faSession = (row) => ({
        username: normIdentityId(row.id),
        role: "fa",
        approverId: normIdentityId(row.id),
        approverName: normText(row.name),
        displayName: normText(row.name)
    });

    const studentSession = () => ({
        username: uppercaseUsername,
        role: "student",
        rollNumber: uppercaseUsername,
        displayName: student.name
    });

    if (roleSelection === "auto") {
        if (staticMatch) {
            return res.json({ success: true, redirect: staticMatch.redirect, session: { username: staticMatch.username, role: staticMatch.role, displayName: staticMatch.username } });
        }

        if (wardenMatch && faMatch) {
            return res.status(409).json({ error: "This ID has dual roles. Please select Warden or Faculty Advisor." });
        }
        if (wardenMatch) {
            const session = wardenSession(wardenMatch);
            return res.json({ success: true, redirect: "/pages/warden/warden_dashboard.html", session });
        }
        if (faMatch) {
            const session = faSession(faMatch);
            return res.json({ success: true, redirect: "/pages/fa/fa_dashboard.html", session });
        }
        if (student && password === "1234") {
            return res.json({ success: true, redirect: "/pages/student/student.html", session: studentSession() });
        }

        return res.status(401).json({ error: "Invalid credentials for selected role." });
    }

    if ((roleSelection === "mess" || roleSelection === "admin") && staticMatch && staticMatch.role === roleSelection) {
        return res.json({ success: true, redirect: staticMatch.redirect, session: { username: staticMatch.username, role: staticMatch.role, displayName: staticMatch.username } });
    }

    if (roleSelection === "warden" && wardenMatch) {
        const session = wardenSession(wardenMatch);
        return res.json({ success: true, redirect: "/pages/warden/warden_dashboard.html", session });
    }
    if (roleSelection === "fa" && faMatch) {
        const session = faSession(faMatch);
        return res.json({ success: true, redirect: "/pages/fa/fa_dashboard.html", session });
    }
    if (roleSelection === "student" && student && password === "1234") {
        return res.json({ success: true, redirect: "/pages/student/student.html", session: studentSession() });
    }

    return res.status(401).json({ error: "Invalid credentials for selected role." });
});

app.get("/api/approvers", async (req, res) => {
    const requestedRole = normalizeApproverRole(req.query && req.query.role);
    const { data, error } = await readCredentialsStorePrimary();
    if (error) return res.status(500).json({ error });
    const { map: hostelMap } = await loadHostelWardenMappingPrimary();

    if (requestedRole) {
        return res.json(listApproversByRole(data, requestedRole, {}, hostelMap));
    }

    res.json({
        wardens: listApproversByRole(data, "warden", {}, hostelMap),
        fas: listApproversByRole(data, "fa")
    });
});

app.post("/api/approvers", async (req, res) => {
    const role = normalizeApproverRole(req.body && req.body.role);
    const id = normIdentityId(req.body && req.body.id);
    const name = normText(req.body && req.body.name);
    const password = normText(req.body && req.body.password);
    const hostelName = normalizeHostelName(req.body && req.body.hostelName);

    if (!role) return res.status(400).json({ error: "Role must be fa or warden" });
    if (!id || !name || !password) {
        return res.status(400).json({ error: "id, name, and password are required" });
    }

    const { data, error } = await readCredentialsStorePrimary();
    if (error) return res.status(500).json({ error });
    if (approverExistsEverywhere(data, id)) {
        return res.status(409).json({ error: `Approver ${id} already exists` });
    }

    if (role === "warden" && !hostelName) {
        return res.status(400).json({ error: "A valid hostel is required for warden" });
    }

    const record = { id, name, password, role, hostelName: role === "warden" ? hostelName : "" };
    getApproverRows(data, role).push(record);

    if (role === "warden") {
        const { data: currentMap } = await readHostelWardenStore();
        const map = new Map();
        for (const [hostelNameKey, value] of Object.entries(currentMap || {})) {
            const key = normHostelKey(hostelNameKey);
            if (!key) continue;
            map.set(key, {
                hostelName: normText((value && value.hostelName) || hostelNameKey),
                wardenId: normIdentityId(value && value.wardenId),
                warden: normText(value && value.warden)
            });
        }
        for (const [key, value] of map.entries()) {
            if (normIdentityId(value.wardenId) === id) {
                map.delete(key);
            }
        }
        map.set(normHostelKey(hostelName), {
            hostelName,
            wardenId: id,
            warden: name
        });
        const nextMapping = {};
        for (const [key, value] of map.entries()) {
            nextMapping[value.hostelName || key] = value;
        }
        await writeHostelWardenStore(nextMapping);
    }

    try {
        await writeCredentialsObjectStore({
            wardens: Array.isArray(data.wardens) ? data.wardens : [],
            fas: Array.isArray(data.fas) ? data.fas : []
        });
        res.json({ success: true, approver: normalizeApproverRow(record, role) });
    } catch (err) {
        console.error("Error writing credentials file:", err);
        res.status(500).json({ error: "Failed to save approver" });
    }
});

app.delete("/api/approvers/:role/:id", async (req, res) => {
    const role = normalizeApproverRole(req.params.role);
    const id = normIdentityId(req.params.id);

    if (!role) return res.status(400).json({ error: "Role must be fa or warden" });
    if (!id) return res.status(400).json({ error: "Approver id is required" });

    const { data, error } = await readCredentialsStorePrimary();
    if (error) return res.status(500).json({ error });

    const approverIndex = findApproverIndex(data, role, id);
    if (approverIndex === -1) {
        return res.status(404).json({ error: `${role.toUpperCase()} ${id} not found` });
    }

    const current = getApproverRows(data, role)[approverIndex];
    current.active = false;

    try {
        await writeCredentialsObjectStore({
            wardens: Array.isArray(data.wardens) ? data.wardens : [],
            fas: Array.isArray(data.fas) ? data.fas : []
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Error updating credentials file:", err);
        res.status(500).json({ error: "Failed to delete approver" });
    }
});

app.get("/api/mess-constraints", async (req, res) => {
    const { data, error } = await readMessConstraintsStore();
    if (error) {
        // If node is not initialized yet, return defaults instead of failing.
        console.warn("Mess constraints not found or unreadable, returning defaults:", error);
        return res.json({ minDaysForRefund: 3, amountPerDay: 200 });
    }
    res.json(data);
});

app.post("/api/mess-constraints", async (req, res) => {
    const { minDaysForRefund, amountPerDay } = req.body || {};

    const min = Number(minDaysForRefund);
    const amount = Number(amountPerDay);

    if (!Number.isFinite(min) || min < 0) {
        return res.status(400).json({ error: "minDaysForRefund must be a non-negative number" });
    }
    if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: "amountPerDay must be a non-negative number" });
    }

    const constraints = {
        minDaysForRefund: min,
        amountPerDay: amount,
        updatedAt: new Date().toISOString(),
        updatedBy: req.headers["x-user-id"] || "unknown"
    };

    try {
        await writeMessConstraintsStore(constraints);
    } catch (err) {
        console.error("Error writing mess constraints:", err);
        return res.status(500).json({ error: "Failed to save mess constraints" });
    }

    res.json({ success: true, data: constraints });
});

// ===== Master Student Routes =====

app.get("/api/student-master", async (req, res) => {
    const { data, error } = await readStudentMasterStore();
    if (error) return res.status(500).json({ error });
    res.json(data.map(normalizeMasterStudent));
});

app.get("/api/student-master/:rollNumber", async (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { map, error } = await loadStudentMasterMapPrimary();
    if (error) return res.status(500).json({ error });

    const student = map.get(roll);
    if (!student) return res.status(404).json({ error: `Student not found: ${roll}` });

    res.json(student);
});

app.get("/api/hostel-warden-mapping", async (req, res) => {
    const { map: mapping, error } = await loadHostelWardenMappingPrimary();
    if (error) return res.status(500).json({ error });
    const hostels = Array.from(mapping.values()).sort((a, b) => a.hostelName.localeCompare(b.hostelName));
    res.json(hostels);
});

// ===== FA Routes =====

app.get("/api/leave-requests", async (req, res) => {
    const { data, error } = await readFaLeaveStore();
    if (error) return res.status(500).json({ error: "Failed to read leave data" });
    const { map, error: mapErr } = await loadStudentMasterMapPrimary();
    if (mapErr) return res.status(500).json({ error: mapErr });

    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["fa"] });
    if (!requester) return;

    const hydratedWithIndex = hydrateLeaveRows(data, map)
        .map((row, sourceIndex) => ({ ...row, sourceIndex }));
    const scoped = hydratedWithIndex.filter((row) => isRequesterAssigned(row, map, "fa", requester));
    res.json(scoped);
});

app.post("/api/update-leave", async (req, res) => {
    try {
        if (!req.body || typeof req.body !== "object") {
            return res.status(400).json({ error: "Request body must be a JSON object" });
        }

        const { index, status, faApproval, refundStatus } = req.body;
        if (index === undefined || index === null) return res.status(400).json({ error: "Missing required field: index" });
        if (!Number.isInteger(index)) return res.status(400).json({ error: "index must be an integer" });
        if (typeof status !== "string" || !status.trim()) {
            return res.status(400).json({ error: "status must be a non-empty string" });
        }
        if (typeof faApproval !== "string" || !faApproval.trim()) {
            return res.status(400).json({ error: "faApproval must be a non-empty string" });
        }
        if (typeof refundStatus !== "string" || !refundStatus.trim()) {
            return res.status(400).json({ error: "refundStatus must be a non-empty string" });
        }

        if (!VALID_FA_FINAL_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Allowed: ${VALID_FA_FINAL_STATUSES.join(", ")}` });
        }
        if (!VALID_FA_APPROVALS.includes(faApproval)) {
            return res.status(400).json({ error: `Invalid faApproval. Allowed: ${VALID_FA_APPROVALS.join(", ")}` });
        }
        if (!ALLOWED_REFUND_STATUSES.includes(refundStatus)) {
            return res.status(400).json({ error: `Invalid refundStatus. Allowed: ${ALLOWED_REFUND_STATUSES.join(", ")}` });
        }
        if (status === "Approved" && faApproval !== "Approved") {
            return res.status(400).json({ error: "Approved status requires faApproval to be Approved" });
        }
        if (status === "Rejected" && faApproval !== "Rejected") {
            return res.status(400).json({ error: "Rejected status requires faApproval to be Rejected" });
        }
        if (status === "Rejected" && refundStatus !== "No Refund") {
            return res.status(400).json({ error: "Rejected status requires refundStatus to be No Refund" });
        }
        if (status === "Approved" && !["Processing", "No Refund"].includes(refundStatus)) {
            return res.status(400).json({ error: "Approved status requires refundStatus to be Processing or No Refund" });
        }

        const { data, error } = await readFaLeaveStore();
        if (error) return res.status(500).json({ error });
        if (index < 0 || index >= data.length) {
            return res.status(400).json({ error: "Invalid index" });
        }

        const { map, error: mapErr } = await loadStudentMasterMapPrimary();
        if (mapErr) return res.status(500).json({ error: mapErr });

        const requester = ensureApproverIdentity(req, res, { requireForRoles: ["fa"] });
        if (!requester) return;
        if (!isRequesterAssigned(data[index], map, "fa", requester)) {
            return res.status(403).json({ error: "Forbidden: this leave request is not assigned to the current FA" });
        }

        data[index].status = status;
        data[index].faApproval = faApproval;
        data[index].refundStatus = refundStatus;

        try {
            await writeFaLeaveStore(data);
        } catch (err) {
            console.error("Error writing FA leave data:", err);
            return res.status(500).json({ error: "Failed to persist FA leave data" });
        }

        const { data: studentLeaves, error: studentErr } = await readStudentLeaveStore();
        if (studentErr) return res.status(500).json({ error: studentErr });

        const faSyncPatch = buildLeaveSyncPatch(data[index]);
        const syncResult = syncLeaveRowByComposite(studentLeaves, data[index], faSyncPatch);
        if (!syncResult.ok) {
            return res.status(404).json({ error: `${syncResult.error} for FA action` });
        }

        try {
            await writeStudentLeaveStore(studentLeaves);
        } catch (err) {
            console.error("Error writing leave_data.json:", err);
            return res.status(500).json({ error: "Failed to persist leave_data.json sync" });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Error updating leave data:", err);
        res.status(500).json({ error: "Failed to update leave data" });
    }
});

// ===== Warden Routes =====

app.get("/api/warden-leave-requests", async (req, res) => {
    const { data, error } = await readWardenLeaveStore();
    if (error) return res.status(500).json({ error });
    const { map, error: mapErr } = await loadStudentMasterMapPrimary();
    if (mapErr) return res.status(500).json({ error: mapErr });

    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["warden"] });
    if (!requester) return;

    const hydratedWithIndex = hydrateLeaveRows(data, map)
        .map((row, sourceIndex) => ({ ...row, sourceIndex }));
    const scoped = hydratedWithIndex.filter((row) => isRequesterAssigned(row, map, "warden", requester));
    res.json(scoped);
});

app.post("/api/warden-update-leave", async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const { index, status, wardenApproval } = req.body;

    if (index === undefined || index === null) return res.status(400).json({ error: "Missing required field: index" });
    if (!status) return res.status(400).json({ error: "Missing required field: status" });
    if (!wardenApproval) return res.status(400).json({ error: "Missing required field: wardenApproval" });
    if (!Number.isInteger(index)) return res.status(400).json({ error: "index must be an integer" });
    if (typeof status !== "string" || typeof wardenApproval !== "string") {
        return res.status(400).json({ error: "status and wardenApproval must be strings" });
    }
    if (!VALID_WARDEN_APPROVALS.includes(wardenApproval)) {
        return res.status(400).json({ error: `Invalid wardenApproval. Allowed: ${VALID_WARDEN_APPROVALS.join(", ")}` });
    }

    const { data, error } = await readWardenLeaveStore();
    if (error) return res.status(500).json({ error });
    if (index < 0 || index >= data.length) return res.status(400).json({ error: `Invalid index ${index}. Must be 0–${data.length - 1}` });

    const { map, error: mapErr } = await loadStudentMasterMapPrimary();
    if (mapErr) return res.status(500).json({ error: mapErr });

    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["warden"] });
    if (!requester) return;
    if (!isRequesterAssigned(data[index], map, "warden", requester)) {
        return res.status(403).json({ error: "Forbidden: this leave request is not assigned to the current Warden" });
    }

    const record = data[index];
    const currentNorm = normText(record.status).toLowerCase();
    const allowed = WARDEN_TRANSITIONS[currentNorm];

    if (!allowed) return res.status(400).json({ error: `Record status "${record.status}" is not actionable by the Warden` });
    if (!allowed.includes(status)) {
        return res.status(400).json({ error: `Cannot transition from "${record.status}" to "${status}". Allowed: ${allowed.join(", ")}` });
    }

    record.status = status;
    record.wardenApproval = wardenApproval;
    if (status === "Rejected") record.refundStatus = "No Refund";

    const { data: studentLeaves, error: studentErr } = await readStudentLeaveStore();
    if (studentErr) return res.status(500).json({ error: studentErr });

    const leaveSyncPatch = buildLeaveSyncPatch(record);
    const studentSync = syncLeaveRowByComposite(studentLeaves, record, leaveSyncPatch);
    if (!studentSync.ok) {
        return res.status(404).json({ error: `${studentSync.error} for Warden action in leave_data.json` });
    }

    try {
        await writeWardenLeaveStore(data);
    } catch (err) {
        console.error("Error writing warden leave data:", err);
        return res.status(500).json({ error: "Failed to persist Warden approval" });
    }

    try {
        await writeStudentLeaveStore(studentLeaves);
    } catch (err) {
        console.error("Error writing leave_data.json:", err);
        return res.status(500).json({ error: "Failed to persist leave_data.json sync" });
    }

    if (status === "Pending FA Approval" && wardenApproval === "Approved") {
        try {
            let faList = [];
            if (USE_POSTGRES_PRIMARY) {
                const { data: faData, error: faErr } = await readFaLeaveStore();
                if (faErr) {
                    return res.status(500).json({ error: `Failed to read FA queue: ${faErr}` });
                }
                faList = Array.isArray(faData) ? faData : [];
            } else {
                const firebaseFa = await readFromFirebase("fa_leave_requests");
                faList = Array.isArray(firebaseFa) ? firebaseFa : [];
            }

            const { map: masterMap } = await loadStudentMasterMapPrimary();
            const master = masterMap.get(normText(record.rollNumber).toUpperCase());
            const source = master ? hydrateFromMaster(record, master) : record;

            const compositeKey = buildLeaveCompositeKey(record);
            const existingIndex = findLeaveIndexByCompositeKey(faList, compositeKey);
            const propagatedSyncPatch = {
                ...buildLeaveSyncPatch(source),
                status: "Pending FA Approval",
                wardenApproval: "Approved",
                faApproval: "Pending",
                refundStatus: "Awaiting Approval"
            };

            if (existingIndex === -1) {
                faList.push({
                    fullName: source.fullName || source.name,
                    rollNumber: source.rollNumber,
                    semester: source.semester,
                    department: source.branch || source.department || "Computer Science",
                    startDate: record.startDate,
                    endDate: record.endDate,
                    totalDays: Number(record.totalDays) || 0,
                    phone: source.phone,
                    parentPhone: source.parentPhone || source.fatherPhone,
                    bankName: source.bankName,
                    bankAccountNumber: source.bankAccountNumber || source.accountNumber,
                    bankIfsc: source.bankIfsc || source.ifsc,
                    reason: record.reason,
                    messName: source.messName,
                    familyApproval: record.familyApproval || "Approved",
                    ...propagatedSyncPatch
                });
            } else {
                applyLeaveSyncPatch(faList[existingIndex], propagatedSyncPatch);
            }

            if (USE_POSTGRES_PRIMARY) {
                await writeFaLeaveStore(faList);
            } else {
                await writeToFirebase("fa_leave_requests", faList);
            }
        } catch (propErr) {
            console.error("Failed to propagate to FA queue:", propErr);
            return res.status(500).json({ error: "Failed to propagate leave to FA queue" });
        }
    }

    res.json({ success: true });
});

app.get("/api/warden-students", async (req, res) => {
    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["warden"] });
    if (!requester) return;
    const shouldScopeToWarden = normText(req.authRole).toLowerCase() === "warden" && (requester.id || requester.name);

    const { data: masterData, error: masterErr } = await readStudentMasterStore();
    if (masterErr) return res.status(500).json({ error: masterErr });

    const scopedMasterData = shouldScopeToWarden
        ? masterData.filter((s) => isRequesterAssigned(s, new Map(), "warden", requester))
        : masterData;
    const mapped = scopedMasterData.map((s) => ({
        rollNumber: s.rollNumber,
        name: s.name,
        fatherName: s.fatherName,
        branch: s.branch || "—",
        roomNumber: s.roomNumber || "—",
        phone: s.phone,
        parentPhone: s.fatherPhone || "—",
        fa: s.fa,
        messName: s.messName,
        email: s.email || "—",
        year: s.year,
        hostel: s.hostelName
    }));
    return res.json(mapped);
});

// ===== Mess Routes =====

app.get("/api/mess-semester-rates", async (req, res) => {
    const { data } = await readMessRatesStore();
    const model = normalizeMessRatesModel(data);
    res.json(model);
});

app.post("/api/mess-semester-rates", async (req, res) => {
    const { period, rate } = req.body || {};
    const key = normText(period).toLowerCase();

    if (!ALLOWED_RATE_PERIODS.includes(key)) {
        return res.status(400).json({ error: `Invalid period. Allowed: ${ALLOWED_RATE_PERIODS.join(", ")}` });
    }

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
        return res.status(400).json({ error: "Rate must be a non-negative number" });
    }

    const { data: modelRaw } = await readMessRatesStore();
    const model = normalizeMessRatesModel(modelRaw);
    if (model.locks[key]) {
        return res.status(400).json({ error: `Rate for ${key} is locked` });
    }

    model.rates[key] = numericRate;

    try {
        await writeMessRatesStore(model);
        res.json({ success: true, data: model });
    } catch (err) {
        console.error("Error writing semester rates:", err);
        res.status(500).json({ error: "Failed to save semester rates" });
    }
});

app.post("/api/mess-rate-lock", async (req, res) => {
    const { period, locked } = req.body || {};
    const key = normText(period).toLowerCase();

    if (!ALLOWED_RATE_PERIODS.includes(key)) {
        return res.status(400).json({ error: `Invalid period. Allowed: ${ALLOWED_RATE_PERIODS.join(", ")}` });
    }
    if (typeof locked !== "boolean") {
        return res.status(400).json({ error: "locked must be boolean" });
    }

    const { data: modelRaw } = await readMessRatesStore();
    const model = normalizeMessRatesModel(modelRaw);
    model.locks[key] = locked;

    try {
        await writeMessRatesStore(model);
        res.json({ success: true, data: model });
    } catch (err) {
        console.error("Error updating lock state:", err);
        res.status(500).json({ error: "Failed to update lock state" });
    }
});

app.get("/api/mess-refunds", async (req, res) => {
    const { data: modelRaw } = await readMessRatesStore();
    const model = normalizeMessRatesModel(modelRaw);
    const { data, error } = await readFaLeaveStore();
    if (error) return res.status(500).json({ error });
    const { map } = await loadStudentMasterMapPrimary();
    const hydrated = hydrateLeaveRows(data, map);

    const approved = hydrated
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => normText(item.status).toLowerCase() === "approved")
        .map(({ item, index }) => {
            const periodKey = semesterToPeriod(item.semester, item.startDate);
            const rate = Number(model.rates[periodKey]) || 0;
            const days = Number(item.totalDays) || 0;
            const manualAmount = Number(item.refundAmount);
            const refundAmount = Number.isFinite(manualAmount) && manualAmount >= 0 ? manualAmount : rate * days;

            return {
                ...item,
                _index: index,
                periodKey,
                periodLocked: Boolean(model.locks[periodKey]),
                refundAmount,
                bankName: normText(item.bankName) || "—",
                bankAccountNumber: normText(item.bankAccountNumber || item.accountNumber) || "—",
                bankIfsc: normText(item.bankIfsc || item.ifsc) || "—"
            };
        });

    res.json(approved);
});

app.post("/api/mess-update-refund", async (req, res) => {
    const { index, refundStatus, refundAmount, bankName, bankAccountNumber, bankIfsc } = req.body || {};

    if (!Number.isInteger(index)) return res.status(400).json({ error: "index must be an integer" });
    if (!refundStatus || !ALLOWED_REFUND_STATUSES.includes(refundStatus)) {
        return res.status(400).json({ error: `Invalid refundStatus. Allowed: ${ALLOWED_REFUND_STATUSES.join(", ")}` });
    }

    const parsedAmount = Number(refundAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: "refundAmount must be a non-negative number" });
    }

    const { data, error } = await readFaLeaveStore();
    if (error) return res.status(500).json({ error });
    if (index < 0 || index >= data.length) {
        return res.status(400).json({ error: `Invalid index ${index}. Must be 0–${data.length - 1}` });
    }

    const item = data[index];
    if (!item || normText(item.status).toLowerCase() !== "approved") {
        return res.status(400).json({ error: "Only FA-approved records are actionable by Mess" });
    }

    item.refundStatus = refundStatus;
    item.refundAmount = parsedAmount;
    item.bankName = normText(bankName) || item.bankName || "—";
    item.bankAccountNumber = normText(bankAccountNumber) || item.bankAccountNumber || "—";
    item.bankIfsc = normText(bankIfsc).toUpperCase() || item.bankIfsc || "—";

    if (refundStatus === "Refunded") {
        item.refundProcessedAt = new Date().toISOString();
        item.refundProcessedBy = "Mess";
    }

    const { data: studentLeaves, error: studentLeavesErr } = await readStudentLeaveStore();
    if (studentLeavesErr) {
        return res.status(500).json({ error: studentLeavesErr });
    }

    const syncResult = syncLeaveRowByComposite(studentLeaves, item, buildLeaveSyncPatch(item));
    if (!syncResult.ok) {
        return res.status(404).json({ error: `${syncResult.error} for Mess action` });
    }

    try {
        await writeFaLeaveStore(data);
    } catch (err) {
        console.error("Error writing mess refund data:", err);
        return res.status(500).json({ error: "Failed to persist mess refund data" });
    }

    try {
        await writeStudentLeaveStore(studentLeaves);
    } catch (err) {
        console.error("Error writing leave_data.json:", err);
        return res.status(500).json({ error: "Failed to persist leave_data.json sync" });
    }

    res.json({ success: true });
});

// ===== Admin – Master Student CRUD =====

app.put("/api/student-master/:rollNumber", async (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = await readStudentMasterStore();
    if (error) return res.status(500).json({ error });

    const idx = data.findIndex((s) => normText(s.rollNumber).toUpperCase() === roll);
    if (idx === -1) return res.status(404).json({ error: `Student ${roll} not found` });

    const body = req.body || {};
    const merged = { ...data[idx], ...body, rollNumber: roll };

    // On edits, keep FA name/id in sync instead of validating against stale merged values.
    if (Object.prototype.hasOwnProperty.call(body, "fa") && !Object.prototype.hasOwnProperty.call(body, "faId")) {
        merged.faId = "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "faId") && !Object.prototype.hasOwnProperty.call(body, "fa")) {
        merged.fa = "";
    }

    const assigned = await applyMasterAssignments(merged);
    const errors = [
        ...validateMasterFields(assigned.value),
        ...assigned.errors
    ];
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    data[idx] = normalizeMasterStudent(assigned.value);

    try {
        await writeStudentMasterStore(data);
        res.json({ success: true, student: data[idx] });
    } catch (err) {
        console.error("Error updating master record:", err);
        res.status(500).json({ error: "Failed to update master record" });
    }
});

app.post("/api/student-master", async (req, res) => {
    const body = req.body || {};
    const roll = normText(body.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = await readStudentMasterStore();
    if (error) return res.status(500).json({ error });

    if (data.some((s) => normText(s.rollNumber).toUpperCase() === roll)) {
        return res.status(409).json({ error: `Student ${roll} already exists` });
    }

    const assigned = await applyMasterAssignments({ ...body, rollNumber: roll }, { requireFa: true });
    const errors = [
        ...validateMasterFields(assigned.value),
        ...assigned.errors
    ];
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const record = normalizeMasterStudent(assigned.value);
    data.push(record);

    try {
        await writeStudentMasterStore(data);
        res.json({ success: true, student: record });
    } catch (err) {
        console.error("Error adding master record:", err);
        res.status(500).json({ error: "Failed to add master record" });
    }
});

app.delete("/api/student-master/:rollNumber", async (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = await readStudentMasterStore();
    if (error) return res.status(500).json({ error });

    const idx = data.findIndex((s) => normText(s.rollNumber).toUpperCase() === roll);
    if (idx === -1) return res.status(404).json({ error: `Student ${roll} not found` });

    const dependencyStores = [
        { label: "leave_data", file: STUDENT_LEAVE_FILE },
        { label: "warden_leave_requests", file: WARDEN_LEAVE_FILE },
        { label: "fa_leave_requests", file: DATA_FILE }
    ];
    const refs = [];
    for (const store of dependencyStores) {
        const loaded = await readArrayStore(store.file);
        if (loaded.error) return res.status(500).json({ error: `Failed to read ${store.label}: ${loaded.error}` });
        const count = loaded.data.filter((row) => normText(row && row.rollNumber).toUpperCase() === roll).length;
        if (count > 0) refs.push({ store: store.label, count });
    }
    if (refs.length) {
        const detail = refs.map((r) => `${r.store}: ${r.count}`).join(", ");
        return res.status(409).json({ error: `Cannot delete ${roll}: leave history exists (${detail})` });
    }

    data.splice(idx, 1);

    try {
        await writeStudentMasterStore(data);
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting master record:", err);
        res.status(500).json({ error: "Failed to delete master record" });
    }
});

function validateMasterFields(body) {
    const errors = [];
    const phoneRe = /^\d{10,15}$/;
    const ifscRe = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
    const accountRe = /^\d{6,18}$/;

    if (body.phone && !phoneRe.test(digitsOnly(body.phone))) {
        errors.push("Phone must be 10-15 digits");
    }
    if (body.fatherPhone && !phoneRe.test(digitsOnly(body.fatherPhone))) {
        errors.push("Father phone must be 10-15 digits");
    }
    if (body.motherPhone && !phoneRe.test(digitsOnly(body.motherPhone))) {
        errors.push("Mother phone must be 10-15 digits");
    }
    const accountCandidate = body.bankAccountNumber || body.accountNumber;
    if (accountCandidate && !accountRe.test(digitsOnly(accountCandidate))) {
        errors.push("Account number must be 6-18 digits");
    }
    const ifscCandidate = body.bankIfsc || body.ifsc;
    if (ifscCandidate && !ifscRe.test(normText(ifscCandidate))) {
        errors.push("IFSC must match format like SBIN0001234");
    }
    if (body.year !== undefined) {
        const y = Number(body.year);
        if (!Number.isInteger(y) || y < 1 || y > 4) errors.push("Year must be 1-4");
    }
    if (body.semester !== undefined) {
        const s = Number(body.semester);
        if (!Number.isInteger(s) || s < 1 || s > 8) errors.push("Semester must be 1-8");
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normText(body.email))) {
        errors.push("Invalid email format");
    }

    return errors;
}

// ===== Student Routes =====

app.get("/api/student-leaves", async (req, res) => {
    const { data, error } = await readStudentLeaveStore();
    if (error) return res.status(500).json({ error: "Failed to read student leave data" });
    const { map } = await loadStudentMasterMapPrimary();

    const { data: faRows, error: faError } = await readFaLeaveStore();
    const faByComposite = new Map();
    if (!faError && Array.isArray(faRows)) {
        for (const row of faRows) {
            const key = buildLeaveCompositeKey(row);
            if (!key) continue;
            faByComposite.set(key, row);
        }
    }

    const hydrated = hydrateLeaveRows(data, map).map((row) => {
        const key = buildLeaveCompositeKey(row);
        if (!faByComposite.has(key)) return row;

        const faRow = faByComposite.get(key);
        return {
            ...row,
            refundStatus: normText(faRow.refundStatus) || row.refundStatus,
            refundAmount: Number.isFinite(Number(faRow.refundAmount)) ? Number(faRow.refundAmount) : row.refundAmount,
            refundProcessedAt: faRow.refundProcessedAt || row.refundProcessedAt,
            refundProcessedBy: faRow.refundProcessedBy || row.refundProcessedBy,
                refundRuleMinDays: Number.isFinite(Number(faRow.refundRuleMinDays)) ? Number(faRow.refundRuleMinDays) : row.refundRuleMinDays,
                refundRuleAmountPerDay: Number.isFinite(Number(faRow.refundRuleAmountPerDay)) ? Number(faRow.refundRuleAmountPerDay) : row.refundRuleAmountPerDay,
                refundRuleCapturedAt: faRow.refundRuleCapturedAt || row.refundRuleCapturedAt,
            bankName: normText(faRow.bankName) || row.bankName,
            bankAccountNumber: normText(faRow.bankAccountNumber || faRow.accountNumber) || row.bankAccountNumber,
            bankIfsc: normText(faRow.bankIfsc || faRow.ifsc) || row.bankIfsc
        };
    });

    res.json(hydrated);
});

app.post("/api/submit-leave", async (req, res) => {
    try {
        const { rollNumber, parentRelation, startDate, endDate, reason } = req.body || {};

        if (!rollNumber || !parentRelation || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return res.status(400).json({ error: "Invalid dates" });
        }
        if (start <= today) {
            return res.status(400).json({ error: "Start date must be in the future" });
        }
        if (end <= start) {
            return res.status(400).json({ error: "End date must be after start date" });
        }

        const { map, error: masterErr } = await loadStudentMasterMapPrimary();
        if (masterErr) return res.status(500).json({ error: masterErr });

        const student = map.get(normText(rollNumber).toUpperCase());
        if (!student) return res.status(404).json({ error: "Student not found in master database" });

        const selectedParent = parentRelation === "mother" ? student.motherPhone : student.fatherPhone;
        const totalDays = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;

            const { data: constraintsData } = await readMessConstraintsStore();
            const refundRuleMinDays = Number.isFinite(Number(constraintsData && constraintsData.minDaysForRefund))
                ? Number(constraintsData.minDaysForRefund)
                : 3;
            const refundRuleAmountPerDay = Number.isFinite(Number(constraintsData && constraintsData.amountPerDay))
                ? Number(constraintsData.amountPerDay)
                : 200;
            const refundRuleCapturedAt = new Date().toISOString();

        const { data: studentLeaves, error: studentErr } = await readStudentLeaveStore();
        if (studentErr) return res.status(500).json({ error: studentErr });

        const { data: wardenLeaves, error: wardenErr } = await readWardenLeaveStore();
        if (wardenErr) return res.status(500).json({ error: wardenErr });

        const compositeExists = (rows) => rows.some((row) =>
            normText(row.rollNumber).toUpperCase() === student.rollNumber &&
            normText(row.startDate) === normText(startDate) &&
            normText(row.endDate) === normText(endDate)
        );

        if (compositeExists(studentLeaves) || compositeExists(wardenLeaves)) {
            return res.status(409).json({ error: "Leave request already exists for this roll number and date range" });
        }

        const leaveRecord = {
            fullName: student.name,
            rollNumber: student.rollNumber,
            fatherName: student.fatherName,
            motherName: student.motherName,
            phone: student.phone,
            fatherPhone: student.fatherPhone,
            motherPhone: student.motherPhone,
            parentPhone: selectedParent,
            parentRelation,
            year: student.year,
            semester: student.semester,
            hostelName: student.hostelName,
            warden: student.warden,
            wardenId: student.wardenId,
            fa: student.fa,
            faId: student.faId,
            messName: student.messName,
            bankName: student.bankName,
            bankAccountNumber: student.accountNumber,
            bankIfsc: student.ifsc,
            startDate,
            endDate,
            totalDays,
            reason: normText(reason),
            status: "Pending Warden Approval",
            familyApproval: "Skipped",
            wardenApproval: "Pending",
            faApproval: "Pending",
            refundStatus: "Awaiting Approval",
            refundRuleMinDays,
            refundRuleAmountPerDay,
            refundRuleCapturedAt
        };

        studentLeaves.push(leaveRecord);
        wardenLeaves.push({ ...leaveRecord });

        await writeStudentLeaveStore(studentLeaves);
        await writeWardenLeaveStore(wardenLeaves);
        res.json({ success: true, status: "Pending Warden Approval" });
    } catch (err) {
        console.error("Error submitting leave:", err);
        res.status(500).json({ error: "Failed to submit leave" });
    }
});

app.get("/api/health/db", async (req, res) => {
    const health = {
        mode: DB_MODE,
        postgres: {
            enabled: USE_POSTGRES_PRIMARY,
            configured: isPostgresConfigured(),
            ok: false
        },
        firebase: {
            primary: USE_FIREBASE_PRIMARY,
            mirror: USE_FIREBASE_MIRROR_WRITE,
            ok: isFirebaseReady()
        }
    };

    if (USE_POSTGRES_PRIMARY) {
        try {
            const row = await postgresHealthCheck();
            health.postgres.ok = true;
            health.postgres.now = row.now;
        } catch (err) {
            health.postgres.error = err.message;
        }
    }

    const statusCode = health.postgres.enabled && !health.postgres.ok ? 500 : 200;
    res.status(statusCode).json(health);
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`   Open http://localhost:${PORT}/index.html`);
    console.log(`[storage] DB_MODE=${DB_MODE}`);
    if (USE_POSTGRES_PRIMARY) {
        console.log("[storage] PostgreSQL primary storage is enabled.");
    }
    if (USE_FIREBASE_PRIMARY) {
        console.log("[firebase] Firebase primary storage is enabled.");
    } else if (USE_FIREBASE_MIRROR_WRITE) {
        console.log("[firebase] Firebase mirror writes are enabled.");
    }
    if (!AUTH_ENABLED) {
        console.warn("⚠️ AUTH_ENABLED is false. API role checks are currently disabled.");
    }
});
