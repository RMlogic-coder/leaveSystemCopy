const fs = require('fs');
const path = require('path');

// Parse CSV manually (simple CSV parser)
function parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }

    return data;
}

// Map CSV row to student_master format
function mapCsvToStudent(csvRow, existingStudent) {
    return {
        rollNumber: csvRow.rollNumber || existingStudent?.rollNumber || '',
        name: csvRow.Name || existingStudent?.name || '',
        fatherName: existingStudent?.fatherName || '',
        motherName: existingStudent?.motherName || '',
        phone: csvRow.Phone || existingStudent?.phone || '',
        fatherPhone: csvRow.fatherPhone || existingStudent?.fatherPhone || '',
        motherPhone: csvRow.motherPhone || existingStudent?.motherPhone || '',
        year: existingStudent?.year || 1,
        semester: existingStudent?.semester || 1,
        hostelName: csvRow['Hostel Name'] || existingStudent?.hostelName || '',
        warden: csvRow['Warden Name'] || existingStudent?.warden || '',
        wardenId: csvRow['Warden ID'] || existingStudent?.wardenId || '',
        fa: csvRow['FA Name'] || existingStudent?.fa || '',
        faId: csvRow['FA ID'] || existingStudent?.faId || '',
        messName: csvRow['Mess Name'] || existingStudent?.messName || '',
        bankName: existingStudent?.bankName || 'SBI',
        accountNumber: csvRow.bankAccountNumber || existingStudent?.accountNumber || '',
        bankAccountNumber: csvRow.bankAccountNumber || existingStudent?.bankAccountNumber || '',
        ifsc: csvRow.bankifsc || existingStudent?.ifsc || '',
        bankIfsc: csvRow.bankifsc || existingStudent?.bankIfsc || '',
        branch: existingStudent?.branch || 'Computer Science',
        roomNumber: existingStudent?.roomNumber || '',
        email: existingStudent?.email || ''
    };
}

// Main function
async function importCSV() {
    try {
        // Read CSV file
        const csvPath = path.join(__dirname, 'final_cleanedCSEFORMAT.csv');
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const csvData = parseCSV(csvContent);
        
        console.log(`✓ Parsed ${csvData.length} records from CSV`);

        // Read existing student_master.json
        const jsonPath = path.join(__dirname, 'data', 'student_master.json');
        const existingData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        
        console.log(`✓ Loaded ${existingData.length} existing records from student_master.json`);

        // Create map of existing students by roll number
        const existingMap = {};
        existingData.forEach(student => {
            existingMap[student.rollNumber] = student;
        });

        // Update and merge
        const updatedData = [];
        const addedRolls = new Set();

        // Update existing students and add new ones from CSV
        csvData.forEach(csvRow => {
            const roll = csvRow.rollNumber;
            const existing = existingMap[roll];
            const updated = mapCsvToStudent(csvRow, existing);
            updatedData.push(updated);
            addedRolls.add(roll);
        });

        // Add any existing students not in CSV (preserve them)
        existingData.forEach(student => {
            if (!addedRolls.has(student.rollNumber)) {
                updatedData.push(student);
            }
        });

        // Sort by roll number
        updatedData.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));

        // Write back to file
        fs.writeFileSync(jsonPath, JSON.stringify(updatedData, null, 4));
        
        console.log(`✓ Updated student_master.json with ${updatedData.length} total records`);
        console.log(`  - Updated/Added from CSV: ${addedRolls.size}`);
        console.log(`  - Preserved existing: ${updatedData.length - addedRolls.size}`);
        console.log('\n✓ Import complete!');

    } catch (err) {
        console.error('Error during import:', err.message);
        process.exit(1);
    }
}

importCSV();
