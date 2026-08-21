const form = document.querySelector('#verification-form');
const canvas = document.querySelector('#captcha');
const context = canvas.getContext('2d');
const refreshButton = document.querySelector('#refresh-captcha');
const message = document.querySelector('#message');
const documentResult = document.querySelector('#document-result');
const documentLink = document.querySelector('#document-link');
const serialInput = document.querySelector('#serial-number');
const idInput = document.querySelector('#id-number');
const continueBtn = document.querySelector('#continue');
let captchaToken = '';

function drawCaptcha(code) {
  const { width, height } = canvas;
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);

  // White noise gives the same grainy, scanned look as the supplied captcha.
  for (let i = 0; i < 190; i++) {
    context.fillStyle = Math.random() > .35 ? 'rgba(255,255,255,.72)' : 'rgba(160,160,160,.62)';
    const size = Math.random() > .92 ? 2 : 1;
    context.fillRect(Math.random() * width, Math.random() * height, size, size);
  }

  context.save();
  context.font = 'italic 900 44px "Arial Black", Arial, sans-serif';
  context.textBaseline = 'middle';
  const characterGap = 53;
  const textStart = width - ((code.length - 1) * characterGap) - 37;
  [...code].forEach((letter, index) => {
    const x = textStart + index * characterGap;
    context.save();
    context.translate(x, 21 + (Math.random() - .5) * 7);
    context.rotate((Math.random() - .5) * .42);
    context.scale(.94, 1 + (Math.random() - .5) * .17);
    context.fillStyle = index % 2 ? '#e4e4e4' : '#fff';
    context.fillText(letter, 0, 1);
    context.restore();
  });

  // Keep the interference subtle: only short marks, never full-width strokes.
  context.lineCap = 'round';
  for (let i = 0; i < 20; i++) {
    context.beginPath();
    context.strokeStyle = i % 2 ? 'rgba(255,255,255,.64)' : 'rgba(178,178,178,.58)';
    context.lineWidth = 1;
    const startX = Math.random() * width;
    const startY = Math.random() * height;
    context.moveTo(startX, startY);
    context.lineTo(startX + (Math.random() - .5) * 15, startY + (Math.random() - .5) * 8);
    context.stroke();
  }
  context.restore();
}

async function refreshCaptcha() {
  message.className = 'message'; message.textContent = '';
  const response = await fetch('/api/captcha'); const captcha = await response.json();
  captchaToken = captcha.token; drawCaptcha(captcha.code);
}
function showMessage(text, success = false) { message.textContent = text; message.className = `message visible${success ? ' success' : ''}`; }
function clearDocumentResult() {
  documentResult.hidden = true;
  documentLink.removeAttribute('href');
}
function showDocumentResult(result) {
  if (!result.fileUrl) return;
  documentResult.hidden = false;
  documentLink.href = result.fileUrl;
}

// تحديث لون زر استمرار بناءً على تعبئة الحقول
function checkInputs() {
  if (serialInput.value.trim() !== '' && idInput.value.trim() !== '') {
    continueBtn.classList.add('active');
  } else {
    continueBtn.classList.remove('active');
  }
}
serialInput.addEventListener('input', checkInputs);
idInput.addEventListener('input', checkInputs);

refreshButton.addEventListener('click', refreshCaptcha);
document.querySelector('#cancel').addEventListener('click', () => { form.reset(); clearDocumentResult(); showMessage(''); refreshCaptcha(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const serialNumber = document.querySelector('#serial-number').value;
  const idNumber = document.querySelector('#id-number').value;
  const captcha = document.querySelector('#captcha-input').value;
  try {
    const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serialNumber, idNumber, captcha, captchaToken }) });
    const result = await response.json(); 
    
    if (response.ok) {
      // عرض نوع المستند عند التحقق الناجح
      const documentType = result.documentType || 'مستند غير محدد';
      showMessage(`${result.message} (نوع المستند: ${documentType})`, true);
      showDocumentResult(result);
      form.reset();
    } else {
      showMessage(result.message, false);
    }
    
    refreshCaptcha();
  } catch { showMessage('تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'); }
});
refreshCaptcha();
