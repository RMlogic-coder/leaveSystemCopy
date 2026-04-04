/* ===== admin.js – Student Master Database Admin Logic ===== */

(function () {
    "use strict";

    const API_BASE = "/api/student-master";
    const HOSTEL_MAPPING_API = "/api/hostel-warden-mapping";
    const PAGE_SIZE = 10;

    let students = [];
    let editingRoll = null;
    let hostelMapping = new Map();
    let currentPage = 1;

    const tableView = document.getElementById("tableView");
    const formView = document.getElementById("formView");
    const formTitle = document.getElementById("formTitle");
    const studentForm = document.getElementById("studentForm");
    const masterBody = document.getElementById("masterTableBody");
    const searchInput = document.getElementById("searchInput");
    const noResults = document.getElementById("noResults");
    const formError = document.getElementById("formError");
    const formSuccess = document.getElementById("formSuccess");
    const deleteModal = document.getElementById("deleteModal");
    const deleteRollLabel = document.getElementById("deleteRollLabel");
    const paginationContainer = document.getElementById("paginationContainer");
    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    const pageInfo = document.getElementById("pageInfo");

    const statTotal = document.getElementById("statTotal");
    const statHostels = document.getElementById("statHostels");
    const statBranches = document.getElementById("statBranches");

    const fHostelName = document.getElementById("fHostelName");
    const fWarden = document.getElementById("fWarden");
    const fRollNumber = document.getElementById("fRollNumber");
    const fBranch = document.getElementById("fBranch");
    const fMessName = document.getElementById("fMessName");

    const session = getAdminSession();
    if (!session) {
        window.location.href = "/index.html";
        return;
    }

    if (fWarden) {
        fWarden.readOnly = true;
        fWarden.title = "Auto-assigned from hostel mapping";
    }
    if (fMessName) {
        fMessName.disabled = true;
        fMessName.title = "Auto-assigned from hostel";
    }

    document.getElementById("navStudents").addEventListener("click", (e) => {
        e.preventDefault();
        showTable();
    });
    document.getElementById("navAddNew").addEventListener("click", (e) => {
        e.preventDefault();
        openAdd();
    });
    document.getElementById("btnAddFromTable").addEventListener("click", openAdd);
    document.getElementById("btnBack").addEventListener("click", showTable);
    document.getElementById("btnCancel").addEventListener("click", showTable);
    document.getElementById("btnCancelDelete").addEventListener("click", () => {
        deleteModal.style.display = "none";
    });
    document.getElementById("btnConfirmDelete").addEventListener("click", confirmDelete);
    btnPrevPage.addEventListener("click", () => changePage(-1));
    btnNextPage.addEventListener("click", () => changePage(1));

    searchInput.addEventListener("input", () => {
        currentPage = 1;
        renderTable();
    });
    if (fHostelName) fHostelName.addEventListener("change", handleHostelInput);
    if (fRollNumber) {
        fRollNumber.addEventListener("input", () => {
            applyBranchFromRollNumber(fRollNumber.value);
        });
    }

    init();

    async function init() {
        await loadHostelMappings();
        await fetchStudents();
    }

    function getAdminSession() {
        try {
            const raw = sessionStorage.getItem("loggedInUser");
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const role = String(parsed && parsed.role || "").toLowerCase();
            if (role !== "admin") return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function buildApiHeaders() {
        const headers = { "Content-Type": "application/json" };
        const role = String(session.role || "admin").toLowerCase();
        headers["x-user-role"] = role;

        if (session.approverId || session.rollNumber || session.username) {
            headers["x-user-id"] = String(session.approverId || session.rollNumber || session.username).trim();
        }
        if (session.displayName || session.approverName || session.username) {
            headers["x-user-name"] = String(session.displayName || session.approverName || session.username).trim();
        }
        return headers;
    }

    async function loadHostelMappings() {
        try {
            const res = await fetch(HOSTEL_MAPPING_API, { headers: buildApiHeaders() });
            if (!res.ok) return;
            const rows = await res.json();
            hostelMapping = new Map();
            rows.forEach((row) => {
                const key = normHostel(row.hostelName);
                if (!key) return;
                hostelMapping.set(key, {
                    hostelName: String(row.hostelName || "").trim(),
                    warden: String(row.warden || "").trim()
                });
            });
        } catch (err) {
            console.error("Failed to load hostel mapping", err);
        }
    }

    async function fetchStudents() {
        try {
            const res = await fetch(API_BASE, { headers: buildApiHeaders() });
            if (!res.ok) throw new Error("Failed to load students");
            students = await res.json();
            currentPage = 1;
            updateStats();
            renderTable();
        } catch (err) {
            console.error(err);
        }
    }

    function updateStats() {
        statTotal.textContent = students.length;
        statHostels.textContent = new Set(students.map((s) => (s.hostelName || "").trim()).filter(Boolean)).size;
        statBranches.textContent = new Set(students.map((s) => (s.branch || "").trim()).filter(Boolean)).size;
    }

    function renderTable() {
        const filtered = getFilteredStudents();
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        if (filtered.length === 0) {
            masterBody.innerHTML = "";
            noResults.style.display = "block";
            updatePagination(0, 0);
            return;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = filtered.slice(start, start + PAGE_SIZE);

        noResults.style.display = "none";
        masterBody.innerHTML = pageRows
            .map((s) => `
                <tr>
                    <td><span class="roll-badge">${esc(s.rollNumber)}</span></td>
                    <td>${esc(s.name)}</td>
                    <td>${esc(s.year)}</td>
                    <td>${esc(s.branch)}</td>
                    <td>${esc(s.hostelName)}</td>
                    <td>${esc(s.phone)}</td>
                    <td class="actions-cell">
                        <button class="btn-icon btn-edit" title="Edit" data-roll="${esc(s.rollNumber)}"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon btn-delete" title="Delete" data-roll="${esc(s.rollNumber)}"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `)
            .join("");

        updatePagination(filtered.length, totalPages);

        masterBody.querySelectorAll(".btn-edit").forEach((btn) => {
            btn.addEventListener("click", () => openEdit(btn.dataset.roll));
        });
        masterBody.querySelectorAll(".btn-delete").forEach((btn) => {
            btn.addEventListener("click", () => openDeleteConfirm(btn.dataset.roll));
        });
    }

    function getFilteredStudents() {
        const query = searchInput.value.trim().toLowerCase();
        return query
            ? students.filter((s) =>
                (s.name || "").toLowerCase().includes(query) ||
                (s.rollNumber || "").toLowerCase().includes(query) ||
                (s.branch || "").toLowerCase().includes(query)
            )
            : students;
    }

    function updatePagination(totalItems, totalPages) {
        if (!paginationContainer || !btnPrevPage || !btnNextPage || !pageInfo) return;

        if (totalItems === 0) {
            paginationContainer.style.display = "none";
            return;
        }

        paginationContainer.style.display = "flex";
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        btnPrevPage.disabled = currentPage <= 1;
        btnNextPage.disabled = currentPage >= totalPages;
    }

    function changePage(delta) {
        const filtered = getFilteredStudents();
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        const nextPage = currentPage + delta;
        if (nextPage < 1 || nextPage > totalPages) return;
        currentPage = nextPage;
        renderTable();
    }

    function showTable() {
        formView.style.display = "none";
        tableView.style.display = "block";
        deleteModal.style.display = "none";
        setActiveNav("navStudents");
        fetchStudents();
    }

    function openAdd() {
        editingRoll = null;
        formTitle.textContent = "Add New Student";
        studentForm.reset();
        clearErrors();
        document.getElementById("fRollNumber").disabled = false;
        tableView.style.display = "none";
        formView.style.display = "block";
        setActiveNav("navAddNew");
        updateWardenFieldFromHostel();
    }

    function openEdit(rollNumber) {
        const student = students.find((s) => s.rollNumber === rollNumber);
        if (!student) return;

        editingRoll = rollNumber;
        formTitle.textContent = `Edit Student - ${rollNumber}`;
        clearErrors();

        const fields = [
            "rollNumber", "name", "email", "phone",
            "fatherName", "fatherPhone", "motherName", "motherPhone",
            "year", "semester", "branch", "hostelName", "roomNumber",
            "messName", "warden", "fa",
            "bankName", "accountNumber", "ifsc"
        ];

        for (const field of fields) {
            const el = document.getElementById("f" + capitalize(field));
            if (el) el.value = student[field] ?? "";
        }

        updateWardenFieldFromHostel();
        updateMessFromHostel();

        document.getElementById("fRollNumber").disabled = true;
        tableView.style.display = "none";
        formView.style.display = "block";
        setActiveNav("navStudents");
    }

    studentForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearErrors();

        const data = gatherFormData();
        const clientErrors = validateClient(data);
        if (clientErrors.length) {
            showFormError(clientErrors.join(". "));
            return;
        }

        try {
            const url = editingRoll ? `${API_BASE}/${encodeURIComponent(editingRoll)}` : API_BASE;
            const method = editingRoll ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: buildApiHeaders(),
                body: JSON.stringify(data)
            });

            const json = await res.json();
            if (!res.ok) {
                showFormError(json.error || "Server error");
                return;
            }

            showFormSuccess(editingRoll ? "Student updated successfully" : "Student added successfully");
            setTimeout(() => showTable(), 900);
        } catch {
            showFormError("Network error. Please try again.");
        }
    });

    let pendingDeleteRoll = null;

    function openDeleteConfirm(rollNumber) {
        pendingDeleteRoll = rollNumber;
        deleteRollLabel.textContent = rollNumber;
        deleteModal.style.display = "flex";
    }

    async function confirmDelete() {
        if (!pendingDeleteRoll) return;
        try {
            const res = await fetch(`${API_BASE}/${encodeURIComponent(pendingDeleteRoll)}`, {
                method: "DELETE",
                headers: buildApiHeaders()
            });
            const json = await res.json();
            if (!res.ok) {
                showFormError(json.error || "Failed to delete");
                deleteModal.style.display = "none";
                return;
            }
            deleteModal.style.display = "none";
            pendingDeleteRoll = null;
            fetchStudents();
        } catch {
            showFormError("Network error while deleting student");
            deleteModal.style.display = "none";
        }
    }

    const PHONE_RE = /^\d{10,15}$/;
    const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
    const ACCOUNT_RE = /^\d{6,18}$/;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function validateClient(data) {
        const errors = [];

        if (!data.rollNumber || !data.rollNumber.trim()) {
            errors.push("Roll Number is required");
            setFieldError("errRollNumber", "Required");
        }
        if (!data.name || !data.name.trim()) {
            errors.push("Name is required");
            setFieldError("errName", "Required");
        }
        if (!data.hostelName || !data.hostelName.trim()) {
            errors.push("Hostel is required");
        }
        if (data.phone && !PHONE_RE.test(data.phone.replace(/\D/g, ""))) {
            errors.push("Phone must be 10-15 digits");
            setFieldError("errPhone", "10-15 digits");
        }
        if (data.fatherPhone && !PHONE_RE.test(data.fatherPhone.replace(/\D/g, ""))) {
            errors.push("Father phone must be 10-15 digits");
            setFieldError("errFatherPhone", "10-15 digits");
        }
        if (data.motherPhone && !PHONE_RE.test(data.motherPhone.replace(/\D/g, ""))) {
            errors.push("Mother phone must be 10-15 digits");
            setFieldError("errMotherPhone", "10-15 digits");
        }
        if (data.accountNumber && !ACCOUNT_RE.test(data.accountNumber.replace(/\D/g, ""))) {
            errors.push("Account number must be 6-18 digits");
            setFieldError("errAccountNumber", "6-18 digits");
        }
        if (data.ifsc && !IFSC_RE.test(data.ifsc.trim())) {
            errors.push("IFSC must match format like SBIN0001234");
            setFieldError("errIfsc", "e.g. SBIN0001234");
        }
        if (data.email && !EMAIL_RE.test(data.email.trim())) {
            errors.push("Invalid email format");
            setFieldError("errEmail", "Invalid format");
        }

        const hostelKey = normHostel(data.hostelName);
        if (hostelKey && hostelMapping.size && !hostelMapping.has(hostelKey)) {
            errors.push("Unknown hostel. Use a mapped hostel name");
        }

        return errors;
    }

    function gatherFormData() {
        const fields = [
            "rollNumber", "name", "email", "phone",
            "fatherName", "fatherPhone", "motherName", "motherPhone",
            "year", "semester", "branch", "hostelName", "roomNumber",
            "messName", "warden", "fa",
            "bankName", "accountNumber", "ifsc"
        ];
        const data = {};
        for (const field of fields) {
            const el = document.getElementById("f" + capitalize(field));
            if (el) data[field] = el.value.trim();
        }
        if (data.year) data.year = Number(data.year);
        if (data.semester) data.semester = Number(data.semester);
        return data;
    }

    function handleHostelInput() {
        updateWardenFieldFromHostel();
        updateMessFromHostel();
    }

    function updateWardenFieldFromHostel() {
        if (!fHostelName || !fWarden) return;
        const key = normHostel(fHostelName.value);
        if (!key || !hostelMapping.has(key)) {
            fWarden.value = "";
            return;
        }
        fWarden.value = hostelMapping.get(key).warden;
    }

    function updateMessFromHostel() {
        if (!fHostelName || !fMessName) return;
        const key = normHostel(fHostelName.value);
        fMessName.value = key === "federal" ? "Federal" : "Bheema";
    }

    function deriveBranchFromRollNumber(rollNumber) {
        const normalized = String(rollNumber || "").trim().toUpperCase();
        if (normalized.startsWith("MC")) return "Mathematics and Computing";
        if (normalized.startsWith("AD")) return "Artificial intelligence and Data Science";
        if (normalized.startsWith("CS")) return "Computer Science";
        return "";
    }

    function applyBranchFromRollNumber(rollNumber) {
        if (!fBranch) return;
        const derived = deriveBranchFromRollNumber(rollNumber);
        if (!derived) return;
        fBranch.value = derived;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function esc(str) {
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    function normHostel(value) {
        return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function setFieldError(id, msg) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg;
    }

    function clearErrors() {
        document.querySelectorAll(".field-error").forEach((el) => {
            el.textContent = "";
        });
        formError.style.display = "none";
        formSuccess.style.display = "none";
    }

    function showFormError(msg) {
        formError.textContent = msg;
        formError.style.display = "block";
        formSuccess.style.display = "none";
    }

    function showFormSuccess(msg) {
        formSuccess.textContent = msg;
        formSuccess.style.display = "block";
        formError.style.display = "none";
    }

    function setActiveNav(id) {
        document.querySelectorAll(".sidebar nav a").forEach((a) => a.classList.remove("active"));
        document.getElementById(id).classList.add("active");
    }
})();
