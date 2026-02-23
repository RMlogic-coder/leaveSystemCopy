const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "fa_leave_requests.json");
const WARDEN_LEAVE_FILE = path.join(__dirname, "warden_leave_requests.json");
const WARDEN_STUDENTS_FILE = path.join(__dirname, "warden_students.json");
const STUDENT_LEAVE_FILE = path.join(__dirname, "leave_data.json");
const STUDENT_MASTER_FILE = path.join(__dirname, "student_master.json");
const MESS_RATES_FILE = path.join(__dirname, "mess_semester_rates.json");

const VALID_WARDEN_APPROVALS = ["Pending", "Approved", "Rejected"];
const WARDEN_TRANSITIONS = {
    "pending warden approval": ["Pending FA Approval", "Rejected"]
};
const ALLOWED_REFUND_STATUSES = ["Awaiting Approval", "Processing", "Refunded", "No Refund"];
const ALLOWED_RATE_PERIODS = ["even2026", "odd2026", "even2025", "odd2025"];

app.use(express.json());
app.use(express.static(__dirname));

function normText(value) {
    return String(value || "").trim();
}

function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
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

function normalizeMasterStudent(student) {
    const rollNumber = normText(student.rollNumber).toUpperCase();
    const name = normText(student.name) || `Student ${rollNumber || "0000"}`;
    const fatherName = normText(student.fatherName) || `Mr. ${deriveLastName(name)}`;
    const motherName = normText(student.motherName) || `Mrs. ${deriveLastName(fatherName)}`;

    const year = Math.max(1, Math.min(4, Number(student.year) || 1));
    const inferredSemester = (year - 1) * 2 + 1;
    const semesterNum = Math.max(1, Math.min(8, Number(student.semester) || inferredSemester));

    const phone = digitsOnly(student.phone) || buildPhone(rollNumber, "1");
    const fatherPhone = digitsOnly(student.fatherPhone) || buildPhone(rollNumber, "2");
    const motherPhone = digitsOnly(student.motherPhone) || `${fatherPhone.slice(0, 9)}3`;

    const accountDigits = digitsOnly(student.accountNumber || student.bankAccountNumber) || digitsOnly(rollNumber).slice(-10).padStart(10, "0");

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
        hostelName: normText(student.hostelName) || "Hostel A",
        warden: normText(student.warden) || "Mr. Ramesh Chand",
        fa: normText(student.fa) || "Dr. Bharat Soni",
        messName: normText(student.messName) || "Mess A",
        bankName: normText(student.bankName) || "SBI",
        accountNumber: accountDigits,
        ifsc: normText(student.ifsc).toUpperCase() || "SBIN0001234",
        branch: normText(student.branch) || "Computer Science",
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
        fa: master.fa,
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

sanitizeMasterDatabase();
backfillLeavesFromMaster();

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

// ===== FA Routes =====

app.get("/api/leave-requests", (req, res) => {
    const { data, error } = readJsonFile(DATA_FILE);
    if (error) return res.status(500).json({ error: "Failed to read leave data" });
    const { map } = loadStudentMasterMap();
    res.json(hydrateLeaveRows(data, map));
});

app.post("/api/update-leave", (req, res) => {
    try {
        const { index, status, faApproval, refundStatus } = req.body || {};
        const { data, error } = readJsonFile(DATA_FILE);
        if (error) return res.status(500).json({ error });
        if (!Number.isInteger(index) || index < 0 || index >= data.length) {
            return res.status(400).json({ error: "Invalid index" });
        }

        data[index].status = status;
        data[index].faApproval = faApproval;
        data[index].refundStatus = refundStatus;

        writeJsonArrayFile(DATA_FILE, data);
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
    const { map } = loadStudentMasterMap();
    res.json(hydrateLeaveRows(data, map));
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

    try {
        writeJsonArrayFile(WARDEN_LEAVE_FILE, data);
    } catch (err) {
        console.error("Error writing warden leave data:", err);
        return res.status(500).json({ error: "Failed to write warden leave data" });
    }

    if (status === "Pending FA Approval" && wardenApproval === "Approved") {
        try {
            const { data: faData, error: faErr } = readJsonFile(DATA_FILE);
            const faList = faErr ? [] : faData;
            const { map: masterMap } = loadStudentMasterMap();
            const master = masterMap.get(normText(record.rollNumber).toUpperCase());
            const source = master ? hydrateFromMaster(record, master) : record;

            const isDuplicate = faList.some((r) =>
                r.rollNumber === record.rollNumber &&
                r.startDate === record.startDate &&
                r.endDate === record.endDate
            );

            if (!isDuplicate) {
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
                    status: "Pending FA Approval",
                    familyApproval: record.familyApproval || "Approved",
                    wardenApproval: "Approved",
                    faApproval: "Pending",
                    refundStatus: "Awaiting Approval"
                });

                writeJsonArrayFile(DATA_FILE, faList);
            }
        } catch (propErr) {
            console.error("Warning: failed to propagate to FA queue:", propErr);
        }
    }

    res.json({ success: true });
});

app.get("/api/warden-students", (req, res) => {
    const { data: masterData, error: masterErr } = readJsonFile(STUDENT_MASTER_FILE);
    if (!masterErr) {
        const mapped = masterData.map((s) => ({
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

    try {
        writeJsonArrayFile(DATA_FILE, data);
        res.json({ success: true });
    } catch (err) {
        console.error("Error updating mess refund:", err);
        res.status(500).json({ error: "Failed to update refund status" });
    }
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
    const errors = validateMasterFields(body);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    // Merge supplied fields over existing, then normalize
    const merged = { ...data[idx], ...body, rollNumber: roll };
    data[idx] = normalizeMasterStudent(merged);

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

    const errors = validateMasterFields(body);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const record = normalizeMasterStudent({ ...body, rollNumber: roll });
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
    if (body.accountNumber && !accountRe.test(digitsOnly(body.accountNumber))) {
        errors.push("Account number must be 6-18 digits");
    }
    if (body.ifsc && !ifscRe.test(normText(body.ifsc))) {
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
    res.json(hydrateLeaveRows(data, map));
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
            fa: student.fa,
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
});
