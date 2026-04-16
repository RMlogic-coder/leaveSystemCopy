// ===== Sidebar Toggle =====
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

let currentConstraints = { minDaysForRefund: 3, amountPerDay: 200 };
let isLoading = false;

function apiHeaders() {
    const headers = { "Content-Type": "application/json" };
    const apiKey = String(sessionStorage.getItem("apiAccessKey") || localStorage.getItem("apiAccessKey") || "change-me").trim();
    headers["x-user-role"] = "mess";
    if (apiKey) headers["x-api-key"] = apiKey;
    return headers;
}

function showMessage(message, isError = false) {
    const msgEl = document.getElementById("settingsMessage");
    if (!msgEl) return;
    msgEl.textContent = message;
    msgEl.style.background = isError ? "#f8d7da" : "#d4edda";
    msgEl.style.color = isError ? "#721c24" : "#155724";
    msgEl.style.border = `1px solid ${isError ? "#f5c6cb" : "#c3e6cb"}`;
    msgEl.style.display = "block";
    
    if (!isError) {
        setTimeout(() => {
            msgEl.style.display = "none";
        }, 3000);
    }
}

function loadConstraints() {
    fetch("/api/mess-constraints", { headers: apiHeaders() })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            currentConstraints = data || { minDaysForRefund: 3, amountPerDay: 200 };
            populateForm();
        })
        .catch(err => {
            console.error("Error loading constraints:", err);
            currentConstraints = { minDaysForRefund: 3, amountPerDay: 200 };
            populateForm();
            showMessage("Could not load settings from server (using defaults)", true);
        });
}

function populateForm() {
    const minDaysInput = document.getElementById("minDaysInput");
    const amountInput = document.getElementById("amountPerDayInput");

    if (minDaysInput) minDaysInput.value = currentConstraints.minDaysForRefund || 3;
    if (amountInput) amountInput.value = currentConstraints.amountPerDay || 200;
}

function resetForm() {
    populateForm();
    showMessage("Form reset to current settings", false);
}

function saveSettings() {
    if (isLoading) return;

    const minDaysInput = document.getElementById("minDaysInput");
    const amountInput = document.getElementById("amountPerDayInput");

    if (!minDaysInput || !amountInput) return;

    const minDays = Number(minDaysInput.value);
    const amount = Number(amountInput.value);

    const errors = [];
    if (!Number.isFinite(minDays) || minDays < 0) {
        errors.push("Minimum days must be a non-negative number");
    }
    if (!Number.isFinite(amount) || amount < 0) {
        errors.push("Amount per day must be a non-negative number");
    }

    if (errors.length > 0) {
        showMessage(errors.join("; "), true);
        return;
    }

    isLoading = true;
    const saveBtn = document.getElementById("saveSettingsBtn");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    setTimeout(() => {
        fetch("/api/mess-constraints", {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({
                minDaysForRefund: minDays,
                amountPerDay: amount
            })
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                currentConstraints = data.data || { minDaysForRefund: minDays, amountPerDay: amount };
                showMessage(`✓ Settings saved successfully! Min Days: ${minDays}, Amount/Day: ₹${amount}`, false);
            })
            .catch(err => {
                console.error("Error saving settings:", err);
                showMessage(`Failed to save settings: ${err.message}`, true);
            })
            .finally(() => {
                isLoading = false;
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save Settings";
                }
            });
    }, 300);
}

// Load settings on page load
document.addEventListener("DOMContentLoaded", function () {
    loadConstraints();
});
