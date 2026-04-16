function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    if (window.innerWidth <= 1024) {
        sidebar.classList.toggle("active");
    } else {
        sidebar.classList.toggle("closed");
    }
}

/* Close when clicking outside */
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

function normStatus(value) {
    return String(value || "").trim().toLowerCase();
}

function getLoggedInStudentRoll() {
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        if (!raw) return "";
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return "";

        const role = String(parsed.role || "").trim().toLowerCase();
        const rollFromSession = String(parsed.rollNumber || parsed.username || "").trim().toUpperCase();

        if (role === "student" && rollFromSession) return rollFromSession;
        if (rollFromSession && /^[A-Z]{2,4}\d{2}[A-Z]\d{3,4}$/.test(rollFromSession)) return rollFromSession;
        return "";
    } catch {
        return "";
    }
}

function getRollFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        return String(params.get("rollNumber") || "").trim().toUpperCase();
    } catch {
        return "";
    }
}

function buildStudentApiHeaders() {
    const headers = { "x-user-role": "student" };
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    if (apiKey) headers["x-api-key"] = apiKey;
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        const parsed = raw ? JSON.parse(raw) : null;
        const userId = String(parsed && (parsed.rollNumber || parsed.username) || "").trim();
        const userName = String(parsed && (parsed.displayName || parsed.username || parsed.rollNumber) || "").trim();
        if (userId) headers["x-user-id"] = userId;
        if (userName) headers["x-user-name"] = userName;
    } catch {
        // Use only required auth headers when session payload is unavailable.
    }
    return headers;
}

let messConstraints = {
    minDaysForRefund: 3,
    amountPerDay: 200
};

function loadMessConstraints() {
    return fetch("/api/mess-constraints", { headers: buildStudentApiHeaders() })
        .then(res => {
            if (!res.ok) {
                console.warn(`Mess constraints unavailable (status ${res.status}); using defaults.`);
                return null;
            }
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

    function getRefundRuleForItem(item) {
        const minDays = Number(item && item.refundRuleMinDays);
        const amountPerDay = Number(item && item.refundRuleAmountPerDay);
        return {
            minDaysForRefund: Number.isFinite(minDays) && minDays >= 0 ? minDays : 3,
            amountPerDay: Number.isFinite(amountPerDay) && amountPerDay >= 0 ? amountPerDay : 200
        };
    }

// ===== Fetch and populate the table =====
document.addEventListener("DOMContentLoaded", function () {
    const loggedRoll = getLoggedInStudentRoll() || getRollFromUrl();
    if (!loggedRoll) {
        const tableBody = document.getElementById("clientTableBody");
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align:center; color:red; padding:30px;">
                        Student session missing or invalid. Please login again.
                    </td>
                </tr>
            `;
        }
        return;
    }

    loadMessConstraints()
        .then(() => fetch("/api/student-leaves", { headers: buildStudentApiHeaders() }))
        .then(response => {
            if (!response.ok) throw new Error("Failed to load student leave data");
            return response.json();
        })
        .then(data => {
            const tableBody = document.getElementById("clientTableBody");
            if (!tableBody) return;
            const rows = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : null);
            if (!rows) throw new Error("Invalid leave data payload");
            tableBody.innerHTML = "";

            const ownRows = rows
                .filter((item) => String(item && item.rollNumber || "").trim().toUpperCase() === loggedRoll)
                .sort((a, b) => String(b && b.startDate || "").localeCompare(String(a && a.startDate || "")));

            if (ownRows.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="11" style="text-align:center; color:var(--muted); padding:30px;">
                            <i class="fa-solid fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                            No previous applications found.
                        </td>
                    </tr>
                `;
                return;
            }

            ownRows.forEach((item, index) => {
                if (!item || typeof item !== "object") return;
                const row = document.createElement("tr");

                const statusLower = normStatus(item.status);
                const isFullyApproved = statusLower === "approved";
                const isRejected = statusLower === "rejected";
                const totalDays = Number(item.totalDays) || 0;
                    const rule = getRefundRuleForItem(item);
                const apiRefundAmount = Number(item.refundAmount);
                const apiRefundStatus = String(item.refundStatus || "").trim();

                let refundAmount = 0;
                let refundStatus = "—";

                if (isFullyApproved) {
                    if (totalDays > rule.minDaysForRefund) {
                        refundAmount = Number.isFinite(apiRefundAmount) && apiRefundAmount >= 0 ? apiRefundAmount : rule.amountPerDay * totalDays;
                        refundStatus = apiRefundStatus || "Processing";
                    } else {
                        refundAmount = 0;
                        refundStatus = "No Refund";
                    }
                } else if (isRejected) {
                    refundAmount = 0;
                    refundStatus = "No Refund";
                } else {
                    refundAmount = 0;
                    refundStatus = "Awaiting Approval";
                }

                // Status badge styling
                let statusClass = "";
                if (statusLower.includes("family")) statusClass = "status-family";
                else if (statusLower.includes("warden")) statusClass = "status-warden";
                else if (statusLower.includes("fa")) statusClass = "status-fa";
                else if (statusLower === "approved") statusClass = "status-approved";
                else if (statusLower === "rejected") statusClass = "status-rejected";

                // Refund status styling
                let refundClass = "";
                if (refundStatus === "No Refund") refundClass = "refund-none";
                else if (refundStatus === "Processing") refundClass = "refund-processing";
                else if (refundStatus === "Refunded") refundClass = "refund-done";
                else if (refundStatus === "Awaiting Approval") refundClass = "refund-awaiting";

                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${esc(item.fullName)}</td>
                    <td>${esc(item.rollNumber)}</td>
                    <td>${esc(item.startDate)}</td>
                    <td>${esc(item.endDate)}</td>
                    <td>${totalDays}</td>
                    <td>₹${refundAmount}</td>
                    <td>${esc(item.phone)}</td>
                    <td>${esc(item.reason)}</td>
                    <td><span class="${statusClass}">${esc(item.status)}</span></td>
                    <td><span class="${refundClass}">${esc(refundStatus)}</span></td>
                `;

                tableBody.appendChild(row);
            });
        })
        .catch(error => {
            console.error("Error loading leave data:", error);
            const tableBody = document.getElementById("clientTableBody");
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="11" style="text-align:center; color:red; padding:30px;">
                            Failed to load leave data. Please try again later.
                        </td>
                    </tr>
                `;
            }
        });
});