require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./supabase-adapter');

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'verification.db');
const db = new Database(databasePath, { readonly: true });
const documents = db.prepare('SELECT * FROM documents ORDER BY id').all();

(async () => {
  let migrated = 0;
  for (const document of documents) {
    const sourcePath = document.file_path && path.resolve(document.file_path);
    const storagePath = document.file_path && `${crypto.randomUUID()}${path.extname(document.file_path)}`;

    try {
      if (sourcePath && fs.existsSync(sourcePath)) {
        await supabase.uploadFile({
          buffer: fs.readFileSync(sourcePath),
          mimetype: document.mime_type || 'application/octet-stream'
        }, storagePath);
      }

      await supabase.insertDocument({
        serial_number: document.serial_number,
        id_number: document.id_number,
        document_type: document.document_type,
        file_path: storagePath || null,
        file_size: document.file_size || null,
        mime_type: document.mime_type || null,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at
      });
      migrated += 1;
      console.log(`Migrated document ${document.serial_number}`);
    } catch (error) {
      console.error(`Failed to migrate ${document.serial_number}:`, error.message);
    }
  }

  const attempts = db.prepare('SELECT serial_number, id_number, status, created_at FROM verification_attempts ORDER BY id').all();
  for (const attempt of attempts) {
    await supabase.supabase.from('verification_attempts').insert(attempt);
  }

  db.close();
  console.log(`Migration complete: ${migrated}/${documents.length} documents.`);
})().catch(error => {
  db.close();
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
