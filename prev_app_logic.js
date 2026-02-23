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

// ===== Fetch and populate the table =====
document.addEventListener("DOMContentLoaded", function () {
    fetch("/api/student-leaves")
        .then(response => {
            if (!response.ok) throw new Error("Failed to load student leave data");
            return response.json();
        })
        .then(data => {
            const tableBody = document.getElementById("clientTableBody");
            if (!tableBody) return;
            if (!Array.isArray(data)) throw new Error("Invalid leave data payload");
            tableBody.innerHTML = "";

            if (data.length === 0) {
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

            data.forEach((item, index) => {
                if (!item || typeof item !== "object") return;
                const row = document.createElement("tr");

                const isFullyApproved = String(item.status || "").trim().toLowerCase() === "approved";
                const isRejected = String(item.status || "").trim().toLowerCase() === "rejected";
                const totalDays = Number(item.totalDays) || 0;

                let refundAmount = 0;
                let refundStatus = "—";

                if (isFullyApproved) {
                    if (totalDays > 3) {
                        refundAmount = 200 * totalDays;
                        refundStatus = item.refundStatus || "Processing";
                    } else {
                        refundStatus = "No Refund";
                    }
                } else if (isRejected) {
                    refundStatus = "No Refund";
                } else {
                    refundStatus = "Awaiting Approval";
                }

                // Status badge styling
                const statusLower = String(item.status || "").trim().toLowerCase();
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