require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const port = Number(process.env.PORT) || 3000;
const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const dataDirectory = path.join(__dirname, 'data');
const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, 'verification.db');

let db;
let supabaseDb;
if (useSupabase) {
  supabaseDb = require('./supabase-adapter');
} else {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  db = new Database(databasePath);
  db.exec(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
}

async function recordAttempt(serialNumber, idNumber, status) {
  if (useSupabase) return supabaseDb.insertVerificationAttempt(serialNumber, idNumber, status);
  return db.prepare('INSERT INTO verification_attempts (serial_number, id_number, status) VALUES (?, ?, ?)')
    .run(serialNumber, idNumber, status);
}

async function findDocument(serialNumber, idNumber) {
  if (useSupabase) return supabaseDb.findDocument(serialNumber, idNumber);
  return db.prepare('SELECT * FROM documents WHERE serial_number = ? AND id_number = ? AND status = ?')
    .get(serialNumber, idNumber, 'active');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const captchaStore = new Map();
function purgeExpiredCaptchas() {
  const expiresBefore = Date.now() - 10 * 60 * 1000;
  for (const [token, item] of captchaStore) if (item.createdAt < expiresBefore) captchaStore.delete(token);
}

app.get('/api/captcha', (_request, response) => {
  purgeExpiredCaptchas();
  const code = Array.from({ length: 4 }, () => crypto.randomInt(0, 10)).join('');
  const token = crypto.randomUUID();
  captchaStore.set(token, { code, createdAt: Date.now() });
  response.json({ token, code });
});

app.post('/api/verify', async (request, response) => {
  const { serialNumber, idNumber, captcha, captchaToken } = request.body || {};
  const captchaRecord = captchaStore.get(captchaToken);
  const fieldsValid = typeof serialNumber === 'string' && serialNumber.trim() &&
    typeof idNumber === 'string' && idNumber.trim();
  const captchaValid = captchaRecord && typeof captcha === 'string' &&
    captcha.trim().toUpperCase() === captchaRecord.code;
  
  if (!fieldsValid || !captchaValid) {
    // تسجيل محاولة فاشلة
    await recordAttempt(serialNumber || 'unknown', idNumber || 'unknown', 'failed');
    captchaStore.delete(captchaToken);
    
    return response.status(400).json({ ok: false, message: 'يرجى التحقق من البيانات ورمز التحقق.' });
  }
  
  // البحث عن المستند باستخدام الرقم التسلسلي ورقم الهوية
  const document = await findDocument(serialNumber, idNumber);
  
  if (!document) {
    // تسجيل محاولة فاشلة
    await recordAttempt(serialNumber, idNumber, 'failed');
    captchaStore.delete(captchaToken);
    
    return response.status(400).json({ ok: false, message: 'لم يتم العثور على مستند مطابق للبيانات المدخلة.' });
  }
  
  // تسجيل محاولة ناجحة
  await recordAttempt(serialNumber, idNumber, 'success');
  captchaStore.delete(captchaToken);
  
  response.json({ 
    ok: true, 
    message: 'تم التحقق من المستند بنجاح.',
    documentType: document.document_type,
    documentId: document.id,
    fileUrl: document.file_path ? `/api/document/${document.id}` : null,
    mimeType: document.mime_type || null
  });
});

// نقطة نهاية لإضافة مستندات جديدة (للاختبار فقط)
app.post('/api/document', async (request, response) => {
  const { serialNumber, idNumber, documentType } = request.body || {};
  
  if (!serialNumber || !idNumber || !documentType) {
    return response.status(400).json({ ok: false, message: 'جميع الحقول مطلوبة.' });
  }
  
  try {
    if (useSupabase) {
      await supabaseDb.insertDocument({ serial_number: serialNumber, id_number: idNumber, document_type: documentType, status: 'active' });
    } else {
      db.prepare('INSERT INTO documents (serial_number, id_number, document_type, status) VALUES (?, ?, ?, ?)')
        .run(serialNumber, idNumber, documentType, 'active');
    }
    
    response.json({ ok: true, message: 'تمت إضافة المستند بنجاح.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') {
      return response.status(400).json({ ok: false, message: 'الرقم التسلسلي مستخدم بالفعل.' });
    }
    response.status(500).json({ ok: false, message: 'حدث خطأ أثناء إضافة المستند.' });
  }
});

// نقطة نهاية لجلب المستندات (للاختبار فقط)
app.get('/api/documents', async (request, response) => {
  const documents = useSupabase ? await supabaseDb.listDocuments() : db.prepare('SELECT * FROM documents ORDER BY created_at DESC LIMIT 50').all();
  response.json(documents);
});

// إعداد multer لرفع الملفات
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'storage', 'documents');
    console.log('Upload path:', uploadPath);
    console.log('Path exists:', fs.existsSync(uploadPath));
    
    // إنشاء المجلد إذا لم يكن موجوداً
    if (!fs.existsSync(uploadPath)) {
      console.log('Creating upload directory...');
      fs.mkdirSync(uploadPath, { recursive: true });
      console.log('Directory created successfully');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // إنشاء اسم فريد للملف
    const uniqueSuffix = crypto.randomUUID();
    const extension = path.extname(file.originalname);
    const filename = `${uniqueSuffix}${extension}`;
    console.log('Generated filename:', filename);
    cb(null, filename);
  }
});
const storage = useSupabase ? multer.memoryStorage() : localStorage;

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    // التحقق من نوع الملف المسموح به
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مسموح به. يرجى اختيار PDF أو صورة (JPEG/PNG)'), false);
    }
  }
});

// نقطة نهاية لرفع الملفات
app.post('/api/upload', (request, response, next) => {
  upload.single('file')(request, response, (err) => {
    if (err) {
      // معالجة أخطاء multer
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return response.status(400).json({ ok: false, message: 'حجم الملف يتجاوز الحد المسموح به (5MB)' });
        }
        return response.status(400).json({ ok: false, message: `خطأ في رفع الملف: ${err.message}` });
      } else {
        // خطأ عام
        console.error('Upload error:', err);
        return response.status(500).json({ ok: false, message: err.message || 'حدث خطأ أثناء رفع الملف' });
      }
    }
    // إذا لم يكن هناك خطأ، استمر مع معالجة الطلب
    next();
  });
}, async (request, response) => {
  let uploadedStoragePath;
  try {
    console.log('Upload request received');
    console.log('Request file:', request.file);
    console.log('Request body:', request.body);
    
    if (!request.file) {
      return response.status(400).json({ ok: false, message: 'لم يتم رفع أي ملف' });
    }
    
    const { serialNumber, idNumber, documentType } = request.body;
    
    console.log('Form data:', { serialNumber, idNumber, documentType });
    
    if (!serialNumber || !idNumber || !documentType) {
      // حذف الملف إذا كانت البيانات غير مكتملة
      if (!useSupabase) fs.unlinkSync(request.file.path);
      return response.status(400).json({ ok: false, message: 'جميع الحقول مطلوبة' });
    }
    
    console.log('Saving document to database...');
    
    const filePath = useSupabase
      ? `${crypto.randomUUID()}${path.extname(request.file.originalname)}`
      : request.file.path;
    uploadedStoragePath = useSupabase ? filePath : null;
    if (useSupabase) {
      await supabaseDb.uploadFile(request.file, filePath);
      await supabaseDb.insertDocument({
        serial_number: serialNumber,
        id_number: idNumber,
        document_type: documentType,
        file_path: filePath,
        file_size: request.file.size,
        mime_type: request.file.mimetype,
        status: 'active'
      });
    } else {
      db.prepare('INSERT INTO documents (serial_number, id_number, document_type, file_path, file_size, mime_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(serialNumber, idNumber, documentType, filePath, request.file.size, request.file.mimetype, 'active');
    }
    
    console.log('Document saved successfully');
    
    response.json({ 
      ok: true, 
      message: `تم رفع ${documentType} بنجاح!`
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    
    // حذف الملف في حالة حدوث خطأ
    if (!useSupabase && request.file && request.file.path && fs.existsSync(request.file.path)) {
      try {
        fs.unlinkSync(request.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file after upload error:', unlinkError);
      }
    }
    if (useSupabase && uploadedStoragePath) {
      try {
        await supabaseDb.removeFile(uploadedStoragePath);
      } catch (removeError) {
        console.error('Error deleting Supabase file after upload error:', removeError);
      }
    }
    
    response.status(500).json({ ok: false, message: `حدث خطأ أثناء رفع الملف: ${error.message}` });
  }
});

// نقطة نهاية لعرض المستند
app.get('/api/document/:id', async (request, response) => {
  try {
    const document = useSupabase ? await supabaseDb.getDocument(request.params.id) : db.prepare('SELECT * FROM documents WHERE id = ?').get(request.params.id);
    
    if (!document) {
      return response.status(404).json({ ok: false, message: 'المستند غير موجود' });
    }
    
    // التحقق من وجود الملف
    if (!document.file_path || (!useSupabase && !fs.existsSync(document.file_path))) {
      return response.status(404).json({ ok: false, message: 'ملف المستند غير موجود' });
    }
    
    if (useSupabase) {
      const file = await supabaseDb.downloadFile(document.file_path);
      response.type(document.mime_type || 'application/octet-stream').send(file);
    } else {
      response.sendFile(path.resolve(document.file_path));
    }
  } catch (error) {
    console.error('Error retrieving file:', error);
    response.status(500).json({ ok: false, message: 'حدث خطأ أثناء جلب المستند' });
  }
});

// نقطة نهاية لحذف المستند
app.delete('/api/document/:id', async (request, response) => {
  try {
    const document = useSupabase ? await supabaseDb.getDocument(request.params.id) : db.prepare('SELECT * FROM documents WHERE id = ?').get(request.params.id);
    
    if (!document) {
      return response.status(404).json({ ok: false, message: 'المستند غير موجود' });
    }
    
    // حذف الملف إذا كان موجوداً
    if (document.file_path) {
      if (useSupabase) {
        await supabaseDb.removeFile(document.file_path);
      } else if (fs.existsSync(document.file_path)) {
        fs.unlinkSync(document.file_path);
      }
    }
    
    // حذف السجل من قاعدة البيانات
    if (useSupabase) await supabaseDb.deleteDocument(request.params.id);
    else db.prepare('DELETE FROM documents WHERE id = ?').run(request.params.id);
    
    response.json({ ok: true, message: 'تم حذف المستند بنجاح' });
  } catch (error) {
    console.error('Error deleting document:', error);
    response.status(500).json({ ok: false, message: 'حدث خطأ أثناء حذف المستند' });
  }
});

// نقطة نهاية لعرض قائمة المستندات
app.get('/api/documents', async (_request, response) => {
  const documents = useSupabase ? await supabaseDb.listDocuments() : db.prepare('SELECT id, serial_number, id_number, document_type, status, created_at FROM documents ORDER BY created_at DESC LIMIT 50').all();
  response.json(documents);
});

app.get('/api/verification-attempts', async (_request, response) => {
  if (useSupabase) {
    const { data, error } = await supabaseDb.supabase.from('verification_attempts').select('id, status, created_at').order('id', { ascending: false }).limit(50);
    if (error) throw error;
    return response.json(data);
  }
  response.json(db.prepare('SELECT id, status, created_at FROM verification_attempts ORDER BY id DESC LIMIT 50').all());
});

if (require.main === module) {
  app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
}
module.exports = app;
