const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// مسار قاعدة البيانات
const dataDirectory = path.join(__dirname, 'data');
const databasePath = path.join(dataDirectory, 'verification.db');

// إنشاء مجلد البيانات إذا لم يكن موجوداً
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

// الاتصال بقاعدة البيانات
const db = new Database(databasePath);

// قراءة وتنفيذ ملف schema.sql
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// إضافة بعض البيانات التجريبية
try {
  // إضافة مستندات تجريبية
  db.prepare('INSERT INTO documents (serial_number, id_number, document_type, status) VALUES (?, ?, ?, ?)')
    .run('DOC001', '1234567890', 'جواسه', 'active');

  db.prepare('INSERT INTO documents (serial_number, id_number, document_type, status) VALUES (?, ?, ?, ?)')
    .run('DOC002', '9876543210', 'بطاقة هوية', 'active');

  db.prepare('INSERT INTO documents (serial_number, id_number, document_type, status) VALUES (?, ?, ?, ?)')
    .run('DOC003', '5555555555', 'جواز سفر', 'active');

  console.log('تمت إضافة البيانات التجريبية بنجاح');
} catch (error) {
  console.error('خطأ في إضافة البيانات التجريبية:', error.message);
}

// إغلاق الاتصال بقاعدة البيانات
db.close();
