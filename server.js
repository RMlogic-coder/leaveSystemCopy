const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";
const API_ACCESS_KEY = process.env.API_ACCESS_KEY || "";

const DATA_FILE = path.join(__dirname, "data", "fa_leave_requests.json");
const WARDEN_LEAVE_FILE = path.join(__dirname, "data", "warden_leave_requests.json");
const WARDEN_STUDENTS_FILE = path.join(__dirname, "data", "warden_students.json");
const STUDENT_LEAVE_FILE = path.join(__dirname, "data", "leave_data.json");
const STUDENT_MASTER_FILE = path.join(__dirname, "data", "student_master.json");
const MESS_RATES_FILE = path.join(__dirname, "data", "mess_semester_rates.json");
const HOSTEL_WARDEN_FILE = path.join(__dirname, "data", "hostel_warden_mapping.json");
const CREDENTIALS_FILE = path.join(__dirname, "data", "credentials.json");

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
    { method: "GET", path: "/api/student-master", roles: ["admin", "fa", "warden"] },
    { method: "GET", path: "/api/student-master/:rollNumber", roles: ["admin", "fa", "warden", "student"] },
    { method: "PUT", path: "/api/student-master/:rollNumber", roles: ["admin"] },
    { method: "POST", path: "/api/student-master", roles: ["admin"] },
    { method: "DELETE", path: "/api/student-master/:rollNumber", roles: ["admin"] },
    { method: "GET", path: "/api/hostel-warden-mapping", roles: ["admin", "fa", "warden"] },

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

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return { data: null, error: `File not found: ${path.basename(filePath)}` };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return { data: null, error: "Data file is not a valid array" };
        }
        return { data: parsed, error: null };
    } catch {
        return { data: null, error: "Failed to parse data file" };
    }
}

function writeJsonArrayFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + "\n");
}

function readJsonObjectFile(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) {
        return { data: fallback, error: null };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { data: fallback, error: null };
        }
        return { data: parsed, error: null };
    } catch {
        return { data: fallback, error: null };
    }
}

function loadApproverDirectory() {
    const { data } = readJsonObjectFile(CREDENTIALS_FILE, {});
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
        wardensById: byId(wardens),
        wardensByName: byName(wardens),
        fasById: byId(fas),
        fasByName: byName(fas)
    };
}

function loadHostelWardenMapping() {
    const { data } = readJsonObjectFile(HOSTEL_WARDEN_FILE, {});
    const map = new Map();
    const entries = data && typeof data === "object" && !Array.isArray(data) ? Object.entries(data) : [];

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

function applyMasterAssignments(candidate, options = {}) {
    const errors = [];
    const next = { ...candidate };
    const mapping = loadHostelWardenMapping();
    const approvers = loadApproverDirectory();

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

function findStudentLeaveDependencies(rollNumber) {
    const roll = normText(rollNumber).toUpperCase();
    const stores = [
        { label: "leave_data", file: STUDENT_LEAVE_FILE },
        { label: "warden_leave_requests", file: WARDEN_LEAVE_FILE },
        { label: "fa_leave_requests", file: DATA_FILE }
    ];

    const references = [];
    for (const store of stores) {
        const { data, error } = readJsonFile(store.file);
        if (error) {
            return { error: `Failed to read ${store.label}: ${error}`, references: [] };
        }

        const count = data.filter((row) => normText(row && row.rollNumber).toUpperCase() === roll).length;
        if (count > 0) {
            references.push({ store: store.label, count });
        }
    }

    return { error: null, references };
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

function sanitizeMasterDatabase() {
    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
    if (error || !Array.isArray(data)) return;

    const sanitized = data.map((row) => normalizeMasterStudent(row || {}));
    if (JSON.stringify(sanitized) !== JSON.stringify(data)) {
        writeJsonArrayFile(STUDENT_MASTER_FILE, sanitized);
    }
}

function loadStudentMasterMap() {
    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
    if (error) return { map: new Map(), error };
    const map = new Map();
    for (const row of data) {
        const normalized = normalizeMasterStudent(row || {});
        if (normalized.rollNumber) map.set(normalized.rollNumber, normalized);
    }
    return { map, error: null };
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

function readMessRatesModel() {
    const { data } = readJsonObjectFile(MESS_RATES_FILE, {});
    return normalizeMessRatesModel(data);
}

function writeMessRatesModel(model) {
    fs.writeFileSync(MESS_RATES_FILE, JSON.stringify(model, null, 4) + "\n");
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
        refundProcessedBy: normText(source.refundProcessedBy) || undefined
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
        "refundProcessedBy"
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

function backfillLeavesFromMaster() {
    const { map, error } = loadStudentMasterMap();
    if (error) {
        console.warn("Master DB unavailable for backfill:", error);
        return;
    }

    const files = [STUDENT_LEAVE_FILE, WARDEN_LEAVE_FILE, DATA_FILE];
    for (const file of files) {
        const { data, error: readErr } = readJsonFile(file);
        if (readErr) continue;
        let changed = false;

        const next = data.map((row) => {
            const roll = normText(row.rollNumber);
            if (!roll || !map.has(roll)) return row;
            const hydrated = hydrateFromMaster(row, map.get(roll));
            if (JSON.stringify(hydrated) !== JSON.stringify(row)) changed = true;
            return hydrated;
        });

        if (changed) {
            writeJsonArrayFile(file, next);
        }
    }
}

function reconcileStudentLeavesWithFaQueue() {
    const { data: faRows, error: faErr } = readJsonFile(DATA_FILE);
    if (faErr) return;

    const { data: studentRows, error: studentErr } = readJsonFile(STUDENT_LEAVE_FILE);
    if (studentErr) return;

    function hasText(value) {
        return normText(value) !== "";
    }

    function buildMissingApprovalRefundPatch(faRow, studentRow) {
        const patch = {};

        if (!hasText(studentRow.status) && hasText(faRow.status)) {
            patch.status = normText(faRow.status);
        }
        if (!hasText(studentRow.wardenApproval) && hasText(faRow.wardenApproval)) {
            patch.wardenApproval = normText(faRow.wardenApproval);
        }
        if (!hasText(studentRow.faApproval) && hasText(faRow.faApproval)) {
            patch.faApproval = normText(faRow.faApproval);
        }
        if (!hasText(studentRow.refundStatus) && hasText(faRow.refundStatus)) {
            patch.refundStatus = normText(faRow.refundStatus);
        }

        const studentAmount = Number(studentRow.refundAmount);
        const faAmount = Number(faRow.refundAmount);
        if (!Number.isFinite(studentAmount) && Number.isFinite(faAmount)) {
            patch.refundAmount = faAmount;
        }

        if (!hasText(studentRow.refundProcessedAt) && hasText(faRow.refundProcessedAt)) {
            patch.refundProcessedAt = normText(faRow.refundProcessedAt);
        }
        if (!hasText(studentRow.refundProcessedBy) && hasText(faRow.refundProcessedBy)) {
            patch.refundProcessedBy = normText(faRow.refundProcessedBy);
        }

        return patch;
    }

    let changed = false;
    for (const faRow of faRows) {
        const idx = findLeaveIndexByCompositeKey(studentRows, buildLeaveCompositeKey(faRow));
        if (idx === -1) continue;

        const patch = buildMissingApprovalRefundPatch(faRow, studentRows[idx]);
        if (Object.keys(patch).length === 0) continue;

        const before = JSON.stringify(studentRows[idx]);
        applyLeaveSyncPatch(studentRows[idx], patch);
        if (JSON.stringify(studentRows[idx]) !== before) changed = true;
    }

    if (changed) {
        writeJsonArrayFile(STUDENT_LEAVE_FILE, studentRows);
    }
}

sanitizeMasterDatabase();
backfillLeavesFromMaster();
reconcileStudentLeavesWithFaQueue();

// ===== Master Student Routes =====

app.get("/api/student-master", (req, res) => {
    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
    if (error) return res.status(500).json({ error });
    res.json(data.map(normalizeMasterStudent));
});

app.get("/api/student-master/:rollNumber", (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { map, error } = loadStudentMasterMap();
    if (error) return res.status(500).json({ error });

    const student = map.get(roll);
    if (!student) return res.status(404).json({ error: `Student not found: ${roll}` });

    res.json(student);
});

app.get("/api/hostel-warden-mapping", (req, res) => {
    const mapping = loadHostelWardenMapping();
    const hostels = Array.from(mapping.values()).sort((a, b) => a.hostelName.localeCompare(b.hostelName));
    res.json(hostels);
});

// ===== FA Routes =====

app.get("/api/leave-requests", (req, res) => {
    const { data, error } = readJsonFile(DATA_FILE);
    if (error) return res.status(500).json({ error: "Failed to read leave data" });
    const { map, error: mapErr } = loadStudentMasterMap();
    if (mapErr) return res.status(500).json({ error: mapErr });

    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["fa"] });
    if (!requester) return;

    const hydratedWithIndex = hydrateLeaveRows(data, map)
        .map((row, sourceIndex) => ({ ...row, sourceIndex }));
    const scoped = hydratedWithIndex.filter((row) => isRequesterAssigned(row, map, "fa", requester));
    res.json(scoped);
});

app.post("/api/update-leave", (req, res) => {
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

        const { data, error } = readJsonFile(DATA_FILE);
        if (error) return res.status(500).json({ error });
        if (index < 0 || index >= data.length) {
            return res.status(400).json({ error: "Invalid index" });
        }

        const { map, error: mapErr } = loadStudentMasterMap();
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
            writeJsonArrayFile(DATA_FILE, data);
        } catch (err) {
            console.error("Error writing FA leave data:", err);
            return res.status(500).json({ error: "Failed to persist FA leave data" });
        }

        const { data: studentLeaves, error: studentErr } = readJsonFile(STUDENT_LEAVE_FILE);
        if (studentErr) return res.status(500).json({ error: studentErr });

        const faSyncPatch = buildLeaveSyncPatch(data[index]);
        const syncResult = syncLeaveRowByComposite(studentLeaves, data[index], faSyncPatch);
        if (!syncResult.ok) {
            return res.status(404).json({ error: `${syncResult.error} for FA action` });
        }

        try {
            writeJsonArrayFile(STUDENT_LEAVE_FILE, studentLeaves);
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

app.get("/api/warden-leave-requests", (req, res) => {
    const { data, error } = readJsonFile(WARDEN_LEAVE_FILE);
    if (error) return res.status(500).json({ error });
    const { map, error: mapErr } = loadStudentMasterMap();
    if (mapErr) return res.status(500).json({ error: mapErr });

    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["warden"] });
    if (!requester) return;

    const hydratedWithIndex = hydrateLeaveRows(data, map)
        .map((row, sourceIndex) => ({ ...row, sourceIndex }));
    const scoped = hydratedWithIndex.filter((row) => isRequesterAssigned(row, map, "warden", requester));
    res.json(scoped);
});

app.post("/api/warden-update-leave", (req, res) => {
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

    const { data, error } = readJsonFile(WARDEN_LEAVE_FILE);
    if (error) return res.status(500).json({ error });
    if (index < 0 || index >= data.length) return res.status(400).json({ error: `Invalid index ${index}. Must be 0–${data.length - 1}` });

    const { map, error: mapErr } = loadStudentMasterMap();
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

    const { data: studentLeaves, error: studentErr } = readJsonFile(STUDENT_LEAVE_FILE);
    if (studentErr) return res.status(500).json({ error: studentErr });

    const leaveSyncPatch = buildLeaveSyncPatch(record);
    const studentSync = syncLeaveRowByComposite(studentLeaves, record, leaveSyncPatch);
    if (!studentSync.ok) {
        return res.status(404).json({ error: `${studentSync.error} for Warden action in leave_data.json` });
    }

    try {
        writeJsonArrayFile(WARDEN_LEAVE_FILE, data);
    } catch (err) {
        console.error("Error writing warden leave data:", err);
        return res.status(500).json({ error: "Failed to persist Warden approval" });
    }

    try {
        writeJsonArrayFile(STUDENT_LEAVE_FILE, studentLeaves);
    } catch (err) {
        console.error("Error writing leave_data.json:", err);
        return res.status(500).json({ error: "Failed to persist leave_data.json sync" });
    }

    if (status === "Pending FA Approval" && wardenApproval === "Approved") {
        try {
            const { data: faData, error: faErr } = readJsonFile(DATA_FILE);
            const faList = faErr ? [] : faData;
            const { map: masterMap } = loadStudentMasterMap();
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

            writeJsonArrayFile(DATA_FILE, faList);
        } catch (propErr) {
            console.error("Warning: failed to propagate to FA queue:", propErr);
        }
    }

    res.json({ success: true });
});

app.get("/api/warden-students", (req, res) => {
    const requester = ensureApproverIdentity(req, res, { requireForRoles: ["warden"] });
    if (!requester) return;
    const shouldScopeToWarden = normText(req.authRole).toLowerCase() === "warden" && (requester.id || requester.name);

    const { data: masterData, error: masterErr } = readJsonFile(STUDENT_MASTER_FILE);
    if (!masterErr) {
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
    }

    const { data, error } = readJsonFile(WARDEN_STUDENTS_FILE);
    if (error) return res.status(500).json({ error });
    res.json(data);
});

// ===== Mess Routes =====

app.get("/api/mess-semester-rates", (req, res) => {
    const model = readMessRatesModel();
    res.json(model);
});

app.post("/api/mess-semester-rates", (req, res) => {
    const { period, rate } = req.body || {};
    const key = normText(period).toLowerCase();

    if (!ALLOWED_RATE_PERIODS.includes(key)) {
        return res.status(400).json({ error: `Invalid period. Allowed: ${ALLOWED_RATE_PERIODS.join(", ")}` });
    }

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
        return res.status(400).json({ error: "Rate must be a non-negative number" });
    }

    const model = readMessRatesModel();
    if (model.locks[key]) {
        return res.status(400).json({ error: `Rate for ${key} is locked` });
    }

    model.rates[key] = numericRate;

    try {
        writeMessRatesModel(model);
        res.json({ success: true, data: model });
    } catch (err) {
        console.error("Error writing semester rates:", err);
        res.status(500).json({ error: "Failed to save semester rates" });
    }
});

app.post("/api/mess-rate-lock", (req, res) => {
    const { period, locked } = req.body || {};
    const key = normText(period).toLowerCase();

    if (!ALLOWED_RATE_PERIODS.includes(key)) {
        return res.status(400).json({ error: `Invalid period. Allowed: ${ALLOWED_RATE_PERIODS.join(", ")}` });
    }
    if (typeof locked !== "boolean") {
        return res.status(400).json({ error: "locked must be boolean" });
    }

    const model = readMessRatesModel();
    model.locks[key] = locked;

    try {
        writeMessRatesModel(model);
        res.json({ success: true, data: model });
    } catch (err) {
        console.error("Error updating lock state:", err);
        res.status(500).json({ error: "Failed to update lock state" });
    }
});

app.get("/api/mess-refunds", (req, res) => {
    const model = readMessRatesModel();
    const { data, error } = readJsonFile(DATA_FILE);
    if (error) return res.status(500).json({ error });
    const { map } = loadStudentMasterMap();
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

app.post("/api/mess-update-refund", (req, res) => {
    const { index, refundStatus, refundAmount, bankName, bankAccountNumber, bankIfsc } = req.body || {};

    if (!Number.isInteger(index)) return res.status(400).json({ error: "index must be an integer" });
    if (!refundStatus || !ALLOWED_REFUND_STATUSES.includes(refundStatus)) {
        return res.status(400).json({ error: `Invalid refundStatus. Allowed: ${ALLOWED_REFUND_STATUSES.join(", ")}` });
    }

    const parsedAmount = Number(refundAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: "refundAmount must be a non-negative number" });
    }

    const { data, error } = readJsonFile(DATA_FILE);
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

    const { data: studentLeaves, error: studentLeavesErr } = readJsonFile(STUDENT_LEAVE_FILE);
    if (studentLeavesErr) {
        return res.status(500).json({ error: studentLeavesErr });
    }

    const syncResult = syncLeaveRowByComposite(studentLeaves, item, buildLeaveSyncPatch(item));
    if (!syncResult.ok) {
        return res.status(404).json({ error: `${syncResult.error} for Mess action` });
    }

    try {
        writeJsonArrayFile(DATA_FILE, data);
    } catch (err) {
        console.error("Error writing mess refund data:", err);
        return res.status(500).json({ error: "Failed to persist mess refund data" });
    }

    try {
        writeJsonArrayFile(STUDENT_LEAVE_FILE, studentLeaves);
    } catch (err) {
        console.error("Error writing leave_data.json:", err);
        return res.status(500).json({ error: "Failed to persist leave_data.json sync" });
    }

    res.json({ success: true });
});

// ===== Admin – Master Student CRUD =====

app.put("/api/student-master/:rollNumber", (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
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

    const assigned = applyMasterAssignments(merged);
    const errors = [
        ...validateMasterFields(assigned.value),
        ...assigned.errors
    ];
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    data[idx] = normalizeMasterStudent(assigned.value);

    try {
        writeJsonArrayFile(STUDENT_MASTER_FILE, data);
        res.json({ success: true, student: data[idx] });
    } catch (err) {
        console.error("Error updating master record:", err);
        res.status(500).json({ error: "Failed to update master record" });
    }
});

app.post("/api/student-master", (req, res) => {
    const body = req.body || {};
    const roll = normText(body.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
    if (error) return res.status(500).json({ error });

    if (data.some((s) => normText(s.rollNumber).toUpperCase() === roll)) {
        return res.status(409).json({ error: `Student ${roll} already exists` });
    }

    const assigned = applyMasterAssignments({ ...body, rollNumber: roll }, { requireFa: true });
    const errors = [
        ...validateMasterFields(assigned.value),
        ...assigned.errors
    ];
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const record = normalizeMasterStudent(assigned.value);
    data.push(record);

    try {
        writeJsonArrayFile(STUDENT_MASTER_FILE, data);
        res.json({ success: true, student: record });
    } catch (err) {
        console.error("Error adding master record:", err);
        res.status(500).json({ error: "Failed to add master record" });
    }
});

app.delete("/api/student-master/:rollNumber", (req, res) => {
    const roll = normText(req.params.rollNumber).toUpperCase();
    if (!roll) return res.status(400).json({ error: "rollNumber is required" });

    const { data, error } = readJsonFile(STUDENT_MASTER_FILE);
    if (error) return res.status(500).json({ error });

    const idx = data.findIndex((s) => normText(s.rollNumber).toUpperCase() === roll);
    if (idx === -1) return res.status(404).json({ error: `Student ${roll} not found` });

    const deps = findStudentLeaveDependencies(roll);
    if (deps.error) return res.status(500).json({ error: deps.error });
    if (deps.references.length) {
        const detail = deps.references.map((r) => `${r.store}: ${r.count}`).join(", ");
        return res.status(409).json({ error: `Cannot delete ${roll}: leave history exists (${detail})` });
    }

    data.splice(idx, 1);

    try {
        writeJsonArrayFile(STUDENT_MASTER_FILE, data);
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

app.get("/api/student-leaves", (req, res) => {
    const { data, error } = readJsonFile(STUDENT_LEAVE_FILE);
    if (error) return res.status(500).json({ error: "Failed to read student leave data" });
    const { map } = loadStudentMasterMap();

    const { data: faRows, error: faError } = readJsonFile(DATA_FILE);
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
            bankName: normText(faRow.bankName) || row.bankName,
            bankAccountNumber: normText(faRow.bankAccountNumber || faRow.accountNumber) || row.bankAccountNumber,
            bankIfsc: normText(faRow.bankIfsc || faRow.ifsc) || row.bankIfsc
        };
    });

    res.json(hydrated);
});

app.post("/api/submit-leave", (req, res) => {
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

        const { map, error: masterErr } = loadStudentMasterMap();
        if (masterErr) return res.status(500).json({ error: masterErr });

        const student = map.get(normText(rollNumber).toUpperCase());
        if (!student) return res.status(404).json({ error: "Student not found in master database" });

        const selectedParent = parentRelation === "mother" ? student.motherPhone : student.fatherPhone;
        const totalDays = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;

        const { data: studentLeaves, error: studentErr } = readJsonFile(STUDENT_LEAVE_FILE);
        if (studentErr) return res.status(500).json({ error: studentErr });

        const { data: wardenLeaves, error: wardenErr } = readJsonFile(WARDEN_LEAVE_FILE);
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
            refundStatus: "Awaiting Approval"
        };

        studentLeaves.push(leaveRecord);
        wardenLeaves.push({ ...leaveRecord });

        writeJsonArrayFile(STUDENT_LEAVE_FILE, studentLeaves);
        writeJsonArrayFile(WARDEN_LEAVE_FILE, wardenLeaves);
        res.json({ success: true, status: "Pending Warden Approval" });
    } catch (err) {
        console.error("Error submitting leave:", err);
        res.status(500).json({ error: "Failed to submit leave" });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`   Open http://localhost:${PORT}/index.html`);
    if (!AUTH_ENABLED) {
        console.warn("⚠️ AUTH_ENABLED is false. API role checks are currently disabled.");
    }
});
