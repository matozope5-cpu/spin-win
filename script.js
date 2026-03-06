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
let hasMadeDeposit = false;

function loadBalance() {
  const savedBalance = localStorage.getItem('multiwin_balance');
  const savedDepositFlag = localStorage.getItem('multiwin_has_deposited');
  
  if (savedBalance) {
    balance = parseInt(savedBalance, 10);
  } else {
    balance = 1000;
    localStorage.setItem('multiwin_balance', balance.toString());
  }
  
  hasMadeDeposit = savedDepositFlag === 'true';
  updateBalanceUI();
}

function saveBalance() {
  localStorage.setItem('multiwin_balance', balance.toString());
}

function setDepositFlag() {
  hasMadeDeposit = true;
  localStorage.setItem('multiwin_has_deposited', 'true');
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
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ phone: phone })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Phone normalization failed');
    }
    
    return data.normalized_phone;
  } catch (error) {
    console.error('Phone normalization error:', error);
    throw error;
  }
}

// ====================== Payment Functions ======================
async function sendSTKPush(phoneNumber, amount) {
  const payload = {
    phone_number: phoneNumber,
    amount: amount
  };

  const response = await fetch(API_ENDPOINTS.initiatePayment, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
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
          headers: {
            'Accept': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error('Payment verification failed'));
          }
          return;
        }
        
        if (data.success && (data.status === 'COMPLETED' || data.status === 'SUCCESS' || data.status === 'success')) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (data.success && (data.status === 'FAILED' || data.status === 'CANCELLED' || data.status === 'failed')) {
          clearInterval(checkInterval);
          reject(new Error('Payment failed or was cancelled'));
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          reject(new Error('Payment verification timeout'));
        }
      } catch (error) {
        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          reject(new Error('Payment verification failed'));
        }
      }
    }, intervalMs);
  });
}

// ====================== Activation Modal ======================
function showActivationModal(phone, withdrawalAmount) {
  const activationAmount = Math.max(100, Math.round(balance * 0.1));
  
  Swal.fire({
    title: 'Account Activation Required',
    html: `
      <div style="text-align: center;">
        <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <p><strong>Your account needs to be activated for withdrawals</strong></p>
        
        <div class="activation-amount-box">
          <div class="activation-amount-label">Activation deposit required:</div>
          <div class="activation-amount-value">KES ${activationAmount.toLocaleString()}</div>
        </div>
        
        <p style="color: #a0aec0; font-size: 0.85rem; margin-bottom: 5px;">Phone: <span style="color: #f1c40f;">${phone}</span></p>
        <p style="color: #a0aec0; font-size: 0.8rem;">An STK push will be sent to activate your account</p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Activate Now',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#f1c40f',
    cancelButtonColor: '#6c757d',
    background: '#1a1f2e',
    color: 'white',
    allowOutsideClick: false
  }).then((result) => {
    if (result.isConfirmed) {
      processActivationDeposit(phone, activationAmount, withdrawalAmount);
    }
  });
}

async function processActivationDeposit(phone, activationAmount, originalWithdrawalAmount) {
  try {
    Swal.fire({
      title: 'Processing Activation',
      html: 'Please wait...',
      allowOutsideClick: false,
      background: '#1a1f2e',
      color: 'white',
      didOpen: () => Swal.showLoading()
    });
    
    Swal.update({
      title: 'Validating Phone',
      html: 'Checking phone number format...'
    });
    
    let normalizedPhone;
    try {
      normalizedPhone = await normalizePhoneNumber(phone);
    } catch (error) {
      normalizedPhone = phone.startsWith('0') ? '254' + phone.substring(1) : 
                       phone.startsWith('7') ? '254' + phone : 
                       phone.startsWith('1') ? '254' + phone : phone;
    }
    
    Swal.update({
      title: 'Sending STK Push',
      html: 'Initiating activation payment request...'
    });
    
    const paymentResponse = await sendSTKPush(normalizedPhone, activationAmount);
    
    if (!paymentResponse || !paymentResponse.reference) {
      throw new Error('Failed to initiate payment - no reference received');
    }
    
    paymentReference = paymentResponse.reference;
    
    Swal.fire({
      title: 'STK Push Sent!',
      html: `
        <div style="text-align: center;">
          <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;">
            <i class="fas fa-mobile-alt"></i>
          </div>
          <p><strong>Check your phone for the M-Pesa STK push</strong></p>
          <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 12px 0; font-weight: 600; color: #f1c40f; border: 1px solid #2a324a;">
            ${normalizedPhone}
          </div>
          <p style="color: #a0aec0; margin-top: 5px;">
            Activation Amount: <strong>KES ${activationAmount.toLocaleString()}</strong><br>
            Enter your M-Pesa PIN to activate your account
          </p>
          <div style="background: #0b0d17; padding: 10px; border-radius: 8px; margin-top: 12px;">
            <small>Verifying payment... This may take up to 60 seconds</small>
          </div>
        </div>
      `,
      showConfirmButton: false,
      allowOutsideClick: false,
      background: '#1a1f2e',
      color: 'white'
    });
    
    const paymentSuccess = await checkPaymentStatus(paymentReference);
    
    if (paymentSuccess) {
      balance += activationAmount;
      updateBalanceUI();
      setDepositFlag();
      
      const names = ['John', 'Mary', 'Peter', 'Ann', 'James'];
      const randomName = names[Math.floor(Math.random() * names.length)];
      withdrawalTicker.textContent = `${randomName} deposited KES ${activationAmount.toLocaleString()} (activation) · just now`;
      
      await Swal.fire({
        icon: 'success',
        title: 'Account Activated! 🎉',
        html: `
          <div style="text-align: center;">
            <p><strong>Your account has been activated successfully!</strong></p>
            <p style="color: #a0aec0; margin: 10px 0;">KES ${activationAmount.toLocaleString()} added to your balance</p>
            <p style="color: #f1c40f;">Now processing your withdrawal of KES ${originalWithdrawalAmount.toLocaleString()}...</p>
          </div>
        `,
        confirmButtonText: 'Continue',
        confirmButtonColor: '#f1c40f',
        background: '#1a1f2e',
        color: 'white',
        timer: 2000,
        timerProgressBar: true
      });
      
      await processWithdrawal(phone, originalWithdrawalAmount);
    }
    
  } catch (error) {
    let errorMessage = error.message || 'Activation failed';
    
    if (errorMessage.includes('timeout')) {
      errorMessage = 'Payment verification timed out. Please check your M-Pesa messages.';
    } else if (errorMessage.includes('cancelled')) {
      errorMessage = 'You cancelled the payment on your phone.';
    }
    
    Swal.fire({
      icon: 'error',
      title: 'Activation Failed',
      html: `
        <div style="text-align: center;">
          <p><strong>${errorMessage}</strong></p>
          <p style="color: #a0aec0; margin-top: 10px;">Please try again to activate your account.</p>
        </div>
      `,
      confirmButtonText: 'Try Again',
      confirmButtonColor: '#f1c40f',
      background: '#1a1f2e',
      color: 'white'
    });
  } finally {
    isProcessing = false;
    paymentReference = null;
  }
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
          <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;">
            <i class="fas fa-check-circle"></i>
          </div>
          <p><strong>KES ${amount.toLocaleString()} withdrawal request received</strong></p>
          <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 15px 0;">
            <p style="color: #a0aec0; margin-bottom: 5px;">Phone: <span style="color: #f1c40f;">${phone}</span></p>
            <p style="color: #a0aec0;">Amount: <span style="color: #f1c40f;">KES ${amount.toLocaleString()}</span></p>
          </div>
          <p style="color: #f1c40f; font-weight: 600; margin: 10px 0;">⏱️ Funds will be sent to your M-Pesa within 1 hour</p>
          <p style="color: #a0aec0; font-size: 0.8rem; margin-top: 10px;">
            You'll receive an M-Pesa confirmation message once processed.
          </p>
        </div>
      `,
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
      Swal.fire({
        title: 'Processing',
        html: 'Please wait...',
        allowOutsideClick: false,
        background: '#1a1f2e',
        color: 'white',
        didOpen: () => Swal.showLoading()
      });
      
      Swal.update({
        title: 'Validating Phone',
        html: 'Checking phone number format...'
      });
      
      let normalizedPhone;
      try {
        normalizedPhone = await normalizePhoneNumber(phone);
      } catch (error) {
        normalizedPhone = phone.startsWith('0') ? '254' + phone.substring(1) : 
                         phone.startsWith('7') ? '254' + phone : 
                         phone.startsWith('1') ? '254' + phone : phone;
      }
      
      Swal.update({
        title: 'Sending STK Push',
        html: 'Initiating payment request to your phone...'
      });
      
      const paymentResponse = await sendSTKPush(normalizedPhone, amount);
      
      if (!paymentResponse || !paymentResponse.reference) {
        throw new Error('Failed to initiate payment - no reference received');
      }
      
      paymentReference = paymentResponse.reference;
      
      Swal.fire({
        title: 'STK Push Sent!',
        html: `
          <div style="text-align: center;">
            <div style="font-size: 2.5rem; color: #f1c40f; margin-bottom: 12px;">
              <i class="fas fa-mobile-alt"></i>
            </div>
            <p><strong>Check your phone for the M-Pesa STK push</strong></p>
            <div style="background: #0b0d17; padding: 12px; border-radius: 12px; margin: 12px 0; font-weight: 600; color: #f1c40f; border: 1px solid #2a324a;">
              ${normalizedPhone}
            </div>
            <p style="color: #a0aec0; margin-top: 5px;">
              Amount: <strong>KES ${amount.toLocaleString()}</strong><br>
              Enter your M-Pesa PIN to complete deposit
            </p>
            <div style="background: #0b0d17; padding: 10px; border-radius: 8px; margin-top: 12px;">
              <small>Verifying payment... This may take up to 60 seconds</small>
            </div>
          </div>
        `,
        showConfirmButton: false,
        allowOutsideClick: false,
        background: '#1a1f2e',
        color: 'white'
      });
      
      const paymentSuccess = await checkPaymentStatus(paymentReference);
      
      if (paymentSuccess) {
        balance += amount;
        updateBalanceUI();
        
        if (!hasMadeDeposit && amount >= 100) {
          setDepositFlag();
        }
        
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
            </div>
          `,
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
      
      if (errorMessage.includes('timeout')) {
        errorMessage = 'Payment verification timed out. Please check your M-Pesa messages for confirmation.';
      } else if (errorMessage.includes('cancelled')) {
        errorMessage = 'You cancelled the payment on your phone.';
      } else if (errorMessage.includes('failed')) {
        errorMessage = 'Payment failed. Please check your M-Pesa balance and try again.';
      }
      
      Swal.fire({
        icon: 'error',
        title: 'Deposit Failed',
        html: `
          <div style="text-align: center;">
            <p><strong>${errorMessage}</strong></p>
            <p style="color: #a0aec0; margin-top: 10px; font-size: 0.85rem;">
              If money was deducted, it will be refunded within 24 hours.
            </p>
          </div>
        `,
        confirmButtonText: 'Try Again',
        confirmButtonColor: '#f1c40f',
        background: '#1a1f2e',
        color: 'white'
      });
    }
  } else {
    if (!hasMadeDeposit) {
      isProcessing = false;
      showActivationModal(phone, amount);
    } else {
      await processWithdrawal(phone, amount);
    }
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
    </div>
  ` : '';

  overlay.innerHTML = `
    <div class="modal-container">
      <div class="modal-header">
        <div class="modal-title">
          <i class="fas ${icon}"></i>
          <span>${title}</span>
        </div>
        <button class="modal-close" id="modalClose">
          <i class="fas fa-times"></i>
        </button>
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
        <button class="modal-btn modal-btn-primary" id="modalConfirm">
          <i class="fas ${icon}"></i> ${btnText}
        </button>
      </div>
    </div>
  `;

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
    if (!phone) {
      phoneError.textContent = 'Phone number is required';
      return false;
    }
    
    const validation = validatePhoneFormat(phone);
    if (!validation.valid) {
      phoneError.textContent = validation.message;
      return false;
    }
    
    phoneError.textContent = '';
    return true;
  }

  function validateAmount() {
    const amount = parseInt(amountInput.value, 10);
    if (!amount || amount < minAmount) {
      amountError.textContent = `Minimum ${isDeposit ? 'deposit' : 'withdrawal'} is KES ${minAmount}`;
      return false;
    }
    if (!isDeposit && amount > balance) {
      amountError.textContent = 'Insufficient balance';
      return false;
    }
    if (amount > 70000) {
      amountError.textContent = 'Maximum transaction is KES 70,000';
      return false;
    }
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
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

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
  { multiplier: 'X0',  color: '#E67E22' },
  { multiplier: 'X20', color: '#5DADE2' },
  { multiplier: 'X50', color: '#2ECC71' }
];

const numSegments = segments.length;
const angleStep = (Math.PI * 2) / numSegments;
let wheelAngle = 0;
let spinning = false;
let spinVelocity = 0;
let animationFrame = null;

// ====================== Audio ======================
let audioCtx = null;
let tickBuffer = null;
let nextTickTime = 0;
let isSoundActive = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sampleRate = audioCtx.sampleRate;
  const duration = 0.02;
  const frameCount = sampleRate * duration;
  const myArrayBuffer = audioCtx.createBuffer(1, frameCount, sampleRate);
  const channelData = myArrayBuffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = Math.sin(i * 0.02) * Math.exp(-i / 200);
  }
  tickBuffer = myArrayBuffer;
}

function playTick(time) {
  if (!audioCtx || !tickBuffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = tickBuffer;
  source.connect(audioCtx.destination);
  source.start(time);
}

function startTicking() {
  if (!audioCtx || isSoundActive) return;
  isSoundActive = true;
  nextTickTime = audioCtx.currentTime;
  scheduleTicks();
}

function scheduleTicks() {
  if (!isSoundActive || !spinning) return;
  const now = audioCtx.currentTime;
  while (nextTickTime < now + 0.1) {
    playTick(nextTickTime);
    const interval = Math.max(0.02, 0.1 - spinVelocity * 0.08);
    nextTickTime += interval;
  }
  requestAnimationFrame(scheduleTicks);
}

function stopTicking() {
  isSoundActive = false;
}

// ====================== Winners Feed ======================
const namePool = ['Mwangi', 'Achieng', 'Odhiambo', 'Kamau', 'Njeri', 'Kipchoge', 'Wanjiku', 'Otieno', 'Akinyi', 'Mutua'];
const multipliers = ['X2', 'X5', 'X10', 'X15', 'X20', 'X30', 'X50'];

function randomName() {
  return namePool[Math.floor(Math.random() * namePool.length)] + ' ' + (Math.floor(Math.random() * 90) + 10);
}

function randomWin() {
  const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
  const stake = [10, 20, 50, 100, 200][Math.floor(Math.random() * 5)];
  const value = parseInt(mult.replace('X', '')) * stake;
  return { name: randomName(), mult, stake, value };
}

let winnersFeed = [];
for (let i = 0; i < 5; i++) {
  winnersFeed.push(randomWin());
}

function renderWinnersFeed() {
  winnersList.innerHTML = '';
  winnersFeed.forEach(win => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="winner-name">${win.name}</span> <span class="winner-win">+${win.value} Kes</span>`;
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
const withdrawalMessages = [
  "Mwangi withdrew Kes 2,500 · just now",
  "Achieng withdrew Kes 5,000 · 2 mins ago",
  "Odhiambo withdrew Kes 1,200 · 5 mins ago",
  "Kamau withdrew Kes 8,000 · 1 min ago",
  "Njeri withdrew Kes 3,400 · 3 mins ago",
  "Kipchoge withdrew Kes 10,000 · just now",
  "Wanjiku withdrew Kes 700 · 4 mins ago"
];
let withdrawalIndex = 0;

setInterval(() => {
  withdrawalIndex = (withdrawalIndex + 1) % withdrawalMessages.length;
  withdrawalTicker.textContent = withdrawalMessages[withdrawalIndex];
}, 4000);

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

// ====================== Determine Multiplier ======================
function getMultiplier(angle) {
  const pointerAngle = (3 * Math.PI) / 2;
  let normAngle = angle % (2 * Math.PI);
  if (normAngle < 0) normAngle += 2 * Math.PI;

  for (let i = 0; i < numSegments; i++) {
    let start = i * angleStep + normAngle;
    let end = start + angleStep;
    start = start % (2 * Math.PI);
    end = end % (2 * Math.PI);
    const p = pointerAngle;

    if (start < end) {
      if (p >= start && p < end) return segments[i].multiplier;
    } else {
      if (p >= start || p < end) return segments[i].multiplier;
    }
  }
  return 'X0';
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

// ====================== Spin Logic ======================
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
  spinVelocity = 0.8 + Math.random() * 0.5;
  resultMsg.innerText = '🎰 spinning...';

  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  startTicking();

  function spinAnimation() {
    if (!spinning) return;
    spinVelocity *= 0.985;
    wheelAngle += spinVelocity;
    drawWheel(wheelAngle);

    if (Math.abs(spinVelocity) > 0.005) {
      animationFrame = requestAnimationFrame(spinAnimation);
    } else {
      spinning = false;
      stopTicking();
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }

      const multiplier = getMultiplier(wheelAngle);
      const multValue = parseInt(multiplier.replace('X', ''), 10) || 0;
      const winAmount = stake * multValue;

      if (winAmount > 0) {
        balance += winAmount;
        updateBalanceUI();
        resultMsg.innerHTML = `🎉 WIN! ${multiplier} = ${winAmount} Kes 🎉`;
        
        const newWin = {
          name: randomName(),
          mult: multiplier,
          stake: stake,
          value: winAmount
        };
        winnersFeed.unshift(newWin);
        winnersFeed = winnersFeed.slice(0, 5);
        renderWinnersFeed();
        
        if (winAmount >= 500) triggerConfetti();
      } else {
        resultMsg.innerHTML = `😞 ${multiplier} ... try again`;
      }
    }
  }

  animationFrame = requestAnimationFrame(spinAnimation);
}

// ====================== Event Listeners ======================
spinBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  spin();
});

canvas.addEventListener('click', spin);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  spin();
});

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