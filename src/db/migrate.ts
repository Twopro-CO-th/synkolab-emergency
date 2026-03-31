import { getDb, closeDb } from './index.js';

console.log('Running database migration...');
const db = getDb();
console.log(`Database ready at: ${db.name}`);
console.log('Tables created successfully.');
closeDb();
