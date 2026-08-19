const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مطلوبان عند استخدام Supabase.');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function fail(error) {
  if (error) throw error;
}

async function insertVerificationAttempt(serialNumber, idNumber, status) {
  const { error } = await supabase.from('verification_attempts').insert({
    serial_number: serialNumber,
    id_number: idNumber,
    status
  });
  fail(error);
}

async function findDocument(serialNumber, idNumber) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('serial_number', serialNumber)
    .eq('id_number', idNumber)
    .eq('status', 'active')
    .maybeSingle();
  fail(error);
  return data;
}

async function insertDocument(document) {
  const { data, error } = await supabase
    .from('documents')
    .insert(document)
    .select('id')
    .single();
  fail(error);
  return data;
}

async function listDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('id, serial_number, id_number, document_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  fail(error);
  return data;
}

async function getDocument(id) {
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  fail(error);
  return data;
}

async function deleteDocument(id) {
  const { error } = await supabase.from('documents').delete().eq('id', id);
  fail(error);
}

async function uploadFile(file, storagePath) {
  const { error } = await supabase.storage.from(bucketName).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });
  fail(error);
}

async function downloadFile(storagePath) {
  const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
  fail(error);
  return Buffer.from(await data.arrayBuffer());
}

async function removeFile(storagePath) {
  const { error } = await supabase.storage.from(bucketName).remove([storagePath]);
  fail(error);
}

module.exports = {
  bucketName,
  deleteDocument,
  downloadFile,
  findDocument,
  getDocument,
  insertDocument,
  insertVerificationAttempt,
  listDocuments,
  removeFile,
  supabase,
  uploadFile
};
