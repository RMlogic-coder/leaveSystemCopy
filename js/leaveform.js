function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    if (window.innerWidth <= 1024) {
        sidebar.classList.toggle("active");
    } else {
        sidebar.classList.toggle("closed");
    }
}

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

let submitting = false;

function field(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const el = field(id);
    if (!el) return;
    el.value = value == null ? "" : String(value);
}

function setContent(id, value) {
    const el = field(id);
    if (!el) return;
    el.textContent = value == null ? "" : String(value);
}

function setMessage(text, color) {
    const msgEl = field("formMessage");
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = color;
    msgEl.style.display = "block";
}

function getLoggedInStudentRoll() {
    try {
        const raw = sessionStorage.getItem("loggedInUser");
        if (!raw) return "";
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.role !== "student") return "";
        return String(parsed.rollNumber || "").trim().toUpperCase();
    } catch {
        return "";
    }
}

function buildStudentApiHeaders(includeJsonContentType = false) {
    const headers = {};
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    if (includeJsonContentType) headers["Content-Type"] = "application/json";
    headers["x-user-role"] = "student";
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

function calculateLeaveDays() {
    const startDateInput = field("startDate");
    const endDateInput = field("endDate");
    const totalDaysInput = field("totalDays");

    if (!startDateInput || !endDateInput || !totalDaysInput) return;

    const startDate = startDateInput.value ? new Date(startDateInput.value) : null;
    const endDate = endDateInput.value ? new Date(endDateInput.value) : null;

    if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        totalDaysInput.value = "";
        return;
    }

    if (endDate <= startDate) {
        totalDaysInput.value = "";
        setMessage("End date must be after the start date.", "#ff4444");
        endDateInput.value = "";
        return;
    }

    const msInDay = 24 * 60 * 60 * 1000;
    const diffInDays = Math.floor((endDate - startDate) / msInDay) + 1;
    totalDaysInput.value = diffInDays > 0 ? diffInDays : "";
}

function toIsoDate(date) {
    return date.toISOString().split("T")[0];
}

function enforceStartDateMin() {
    const startDateInput = field("startDate");
    if (!startDateInput) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    startDateInput.min = toIsoDate(tomorrow);
}

function loadStudentPrefill(rollNumber) {
    return fetch(`/api/student-master/${encodeURIComponent(rollNumber)}`, { headers: buildStudentApiHeaders() })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to load student data");

            setText("studentName", data.name);
            setText("rollNumber", data.rollNumber);
            setText("year", data.year);
            setText("semester", data.semester);
            setText("hostelName", data.hostelName);
            setText("messName", data.messName);

            // Student dashboard cards
            setContent("hostelName", data.hostelName || "--");
            setContent("yourFA", `${data.fa || "--"} (${data.faId || "-"})`);
            setText("warden", data.warden);
            setText("fa", data.fa);
            setText("fatherName", data.fatherName);
            setText("motherName", data.motherName);
            setText("phone", data.phone);
            setText("bankName", data.bankName);
            setText("bankAccountNumber", data.accountNumber);
            setText("bankIfsc", data.ifsc);

            const parentSelect = field("parentPhone");
            if (parentSelect) {
                parentSelect.innerHTML = `
                    <option value="">Select Parent</option>
                    <option value="father">Father – ${data.fatherPhone || "—"}</option>
                    <option value="mother">Mother – ${data.motherPhone || "—"}</option>
                `;
            }

            const messField = field("messName");
            if (messField && messField.tagName === "SELECT") {
                const currentMess = data.messName || "";
                messField.innerHTML = `<option value="${currentMess}">${currentMess || "Select Mess"}</option>`;
                if (currentMess) messField.value = currentMess;
            }
        });
}

function normalizeLeaveStatus(value) {
    return String(value || "").trim().toLowerCase();
}

function updateDashboardStat(id, value) {
    const el = field(id);
    if (!el) return;
    el.textContent = String(value);
}

function loadStudentDashboardStats(rollNumber) {
    const normalizedRoll = String(rollNumber || "").trim().toUpperCase();
    if (!normalizedRoll) return Promise.resolve();

    return fetch("/api/student-leaves", { headers: buildStudentApiHeaders() })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to load student leave data");
            if (!Array.isArray(data)) throw new Error("Invalid leave data payload");

            const ownLeaves = data.filter(item => String(item && item.rollNumber || "").trim().toUpperCase() === normalizedRoll);
            const totalLeaveDays = ownLeaves.reduce((sum, item) => sum + (Number(item && item.totalDays) || 0), 0);
            const pendingRefunds = ownLeaves.filter((item) => {
                const status = normalizeLeaveStatus(item && item.status);
                const refundStatus = normalizeLeaveStatus(item && item.refundStatus);
                if (status === "rejected") return false;
                return refundStatus === "awaiting approval" || refundStatus === "processing";
            }).length;

            //updateDashboardStat("yourFA", totalLeaveDays);
            updateDashboardStat("pendingRefundValue", pendingRefunds);
        });
}

function handleLeaveSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const form = e.target;
    const rollNumber = (field("rollNumber") || {}).value || "";
    const currentRoll = getLoggedInStudentRoll() || String(rollNumber).trim().toUpperCase();
    const parentRelation = (field("parentPhone") || {}).value || "";
    const startDate = (field("startDate") || {}).value || "";
    const endDate = (field("endDate") || {}).value || "";
    const totalDays = (field("totalDays") || {}).value || "";
    const reason = (field("leaveReason") || {}).value || "";

    const errors = [];
    if (!rollNumber.trim()) errors.push("Roll number is required.");
    if (!parentRelation) errors.push("Please select a parent contact.");
    if (!startDate) errors.push("Start date is required.");
    if (!endDate) errors.push("End date is required.");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && start <= today) errors.push("Start date must be after current date.");
    if (start && end && end <= start) errors.push("End date must be after start date.");
    if (!totalDays || Number(totalDays) < 1) errors.push("Total days must be at least 1.");
    if (!reason.trim()) errors.push("Reason is required.");

    if (errors.length > 0) {
        setMessage(errors[0], "#ff4444");
        return;
    }

    submitting = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting…";
    }

    fetch("/api/submit-leave", {
        method: "POST",
        headers: buildStudentApiHeaders(true),
        body: JSON.stringify({
            rollNumber: rollNumber.trim(),
            parentRelation,
            startDate,
            endDate,
            reason: reason.trim()
        })
    })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data && data.error ? data.error : "Failed to submit leave");

            setMessage("Leave application submitted successfully!", "#00c853");
            form.reset();
            if (currentRoll) setText("rollNumber", currentRoll);
            setText("totalDays", "");
            enforceStartDateMin();
        })
        .catch(err => {
            console.error("Submit error:", err);
            setMessage(err.message || "Failed to submit. Please try again.", "#ff4444");
        })
        .finally(() => {
            submitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Submit Application";
            }
            if (currentRoll) {
                loadStudentPrefill(currentRoll).catch(() => {});
            }
        });
}

document.addEventListener("DOMContentLoaded", function () {
    const startDateInput = field("startDate");
    const endDateInput = field("endDate");

    if (startDateInput) startDateInput.addEventListener("change", function () {
        calculateLeaveDays();
        if (startDateInput.value) {
            const nextDay = new Date(startDateInput.value);
            nextDay.setDate(nextDay.getDate() + 1);
            if (endDateInput) endDateInput.min = toIsoDate(nextDay);
        }
    });
    if (endDateInput) endDateInput.addEventListener("change", calculateLeaveDays);

    enforceStartDateMin();

    const leaveForm = field("leaveForm");
    if (leaveForm) leaveForm.addEventListener("submit", handleLeaveSubmit);

    const rollInput = field("rollNumber");
    const sessionRoll = getLoggedInStudentRoll();
    const initialRoll = sessionRoll || ((rollInput && rollInput.value) ? rollInput.value : "");

    if (rollInput && sessionRoll) {
        rollInput.value = sessionRoll;
    }

    if (!initialRoll) {
        setMessage("Student session missing. Please login again.", "#ff4444");
        return;
    }

    loadStudentPrefill(initialRoll).catch(err => {
        console.error("Prefill error:", err);
        setMessage("Failed to load student prefill data.", "#ff4444");
    });

    loadStudentDashboardStats(initialRoll).catch(err => {
        console.error("Dashboard stats error:", err);
        updateDashboardStat("dayCountValue", "--");
        updateDashboardStat("pendingRefundValue", "--");
    });
});
