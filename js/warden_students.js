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
            role: nextRole
        };

        sessionStorage.setItem("loggedInUser", JSON.stringify(nextSession));
        window.location.href = nextRole === "fa"
            ? "/pages/fa/fa_dashboard.html"
            : "/pages/warden/warden_dashboard.html";
    } catch (err) {
        console.error("Failed to switch role:", err);
        alert("Unable to switch role. Please login again.");
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

// ===== Global Data =====
let allStudents = [];
let allLeaveRequests = [];
let currentPage = 1;
let searchQuery = "";
const PAGE_SIZE = 10;

let wardenSession = {
    approverId: "",
    approverName: "Warden",
    hostelName: ""
};

const WARDEN_PROFILES = {
    NBV101: { name: "Natesh", hostelName: "Bheema" },
    PS101: { name: "Priyanka", hostelName: "Krishna" },
    P101: { name: "Pradhan", hostelName: "Federal" },
    JT101: { name: "Jhanvi", hostelName: "Tungabadra" }
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

function normHostel(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeWardenId(value) {
    return /^[A-Z]{2,4}\d{2}[A-Z]\d{3,4}$/.test(String(value || "").trim().toUpperCase());
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
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    headers["x-user-role"] = "warden";
    if (apiKey) headers["x-api-key"] = apiKey;
    if (wardenSession.approverId) headers["x-user-id"] = wardenSession.approverId;
    if (wardenSession.approverName) headers["x-user-name"] = wardenSession.approverName;
    return headers;
}

function isStudentInWardenHostel(student) {
    const sessionHostel = normHostel(wardenSession.hostelName);
    if (!sessionHostel) return true;
    const studentHostel = normHostel((student && (student.hostel || student.hostelName)) || "");
    return studentHostel === sessionHostel;
}

function getFilteredStudents() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allStudents;

    return allStudents.filter((student) => {
        const haystack = [
            field(student, "rollNumber", ""),
            field(student, "name", ""),
            field(student, "branch", ""),
            field(student, "roomNumber", ""),
            field(student, "fa", "")
        ].join(" ").toLowerCase();
        return haystack.includes(q);
    });
}

/** Clamp current page to valid range */
function clampPage() {
    const totalPages = Math.ceil(getFilteredStudents().length / PAGE_SIZE) || 1;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
}

/** Normalize status for badge mapping */
function badgeClass(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "approved") return "badge-approved";
    if (s === "rejected") return "badge-rejected";
    return "badge-pending";
}

// ===== Load Data =====
document.addEventListener("DOMContentLoaded", function () {
    const tbody = document.getElementById("studentTableBody");
    const searchInput = document.getElementById("studentSearch");
    const session = getLoggedInWardenSession();

    if (session) {
        wardenSession = resolveWardenSession(session);
    }

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            searchQuery = searchInput.value || "";
            currentPage = 1;
            updateStats();
            renderTable();
        });
    }

    Promise.all([
        fetch("/api/warden-students", { headers: apiHeaders() }).then(r => { if (!r.ok) throw new Error("Students API " + r.status); return r.json(); }),
        fetch("/api/warden-leave-requests", { headers: apiHeaders() }).then(r => { if (!r.ok) throw new Error("Leaves API " + r.status); return r.json(); })
    ])
    .then(([students, leaves]) => {
        const sourceStudents = Array.isArray(students) ? students : [];
        allStudents = sourceStudents.filter(isStudentInWardenHostel);
        allLeaveRequests = Array.isArray(leaves) ? leaves : [];
        clampPage();
        updateStats();
        renderTable();
    })
    .catch(err => {
        console.error("Error loading data:", err);
        allStudents = [];
        allLeaveRequests = [];
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align:center; color:#ff1744; padding:30px;">
                        Failed to load student data. Please refresh or try again later.
                    </td>
                </tr>
            `;
        }
        updatePagination();
    });
});

// ===== Stats =====
function updateStats() {
    const filteredStudents = getFilteredStudents();
    clampPage();
    const totalPages = Math.ceil(filteredStudents.length / PAGE_SIZE) || 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const showing = Math.max(0, Math.min(PAGE_SIZE, filteredStudents.length - startIdx));

    const statTotal = document.getElementById("statTotal");
    const statShowing = document.getElementById("statShowing");
    const statPage = document.getElementById("statPage");

    if (statTotal) statTotal.textContent = allStudents.length;
    if (statShowing) statShowing.textContent = showing;
    if (statPage) statPage.textContent = `${currentPage} / ${totalPages}`;
}

// ===== Pagination =====
function changePage(delta) {
    const totalPages = Math.ceil(getFilteredStudents().length / PAGE_SIZE) || 1;
    const newPage = currentPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    currentPage = newPage;
    updateStats();
    renderTable();
}

function updatePagination() {
    clampPage();
    const filteredStudents = getFilteredStudents();
    const totalPages = Math.ceil(filteredStudents.length / PAGE_SIZE) || 1;
    const indicator = document.getElementById("pageIndicator");
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");

    if (indicator) indicator.textContent = `Page ${currentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

// ===== Render Student Table =====
function renderTable() {
    const tbody = document.getElementById("studentTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    clampPage();
    const filteredStudents = getFilteredStudents();
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageStudents = filteredStudents.slice(startIdx, startIdx + PAGE_SIZE);

    if (pageStudents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; color:var(--muted); padding:30px;">
                    <i class="fa-solid fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                    No students found.
                </td>
            </tr>
        `;
        updatePagination();
        return;
    }

    pageStudents.forEach((student, idx) => {
        if (!student || typeof student !== "object") return; // skip malformed entries
        const row = document.createElement("tr");
        // Sanitise rollNumber for use in onclick attribute
        const safeRoll = esc(field(student, "rollNumber"));

        row.innerHTML = `
            <td>${startIdx + idx + 1}</td>
            <td>${safeRoll}</td>
            <td>${esc(field(student, "name"))}</td>
            <td>${esc(field(student, "fatherName"))}</td>
            <td>${esc(field(student, "branch"))}</td>
            <td>${esc(field(student, "roomNumber"))}</td>
            <td>${esc(field(student, "phone"))}</td>
            <td>${esc(field(student, "fa"))}</td>
            <td>
                <div class="actions">
                    <button class="btn-info" onclick="openRequestsModal('${safeRoll}')">
                        <i class="fa-solid fa-clipboard-list"></i> Requests
                    </button>
                    <button class="btn-accept" onclick="openInfoModal('${safeRoll}')">
                        <i class="fa-solid fa-circle-info"></i> Info
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(row);
    });

    updatePagination();
}

// ===== Info Modal =====
function openInfoModal(studentIndex) {
    const roll = String(studentIndex || "").trim();
    if (!roll) return;
    const student = allStudents.find((s) => String(field(s, "rollNumber", "")).trim() === roll);
    if (!student || typeof student !== "object") return;

    const body = document.getElementById("infoModalBody");
    if (!body) return;

    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">${esc(field(student, "name"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Roll Number</span>
            <span class="detail-value">${esc(field(student, "rollNumber"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Father's Name</span>
            <span class="detail-value">${esc(field(student, "fatherName"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Branch</span>
            <span class="detail-value">${esc(field(student, "branch"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Year</span>
            <span class="detail-value">${esc(field(student, "year"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Room Number</span>
            <span class="detail-value">${esc(field(student, "roomNumber"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Hostel</span>
            <span class="detail-value">${esc(field(student, "hostel"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Phone</span>
            <span class="detail-value">${esc(field(student, "phone"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Parent Phone</span>
            <span class="detail-value">${esc(field(student, "parentPhone"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Mess</span>
            <span class="detail-value">${esc(field(student, "messName"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Email</span>
            <span class="detail-value">${esc(field(student, "email"))}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Faculty Advisor</span>
            <span class="detail-value">${esc(field(student, "fa"))}</span>
        </div>
    `;

    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.add("active");
}

function closeInfoModal() {
    const modal = document.getElementById("infoModal");
    if (modal) modal.classList.remove("active");
}

// ===== Requests Modal =====
function openRequestsModal(rollNumber) {
    if (!rollNumber) return;
    const body = document.getElementById("requestsModalBody");
    if (!body) return;

    const studentLeaves = Array.isArray(allLeaveRequests)
        ? allLeaveRequests.filter(l => l && l.rollNumber === rollNumber)
        : [];

    if (studentLeaves.length === 0) {
        body.innerHTML = `
            <div style="text-align:center; color:var(--muted); padding:30px;">
                <i class="fa-solid fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                No leave requests found for this student.
            </div>
        `;
    } else {
        let html = `<div class="requests-list">`;
        studentLeaves.forEach((leave, idx) => {
            const cls = badgeClass(leave.status);

            html += `
                <div class="request-card">
                    <div class="request-card-header">
                        <span class="request-card-title">#${idx + 1} — ${esc(field(leave, "startDate"))} → ${esc(field(leave, "endDate"))}</span>
                        <span class="approval-badge ${cls}">${esc(field(leave, "status", "Pending"))}</span>
                    </div>
                    <div class="request-card-body">
                        <div class="detail-row">
                            <span class="detail-label">Days</span>
                            <span class="detail-value">${Number(leave.totalDays) || 0}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Reason</span>
                            <span class="detail-value" style="max-width:280px; white-space:normal; text-align:right;">${esc(field(leave, "reason"))}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Family</span>
                            <span class="detail-value">${esc(field(leave, "familyApproval", "Pending"))}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Warden</span>
                            <span class="detail-value">${esc(field(leave, "wardenApproval", "Pending"))}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">FA</span>
                            <span class="detail-value">${esc(field(leave, "faApproval", "Pending"))}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        body.innerHTML = html;
    }

    const modal = document.getElementById("requestsModal");
    if (modal) modal.classList.add("active");
}

function closeRequestsModal() {
    const modal = document.getElementById("requestsModal");
    if (modal) modal.classList.remove("active");
}

// Close modals on overlay click
document.addEventListener("click", function (e) {
    if (e.target === document.getElementById("infoModal")) closeInfoModal();
    if (e.target === document.getElementById("requestsModal")) closeRequestsModal();
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        closeInfoModal();
        closeRequestsModal();
    }
});
