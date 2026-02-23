/* ===== admin.js – Student Master Database Admin Logic ===== */

(function () {
    "use strict";

    const API_BASE = "/api/student-master";

    // Cached student list
    let students = [];
    let editingRoll = null; // null = add mode, string = edit mode

    // ── DOM refs ──
    const tableView    = document.getElementById("tableView");
    const formView     = document.getElementById("formView");
    const formTitle    = document.getElementById("formTitle");
    const studentForm  = document.getElementById("studentForm");
    const masterBody   = document.getElementById("masterTableBody");
    const searchInput  = document.getElementById("searchInput");
    const noResults    = document.getElementById("noResults");
    const formError    = document.getElementById("formError");
    const formSuccess  = document.getElementById("formSuccess");
    const deleteModal  = document.getElementById("deleteModal");
    const deleteRollLabel = document.getElementById("deleteRollLabel");

    // Stat elements
    const statTotal    = document.getElementById("statTotal");
    const statHostels  = document.getElementById("statHostels");
    const statBranches = document.getElementById("statBranches");

    // ── Buttons ──
    document.getElementById("navStudents").addEventListener("click", (e) => { e.preventDefault(); showTable(); });
    document.getElementById("navAddNew").addEventListener("click", (e) => { e.preventDefault(); openAdd(); });
    document.getElementById("btnAddFromTable").addEventListener("click", openAdd);
    document.getElementById("btnBack").addEventListener("click", showTable);
    document.getElementById("btnCancel").addEventListener("click", showTable);
    document.getElementById("btnCancelDelete").addEventListener("click", () => { deleteModal.style.display = "none"; });
    document.getElementById("btnConfirmDelete").addEventListener("click", confirmDelete);

    searchInput.addEventListener("input", renderTable);

    // ── Init ──
    fetchStudents();

    // ── Fetch all students ──
    async function fetchStudents() {
        try {
            const res = await fetch(API_BASE);
            if (!res.ok) throw new Error("Failed to load students");
            students = await res.json();
            updateStats();
            renderTable();
        } catch (err) {
            console.error(err);
        }
    }

    // ── Stats ──
    function updateStats() {
        statTotal.textContent = students.length;
        statHostels.textContent = new Set(students.map((s) => s.hostelName)).size;
        statBranches.textContent = new Set(students.map((s) => s.branch)).size;
    }

    // ── Render table ──
    function renderTable() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = query
            ? students.filter((s) =>
                s.name.toLowerCase().includes(query) ||
                s.rollNumber.toLowerCase().includes(query) ||
                (s.branch || "").toLowerCase().includes(query)
            )
            : students;

        if (filtered.length === 0) {
            masterBody.innerHTML = "";
            noResults.style.display = "block";
            return;
        }

        noResults.style.display = "none";
        masterBody.innerHTML = filtered
            .map((s) => `
                <tr>
                    <td><span class="roll-badge">${esc(s.rollNumber)}</span></td>
                    <td>${esc(s.name)}</td>
                    <td>${s.year}</td>
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

        // Bind edit/delete buttons
        masterBody.querySelectorAll(".btn-edit").forEach((btn) => {
            btn.addEventListener("click", () => openEdit(btn.dataset.roll));
        });
        masterBody.querySelectorAll(".btn-delete").forEach((btn) => {
            btn.addEventListener("click", () => openDeleteConfirm(btn.dataset.roll));
        });
    }

    // ── Show Table ──
    function showTable() {
        formView.style.display = "none";
        tableView.style.display = "block";
        deleteModal.style.display = "none";
        setActiveNav("navStudents");
        fetchStudents();
    }

    // ── Open Add ──
    function openAdd() {
        editingRoll = null;
        formTitle.textContent = "Add New Student";
        studentForm.reset();
        clearErrors();
        document.getElementById("fRollNumber").disabled = false;
        tableView.style.display = "none";
        formView.style.display = "block";
        setActiveNav("navAddNew");
    }

    // ── Open Edit ──
    function openEdit(rollNumber) {
        const student = students.find((s) => s.rollNumber === rollNumber);
        if (!student) return;

        editingRoll = rollNumber;
        formTitle.textContent = `Edit Student – ${rollNumber}`;
        clearErrors();

        // Populate form fields
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

        document.getElementById("fRollNumber").disabled = true;
        tableView.style.display = "none";
        formView.style.display = "block";
        setActiveNav("navStudents");
    }

    // ── Form submit ──
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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });

            const json = await res.json();
            if (!res.ok) {
                showFormError(json.error || "Server error");
                return;
            }

            showFormSuccess(editingRoll ? "Student updated successfully!" : "Student added successfully!");
            setTimeout(() => showTable(), 1200);
        } catch (err) {
            showFormError("Network error. Please try again.");
        }
    });

    // ── Delete ──
    let pendingDeleteRoll = null;

    function openDeleteConfirm(rollNumber) {
        pendingDeleteRoll = rollNumber;
        deleteRollLabel.textContent = rollNumber;
        deleteModal.style.display = "flex";
    }

    async function confirmDelete() {
        if (!pendingDeleteRoll) return;
        try {
            const res = await fetch(`${API_BASE}/${encodeURIComponent(pendingDeleteRoll)}`, { method: "DELETE" });
            const json = await res.json();
            if (!res.ok) {
                alert(json.error || "Failed to delete");
                return;
            }
            deleteModal.style.display = "none";
            pendingDeleteRoll = null;
            fetchStudents();
        } catch (err) {
            alert("Network error");
        }
    }

    // ── Validation ──
    const PHONE_RE   = /^\d{10,15}$/;
    const IFSC_RE    = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
    const ACCOUNT_RE = /^\d{6,18}$/;
    const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

        return errors;
    }

    // ── Helpers ──
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
        // Coerce year/semester to numbers
        if (data.year) data.year = Number(data.year);
        if (data.semester) data.semester = Number(data.semester);
        return data;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function esc(str) {
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    function setFieldError(id, msg) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg;
    }

    function clearErrors() {
        document.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
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
        document.getElementById(id)?.classList.add("active");
    }
})();
