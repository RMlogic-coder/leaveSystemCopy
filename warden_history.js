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

// ===== Helpers =====
function esc(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "—" : String(str);
    return d.innerHTML;
}

function field(item, key, fallback) {
    const v = item[key];
    return (v == null || v === "") ? (fallback ?? "—") : v;
}

function normStatus(s) {
    return String(s || "").trim().toLowerCase();
}

// ===== Global Data =====
let allRequests = [];
let currentFilter = "all";

// Determine the warden-level outcome for a request.
// "Forwarded" = warden approved and sent to FA. "Rejected" = warden rejected.
function wardenOutcome(item) {
    const wa = normStatus(item.wardenApproval);
    if (wa === "approved") return "Forwarded";
    if (wa === "rejected") return "Rejected";
    return null; // still pending at warden level
}

function isProcessed(item) {
    return wardenOutcome(item) !== null;
}

// ===== Load Data =====
document.addEventListener("DOMContentLoaded", function () {
    const historyTableBody = document.getElementById("historyTableBody");

    fetch("/api/warden-leave-requests")
        .then(res => {
            if (!res.ok) throw new Error("Failed to load leave requests");
            return res.json();
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error("Invalid leave history payload");
            allRequests = data;
            updateCounts();
            renderHistory();
        })
        .catch(err => {
            console.error("Error loading history:", err);
            if (!historyTableBody) return;
            historyTableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align:center; color:#ff1744; padding:30px;">
                        Failed to load history data.
                    </td>
                </tr>
            `;
        });
});

// ===== Stats =====
function updateCounts() {
    const processed = allRequests.filter(isProcessed);
    const forwarded = allRequests.filter(r => wardenOutcome(r) === "Forwarded");
    const rejected = allRequests.filter(r => wardenOutcome(r) === "Rejected");

    const totalProcessed = document.getElementById("totalProcessed");
    const totalForwarded = document.getElementById("totalForwarded");
    const totalRejected = document.getElementById("totalRejected");

    if (totalProcessed) totalProcessed.textContent = processed.length;
    if (totalForwarded) totalForwarded.textContent = forwarded.length;
    if (totalRejected) totalRejected.textContent = rejected.length;
}

// ===== Filter =====
function setFilter(filter, btn) {
    currentFilter = filter;

    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active-filter"));
    if (btn) btn.classList.add("active-filter");

    renderHistory();
}

// ===== Render History Table =====
function renderHistory() {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filter processed requests, apply current filter
    let historyItems = allRequests
        .map((item, index) => ({ item, index, outcome: wardenOutcome(item) }))
        .filter(({ outcome }) => outcome !== null)
        .filter(({ outcome }) => currentFilter === "all" || outcome === currentFilter);

    // Sort: most recently processed at the top (by wardenProcessedAt or index desc)
    historyItems.sort((a, b) => {
        const dateA = a.item.wardenProcessedAt || a.item.updatedAt || "";
        const dateB = b.item.wardenProcessedAt || b.item.updatedAt || "";
        if (dateA && dateB) return dateB.localeCompare(dateA);
        return b.index - a.index; // fallback: higher index = newer
    });

    if (historyItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; color:var(--muted); padding:30px;">
                    <i class="fa-solid fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                    No ${currentFilter === "all" ? "processed" : currentFilter.toLowerCase()} requests found.
                </td>
            </tr>
        `;
        return;
    }

    historyItems.forEach(({ item, index, outcome }, displayIdx) => {
        const row = document.createElement("tr");

        const statusHTML = outcome === "Forwarded"
            ? `<span class="status-label status-label-approved">
                    <i class="fa-solid fa-circle-check"></i> Forwarded
               </span>`
            : `<span class="status-label status-label-rejected">
                    <i class="fa-solid fa-circle-xmark"></i> Rejected
               </span>`;

        row.innerHTML = `
            <td>${displayIdx + 1}</td>
            <td>${esc(field(item, "fullName"))}</td>
            <td>${esc(field(item, "rollNumber"))}</td>
            <td>${esc(field(item, "startDate"))}</td>
            <td>${esc(field(item, "endDate"))}</td>
            <td>${Number(item.totalDays) || 0}</td>
            <td>${esc(field(item, "reason"))}</td>
            <td>${statusHTML}</td>
            <td>
                <button class="btn-info" onclick="openModal(${index})">
                    <i class="fa-solid fa-circle-info"></i> Info
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

// ===== Modal =====
function openModal(index) {
    const item = allRequests[index];
    if (!item) return;
    populateModal(item);
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.add("active");
}

function closeModal() {
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.remove("active");
}

// Close modal on overlay click
document.addEventListener("click", function (e) {
    const modal = document.getElementById("infoModal");
    if (e.target === modal) closeModal();
});

// Close modal on Escape
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
});

function populateModal(item) {
    if (!item) return;
    const totalDays = Number(item.totalDays) || 0;
    const outcome = wardenOutcome(item);

    function badge(status) {
        const s = normStatus(status);
        const cls = s === "approved" ? "badge-approved"
                  : s === "rejected" ? "badge-rejected"
                  : "badge-pending";
        return `<span class="approval-badge ${cls}">${esc(status || "Pending")}</span>`;
    }

    // Final status text (overall leave outcome so far)
    const overallStatus = normStatus(item.status);
    let finalLabel = "";
    if (overallStatus === "approved") {
        finalLabel = '<span style="color:#00c853; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Approved</span>';
    } else if (overallStatus === "rejected") {
        finalLabel = '<span style="color:#ff1744; font-weight:700;"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>';
    } else {
        finalLabel = `<span style="color:#ffc107; font-weight:700;"><i class="fa-solid fa-hourglass-half"></i> ${esc(item.status)}</span>`;
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
        <div class="detail-row">
            <span class="detail-label">Current Status</span>
            <span class="detail-value">${finalLabel}</span>
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
}
