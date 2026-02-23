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

const PERIODS = ["even2026", "odd2026", "even2025", "odd2025"];
let refundRows = [];
let rateModel = { rates: {}, locks: {} };
let currentModalRow = null;
let actionInFlight = false;

function esc(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "—" : String(str);
    return d.innerHTML;
}

function normStatus(s) {
    return String(s || "").trim().toLowerCase();
}

function money(value) {
    const amount = Number(value) || 0;
    return `₹${amount.toLocaleString("en-IN")}`;
}

function maskAccount(account) {
    const text = String(account || "").replace(/\s+/g, "");
    if (!text || text === "—") return "—";
    if (text.length <= 4) return text;
    return `${"•".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

function isPendingRefund(item) {
    const s = normStatus(item.refundStatus);
    return s !== "refunded" && s !== "no refund";
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

function periodTag(item) {
    if (!item.periodKey) return "—";
    const lockIcon = item.periodLocked ? "<i class='fa-solid fa-lock'></i>" : "<i class='fa-solid fa-lock-open'></i>";
    return `${esc(item.periodKey)} ${lockIcon}`;
}

document.addEventListener("DOMContentLoaded", function () {
    const saveBtn = document.getElementById("saveSemesterRateBtn");
    const lockBtn = document.getElementById("toggleRateLockBtn");

    if (saveBtn) saveBtn.addEventListener("click", saveSemesterRate);
    if (lockBtn) lockBtn.addEventListener("click", togglePeriodLock);

    const periodSelect = document.getElementById("semesterRateSemester");
    if (periodSelect) periodSelect.addEventListener("change", syncSelectedPeriodInfo);

    loadAll();
});

function loadAll() {
    Promise.all([
        fetch("/api/mess-refunds").then(r => { if (!r.ok) throw new Error("Failed refunds"); return r.json(); }),
        fetch("/api/mess-semester-rates").then(r => { if (!r.ok) throw new Error("Failed rates"); return r.json(); })
    ])
        .then(([rows, model]) => {
            if (!Array.isArray(rows)) throw new Error("Invalid refund payload");
            refundRows = rows;
            rateModel = model && typeof model === "object" ? model : { rates: {}, locks: {} };
            renderTable();
            renderStats();
            updateRateHint();
            syncSelectedPeriodInfo();
        })
        .catch(err => {
            console.error("Mess dashboard load error:", err);
            const tbody = document.getElementById("refundTableBody");
            if (!tbody) return;
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#ff1744; padding:30px;">Failed to load mess refund data.</td></tr>`;
        });
}

function renderStats() {
    const pending = refundRows.filter(isPendingRefund);
    const pendingCount = pending.length;
    const liability = pending.reduce((sum, r) => sum + (Number(r.refundAmount) || 0), 0);
    const processed = refundRows
        .filter(r => normStatus(r.refundStatus) === "refunded")
        .reduce((sum, r) => sum + (Number(r.refundAmount) || 0), 0);

    const pendingEl = document.getElementById("pendingCount");
    const liabilityEl = document.getElementById("totalLiability");
    const processedEl = document.getElementById("processedAmount");

    if (pendingEl) pendingEl.textContent = pendingCount;
    if (liabilityEl) liabilityEl.textContent = money(liability);
    if (processedEl) processedEl.textContent = money(processed);
}

function renderTable() {
    const tbody = document.getElementById("refundTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const pendingRows = refundRows.filter(isPendingRefund);

    if (pendingRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--muted); padding:30px;">No pending refunds.</td></tr>`;
        return;
    }

    pendingRows.forEach((item, idx) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${idx + 1}</td>
            <td>${esc(item.fullName || item.name)}</td>
            <td>${esc(item.rollNumber)}</td>
            <td>${periodTag(item)}</td>
            <td>${esc(item.startDate)} → ${esc(item.endDate)}</td>
            <td>${Number(item.totalDays) || 0}</td>
            <td class="money">${money(item.refundAmount)}</td>
            <td>${esc(item.bankName)} / ${esc(maskAccount(item.bankAccountNumber))}</td>
            <td>${statusBadge(item.refundStatus)}</td>
            <td>
                <button class="btn-info" onclick="openModalByIndex(${item._index})">
                    <i class="fa-solid fa-pen"></i> Process
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function openModalByIndex(dataIndex) {
    const item = refundRows.find(r => r._index === dataIndex);
    if (!item) return;
    currentModalRow = item;

    const body = document.getElementById("modalBody");
    if (!body) return;

    body.innerHTML = `
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${esc(item.fullName || item.name)}</span></div>
        <div class="detail-row"><span class="detail-label">Roll Number</span><span class="detail-value">${esc(item.rollNumber)}</span></div>
        <div class="detail-row"><span class="detail-label">Period Key</span><span class="detail-value">${esc(item.periodKey || "—")}</span></div>
        <div class="detail-row"><span class="detail-label">Leave Period</span><span class="detail-value">${esc(item.startDate)} → ${esc(item.endDate)}</span></div>
        <div class="detail-row"><span class="detail-label">Days</span><span class="detail-value">${Number(item.totalDays) || 0}</span></div>

        <div class="modal-field">
            <label>Refund Amount (Days × ₹200)</label>
            <input id="modalRefundAmount" type="number" value="${(Number(item.totalDays) || 0) * 200}" readonly style="background:#f0f0f0;cursor:not-allowed;">
        </div>
        <div class="modal-field">
            <label>Bank Name</label>
            <input id="modalBankName" type="text" value="${esc(item.bankName || "")}" readonly>
        </div>
        <div class="modal-field">
            <label>Account Number</label>
            <input id="modalBankAccount" type="text" value="${esc(item.bankAccountNumber || "")}" readonly>
        </div>
        <div class="modal-field">
            <label>IFSC</label>
            <input id="modalBankIfsc" type="text" value="${esc(item.bankIfsc || "")}" readonly>
        </div>
    `;

    const footer = document.getElementById("modalFooter");
    if (footer) {
        footer.innerHTML = `
            <button class="btn-modal-accept" onclick="saveRefund('Processing')">Save as Processing</button>
            <button class="btn-modal-accept" onclick="saveRefund('Refunded')">Mark Refunded</button>
            <button class="btn-modal-reject" onclick="saveRefund('No Refund')">No Refund</button>
            <button class="btn-modal-close" onclick="closeModal()">Close</button>
        `;
    }

    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.add("active");
}

function closeModal() {
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.remove("active");
    currentModalRow = null;
}

document.addEventListener("click", function (e) {
    const modal = document.getElementById("infoModal");
    if (e.target === modal) closeModal();
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
});

function saveRefund(refundStatus) {
    if (!currentModalRow || actionInFlight) return;

    const refundAmount = Number((document.getElementById("modalRefundAmount") || {}).value);
    const bankName = ((document.getElementById("modalBankName") || {}).value || "").trim();
    const bankAccountNumber = ((document.getElementById("modalBankAccount") || {}).value || "").trim();
    const bankIfsc = ((document.getElementById("modalBankIfsc") || {}).value || "").trim().toUpperCase();

    if (!Number.isFinite(refundAmount) || refundAmount < 0) {
        alert("Refund amount must be a non-negative number.");
        return;
    }

    actionInFlight = true;
    fetch("/api/mess-update-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            index: currentModalRow._index,
            refundStatus,
            refundAmount,
            bankName,
            bankAccountNumber,
            bankIfsc
        })
    })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to update refund");
            closeModal();
            loadAll();
        })
        .catch(err => {
            console.error("Refund update failed:", err);
            alert(err.message || "Failed to update refund.");
        })
        .finally(() => {
            actionInFlight = false;
        });
}

function syncSelectedPeriodInfo() {
    const period = ((document.getElementById("semesterRateSemester") || {}).value || "").trim().toLowerCase();
    const rateInput = document.getElementById("semesterRateInput");
    const lockBtn = document.getElementById("toggleRateLockBtn");

    if (!period || !PERIODS.includes(period)) {
        if (rateInput) rateInput.value = "";
        if (lockBtn) lockBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Toggle Lock';
        return;
    }

    const rate = Number((rateModel.rates || {})[period]);
    if (rateInput) rateInput.value = Number.isFinite(rate) ? rate : 0;

    const locked = Boolean((rateModel.locks || {})[period]);
    if (lockBtn) {
        lockBtn.innerHTML = locked
            ? '<i class="fa-solid fa-lock-open"></i> Unlock Rate'
            : '<i class="fa-solid fa-lock"></i> Lock Rate';
    }
}

function saveSemesterRate() {
    const period = ((document.getElementById("semesterRateSemester") || {}).value || "").trim().toLowerCase();
    const rate = Number((document.getElementById("semesterRateInput") || {}).value);

    if (!PERIODS.includes(period)) {
        alert("Please select a valid period.");
        return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
        alert("Rate must be a non-negative number.");
        return;
    }

    fetch("/api/mess-semester-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, rate })
    })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to save rate");
            rateModel = data && data.data ? data.data : rateModel;
            updateRateHint();
            syncSelectedPeriodInfo();
            loadAll();
        })
        .catch(err => {
            console.error("Rate save failed:", err);
            alert(err.message || "Failed to save period rate.");
        });
}

function togglePeriodLock() {
    const period = ((document.getElementById("semesterRateSemester") || {}).value || "").trim().toLowerCase();
    if (!PERIODS.includes(period)) {
        alert("Please select a valid period.");
        return;
    }

    const current = Boolean((rateModel.locks || {})[period]);

    fetch("/api/mess-rate-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, locked: !current })
    })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to update lock");
            rateModel = data && data.data ? data.data : rateModel;
            updateRateHint();
            syncSelectedPeriodInfo();
            loadAll();
        })
        .catch(err => {
            console.error("Lock update failed:", err);
            alert(err.message || "Failed to update lock state.");
        });
}

function updateRateHint() {
    const hint = document.getElementById("rateHint");
    if (!hint) return;

    const text = PERIODS
        .map((period) => {
            const rate = Number((rateModel.rates || {})[period]) || 0;
            const locked = Boolean((rateModel.locks || {})[period]);
            return `${period}: ₹${rate}/day ${locked ? "🔒" : "🔓"}`;
        })
        .join(" • ");

    hint.textContent = text;
}
