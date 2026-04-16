const { Pool } = require('pg');
const fs = require('fs');

// 🔌 DB CONNECTION
const pool = new Pool({
    user: 'ryanmanchanda',
    host: 'localhost',
    database: 'ryanmanchanda',
    password: 'r2417@2007',
    port: 5432
});

async function importData() {
    const data = JSON.parse(fs.readFileSync('student.json', 'utf-8'));

    for (const s of data) {
        try {
            // 🏢 1. Insert Hostel
            await pool.query(
                `INSERT INTO hostels (name)
                 VALUES ($1)
                 ON CONFLICT (name) DO NOTHING`,
                [s.hostelName]
            );

            // 👮 2. Insert Warden
            await pool.query(
                `INSERT INTO wardens (name, warden_code, hostel_id)
                 SELECT $1, $2, id FROM hostels WHERE name=$3
                 ON CONFLICT (warden_code) DO NOTHING`,
                [s.warden, s.wardenId, s.hostelName]
            );

            // 👨‍🏫 3. Insert FA
            await pool.query(
                `INSERT INTO faculty_advisors (name, fa_code)
                 VALUES ($1, $2)
                 ON CONFLICT (fa_code) DO NOTHING`,
                [s.fa, s.faId]
            );

            // 🧑‍🎓 4. Insert Student
            await pool.query(
                `INSERT INTO students (
                    roll_number, name, father_name, mother_name,
                    phone, father_phone, mother_phone,
                    email, year, semester,
                    branch, room_number,
                    hostel_id, fa_id
                )
                VALUES (
                    $1,$2,$3,$4,
                    $5,$6,$7,
                    $8,$9,$10,
                    $11,$12,
                    (SELECT id FROM hostels WHERE name=$13),
                    (SELECT id FROM faculty_advisors WHERE fa_code=$14)
                )
                ON CONFLICT (roll_number) DO NOTHING`,
                [
                    s.rollNumber, s.name, s.fatherName, s.motherName,
                    s.phone, s.fatherPhone, s.motherPhone,
                    s.email, s.year, s.semester,
                    s.branch, s.roomNumber,
                    s.hostelName, s.faId
                ]
            );

            // 🏦 5. Insert Bank Details
            await pool.query(
                `INSERT INTO bank_details (student_id, bank_name, account_number, ifsc)
                 SELECT id, $1, $2, $3 FROM students WHERE roll_number=$4
                 ON CONFLICT DO NOTHING`,
                [
                    s.bankName,
                    s.accountNumber,
                    s.ifsc,
                    s.rollNumber
                ]
            );

            console.log(`✅ Inserted: ${s.rollNumber}`);

        } catch (err) {
            console.error(`❌ Error for ${s.rollNumber}:`, err.message);
        }
    }

    await pool.end();
    console.log("🎉 Import Complete!");
}

importData();