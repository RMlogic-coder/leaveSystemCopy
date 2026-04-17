/* ===== admin.js – Student Master Database Admin Logic ===== */

(function () {
    "use strict";

    const API_BASE = "/api/student-master";
    const HOSTEL_MAPPING_API = "/api/hostel-warden-mapping";
    const PAGE_SIZE = 10;

    let students = [];
    let editingRoll = null;
    let hostelMapping = new Map();
    let approversByRole = { admin: [], mess: [], warden: [], fa: [], student: [] };
    let currentApproverRole = "warden";
    let approverSearchQuery = "";
    let pendingDelete = null;
    let currentPage = 1;

    const tableView = document.getElementById("tableView");
    const formView = document.getElementById("formView");
    const approversView = document.getElementById("approversView");
    const approverFormView = document.getElementById("approverFormView");
    const formTitle = document.getElementById("formTitle");
    const approverFormTitle = document.getElementById("approverFormTitle");
    const studentForm = document.getElementById("studentForm");
    const approverForm = document.getElementById("approverForm");
    const masterBody = document.getElementById("masterTableBody");
    const approverBody = document.getElementById("approverTableBody");
    const searchInput = document.getElementById("searchInput");
    const approverSearchInput = document.getElementById("approverSearchInput");
    const noResults = document.getElementById("noResults");
    const approverNoResults = document.getElementById("approverNoResults");
    const formError = document.getElementById("formError");
    const formSuccess = document.getElementById("formSuccess");
    const approverFormError = document.getElementById("approverFormError");
    const approverFormSuccess = document.getElementById("approverFormSuccess");
    const deleteModal = document.getElementById("deleteModal");
    const deleteRollLabel = document.getElementById("deleteRollLabel");
    const paginationContainer = document.getElementById("paginationContainer");
    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    const pageInfo = document.getElementById("pageInfo");
    const dashboard = document.querySelector(".dashboard");
    const sidebar = document.querySelector(".sidebar");
    const menuToggle = document.getElementById("menuToggle");

    const statTotal = document.getElementById("statTotal");
    const statAdmins = document.getElementById("statAdmins");
    const statMess = document.getElementById("statMess");
    const statHostels = document.getElementById("statHostels");
    const statBranches = document.getElementById("statBranches");
    const statWardens = document.getElementById("statWardens");
    const statFas = document.getElementById("statFas");
    const statStudents = document.getElementById("statStudents");

    const fHostelName = document.getElementById("fHostelName");
    const fWarden = document.getElementById("fWarden");
    const fRollNumber = document.getElementById("fRollNumber");
    const fBranch = document.getElementById("fBranch");
    const fMessName = document.getElementById("fMessName");
    const fFa = document.getElementById("fFa");
    const aRole = document.getElementById("aRole");
    const aId = document.getElementById("aId");
    const aName = document.getElementById("aName");
    const aHostelName = document.getElementById("aHostelName");
    const aHostelGroup = document.getElementById("aHostelGroup");
    const aPassword = document.getElementById("aPassword");

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
    document.getElementById("navApprovers").addEventListener("click", (e) => {
        e.preventDefault();
        showApproversTable();
    });
    document.getElementById("btnAddFromTable").addEventListener("click", openAdd);
    document.getElementById("btnBack").addEventListener("click", showTable);
    document.getElementById("btnCancel").addEventListener("click", showTable);
    document.getElementById("btnAddApprover").addEventListener("click", openAddApprover);
    document.getElementById("btnApproverBack").addEventListener("click", showApproversTable);
    document.getElementById("btnApproverCancel").addEventListener("click", showApproversTable);
    document.getElementById("btnCancelDelete").addEventListener("click", () => {
        deleteModal.style.display = "none";
    });
    document.getElementById("btnConfirmDelete").addEventListener("click", confirmDelete);
    btnPrevPage.addEventListener("click", () => changePage(-1));
    btnNextPage.addEventListener("click", () => changePage(1));
    if (menuToggle) {
        menuToggle.addEventListener("click", () => {
            const shouldOpen = !dashboard.classList.contains("sidebar-open");
            setSidebarOpen(shouldOpen);
        });
    }
    if (dashboard) {
        dashboard.addEventListener("click", (e) => {
            if (!isMobileViewport()) return;
            if (!dashboard.classList.contains("sidebar-open")) return;
            if (!sidebar || sidebar.contains(e.target) || (menuToggle && menuToggle.contains(e.target))) return;
            setSidebarOpen(false);
        });
    }
    window.addEventListener("resize", () => {
        if (!isMobileViewport()) {
            setSidebarOpen(false);
        }
    });
    if (approverSearchInput) {
        approverSearchInput.addEventListener("input", () => {
            approverSearchQuery = approverSearchInput.value.trim().toLowerCase();
            renderApproverTable();
        });
    }
    const btnAdminApprovers = document.getElementById("btnAdminApprovers");
    const btnMessApprovers = document.getElementById("btnMessApprovers");
    const btnWardenApprovers = document.getElementById("btnWardenApprovers");
    const btnFaApprovers = document.getElementById("btnFaApprovers");
    const btnStudentApprovers = document.getElementById("btnStudentApprovers");
    if (btnAdminApprovers) btnAdminApprovers.addEventListener("click", () => setApproverRole("admin"));
    if (btnMessApprovers) btnMessApprovers.addEventListener("click", () => setApproverRole("mess"));
    if (btnWardenApprovers) btnWardenApprovers.addEventListener("click", () => setApproverRole("warden"));
    if (btnFaApprovers) btnFaApprovers.addEventListener("click", () => setApproverRole("fa"));
    if (btnStudentApprovers) btnStudentApprovers.addEventListener("click", () => setApproverRole("student"));
    if (approverForm) approverForm.addEventListener("submit", handleApproverSubmit);
    if (aRole) aRole.addEventListener("change", () => syncApproverFormFields());

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
        await loadApproverData();
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
        const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
        headers["x-user-role"] = role;
        if (apiKey) headers["x-api-key"] = apiKey;

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
        approversView.style.display = "none";
        approverFormView.style.display = "none";
        tableView.style.display = "block";
        deleteModal.style.display = "none";
        setActiveNav("navStudents");
        fetchStudents();
        setSidebarOpen(false);
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
        renderFacultyAdvisorOptions();
        updateWardenFieldFromHostel();
        setSidebarOpen(false);
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
            if (!el) continue;
            if (field === "fa") {
                el.value = student.faId || student.fa || "";
            } else {
                el.value = student[field] ?? "";
            }
        }

        renderFacultyAdvisorOptions(student.faId || student.fa || "");
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
            await loadApproverData();
            setTimeout(() => showTable(), 900);
        } catch {
            showFormError("Network error. Please try again.");
        }
    });

    function openDeleteConfirm(rollNumber) {
        pendingDelete = { type: "student", id: rollNumber, label: rollNumber };
        deleteRollLabel.textContent = rollNumber;
        deleteModal.style.display = "flex";
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        try {
            const target = pendingDelete;
            let url = "";
            let method = "DELETE";

            if (target.type === "student") {
                url = `${API_BASE}/${encodeURIComponent(target.id)}`;
            } else if (target.type === "approver") {
                url = `/api/approvers/${encodeURIComponent(target.role)}/${encodeURIComponent(target.id)}`;
            }

            const res = await fetch(url, { method, headers: buildApiHeaders() });
            const json = await res.json();
            if (!res.ok) {
                if (target.type === "student") {
                    showFormError(json.error || "Failed to delete");
                } else {
                    showApproverFormError(json.error || "Failed to delete approver");
                }
                deleteModal.style.display = "none";
                return;
            }
            deleteModal.style.display = "none";
            pendingDelete = null;
            if (target.type === "student") {
                fetchStudents();
            } else {
                await loadApproverData();
                showApproversTable();
            }
        } catch {
            if (pendingDelete && pendingDelete.type === "student") {
                showFormError("Network error while deleting student");
            } else {
                showApproverFormError("Network error while deleting approver");
            }
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
        if (fFa) {
            const selected = fFa.selectedOptions && fFa.selectedOptions[0];
            data.faId = fFa.value.trim();
            data.fa = selected ? (selected.dataset.name || selected.textContent.trim() || fFa.value.trim()) : fFa.value.trim();
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

    function normalizeApproverRole(role) {
        const normalized = String(role || "").trim().toLowerCase();
        return ["admin", "mess", "fa", "warden", "student"].includes(normalized) ? normalized : "";
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

    function clearApproverErrors() {
        if (approverFormError) approverFormError.style.display = "none";
        if (approverFormSuccess) approverFormSuccess.style.display = "none";
        if (approverFormError) approverFormError.textContent = "";
        if (approverFormSuccess) approverFormSuccess.textContent = "";
    }

    function showFormError(msg) {
        formError.textContent = msg;
        formError.style.display = "block";
        formSuccess.style.display = "none";
    }

    function showApproverFormError(msg) {
        if (!approverFormError) return;
        approverFormError.textContent = msg;
        approverFormError.style.display = "block";
        if (approverFormSuccess) approverFormSuccess.style.display = "none";
    }

    function showFormSuccess(msg) {
        formSuccess.textContent = msg;
        formSuccess.style.display = "block";
        formError.style.display = "none";
    }

    function showApproverFormSuccess(msg) {
        if (!approverFormSuccess) return;
        approverFormSuccess.textContent = msg;
        approverFormSuccess.style.display = "block";
        if (approverFormError) approverFormError.style.display = "none";
    }

    function setActiveNav(id) {
        document.querySelectorAll(".sidebar nav a").forEach((a) => a.classList.remove("active"));
        document.getElementById(id).classList.add("active");
    }

    function approverRoleLabel(role) {
        const normalized = normalizeApproverRole(role);
        if (normalized === "admin") return "Admin";
        if (normalized === "mess") return "Mess";
        if (normalized === "fa") return "Faculty Advisor";
        if (normalized === "warden") return "Warden";
        if (normalized === "student") return "Student";
        return "User";
    }

    function getApproverList(role) {
        return approversByRole[role] || [];
    }

    function updateApproverStats() {
        if (statAdmins) statAdmins.textContent = String(getApproverList("admin").length);
        if (statMess) statMess.textContent = String(getApproverList("mess").length);
        if (statWardens) statWardens.textContent = String(getApproverList("warden").length);
        if (statFas) statFas.textContent = String(getApproverList("fa").length);
        if (statStudents) statStudents.textContent = String(getApproverList("student").length);
    }

    function updateApproverTabs() {
        const adminBtn = document.getElementById("btnAdminApprovers");
        const messBtn = document.getElementById("btnMessApprovers");
        const wardenBtn = document.getElementById("btnWardenApprovers");
        const faBtn = document.getElementById("btnFaApprovers");
        const studentBtn = document.getElementById("btnStudentApprovers");
        if (adminBtn) adminBtn.classList.toggle("active", currentApproverRole === "admin");
        if (messBtn) messBtn.classList.toggle("active", currentApproverRole === "mess");
        if (wardenBtn) wardenBtn.classList.toggle("active", currentApproverRole === "warden");
        if (faBtn) faBtn.classList.toggle("active", currentApproverRole === "fa");
        if (studentBtn) studentBtn.classList.toggle("active", currentApproverRole === "student");
        updateApproverStats();
    }

    function setApproverRole(role) {
        const normalized = normalizeApproverRole(role) || "warden";
        currentApproverRole = normalized;
        approverSearchQuery = "";
        if (approverSearchInput) approverSearchInput.value = "";
        updateApproverTabs();
        renderApproverTable();
    }

    function showApproversTable() {
        tableView.style.display = "none";
        formView.style.display = "none";
        approverFormView.style.display = "none";
        approversView.style.display = "block";
        deleteModal.style.display = "none";
        setActiveNav("navApprovers");
        updateApproverTabs();
        renderApproverTable();
        setSidebarOpen(false);
    }

    function isMobileViewport() {
        return window.matchMedia("(max-width: 900px)").matches;
    }

    function setSidebarOpen(open) {
        if (!dashboard || !menuToggle) return;
        const shouldOpen = Boolean(open) && isMobileViewport();
        dashboard.classList.toggle("sidebar-open", shouldOpen);
        menuToggle.setAttribute("aria-expanded", String(shouldOpen));
    }

    function openAddApprover() {
        editingRoll = null;
        clearApproverErrors();
        if (approverForm) approverForm.reset();
        if (aRole) aRole.value = currentApproverRole;
        if (aId) aId.disabled = false;
        if (approverFormTitle) approverFormTitle.textContent = "Add New User";
        syncApproverFormFields();
        tableView.style.display = "none";
        formView.style.display = "none";
        approversView.style.display = "none";
        approverFormView.style.display = "block";
        setActiveNav("navApprovers");
    }

    function renderFacultyAdvisorOptions(selectedValue = "") {
        if (!fFa) return;
        const fas = getApproverList("fa");
        const desired = String(selectedValue || "").trim();
        const options = ['<option value="">Select Faculty Advisor</option>'];

        fas.forEach((fa) => {
            const label = `${fa.name} (${fa.id})`;
            options.push(`<option value="${esc(fa.id)}" data-name="${esc(fa.name)}">${esc(label)}</option>`);
        });

        fFa.innerHTML = options.join("");

        if (desired) {
            const exact = Array.from(fFa.options).find((opt) => opt.value === desired || opt.dataset.name === desired || opt.textContent.includes(desired));
            if (exact) fFa.value = exact.value;
        }
    }

    function getFilteredApprovers() {
        const list = getApproverList(currentApproverRole);
        if (!approverSearchQuery) return list;
        return list.filter((item) => {
            return [item.id, item.username, item.name, item.displayName, item.role].join(" ").toLowerCase().includes(approverSearchQuery);
        });
    }

    function renderApproverTable() {
        if (!approverBody) return;
        updateApproverTabs();

        const rows = getFilteredApprovers();
        if (!rows.length) {
            approverBody.innerHTML = "";
            if (approverNoResults) approverNoResults.style.display = "block";
            return;
        }

        if (approverNoResults) approverNoResults.style.display = "none";
        approverBody.innerHTML = rows.map((item) => `
            <tr>
                <td><span class="approver-type-badge">${esc(approverRoleLabel(item.role))}</span></td>
                <td>${esc(item.id || item.username)}</td>
                <td>${esc(item.name || item.displayName)}</td>
                <td>${esc(item.role === "warden" ? (item.hostelName || "") : "")}</td>
                <td>${item.active === false ? "Inactive" : "Active"}</td>
                <td class="actions-cell">
                    <button class="btn-icon btn-reset-password" title="Reset Password" data-role="${esc(item.role)}" data-id="${esc(item.id || item.username)}" data-name="${esc(item.name || item.displayName)}"><i class="fa-solid fa-key"></i></button>
                    <button class="btn-icon btn-delete" title="Delete" data-role="${esc(item.role)}" data-id="${esc(item.id || item.username)}" data-name="${esc(item.name || item.displayName)}"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `).join("");

        approverBody.querySelectorAll(".btn-reset-password").forEach((btn) => {
            btn.addEventListener("click", () => {
                openResetApproverPasswordPrompt(btn.dataset.role, btn.dataset.id, btn.dataset.name);
            });
        });

        approverBody.querySelectorAll(".btn-delete").forEach((btn) => {
            btn.addEventListener("click", () => {
                openDeleteApproverConfirm(btn.dataset.role, btn.dataset.id, btn.dataset.name);
            });
        });
    }

    async function loadApproverData() {
        try {
            const res = await fetch(`/api/approvers`, { headers: buildApiHeaders() });
            if (!res.ok) throw new Error("Failed to load users");
            const data = await res.json();

            approversByRole = {
                admin: data.admins || [],
                mess: data.mess || [],
                warden: data.wardens || [],
                fa: data.fas || [],
                student: data.students || []
            };

            updateApproverTabs();
            renderFacultyAdvisorOptions();
            if (approversView && approversView.style.display !== "none") {
                renderApproverTable();
            }
        } catch (err) {
            console.error("Failed to load approvers", err);
        }
    }

    function openDeleteApproverConfirm(role, id, name) {
        pendingDelete = {
            type: "approver",
            role,
            id,
            label: `${name} (${id})`
        };
        deleteRollLabel.textContent = pendingDelete.label;
        deleteModal.style.display = "flex";
    }

    async function openResetApproverPasswordPrompt(role, id, name) {
        const normalizedRole = normalizeApproverRole(role);
        const firstPassword = window.prompt(`Enter a new password for ${name} (${id})`);
        if (firstPassword == null) return;

        const newPassword = firstPassword.trim();
        if (!newPassword) {
            showApproverFormError("Password cannot be empty");
            return;
        }

        const confirmPassword = window.prompt(`Confirm the new password for ${name} (${id})`);
        if (confirmPassword == null) return;
        if (confirmPassword.trim() !== newPassword) {
            showApproverFormError("Passwords do not match");
            return;
        }

        try {
            const res = await fetch(`/api/approvers/${encodeURIComponent(normalizedRole)}/${encodeURIComponent(id)}/password`, {
                method: "POST",
                headers: buildApiHeaders(),
                body: JSON.stringify({ newPassword })
            });
            const json = await res.json();
            if (!res.ok) {
                showApproverFormError(json.error || "Failed to update password");
                return;
            }

            showApproverFormSuccess(`${approverRoleLabel(normalizedRole)} password updated successfully`);
            window.alert("Password has been updated successfully.");
            await loadApproverData();
            renderApproverTable();
        } catch {
            showApproverFormError("Network error. Please try again.");
        }
    }

    async function handleApproverSubmit(e) {
        e.preventDefault();
        clearApproverErrors();

        const role = normalizeApproverRole(aRole && aRole.value);
        const id = aId ? aId.value.trim() : "";
        const name = aName ? aName.value.trim() : "";
        const hostelName = aHostelName ? aHostelName.value.trim() : "";
        const password = aPassword ? aPassword.value.trim() : "";

        if (!role) return showApproverFormError("Role is required");
        if (!id) return showApproverFormError("Username / ID is required");
        if (!name) return showApproverFormError("Display name is required");
        if (role === "warden" && !hostelName) return showApproverFormError("Hostel is required for warden");
        if (!password) return showApproverFormError("Password is required");

        try {
            const res = await fetch("/api/approvers", {
                method: "POST",
                headers: buildApiHeaders(),
                body: JSON.stringify({ role, id, username: id, name, displayName: name, password, hostelName: role === "warden" ? hostelName : "", rollNumber: role === "student" ? id : "" })
            });
            const json = await res.json();
            if (!res.ok) {
                showApproverFormError(json.error || "Server error");
                return;
            }

            showApproverFormSuccess(`${approverRoleLabel(role)} saved successfully`);
            await loadApproverData();
            if (approverForm) approverForm.reset();
            if (aRole) aRole.value = role;
            if (aId) aId.disabled = false;
            syncApproverFormFields();
            setTimeout(() => showApproversTable(), 900);
        } catch {
            showApproverFormError("Network error. Please try again.");
        }
    }

    function syncApproverFormFields() {
        const role = normalizeApproverRole(aRole && aRole.value) || currentApproverRole;
        const isWarden = role === "warden";

        if (aHostelGroup) {
            aHostelGroup.style.display = isWarden ? "block" : "none";
        }
        if (aHostelName) {
            aHostelName.required = isWarden;
            if (!isWarden) aHostelName.value = "";
        }
        if (aId) {
            aId.placeholder = role === "student" ? "e.g. CS25B1001" : role === "admin" ? "e.g. admin" : role === "mess" ? "e.g. mess" : "e.g. JT101";
        }
        if (!isWarden && aRole) {
            aRole.value = role;
        }
    }
})();
