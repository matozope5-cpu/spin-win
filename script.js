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
let balance = 1000;

// ====================== Audio (same as before) ======================
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

// ====================== Winners Feed (Dynamic, 5 items) ======================
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

// Initialize the winners feed with 5 random entries
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

// Update the feed every 5 seconds: add new winner, remove oldest
setInterval(() => {
  const newWin = randomWin();
  winnersFeed.unshift(newWin);
  winnersFeed = winnersFeed.slice(0, 5); // keep only 5
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

// ====================== Balance & Stake ======================
function updateBalanceUI() {
  balanceSpan.innerText = balance;
  const maxStake = Math.min(balance, 10000);
  stakeInput.max = maxStake;
  if (parseInt(stakeInput.value) > maxStake) stakeInput.value = maxStake;
}

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
        resultMsg.innerHTML = `🎉 WIN! ${multiplier} = ${winAmount} Kes 🎉`;
        // Add to winners feed
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
      updateBalanceUI();
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

// Initial render
drawWheel(wheelAngle);
updateBalanceUI();
renderWinnersFeed();

// Resize confetti canvas on window resize
window.addEventListener('resize', () => {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
});

// ====================== Deposit / Withdraw Buttons ======================
const depositBtn = document.getElementById('depositBtn');
const withdrawBtn = document.getElementById('withdrawBtn');

if (depositBtn) {
  depositBtn.addEventListener('click', () => {
    // For now, show a simple prompt – replace with actual payment flow
    const amount = prompt('Enter amount to deposit (Kes):', '100');
    if (amount && !isNaN(amount) && Number(amount) > 0) {
      balance += Number(amount);
      updateBalanceUI();
      // Show success message
      Swal.fire({
        icon: 'success',
        title: 'Deposit Successful',
        text: `Kes ${amount} has been added to your balance.`,
        timer: 2000,
        showConfirmButton: false
      }).catch(() => {}); // ignore if Swal not defined
    }
  });
}

if (withdrawBtn) {
  withdrawBtn.addEventListener('click', () => {
    const amount = prompt('Enter amount to withdraw (Kes):', '100');
    if (amount && !isNaN(amount) && Number(amount) > 0) {
      if (Number(amount) > balance) {
        alert('Insufficient balance!');
        return;
      }
      balance -= Number(amount);
      updateBalanceUI();
      // Add to withdrawal ticker
      const name = 'User ' + Math.floor(Math.random() * 100);
      const msg = `${name} withdrew Kes ${amount} · just now`;
      document.getElementById('withdrawal-ticker').textContent = msg;
      // Show success
      Swal.fire({
        icon: 'success',
        title: 'Withdrawal Initiated',
        text: `Kes ${amount} will be sent to your M-Pesa shortly.`,
        timer: 2000,
        showConfirmButton: false
      }).catch(() => {});
    }
  });
}