// ===== Sidebar Toggle =====
function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    if (window.innerWidth <= 1024) {
        sidebar.classList.toggle("active");
    } else {
        sidebar.classList.toggle("closed");
    }
}

function switchRole() {
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        const parsed = raw ? JSON.parse(raw) : {};
        const currentRole = String((parsed && parsed.role) || "fa").toLowerCase();
        const nextRole = currentRole === "warden" ? "fa" : "warden";

        const nextSession = {
            ...(parsed && typeof parsed === "object" ? parsed : {}),
            role: nextRole
        };

        sessionStorage.setItem("loggedInUser", JSON.stringify(nextSession));
        window.location.href = nextRole === "warden"
            ? "/pages/warden/warden_dashboard.html"
            : "/pages/fa/fa_dashboard.html";
    } catch (err) {
        console.error("Failed to switch role:", err);
        alert("Unable to switch role. Please login again.");
    }
}

// Close sidebar when clicking outside
document.addEventListener("click", function (e) {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.querySelector(".menu-btn");
    if (!sidebar || !menuBtn) return;
    if (
        window.innerWidth <= 1024 &&
        sidebar.classList.contains("active") &&
        !sidebar.contains(e.target) &&
        !menuBtn.contains(e.target)
    ) {
        sidebar.classList.remove("active");
    }
});

// ===== Global Data Store =====
let leaveRequests = [];
let currentModalIndex = null;
let actionInFlight = false;
let faSession = {
    approverId: "",
    approverName: "",
    role: "fa"
};

    let messConstraints = {
        minDaysForRefund: 3,
        amountPerDay: 200
    };

const FA_PROFILES = {
    BS101: { name: "Bharat Soni" },
    P101: { name: "Pradhan" },
    JT101: { name: "Jhanvi" },
    PS101: { name: "Priyanka" },
    NBV101: { name: "Natesh" }
};

// ===== Helpers =====

/** Escape HTML to prevent XSS */
function esc(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "—" : String(str);
    return d.innerHTML;
}

/** Safe field read with fallback */
function field(obj, key, fallback) {
    if (!obj || typeof obj !== "object") return fallback ?? "—";
    const v = obj[key];
    return (v == null || v === "") ? (fallback ?? "—") : v;
}

/** Normalize status string for comparison */
function normStatus(s) { return String(s || "").trim().toLowerCase(); }
function isPendingFA(item) { return normStatus(item && item.status) === "pending fa approval"; }

function getRequestSourceIndex(item, fallbackIndex) {
    const sourceIndex = Number(item && item.sourceIndex);
    return Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : fallbackIndex;
}

    function getRefundRuleForItem(item) {
        const minDays = Number(item && item.refundRuleMinDays);
        const amountPerDay = Number(item && item.refundRuleAmountPerDay);
        return {
            minDaysForRefund: Number.isFinite(minDays) && minDays >= 0 ? minDays : 3,
            amountPerDay: Number.isFinite(amountPerDay) && amountPerDay >= 0 ? amountPerDay : 200
        };
    }

function parseApiResponse(response) {
    return response
        .text()
        .then((raw) => {
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch {
                return { error: raw };
            }
        })
        .then((data) => {
            if (!response.ok) {
                const reason = data && typeof data.error === "string" && data.error.trim()
                    ? data.error.trim()
                    : `Request failed (${response.status})`;
                throw new Error(reason);
            }
            return data;
        });
}

function getLoggedInFaSession() {
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.role !== "fa") return null;
        return parsed;
    } catch {
        return null;
    }
}

    function loadMessConstraints() {
        fetch("/api/mess-constraints", { headers: apiHeaders() })
            .then(res => {
                if (!res.ok) throw new Error("Failed to load constraints");
                return res.json();
            })
            .then(data => {
                if (data && typeof data === "object") {
                    messConstraints = {
                        minDaysForRefund: Number(data.minDaysForRefund) || 3,
                        amountPerDay: Number(data.amountPerDay) || 200
                    };
                }
            })
            .catch(err => {
                console.error("Error loading mess constraints (using defaults):", err);
                messConstraints = { minDaysForRefund: 3, amountPerDay: 200 };
            });
    }

function looksLikeFaId(value) {
    const text = String(value || "").trim().toUpperCase();
    return /^[A-Z]{2,4}\d{3,4}$/.test(text) || /^[A-Z]{2,4}\d{2}[A-Z]\d{3,4}$/.test(text);
}

function resolveFaSession(session) {
    const approverId = String((session && (session.approverId || session.username)) || "").trim().toUpperCase();
    const profile = FA_PROFILES[approverId] || {};
    const rawName = String((session && (session.approverName || session.displayName)) || "").trim();
    const rawNameIsId = looksLikeFaId(rawName) || (approverId && rawName.toUpperCase() === approverId);
    const approverName = (rawName && !rawNameIsId) ? rawName : (profile.name || approverId || "Faculty Advisor");

    return {
        approverId,
        approverName,
        role: "fa"
    };
}

function updateFaIdentity() {
    const faName = document.getElementById("faName");
    const faRole = document.getElementById("faRole");

    if (faName) faName.textContent = faSession.approverName || "Faculty Advisor";
    if (faRole) faRole.textContent = "Faculty Advisor";
}

function getActiveFaLabel() {
    const name = String(faSession.approverName || "Faculty Advisor").trim() || "Faculty Advisor";
    const id = String(faSession.approverId || "").trim().toUpperCase();
    return id ? `${name} (${id})` : name;
}

function apiHeaders(includeJsonContentType = false) {
    const headers = {};
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    if (includeJsonContentType) headers["Content-Type"] = "application/json";
    if (faSession.approverId) headers["x-user-id"] = faSession.approverId;
    if (faSession.approverName) headers["x-user-name"] = faSession.approverName;
    headers["x-user-role"] = "fa";
    if (apiKey) headers["x-api-key"] = apiKey;
    return headers;
}

function updateFaStudentCount(count) {
    const el = document.getElementById("faStudentCount");
    if (el) el.textContent = String(Number(count) || 0);
}

function isStudentAssignedToCurrentFa(student) {
    if (!student || typeof student !== "object") return false;

    const studentFaId = String(student.faId || "").trim().toUpperCase();
    const studentFaName = String(student.fa || "").trim().toLowerCase();
    const currentFaId = String(faSession.approverId || "").trim().toUpperCase();
    const currentFaName = String(faSession.approverName || "").trim().toLowerCase();

    if (currentFaId && studentFaId) return studentFaId === currentFaId;
    if (currentFaName && studentFaName) return studentFaName === currentFaName;
    return false;
}

function loadFaStudentCount() {
    return fetch("/api/student-master", {
        headers: apiHeaders()
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to load student master");
            return res.json();
        })
        .then(data => {
            if (!Array.isArray(data)) {
                updateFaStudentCount(0);
                return;
            }
            const assignedCount = data.filter(isStudentAssignedToCurrentFa).length;
            updateFaStudentCount(assignedCount);
        })
        .catch(err => {
            console.error("Error loading FA student count:", err);
            updateFaStudentCount(0);
        });
}

function addTemporaryTestRows(rowCount = 5) {
    const safeRowCount = Math.max(1, Number(rowCount) || 5);
    const seed = Date.now();

    const mockRows = Array.from({ length: safeRowCount }, (_, idx) => {
        const unique = seed + idx;
        const totalDays = 2 + (idx % 4);
        const startDate = new Date(Date.now() + (idx + 1) * 24 * 60 * 60 * 1000);
        const endDate = new Date(startDate.getTime() + (totalDays - 1) * 24 * 60 * 60 * 1000);

        return {
            fullName: `Test Student ${idx + 1}`,
            rollNumber: `TEST${String(unique).slice(-6)}`,
            department: "Computer Science",
            phone: `9${String(unique).slice(-9)}`,
            parentPhone: `8${String(unique).slice(-9)}`,
            messName: idx % 2 === 0 ? "Mess A" : "Mess B",
            startDate: startDate.toISOString().slice(0, 10),
            endDate: endDate.toISOString().slice(0, 10),
            totalDays,
            reason: "Temporary test data",
            status: "Pending FA Approval",
            familyApproval: "Approved",
            wardenApproval: "Approved",
            faApproval: "Pending",
            refundStatus: "Awaiting Approval"
        };
    });

    leaveRequests = [...mockRows, ...leaveRequests];
    renderTable();
    updatePendingCount();
}

// ===== Load Data & Render Table =====
document.addEventListener("DOMContentLoaded", function () {
    const tableBody = document.getElementById("requestTableBody");
    const addTestRowsBtn = document.getElementById("addTestRowsBtn");
    const session = getLoggedInFaSession();

    if (session) {
        faSession = resolveFaSession(session);
    }

    updateFaIdentity();

    loadFaStudentCount();
        loadMessConstraints(); // Call the new function to load mess constraints

    if (addTestRowsBtn) {
        addTestRowsBtn.addEventListener("click", function () {
            addTemporaryTestRows(5);
        });
    }

    fetch("/api/leave-requests", {
        headers: apiHeaders()
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to load leave requests");
            return res.json();
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error("Invalid leave request payload");
            leaveRequests = data;
            renderTable();
            updatePendingCount();
        })
        .catch(err => {
            console.error("Error loading leave data:", err);
            if (!tableBody) return;
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center; color:#ff1744; padding:30px;">
                        Failed to load leave requests.
                    </td>
                </tr>
            `;
        });
});

function renderTable() {
    const tbody = document.getElementById("requestTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Only show pending requests on the dashboard
    const pendingRequests = leaveRequests
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => isPendingFA(item));

    if (pendingRequests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:var(--muted); padding:30px;">
                    <i class="fa-solid fa-inbox" style="font-size:24px; color:#00c853; margin-bottom:8px; display:block;"></i>
                    <div style="font-weight:600; color:var(--text); margin-bottom:6px;">No pending leave requests for ${esc(getActiveFaLabel())}.</div>
                    <div style="max-width:420px; margin:0 auto; line-height:1.5;">
                        This dashboard only shows requests assigned to the active Faculty Advisor after warden forwarding.
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    pendingRequests.forEach(({ item, index }, displayIdx) => {
        if (!item || typeof item !== "object") return;
        const row = document.createElement("tr");

        const actionsHTML = `
            <button class="btn-accept" onclick="acceptRequest(${index})">
                <i class="fa-solid fa-check"></i> Accept
            </button>
            <button class="btn-reject" onclick="rejectRequest(${index})">
                <i class="fa-solid fa-xmark"></i> Reject
            </button>
        `;

        row.innerHTML = `
            <td>${displayIdx + 1}</td>
            <td>${esc(field(item, "fullName"))}</td>
            <td>${esc(field(item, "rollNumber"))}</td>
            <td>${esc(field(item, "startDate"))}</td>
            <td>${esc(field(item, "endDate"))}</td>
            <td>${Number(item.totalDays) || 0}</td>
            <td>${esc(field(item, "reason"))}</td>
            <td>
                <div class="actions">
                    ${actionsHTML}
                    <button class="btn-info" onclick="openModal(${index})">
                        <i class="fa-solid fa-circle-info"></i> Info
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(row);
    });
}

function updatePendingCount() {
    const count = leaveRequests.filter(r => isPendingFA(r)).length;
    const pendingCount = document.getElementById("pendingCount");
    if (pendingCount) pendingCount.textContent = count;
}

// ===== Accept / Reject =====
function acceptRequest(index) {
    if (actionInFlight) return;
    const item = leaveRequests[index];
    if (!item || !isPendingFA(item)) return;
    const requestIndex = getRequestSourceIndex(item, index);

    const totalDays = Number(item.totalDays) || 0;
        const rule = getRefundRuleForItem(item);

    // Save old state for rollback
    const prev = { status: item.status, faApproval: item.faApproval, refundStatus: item.refundStatus };

    item.status = "Approved";
    item.faApproval = "Approved";
        item.refundStatus = totalDays > rule.minDaysForRefund ? "Processing" : "No Refund";

    renderTable();
    updatePendingCount();

    actionInFlight = true;
    fetch("/api/update-leave", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({
            index: requestIndex,
            status: "Approved",
            faApproval: "Approved",
            refundStatus: item.refundStatus
        })
    })
    .then(parseApiResponse)
    .catch(err => {
        console.error("Failed to save accept:", err);
        alert(err.message || "Failed to persist approval.");
        // Rollback
        item.status = prev.status;
        item.faApproval = prev.faApproval;
        item.refundStatus = prev.refundStatus;
        renderTable();
        updatePendingCount();
    })
    .finally(() => { actionInFlight = false; });

    if (currentModalIndex === index) populateModal(index);
}

function rejectRequest(index) {
    if (actionInFlight) return;
    const item = leaveRequests[index];
    if (!item || !isPendingFA(item)) return;
    const requestIndex = getRequestSourceIndex(item, index);

    // Save old state for rollback
    const prev = { status: item.status, faApproval: item.faApproval, refundStatus: item.refundStatus };

    item.status = "Rejected";
    item.faApproval = "Rejected";
    item.refundStatus = "No Refund";

    renderTable();
    updatePendingCount();

    actionInFlight = true;
    fetch("/api/update-leave", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({
            index: requestIndex,
            status: "Rejected",
            faApproval: "Rejected",
            refundStatus: "No Refund"
        })
    })
    .then(parseApiResponse)
    .catch(err => {
        console.error("Failed to save reject:", err);
        alert(err.message || "Failed to persist rejection.");
        // Rollback
        item.status = prev.status;
        item.faApproval = prev.faApproval;
        item.refundStatus = prev.refundStatus;
        renderTable();
        updatePendingCount();
    })
    .finally(() => { actionInFlight = false; });

    if (currentModalIndex === index) populateModal(index);
}

// ===== Modal =====
function openModal(index) {
    if (!leaveRequests[index]) return;
    currentModalIndex = index;
    populateModal(index);
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.add("active");
}

function closeModal() {
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.remove("active");
    currentModalIndex = null;
}

// Close modal on overlay click
document.addEventListener("click", function (e) {
    const modal = document.getElementById("infoModal");
    if (e.target === modal) {
        closeModal();
    }
});

// Close modal on Escape key
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
});

function populateModal(index) {
    const item = leaveRequests[index];
    if (!item) return;
    const isPending = isPendingFA(item);
    const totalDays = Number(item.totalDays) || 0;
        const rule = getRefundRuleForItem(item);

    // Calculate refund amount
    const isApproved = normStatus(item.status) === "approved";
        const refundAmount = (isApproved && totalDays > rule.minDaysForRefund)
            ? rule.amountPerDay * totalDays
            : 0;
    const refundLabel = isApproved
            ? (totalDays > rule.minDaysForRefund
                ? `₹${refundAmount} (${esc(field(item, "refundStatus", "Processing"))})`
                : "₹0 — No Refund")
        : (isPending ? "Awaiting Approval" : "₹0 — No Refund");

    // Build badge helper
    function badge(status) {
        const s = normStatus(status);
        const cls = s === "approved" ? "badge-approved"
                  : s === "rejected" ? "badge-rejected"
                  : "badge-pending";
        return `<span class="approval-badge ${cls}">${esc(status || "Pending")}</span>`;
    }

    const body = document.getElementById("modalBody");
    if (!body) return;
    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">${esc(field(item, "fullName"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Roll Number</span>
            <span class="detail-value">${esc(field(item, "rollNumber"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Department</span>
            <span class="detail-value">${esc(field(item, "department"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Phone</span>
            <span class="detail-value">${esc(field(item, "phone"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Parent Phone</span>
            <span class="detail-value">${esc(field(item, "parentPhone"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Mess</span>
            <span class="detail-value">${esc(field(item, "messName"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Leave Period</span>
            <span class="detail-value">${esc(field(item, "startDate"))}  →  ${esc(field(item, "endDate"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Total Days</span>
            <span class="detail-value">${totalDays}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Reason</span>
            <span class="detail-value" style="max-width:280px; white-space:normal; text-align:right;">${esc(field(item, "reason"))}</span>
        </div>

        <h4 style="margin-top:20px; font-size:14px; color:var(--muted); margin-bottom:4px;">
            <i class="fa-solid fa-route" style="color:var(--pink);"></i> Approval Chain
        </h4>
        <div class="approval-chain">
            <div class="approval-step">
                <span class="approval-step-label"><i class="fa-solid fa-house"></i> Family</span>
                ${badge(item.familyApproval)}
            </div>
            <div class="approval-step">
                <span class="approval-step-label"><i class="fa-solid fa-building-shield"></i> Warden</span>
                ${badge(item.wardenApproval)}
            </div>
            <div class="approval-step">
                <span class="approval-step-label"><i class="fa-solid fa-user-tie"></i> FA</span>
                ${badge(item.faApproval)}
            </div>
        </div>

        <div class="refund-highlight">
            <span class="detail-label">Mess Refund</span>
            <span class="detail-value">${refundLabel}</span>
        </div>
    `;

    // Modal footer buttons — show/hide based on status
    const modalFooter = document.querySelector(".modal-footer");
    if (!modalFooter) return;

    if (isPending) {
        modalFooter.innerHTML = `
            <button class="btn-modal-accept" onclick="acceptRequest(${index})">Accept</button>
            <button class="btn-modal-reject" onclick="rejectRequest(${index})">Reject</button>
            <button class="btn-modal-close" onclick="closeModal()">Close</button>
        `;
    } else {
        const label = normStatus(item.status) === "approved"
            ? '<span class="status-label status-label-approved"><i class="fa-solid fa-circle-check"></i> Accepted</span>'
            : '<span class="status-label status-label-rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>';
        modalFooter.innerHTML = `
            ${label}
            <button class="btn-modal-close" onclick="closeModal()">Close</button>
        `;
    }
}
