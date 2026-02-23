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

    if (addTestRowsBtn) {
        addTestRowsBtn.addEventListener("click", function () {
            addTemporaryTestRows(5);
        });
    }

    fetch("/api/leave-requests")
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
                    <i class="fa-solid fa-check-circle" style="font-size:24px; color:#00c853; margin-bottom:8px; display:block;"></i>
                    No pending leave requests. All caught up!
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

    const totalDays = Number(item.totalDays) || 0;

    // Save old state for rollback
    const prev = { status: item.status, faApproval: item.faApproval, refundStatus: item.refundStatus };

    item.status = "Approved";
    item.faApproval = "Approved";
    item.refundStatus = totalDays > 3 ? "Processing" : "No Refund";

    renderTable();
    updatePendingCount();

    actionInFlight = true;
    fetch("/api/update-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            index,
            status: "Approved",
            faApproval: "Approved",
            refundStatus: item.refundStatus
        })
    })
    .then(r => { if (!r.ok) throw new Error("Server " + r.status); })
    .catch(err => {
        console.error("Failed to save accept:", err);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            index,
            status: "Rejected",
            faApproval: "Rejected",
            refundStatus: "No Refund"
        })
    })
    .then(r => { if (!r.ok) throw new Error("Server " + r.status); })
    .catch(err => {
        console.error("Failed to save reject:", err);
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

    // Calculate refund amount
    const isApproved = normStatus(item.status) === "approved";
    const refundAmount = (isApproved && totalDays > 3) ? 200 * totalDays : 0;
    const refundLabel = isApproved
        ? (totalDays > 3 ? `₹${refundAmount} (${esc(field(item, "refundStatus", "Processing"))})` : "₹0 — No Refund")
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
