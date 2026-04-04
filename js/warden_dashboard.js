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
        const currentRole = String((parsed && parsed.role) || "warden").toLowerCase();
        const nextRole = currentRole === "fa" ? "warden" : "fa";

        const nextSession = {
            ...(parsed && typeof parsed === "object" ? parsed : {}),
            role: nextRole,
            approverId: String((parsed && (parsed.approverId || parsed.username)) || wardenSession.approverId || "").trim().toUpperCase(),
            approverName: String((parsed && (parsed.approverName || parsed.displayName)) || wardenSession.approverName || "").trim(),
            displayName: String((parsed && (parsed.displayName || parsed.approverName)) || wardenSession.approverName || "").trim()
        };

        // Keep hostel context when returning to warden role.
        if (nextRole === "warden") {
            nextSession.hostelName = String((parsed && parsed.hostelName) || wardenSession.hostelName || "").trim();
        }

        sessionStorage.setItem("loggedInUser", JSON.stringify(nextSession));
        window.location.href = nextRole === "fa"
            ? "/pages/fa/fa_dashboard.html"
            : "/pages/warden/warden_dashboard.html";
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
let actionInFlight = false; // double-click guard
let wardenSession = {
    approverId: "",
    approverName: "Warden",
    hostelName: "—"
};

const WARDEN_PROFILES = {
    NBV101: { name: "Natesh", hostelName: "Bheema" },
    PS101: { name: "Priyanka", hostelName: "Krishna" },
    P101: { name: "Pradhan", hostelName: "Federal" },
    JT101: { name: "Jhanvi", hostelName: "Tungabadra" }
};

function looksLikeWardenId(value) {
    return /^[A-Z]{2,4}\d{2}[A-Z]\d{3,4}$/.test(String(value || "").trim().toUpperCase());
}

function normHostel(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ===== Helpers =====

/** Escape HTML to prevent XSS */
function esc(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "—" : String(str);
    return d.innerHTML;
}

/** Safe field read with fallback */
function field(item, key, fallback) {
    const v = item[key];
    return (v == null || v === "") ? (fallback ?? "—") : v;
}

/** Normalize status string for safe comparison */
function normStatus(s) {
    return String(s || "").trim().toLowerCase();
}

const PENDING_WARDEN = "pending warden approval";

function isPendingWarden(item) {
    return normStatus(item.status) === PENDING_WARDEN;
}

function getRequestSourceIndex(item, fallbackIndex) {
    const sourceIndex = Number(item && item.sourceIndex);
    return Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : fallbackIndex;
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

function getLoggedInWardenSession() {
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.role !== "warden") return null;
        return parsed;
    } catch {
        return null;
    }
}

function resolveWardenSession(session) {
    const approverId = String((session && (session.approverId || session.username)) || "").trim().toUpperCase();
    const profile = WARDEN_PROFILES[approverId] || {};
    const rawName = String((session && (session.approverName || session.displayName)) || "").trim();
    const approverName = (rawName && !looksLikeWardenId(rawName))
        ? rawName
        : (profile.name || approverId || "Warden");
    const hostelName = String((session && session.hostelName) || profile.hostelName || "").trim();

    return {
        approverId,
        approverName,
        hostelName
    };
}

function apiHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (wardenSession.approverId) headers["x-user-id"] = wardenSession.approverId;
    if (wardenSession.approverName) headers["x-user-name"] = wardenSession.approverName;
    headers["x-user-role"] = "warden";
    return headers;
}

function updateWardenSummary(students) {
    const totalStudents = document.getElementById("totalStudents");
    const pendingCount = document.getElementById("pendingCount");
    const hostelName = document.getElementById("hostelName");
    const wardenName = document.getElementById("wardenName");
    const wardenRole = document.getElementById("wardenRole");

    const derivedHostel = wardenSession.hostelName
        || (Array.isArray(students) && students.length > 0 && String(students[0].hostel || "").trim())
        || "—";

    const hostelKey = normHostel(derivedHostel);
    const hostelStudents = Array.isArray(students)
        ? students.filter((s) => normHostel((s && (s.hostel || s.hostelName)) || "") === hostelKey)
        : [];
    const totalHostelStudents = hostelKey ? hostelStudents.length : (Array.isArray(students) ? students.length : 0);

    if (wardenName) wardenName.textContent = wardenSession.approverName || "Warden";
    if (wardenRole) wardenRole.textContent = derivedHostel !== "—" ? `${derivedHostel} Warden` : "Hostel Warden";
    if (hostelName) hostelName.textContent = derivedHostel;
    if (totalStudents) totalStudents.textContent = String(totalHostelStudents);
    if (pendingCount) pendingCount.textContent = String(leaveRequests.filter(r => isPendingWarden(r)).length);
}

// ===== Load Data & Render Table =====
document.addEventListener("DOMContentLoaded", function () {
    const tableBody = document.getElementById("requestTableBody");
    const session = getLoggedInWardenSession();

    if (session) {
        wardenSession = resolveWardenSession(session);
    }

    updateWardenSummary([]);

    fetch("/api/warden-students", {
        headers: apiHeaders()
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to load warden students");
            return res.json();
        })
        .then(data => {
            updateWardenSummary(Array.isArray(data) ? data : []);
        })
        .catch(err => {
            console.error("Error loading warden student summary:", err);
            updateWardenSummary([]);
        });

    fetch("/api/warden-leave-requests", {
        headers: apiHeaders()
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to load leave requests");
            return res.json();
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error("Invalid payload");
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

    const pendingRequests = leaveRequests
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => isPendingWarden(item));

    if (pendingRequests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:var(--muted); padding:30px;">
                    <i class="fa-solid fa-check-circle" style="font-size:24px; color:#00c853; margin-bottom:8px; display:block;"></i>
                    No pending leave requests. All caught up!
                </td>
            </tr>
        `;
        return;
    }

    pendingRequests.forEach(({ item, index }, displayIdx) => {
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
    const count = leaveRequests.filter(r => isPendingWarden(r)).length;
    const el = document.getElementById("pendingCount");
    if (el) el.textContent = count;
}

// ===== Accept / Reject =====
function acceptRequest(index) {
    const item = leaveRequests[index];
    if (!item || !isPendingWarden(item) || actionInFlight) return;
    actionInFlight = true;
    const requestIndex = getRequestSourceIndex(item, index);

    // Save previous state for rollback
    const prev = { status: item.status, wardenApproval: item.wardenApproval };

    item.status = "Pending FA Approval";
    item.wardenApproval = "Approved";

    renderTable();
    updatePendingCount();
    if (currentModalIndex === index) populateModal(index);

    fetch("/api/warden-update-leave", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
            index: requestIndex,
            status: "Pending FA Approval",
            wardenApproval: "Approved"
        })
    })
    .then(parseApiResponse)
    .catch(err => {
        console.error("Failed to save — rolling back:", err);
        alert(err.message || "Failed to persist approval.");
        item.status = prev.status;
        item.wardenApproval = prev.wardenApproval;
        renderTable();
        updatePendingCount();
        if (currentModalIndex === index) populateModal(index);
    })
    .finally(() => { actionInFlight = false; });
}

function rejectRequest(index) {
    const item = leaveRequests[index];
    if (!item || !isPendingWarden(item) || actionInFlight) return;
    actionInFlight = true;
    const requestIndex = getRequestSourceIndex(item, index);

    const prev = { status: item.status, wardenApproval: item.wardenApproval, refundStatus: item.refundStatus };

    item.status = "Rejected";
    item.wardenApproval = "Rejected";
    item.refundStatus = "No Refund";

    renderTable();
    updatePendingCount();
    if (currentModalIndex === index) populateModal(index);

    fetch("/api/warden-update-leave", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
            index: requestIndex,
            status: "Rejected",
            wardenApproval: "Rejected",
            refundStatus: "No Refund"
        })
    })
    .then(parseApiResponse)
    .catch(err => {
        console.error("Failed to save — rolling back:", err);
        alert(err.message || "Failed to persist rejection.");
        item.status = prev.status;
        item.wardenApproval = prev.wardenApproval;
        item.refundStatus = prev.refundStatus;
        renderTable();
        updatePendingCount();
        if (currentModalIndex === index) populateModal(index);
    })
    .finally(() => { actionInFlight = false; });
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

document.addEventListener("click", function (e) {
    const modal = document.getElementById("infoModal");
    if (e.target === modal) closeModal();
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
});

function populateModal(index) {
    const item = leaveRequests[index];
    if (!item) return;
    const pending = isPendingWarden(item);
    const totalDays = Number(item.totalDays) || 0;

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
                ${badge(field(item, "familyApproval", "Pending"))}
            </div>
            <div class="approval-step">
                <span class="approval-step-label"><i class="fa-solid fa-building-shield"></i> Warden</span>
                ${badge(field(item, "wardenApproval", "Pending"))}
            </div>
            <div class="approval-step">
                <span class="approval-step-label"><i class="fa-solid fa-user-tie"></i> FA</span>
                ${badge(field(item, "faApproval", "Pending"))}
            </div>
        </div>
    `;

    const modalFooter = document.querySelector(".modal-footer");
    if (!modalFooter) return;

    if (pending) {
        modalFooter.innerHTML = `
            <button class="btn-modal-accept" onclick="acceptRequest(${index})">Accept</button>
            <button class="btn-modal-reject" onclick="rejectRequest(${index})">Reject</button>
            <button class="btn-modal-close" onclick="closeModal()">Close</button>
        `;
    } else {
        const ns = normStatus(item.status);
        const label = (ns === "pending fa approval" || ns === "approved")
            ? '<span class="status-label status-label-approved"><i class="fa-solid fa-circle-check"></i> Forwarded to FA</span>'
            : '<span class="status-label status-label-rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>';
        modalFooter.innerHTML = `
            ${label}
            <button class="btn-modal-close" onclick="closeModal()">Close</button>
        `;
    }
}
