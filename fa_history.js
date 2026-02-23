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

// ===== Global Data =====
let allRequests = [];
let currentFilter = "all";

// ===== Load Data =====
document.addEventListener("DOMContentLoaded", function () {
    const historyTableBody = document.getElementById("historyTableBody");

    fetch("/api/leave-requests")
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
    const processed = allRequests.filter(r => r.status === "Approved" || r.status === "Rejected");
    const approved = allRequests.filter(r => r.status === "Approved");
    const rejected = allRequests.filter(r => r.status === "Rejected");

    const totalProcessed = document.getElementById("totalProcessed");
    const totalApproved = document.getElementById("totalApproved");
    const totalRejected = document.getElementById("totalRejected");

    if (totalProcessed) totalProcessed.textContent = processed.length;
    if (totalApproved) totalApproved.textContent = approved.length;
    if (totalRejected) totalRejected.textContent = rejected.length;
}

// ===== Filter =====
function setFilter(filter, btn) {
    currentFilter = filter;

    // Update active state on filter buttons
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active-filter"));
    if (btn) btn.classList.add("active-filter");

    renderHistory();
}

// ===== Render History Table =====
function renderHistory() {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Only show processed (non-pending) requests
    const historyItems = allRequests
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.status === "Approved" || item.status === "Rejected")
        .filter(({ item }) => currentFilter === "all" || item.status === currentFilter);

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

    historyItems.forEach(({ item, index }, displayIdx) => {
        const row = document.createElement("tr");

        const statusHTML = item.status === "Approved"
            ? `<span class="status-label status-label-approved">
                    <i class="fa-solid fa-circle-check"></i> Approved
               </span>`
            : `<span class="status-label status-label-rejected">
                    <i class="fa-solid fa-circle-xmark"></i> Rejected
               </span>`;

        row.innerHTML = `
            <td>${displayIdx + 1}</td>
            <td>${item.fullName}</td>
            <td>${item.rollNumber}</td>
            <td>${item.startDate}</td>
            <td>${item.endDate}</td>
            <td>${item.totalDays}</td>
            <td>${item.reason}</td>
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
    const isApproved = item.status === "Approved";
    const refundAmount = (isApproved && totalDays > 3) ? 200 * totalDays : 0;
    const refundLabel = isApproved
        ? (totalDays > 3 ? `₹${refundAmount} (${item.refundStatus || 'Processing'})` : "₹0 — No Refund")
        : "₹0 — No Refund";

    const faApprovalStatus = isApproved ? "Approved" : (item.faApproval === "Rejected" ? "Rejected" : "Pending");

    function badge(status) {
        const map = {
            "Approved": "badge-approved",
            "Pending": "badge-pending",
            "Rejected": "badge-rejected"
        };
        return `<span class="approval-badge ${map[status] || 'badge-pending'}">${status}</span>`;
    }

    const body = document.getElementById("modalBody");
    if (!body) return;
    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">${item.fullName}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Roll Number</span>
            <span class="detail-value">${item.rollNumber}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Department</span>
            <span class="detail-value">${item.department}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Phone</span>
            <span class="detail-value">${item.phone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Parent Phone</span>
            <span class="detail-value">${item.parentPhone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Mess</span>
            <span class="detail-value">${item.messName}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Leave Period</span>
            <span class="detail-value">${item.startDate}  →  ${item.endDate}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Total Days</span>
            <span class="detail-value">${item.totalDays}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Reason</span>
            <span class="detail-value" style="max-width:280px; white-space:normal; text-align:right;">${item.reason}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Decision</span>
            <span class="detail-value">${item.status === "Approved"
                ? '<span style="color:#00c853; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Approved</span>'
                : '<span style="color:#ff1744; font-weight:700;"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>'
            }</span>
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
                ${badge(faApprovalStatus)}
            </div>
        </div>

        <div class="refund-highlight">
            <span class="detail-label">Mess Refund</span>
            <span class="detail-value">${refundLabel}</span>
        </div>
    `;
}
