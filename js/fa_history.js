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

// ===== Global Data =====
let allRequests = [];
let currentFilter = "all";
let currentPage = 1;
const PAGE_SIZE = 10;

let faSession = {
    approverId: "",
    approverName: "Faculty Advisor"
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

function looksLikeFaId(value) {
    const text = String(value || "").trim().toUpperCase();
    return /^[A-Z]{2,4}\d{3,4}$/.test(text) || /^[A-Z]{2,4}\d{2}[A-Z]\d{3,4}$/.test(text);
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

function resolveFaSession(session) {
    const approverId = String((session && (session.approverId || session.username)) || "").trim().toUpperCase();
    const profile = FA_PROFILES[approverId] || {};
    const rawName = String((session && (session.approverName || session.displayName)) || "").trim();
    const rawNameIsId = looksLikeFaId(rawName) || (approverId && rawName.toUpperCase() === approverId);
    const approverName = (rawName && !rawNameIsId) ? rawName : (profile.name || approverId || "Faculty Advisor");

    return { approverId, approverName };
}

function apiHeaders() {
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    const headers = { "x-user-role": "fa" };
    if (apiKey) headers["x-api-key"] = apiKey;
    if (faSession.approverId) headers["x-user-id"] = faSession.approverId;
    if (faSession.approverName) headers["x-user-name"] = faSession.approverName;
    return headers;
}

    function getRefundRuleForItem(item) {
        const minDays = Number(item && item.refundRuleMinDays);
        const amountPerDay = Number(item && item.refundRuleAmountPerDay);
        return {
            minDaysForRefund: Number.isFinite(minDays) && minDays >= 0 ? minDays : 3,
            amountPerDay: Number.isFinite(amountPerDay) && amountPerDay >= 0 ? amountPerDay : 200
        };
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

// ===== Load Data =====
document.addEventListener("DOMContentLoaded", function () {
    const historyTableBody = document.getElementById("historyTableBody");
    const session = getLoggedInFaSession();

    if (session) {
        faSession = resolveFaSession(session);
    }

        loadMessConstraints();

    fetch("/api/leave-requests", { headers: apiHeaders() })
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
    currentPage = 1;

    // Update active state on filter buttons
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active-filter"));
    if (btn) btn.classList.add("active-filter");

    renderHistory();
}

// ===== Pagination =====
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderHistory();
        window.scrollTo(0, 0);
    }
}

function nextPage() {
    const filtered = getFilteredItems();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage < totalPages) {
        currentPage++;
        renderHistory();
        window.scrollTo(0, 0);
    }
}

function getFilteredItems() {
    return allRequests
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "Approved" || item.status === "Rejected")
    .filter(({ item }) => currentFilter === "all" || item.status === currentFilter);
}

function updatePaginationControls(filteredCount) {
    const totalPages = Math.ceil(filteredCount / PAGE_SIZE) || 1;
    const container = document.getElementById("paginationContainer");
    const pageInfo = document.getElementById("pageInfo");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");

    if (filteredCount === 0) {
        if (container) container.style.display = "none";
        return;
    }

    if (container) container.style.display = "flex";
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages;
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

    const totalPages = Math.ceil(historyItems.length / PAGE_SIZE) || 1;
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    updatePaginationControls(historyItems.length);

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

    // Calculate pagination
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const pageItems = historyItems.slice(startIdx, endIdx);

    pageItems.forEach(({ item, index }, displayIdx) => {
        const row = document.createElement("tr");
        const globalRowNum = startIdx + displayIdx + 1;

        const statusHTML = item.status === "Approved"
            ? `<span class="status-label status-label-approved">
                    <i class="fa-solid fa-circle-check"></i> Approved
               </span>`
            : `<span class="status-label status-label-rejected">
                    <i class="fa-solid fa-circle-xmark"></i> Rejected
               </span>`;

        row.innerHTML = `
            <td>${globalRowNum}</td>
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
        const rule = getRefundRuleForItem(item);
        const refundAmount = (isApproved && totalDays > rule.minDaysForRefund)
            ? rule.amountPerDay * totalDays
            : 0;
    const refundLabel = isApproved
            ? (totalDays > rule.minDaysForRefund
                ? `₹${refundAmount} (${item.refundStatus || 'Processing'})`
                : "₹0 — No Refund")
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
