const fs = require('fs');
const path = require('path');

// Read student_master.json
const studentPath = path.join(__dirname, 'data', 'student_master.json');
const students = JSON.parse(fs.readFileSync(studentPath, 'utf-8'));

// Extract unique Warden IDs and FA IDs
const wardens = new Map();
const fas = new Map();

students.forEach(student => {
    if (student.wardenId && student.warden) {
        wardens.set(student.wardenId, student.warden);
    }
    if (student.faId && student.fa) {
        fas.set(student.faId, student.fa);
    }
});

// Create credentials object
const credentials = {
    wardens: Array.from(wardens).map(([id, name]) => ({
        id,
        name,
        password: "1234",
        role: "warden"
    })),
    fas: Array.from(fas).map(([id, name]) => ({
        id,
        name,
        password: "1234",
        role: "fa"
    }))
};

// Write to credentials.json
const credPath = path.join(__dirname, 'data', 'credentials.json');
fs.writeFileSync(credPath, JSON.stringify(credentials, null, 4));

console.log(`✓ Generated credentials.json`);
console.log(`  - Wardens: ${credentials.wardens.length}`);
console.log(`  - FAs: ${credentials.fas.length}`);
console.log('\nWardens:');
credentials.wardens.forEach(w => console.log(`  ${w.id} → ${w.name}`));
console.log('\nFAs:');
credentials.fas.forEach(f => console.log(`  ${f.id} → ${f.name}`));
