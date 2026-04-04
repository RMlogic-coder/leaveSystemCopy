function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    if (window.innerWidth <= 1024) sidebar.classList.toggle("active");
    else sidebar.classList.toggle("closed");
}

document.addEventListener("click", function (e) {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.querySelector(".menu-btn");
    if (!sidebar || !menuBtn) return;
    if (window.innerWidth <= 1024 && sidebar.classList.contains("active") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.remove("active");
    }
});

let rows = [];
let currentFilter = "all";

function esc(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "—" : String(str);
    return d.innerHTML;
}

function money(value) {
    const amount = Number(value) || 0;
    return `₹${amount.toLocaleString("en-IN")}`;
}

function normStatus(s) {
    return String(s || "").trim().toLowerCase();
}

function statusBadge(status) {
    const s = normStatus(status);
    if (s === "refunded") {
        return '<span class="status-label status-label-approved"><i class="fa-solid fa-circle-check"></i> Refunded</span>';
    }
    if (s === "no refund") {
        return '<span class="status-label status-label-rejected"><i class="fa-solid fa-ban"></i> No Refund</span>';
    }
    if (s === "processing") {
        return '<span class="status-label status-label-processing"><i class="fa-solid fa-hourglass-half"></i> Processing</span>';
    }
    return '<span class="status-label"><i class="fa-solid fa-clock"></i> Awaiting Approval</span>';
}

document.addEventListener("DOMContentLoaded", function () {
    fetch("/api/mess-refunds")
        .then(r => { if (!r.ok) throw new Error("Failed to load refunds"); return r.json(); })
        .then(data => {
            if (!Array.isArray(data)) throw new Error("Invalid payload");
            rows = data;
            updateStats();
            renderTable();
        })
        .catch(err => {
            console.error("Mess history load error:", err);
            const tbody = document.getElementById("historyTableBody");
            if (!tbody) return;
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#ff1744; padding:30px;">Failed to load mess history.</td></tr>`;
        });
});

function updateStats() {
    const processed = rows.filter(r => {
        const s = normStatus(r.refundStatus);
        return s === "processing" || s === "refunded" || s === "no refund";
    });
    const refunded = rows.filter(r => normStatus(r.refundStatus) === "refunded");
    const noRefund = rows.filter(r => normStatus(r.refundStatus) === "no refund");

    const totalProcessed = document.getElementById("totalProcessed");
    const totalRefundedAmount = document.getElementById("totalRefundedAmount");
    const noRefundCount = document.getElementById("noRefundCount");

    if (totalProcessed) totalProcessed.textContent = processed.length;
    if (totalRefundedAmount) totalRefundedAmount.textContent = money(refunded.reduce((sum, r) => sum + (Number(r.refundAmount) || 0), 0));
    if (noRefundCount) noRefundCount.textContent = noRefund.length;
}

function setFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active-filter"));
    if (btn) btn.classList.add("active-filter");
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;

    const items = rows
        .filter(r => {
            const s = normStatus(r.refundStatus);
            return s === "processing" || s === "refunded" || s === "no refund";
        })
        .filter(r => currentFilter === "all" || r.refundStatus === currentFilter);

    tbody.innerHTML = "";

    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--muted); padding:30px;">No records for selected filter.</td></tr>`;
        return;
    }

    items.forEach((item, idx) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${idx + 1}</td>
            <td>${esc(item.fullName)}</td>
            <td>${esc(item.rollNumber)}</td>
            <td>${esc(item.semester || "Unknown")}</td>
            <td>${Number(item.totalDays) || 0}</td>
            <td class="money">${money(item.refundAmount)}</td>
            <td>${esc(item.bankName)} / ${esc(item.bankAccountNumber || "—")}</td>
            <td>${statusBadge(item.refundStatus)}</td>
            <td>${esc(item.refundProcessedAt || "—")}</td>
        `;
        tbody.appendChild(row);
    });
}
