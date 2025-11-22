import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, GoogleAuthProvider, signInWithPopup, getAdditionalUserInfo,
    setPersistence, browserLocalPersistence 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCb3csf_fKDif-PwQXfTf6P_aolbK4Dm3Y",
    authDomain: "primegame-7cea1.firebaseapp.com",
    projectId: "primegame-7cea1",
    storageBucket: "primegame-7cea1.firebasestorage.app",
    messagingSenderId: "369035051769",
    appId: "1:369035051769:web:c72189abab203fdb8c1828",
    measurementId: "G-5M3FP43V2Q"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const API_URL = ''; 

// --- CONSTANTES ---
const EXCHANGE_RATE = 1000; // 1 BRL = 1000 GC

setPersistence(auth, browserLocalPersistence).catch(console.error);

const appState = {
    currentAuthPage: 'landing-page',
    currentAppPage: null,
    wallet: 0.00,
    bonus_wallet: 0.00,
    rollover_target: 0.00,
    connectedAccounts: {},
    currentGame: null,
    betSlip: [],
    currentUser: null,
    isRegistering: false,
    kycData: { fullname: '', cpf: '', birthdate: '', kyc_status: 'pending' },
    currentBetLimit: 3.00 * EXCHANGE_RATE,
    myReferralCode: ''
};

// ==================================================
// 1. FUNÇÕES AUXILIARES (UI & API)
// ==================================================

function toggleLoading(prefix, show) {
    const loader = document.getElementById(`${prefix}-loader`);
    const text = document.getElementById(`${prefix}-btn-text`);
    if (show) { 
        if(loader) loader.classList.remove('hidden'); 
        if(text) text.classList.add('hidden'); 
    } else { 
        if(loader) loader.classList.add('hidden'); 
        if(text) text.classList.remove('hidden'); 
    }
}

function toggleError(prefix, msg) {
    const el = document.getElementById(`${prefix}-error-msg`);
    if (msg) { 
        if(el) {
            el.textContent = msg; 
            el.classList.remove('hidden'); 
        }
    } else { 
        if(el) el.classList.add('hidden'); 
    }
}

function showRegisterError(msg) { toggleError('register', msg); }

function showMessage(msg, type) {
    const m = document.getElementById('message-modal');
    const c = document.getElementById('message-modal-content');
    if(!m || !c) return;

    c.textContent = msg;
    const bgClass = type === 'success' ? 'bg-green-600/90' : 'bg-red-600/90';
    c.className = `inline-block px-6 py-3 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] font-bold text-sm border border-white/10 backdrop-blur-xl transform transition-all duration-300 text-white ${bgClass}`;
    
    m.classList.remove('hidden');
    setTimeout(() => { c.classList.remove('scale-95', 'opacity-0'); }, 10);
    setTimeout(() => {
        c.classList.add('scale-95', 'opacity-0');
        setTimeout(() => m.classList.add('hidden'), 300);
    }, 3000);
}

function showError(msg) { showMessage(msg, 'error'); }

async function fetchWithAuth(endpoint, options = {}) {
    if (!appState.currentUser) {
        // Se não tiver usuário, tenta pegar do auth direto antes de falhar
        if (auth.currentUser) appState.currentUser = auth.currentUser;
        else throw new Error("Aguardando autenticação...");
    }
    
    let idToken = await appState.currentUser.getIdToken();
    options.headers = { ...options.headers, 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    
    let response = await fetch(`${API_URL}${endpoint}`, options);
    
    if (response.status === 401) {
        try {
            idToken = await appState.currentUser.getIdToken(true);
            options.headers['Authorization'] = `Bearer ${idToken}`;
            response = await fetch(`${API_URL}${endpoint}`, options);
        } catch (e) { throw new Error("Sessão expirada."); }
    }

    if (!response.ok) {
        try {
            const data = await response.json();
            throw new Error(data.detail || data.error || `Erro ${response.status}`);
        } catch (e) { throw new Error(e.message || `Erro ${response.status}`); }
    }
    return response.json();
}

// ==================================================
// 2. FUNÇÕES DE LÓGICA (Ações do Usuário)
// ==================================================

async function handleLogin(e) {
    e.preventDefault();
    toggleLoading('login', true);
    try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch (error) {
        toggleError('login', 'Credenciais inválidas.');
        toggleLoading('login', false);
    }
}

async function handleGoogleLogin() {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const res = await signInWithPopup(auth, new GoogleAuthProvider());
        if (getAdditionalUserInfo(res).isNewUser) {
            appState.currentUser = res.user;
            await fetchWithAuth('/api/init-user', { 
                method: 'POST', 
                body: JSON.stringify({ email: res.user.email, fullname: res.user.displayName || '' }) 
            }).catch(console.error);
        }
    } catch (e) {
        toggleError('login', 'Erro no login Google.');
    }
}

async function handleRegister() {
    appState.isRegistering = true;
    toggleLoading('reg', true);
    const email = document.getElementById('reg-email').value;
    try {
        await setPersistence(auth, browserLocalPersistence);
        const cred = await createUserWithEmailAndPassword(auth, email, document.getElementById('reg-password').value);
        appState.currentUser = cred.user;
        await fetchWithAuth('/api/init-user', {
            method: 'POST',
            body: JSON.stringify({ 
                email, 
                fullname: document.getElementById('reg-fullname').value,
                cpf: document.getElementById('reg-cpf').value,
                birthdate: document.getElementById('reg-birthdate').value,
                referralCode: document.getElementById('reg-referral').value
            })
        });
        location.reload();
    } catch (error) {
        showRegisterError(error.message);
        if (appState.currentUser) await appState.currentUser.delete().catch(() => {});
        appState.currentUser = null;
        toggleLoading('reg', false);
        appState.isRegistering = false;
    }
}

async function handleLogout() {
    await signOut(auth);
    location.reload(); 
}

// --- CONEXÃO JOGOS ---
async function handleSubmitConnection() {
    const id = document.getElementById('riot-id-input').value;
    if (!id) return toggleError('connect', "Insira um ID.");
    toggleLoading('connect', true);
    try {
        await fetchWithAuth('/api/connect', { method: 'POST', body: JSON.stringify({ playerId: id, gameType: appState.currentGame }) });
        const userData = await fetchWithAuth('/api/get-user-data');
        appState.connectedAccounts = userData.connectedAccounts;
        updateUI();
        toggleModal('connect-modal', false);
        showMessage("Conectado! Aguarde processamento...", 'success');
    } catch (e) {
        toggleError('connect', e.message);
    } finally {
        toggleLoading('connect', false);
    }
}

// --- KYC ---
async function handleKycSubmit(e) {
    e.preventDefault();
    const fullname = document.getElementById('kyc-modal-fullname').value;
    const cpf = document.getElementById('kyc-modal-cpf').value;
    const birthdate = document.getElementById('kyc-modal-birthdate').value;
    if (!fullname || !cpf || !birthdate) return toggleError('kyc', "Preencha tudo.");
    
    toggleLoading('kyc', true); 
    try {
        appState.kycData = await fetchWithAuth('/api/validate-kyc', { method: 'POST', body: JSON.stringify({ fullname, cpf, birthdate }) });
        updateUI();
        toggleModal('kyc-modal', false);
        showMessage("Verificado!", 'success');
    } catch (e) {
        toggleError('kyc', e.message);
    } finally {
        toggleLoading('kyc', false);
    }
}

// --- FINANCEIRO ---
async function handleGeneratePix() {
    const valBrl = parseFloat(document.getElementById('deposit-amount').value);
    const couponCode = document.getElementById('deposit-coupon-input').value;
    if (valBrl < 20) return toggleError('deposit', "Mínimo R$ 20.");
    
    toggleLoading('deposit', true);
    try {
        const data = await fetchWithAuth('/api/deposit/generate-pix', { 
            method: 'POST', body: JSON.stringify({ amount: valBrl, couponCode })
        });
        document.getElementById('deposit-qrcode-img').src = data.qrCodeBase64;
        document.getElementById('deposit-copypaste').value = data.copyPaste;
        document.getElementById('deposit-step-1').classList.add('hidden');
        document.getElementById('deposit-step-2').classList.remove('hidden');
        
        const gcAmount = valBrl * EXCHANGE_RATE;
        showMessage(`Gerando PIX para receber ${gcAmount} GC`, 'success');
        
    } catch (e) { toggleError('deposit', e.message); } finally { toggleLoading('deposit', false); }
}

async function handleRequestWithdraw() {
    const valGc = parseFloat(document.getElementById('withdraw-amount').value);
    const minBrl = 50;
    const minGc = minBrl * EXCHANGE_RATE;
    
    if (valGc < minGc) return toggleError('withdraw', `Mínimo ${minGc} GC (R$ ${minBrl}).`);
    if (valGc > appState.wallet) return toggleError('withdraw', "Saldo insuficiente.");
    
    const valBrl = valGc / EXCHANGE_RATE;
    
    if(!confirm(`Sacar ${valGc} GC? Você receberá aproximadamente R$ ${valBrl.toFixed(2)}.`)) return;

    toggleLoading('withdraw', true);
    try {
        const res = await fetchWithAuth('/api/withdraw/request', { method: 'POST', body: JSON.stringify({ amount: valBrl }) });
        appState.wallet = res.newWallet * EXCHANGE_RATE;
        updateUI();
        toggleModal('withdraw-modal', false);
        showMessage("Solicitado! Aguarde o PIX.", 'success');
    } catch (e) { toggleError('withdraw', e.message); } finally { toggleLoading('withdraw', false); }
}

async function handleRedeemCoupon() {
    const code = document.getElementById('coupon-input').value;
    if(!code) return showError("Digite código.");
    try {
        const res = await fetchWithAuth('/api/redeem-coupon', { method: 'POST', body: JSON.stringify({ code }) });
        const data = await fetchWithAuth('/api/get-user-data');
        appState.bonus_wallet = (data.bonus_wallet || 0) * EXCHANGE_RATE;
        appState.rollover_target = (data.rollover_target || 0) * EXCHANGE_RATE;
        updateUI();
        showMessage(`Bônus de ${(res.amount * EXCHANGE_RATE)} GC ativado!`, 'success');
    } catch (e) { showError(e.message); }
}

async function handleConvertBonus() {
    try {
        const res = await fetchWithAuth('/api/convert-bonus', { method: 'POST' });
        appState.wallet += res.convertedAmount * EXCHANGE_RATE;
        appState.bonus_wallet = 0;
        appState.rollover_target = 0;
        updateUI();
        showMessage("Convertido com sucesso!", 'success');
    } catch (e) { showError(e.message); }
}

// --- APOSTAS ---
async function handlePlaceBet() {
    const amountGC = parseFloat(document.getElementById('bet-amount-input').value);
    if (!amountGC || amountGC <= 0) return showError("Valor inválido.");
    if (appState.betSlip.length === 0) return showError("Selecione desafios.");
    
    toggleLoading('place-bet', true);
    document.getElementById('place-bet-btn').classList.add('hidden');

    try {
        const amountBRL = amountGC / EXCHANGE_RATE;
        const res = await fetchWithAuth('/api/place-bet', {
            method: 'POST',
            body: JSON.stringify({ betAmount: amountBRL, betItems: appState.betSlip })
        });
        
        appState.wallet = res.newWallet * EXCHANGE_RATE;
        appState.bonus_wallet = res.newBonusWallet * EXCHANGE_RATE;
        updateUI();
        
        appState.betSlip = [];
        updateBetSlipCount();
        toggleModal('bet-slip-modal', false);
        showMessage("Aposta Confirmada! Boa sorte.", 'success');
        navigateApp('bets-page');
        
    } catch (e) {
        document.getElementById('bet-slip-error-msg').textContent = e.message;
        document.getElementById('bet-slip-error-msg').classList.remove('hidden');
    } finally {
        toggleLoading('place-bet', false);
        document.getElementById('place-bet-btn').classList.remove('hidden');
    }
}

async function handleRequestBet() {
    const target = document.getElementById('request-target-input').value;
    if (!target) return toggleError('request', "Insira meta.");
    toggleLoading('request', true);
    try {
        const data = await fetchWithAuth('/api/request-bet', { method: 'POST', body: JSON.stringify({ gameType: appState.currentGame, target }) });
        const c = data.challenge;
        document.getElementById('request-result-title').textContent = c.title;
        document.getElementById('request-result-odd').textContent = c.odd.toFixed(2) + 'x';
        
        const addBtn = document.getElementById('request-add-to-slip');
        addBtn.onclick = function() {
            toggleBetSlipItem(c);
            toggleModal('request-bet-modal', false);
        };
        
        document.getElementById('request-form-container').classList.add('hidden');
        document.getElementById('request-result-container').classList.remove('hidden');
    } catch (e) { toggleError('request', e.message); } finally { toggleLoading('request', false); }
}

function handleAddCustomBetToSlip() {} // Placeholder para evitar erro se chamado diretamente

// ==================================================
// 3. FUNÇÕES DE ATUALIZAÇÃO DE UI
// ==================================================

function updateWalletUI() {
    const walletEl = document.getElementById('wallet-balance');
    const bonusEl = document.getElementById('bonus-balance');
    const navBal = document.getElementById('nav-user-balance');
    
    if(walletEl) walletEl.innerHTML = `<svg class="w-6 h-6 text-yellow-400"><use href="#icon-glitch-coin"></use></svg> ${appState.wallet.toFixed(0)}`;
    if(bonusEl) bonusEl.innerHTML = `<svg class="w-6 h-6 text-yellow-400"><use href="#icon-glitch-coin"></use></svg> ${appState.bonus_wallet.toFixed(0)}`;
    if(navBal) navBal.innerHTML = `<svg class="w-4 h-4 text-yellow-300"><use href="#icon-glitch-coin"></use></svg> ${(appState.wallet + appState.bonus_wallet).toFixed(0)}`;
}

function updateProfileUI() {
    document.getElementById('kyc-fullname').textContent = appState.kycData.fullname || '-';
    document.getElementById('kyc-cpf').textContent = appState.kycData.cpf || '-';
    
    const kycBadge = document.getElementById('kyc-status');
    const kycBtn = document.getElementById('kyc-verify-btn');
    
    if (appState.kycData.kyc_status === 'verified') {
        kycBadge.textContent = 'VERIFICADO';
        kycBadge.className = 'text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/50';
        kycBtn.classList.add('hidden');
    } else {
        kycBadge.textContent = 'PENDENTE';
        kycBtn.classList.remove('hidden');
        kycBtn.addEventListener('click', () => toggleModal('kyc-modal', true));
    }
    
    const lolStatus = document.getElementById('lol-status');
    const lolBtn = document.getElementById('lol-connect-btn');
    
    if (appState.connectedAccounts['lol']) {
        lolStatus.innerHTML = `<span class="w-2 h-2 bg-green-500 rounded-full"></span> ${appState.connectedAccounts['lol'].playerId}`;
        lolStatus.className = 'text-green-400 text-sm font-bold flex items-center gap-2 mt-1';
        lolBtn.textContent = 'DESCONECTAR';
        lolBtn.classList.replace('border-white/20', 'border-red-500/50');
        lolBtn.classList.add('text-red-400', 'hover:bg-red-500/10');
        
        // Clone para limpar listeners antigos
        const newBtn = lolBtn.cloneNode(true);
        lolBtn.parentNode.replaceChild(newBtn, lolBtn);
        newBtn.addEventListener('click', () => handleDisconnect('lol'));
    } else {
        lolStatus.innerHTML = `<span class="w-2 h-2 bg-red-500 rounded-full"></span> Desconectado`;
        lolStatus.className = 'text-[var(--accent-orange)] text-sm font-bold flex items-center gap-2 mt-1';
        lolBtn.textContent = 'VINCULAR';
        lolBtn.classList.remove('text-red-400', 'hover:bg-red-500/10', 'border-red-500/50');
        lolBtn.classList.add('border-white/20');
        
        const newBtn = lolBtn.cloneNode(true);
        lolBtn.parentNode.replaceChild(newBtn, lolBtn);
        newBtn.addEventListener('click', () => openConnectModal('lol'));
    }
}

function updateRolloverUI() {
    const container = document.getElementById('rollover-container');
    if (appState.rollover_target > 0) {
        container.classList.remove('hidden');
        document.getElementById('rollover-text').textContent = `${appState.rollover_target.toFixed(0)} GC`;
        const percent = Math.min(100, (1 - (appState.rollover_target / (appState.bonus_wallet * 20))) * 100); 
        document.getElementById('rollover-bar').style.width = `${percent}%`;
        
        const btn = document.getElementById('convert-bonus-btn');
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = `<svg class="w-4 h-4 text-yellow-400"><use href="#icon-glitch-coin"></use></svg> Falta ${appState.rollover_target.toFixed(0)} GC`;
    } else if (appState.bonus_wallet > 0) {
        container.classList.remove('hidden');
        document.getElementById('rollover-text').textContent = "LIBERADO";
        const bar = document.getElementById('rollover-bar');
        bar.style.width = "100%";
        bar.classList.remove('bg-gradient-to-r');
        bar.classList.add('bg-green-500');
        
        const btn = document.getElementById('convert-bonus-btn');
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.classList.add('bg-[var(--primary-purple)]', 'hover:brightness-110');
        btn.innerHTML = `<svg class="w-4 h-4 text-yellow-400"><use href="#icon-glitch-coin"></use></svg> CONVERTER BÔNUS EM SALDO REAL`;
    } else {
        container.classList.add('hidden');
    }
}

function updateNavbarUI() {
    const userInfo = document.getElementById('nav-user-info');
    const loginBtn = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const desktopNav = document.getElementById('desktop-nav');
    
    // FIX: Lógica correta para mostrar/esconder o menu
    if (appState.currentUser) {
        userInfo.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        
        if(desktopNav) {
            desktopNav.classList.remove('hidden');
            desktopNav.classList.add('md:flex'); // Mostra apenas em Desktop se logado
        }
        if(loginBtn) loginBtn.classList.add('hidden');
        
        document.getElementById('nav-user-name').textContent = appState.currentUser.email.split('@')[0];
    } else {
        userInfo.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        
        if(desktopNav) {
            desktopNav.classList.add('hidden');
            desktopNav.classList.remove('md:flex'); // Esconde se deslogado
        }
        if(loginBtn) loginBtn.classList.remove('hidden');
    }
}

function updateUI() {
    updateWalletUI();
    updateProfileUI();
    updateRolloverUI();
    updateNavbarUI();
}

// ==================================================
// 4. FUNÇÕES DE NAVEGAÇÃO & SETUP
// ==================================================

function toggleShells(mode) {
    const loading = document.getElementById('loading-shell');
    const authShell = document.getElementById('auth-shell');
    const appShell = document.getElementById('app-shell');
    if(loading) loading.classList.add('hidden');
    
    if (mode === 'app') {
        if(authShell) authShell.classList.replace('flex', 'hidden');
        if(appShell) appShell.classList.replace('hidden', 'block');
    } else {
        if(authShell) authShell.classList.replace('hidden', 'flex');
        if(appShell) appShell.classList.replace('block', 'hidden');
    }
}

function navigateAuth(pageId) {
    document.querySelectorAll('#auth-shell .page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    appState.currentAuthPage = pageId;
}

function navigateApp(pageId) {
    if (appState.currentAppPage === pageId) return;
    if (appState.currentAppPage) {
        const curr = document.getElementById(appState.currentAppPage);
        if (curr) curr.classList.remove('active');
    }
    const target = document.getElementById(pageId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
    appState.currentAppPage = pageId;
    
    const syncMenu = (selector) => {
        document.querySelectorAll(selector).forEach(i => {
            const isActive = i.dataset.page === pageId;
            if (selector.includes('desktop')) {
                const indicator = i.querySelector('span');
                if (isActive) {
                    i.classList.replace('text-[var(--text-secondary)]', 'text-[var(--primary-purple)]');
                    if(indicator) indicator.classList.replace('scale-x-0', 'scale-x-100');
                } else {
                    i.classList.replace('text-[var(--primary-purple)]', 'text-[var(--text-secondary)]');
                    if(indicator) indicator.classList.replace('scale-x-100', 'scale-x-0');
                }
            } else {
                i.classList.toggle('active', isActive);
                if (isActive) i.classList.replace('text-[var(--text-secondary)]', 'text-[var(--primary-purple)]');
                else i.classList.replace('text-[var(--primary-purple)]', 'text-[var(--text-secondary)]');
            }
        });
    };
    syncMenu('.nav-item');
    syncMenu('.nav-item-desktop');
    
    if (pageId === 'home-page') appState.currentGame = null;
    if (pageId === 'profile-page') updateUI();
    if (pageId === 'bets-page') fetchAndRenderActiveBets();
    if (pageId === 'history-page') fetchAndRenderHistoryBets();
}

// --- INICIALIZAÇÃO DOS LISTENERS ---
function setupAuthListeners() {
    const ids = ['auth-login-btn', 'register-goto-login', 'auth-register-btn', 'landing-cta-btn', 'login-goto-register'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('click', () => navigateAuth(id.includes('login') ? 'login-page' : 'register-page'));
    });

    const loginForm = document.getElementById('login-form');
    if(loginForm) loginForm.addEventListener('submit', handleLogin);

    const regSubmit = document.getElementById('reg-submit');
    if(regSubmit) regSubmit.addEventListener('click', handleRegister); 
    
    const googleBtn = document.getElementById('google-login-btn');
    if(googleBtn) googleBtn.addEventListener('click', handleGoogleLogin);

    const termBtn = document.getElementById('open-terms-btn');
    if(termBtn) termBtn.addEventListener('click', () => toggleModal('terms-page', true));
    
    const closeTerms = document.getElementById('close-terms-btn');
    if(closeTerms) closeTerms.addEventListener('click', () => toggleModal('terms-page', false));
    
    const okTerms = document.getElementById('terms-ok-btn');
    if(okTerms) okTerms.addEventListener('click', () => toggleModal('terms-page', false));
    
    setupRegistrationSteps();
}

function setupAppListeners() {
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    document.querySelector('.bottom-nav').addEventListener('click', (e) => {
        const btn = e.target.closest('button.nav-item');
        if (btn) navigateApp(btn.dataset.page);
    });

    const desktopNav = document.getElementById('desktop-nav');
    if (desktopNav) {
        desktopNav.addEventListener('click', (e) => {
            const btn = e.target.closest('button.nav-item-desktop');
            if (btn) navigateApp(btn.dataset.page);
        });
    }

    const lolCard = document.getElementById('select-lol');
    if(lolCard) lolCard.addEventListener('click', () => selectGame('lol'));

    document.getElementById('back-to-home').addEventListener('click', () => navigateApp('home-page'));
    
    // Connect
    document.querySelectorAll('.connect-btn').forEach(btn => btn.addEventListener('click', (e) => openConnectModal(e.target.dataset.game)));
    document.getElementById('connect-modal-cancel').addEventListener('click', () => toggleModal('connect-modal', false));
    document.getElementById('connect-modal-submit').addEventListener('click', handleSubmitConnection);
    document.getElementById('connect-terms-check').addEventListener('change', (e) => {
        const btn = document.getElementById('connect-modal-submit');
        btn.disabled = !e.target.checked;
        btn.classList.toggle('opacity-50', !e.target.checked);
        btn.style.cursor = e.target.checked ? 'pointer' : 'not-allowed';
    });

    // Bets
    document.getElementById('bet-slip-fab').addEventListener('click', openBetSlipModal);
    document.getElementById('bet-slip-modal-close').addEventListener('click', () => toggleModal('bet-slip-modal', false));
    document.getElementById('bet-amount-input').addEventListener('input', updateBetSlipSummary);
    document.getElementById('place-bet-btn').addEventListener('click', handlePlaceBet);

    // Request Bet
    document.getElementById('open-request-bet-modal').addEventListener('click', openRequestBetModal);
    document.getElementById('request-modal-cancel').addEventListener('click', () => toggleModal('request-bet-modal', false));
    document.getElementById('request-modal-submit').addEventListener('click', handleRequestBet);
    
    const addCustomBtn = document.getElementById('request-add-to-slip');
    if(addCustomBtn) {
         addCustomBtn.addEventListener('click', handleAddCustomBetToSlip);
    }
    
    document.getElementById('request-try-again').addEventListener('click', resetRequestModal);

    // KYC
    document.getElementById('kyc-form').addEventListener('submit', handleKycSubmit);
    document.getElementById('kyc-modal-cancel').addEventListener('click', () => toggleModal('kyc-modal', false));

    // Deposit
    document.getElementById('open-deposit-modal').addEventListener('click', openDepositModal);
    document.getElementById('deposit-modal-cancel').addEventListener('click', () => toggleModal('deposit-modal', false));
    document.getElementById('deposit-confirm-btn').addEventListener('click', handleGeneratePix);
    document.getElementById('deposit-copy-btn').addEventListener('click', copyPixCode);
    document.getElementById('deposit-finish-btn').addEventListener('click', () => toggleModal('deposit-modal', false));
    document.querySelectorAll('.deposit-preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => document.getElementById('deposit-amount').value = e.target.dataset.value);
    });

    // Withdraw
    document.getElementById('open-withdraw-modal').addEventListener('click', openWithdrawModal);
    document.getElementById('withdraw-modal-cancel').addEventListener('click', () => toggleModal('withdraw-modal', false));
    document.getElementById('withdraw-confirm-btn').addEventListener('click', handleRequestWithdraw);

    // Coupon
    document.getElementById('redeem-coupon-btn').addEventListener('click', handleRedeemCoupon);
    const refEl = document.getElementById('my-referral-code');
    if(refEl) refEl.addEventListener('click', () => {
        if(appState.myReferralCode) {
            navigator.clipboard.writeText(appState.myReferralCode);
            showMessage("Copiado!", 'success');
        }
    });

    // Convert
    document.getElementById('convert-bonus-btn').addEventListener('click', handleConvertBonus);
}

function handleDisconnect(gameType) {
    // Implementação do disconnect (estava faltando, causando erro se chamado)
    if(!confirm("Deseja desconectar esta conta?")) return;
    
    toggleLoading('connect', true);
    fetchWithAuth('/api/disconnect', { method: 'POST', body: JSON.stringify({ gameType }) })
    .then(() => {
        delete appState.connectedAccounts[gameType];
        updateUI();
        showMessage("Conta desconectada.", 'success');
    })
    .catch(e => showError(e.message))
    .finally(() => toggleLoading('connect', false));
}

// --- BETTING HELPERS QUE FALTAVAM NA VERSÃO ANTERIOR ---
function openBetSlipModal() {
    renderBetSlip();
    updateBetSlipSummary();
    toggleModal('bet-slip-modal', true);
}

function renderBetSlip() {
    const list = document.getElementById('bet-slip-list');
    list.innerHTML = '';
    if (appState.betSlip.length === 0) {
        list.innerHTML = '<p class="text-center text-[var(--text-secondary)] text-sm mt-4 italic">Nenhum desafio selecionado.</p>';
        return;
    }
    appState.betSlip.forEach((bet, index) => {
        const item = document.createElement('div');
        item.className = 'glass-card p-3 mb-2 flex justify-between items-center bg-white/5 border border-white/10';
        item.innerHTML = `
            <div>
                <p class="font-bold text-sm text-white">${bet.title}</p>
                <p class="text-xs text-[var(--text-secondary)]">${bet.gameType === 'lol' ? 'League of Legends' : bet.gameType}</p>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-[var(--primary-purple)] font-bold">${bet.odd.toFixed(2)}x</span>
                <button class="text-red-400 font-bold hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors" data-index="${index}">×</button>
            </div>
        `;
        item.querySelector('button').addEventListener('click', () => removeBetSlipItem(index));
        list.appendChild(item);
    });
}

function removeBetSlipItem(index) {
    appState.betSlip.splice(index, 1);
    updateBetSlipCount();
    renderBetSlip();
    updateBetSlipSummary();
}

function updateBetSlipCount() {
    const count = appState.betSlip.length;
    const el = document.getElementById('bet-slip-count');
    if (el) {
        el.textContent = count;
        el.classList.toggle('hidden', count === 0);
    }
    const fab = document.getElementById('bet-slip-fab');
    if (fab && appState.currentUser) fab.classList.toggle('hidden', count === 0);
}

function updateBetSlipSummary() {
    const totalOdd = appState.betSlip.reduce((acc, bet) => acc * bet.odd, 1);
    const amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    
    document.getElementById('bet-slip-total-odd').textContent = `${totalOdd.toFixed(2)}x`;
    
    const potWin = amount * totalOdd;
    const potEl = document.getElementById('bet-potential-winnings');
    if(potEl) potEl.innerHTML = `<svg class="w-5 h-5 text-yellow-400"><use href="#icon-glitch-coin"></use></svg> ${potWin.toFixed(2)}`;

    const limitInfo = document.getElementById('bet-slip-limit-info');
    const placeBtn = document.getElementById('place-bet-btn');
    
    if (amount > appState.currentBetLimit) {
        limitInfo.textContent = `Limite atual: ${appState.currentBetLimit.toFixed(0)} GC`;
        limitInfo.classList.remove('hidden');
        placeBtn.disabled = true;
        placeBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        limitInfo.classList.add('hidden');
        placeBtn.disabled = false;
        placeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

function toggleBetSlipItem(challenge) {
    const idx = appState.betSlip.findIndex(b => b.id === challenge.id);
    if (idx >= 0) {
        appState.betSlip.splice(idx, 1);
    } else {
        const conflict = appState.betSlip.find(b => b.conflictKey === challenge.conflictKey);
        if (conflict) {
            showMessage("Conflito com aposta existente!", 'error');
            return;
        }
        appState.betSlip.push(challenge);
        showMessage("Adicionado ao boletim!", 'success');
    }
    updateBetSlipCount();
}

// Placeholder para evitar erro
function handleAddCustomBetToSlip() {}
function resetRequestModal() {
    document.getElementById('request-result-container').classList.add('hidden');
    document.getElementById('request-form-container').classList.remove('hidden');
}

function copyPixCode() {
    const el = document.getElementById('deposit-copypaste');
    el.select();
    navigator.clipboard.writeText(el.value);
    showMessage("Copiado!", 'success');
}

// --- UTILITÁRIOS DE MODAL ---
function toggleModal(id, show) {
    const el = document.getElementById(id);
    const back = document.getElementById('modal-backdrop');
    if (show) { 
        el.classList.remove('hidden'); 
        if(back) back.classList.remove('hidden'); 
    } else { 
        el.classList.add('hidden'); 
        if(back) back.classList.add('hidden'); 
    }
}

// --- GAME LOGIC (Render Challenges) ---
function renderChallenges(challenges) {
    const list = document.getElementById('challenges-list');
    list.innerHTML = '';
    document.getElementById('request-bet-card').classList.remove('hidden');
    challenges.forEach(c => {
        const el = document.createElement('div');
        el.className = 'glass-card p-4 flex justify-between items-center hover:border-[var(--primary-purple)] transition-all cursor-pointer group border border-white/5 bg-white/5';
        const isSelected = appState.betSlip.some(b => b.id === c.id);
        if (isSelected) el.classList.add('border-[var(--primary-purple)]', 'bg-[var(--primary-purple)]/10');
        el.innerHTML = `
            <div>
                <h4 class="font-bold group-hover:text-[var(--primary-purple)] transition-colors text-white">${c.title}</h4>
                <p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Multiplicador</p>
            </div>
            <div class="text-right">
                <span class="text-2xl font-bold font-[var(--font-display)] ${isSelected ? 'text-[var(--primary-purple)]' : 'text-white'}">${c.odd.toFixed(2)}x</span>
            </div>
        `;
        el.addEventListener('click', () => {
            toggleBetSlipItem(c);
            renderChallenges(challenges);
        });
        list.appendChild(el);
    });
}

// --- GAMIFICAÇÃO: BUSCA APOSTAS ---
async function fetchAndRenderActiveBets() {
    const list = document.getElementById('active-bets-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    try {
        const bets = await fetchWithAuth('/api/get-active-bets');
        if (bets.length === 0) {
            list.innerHTML = '<p class="text-[var(--text-secondary)] text-center italic">Nenhuma missão ativa no momento.</p>';
            return;
        }
        list.innerHTML = bets.map(b => `
            <div class="glass-card p-4 border-l-4 border-yellow-500 bg-white/5">
                <div class="flex justify-between mb-2">
                    <span class="text-xs text-yellow-500 font-bold uppercase tracking-wider">Em Andamento</span>
                    <span class="text-xs text-[var(--text-secondary)]">${new Date(b.createdAt).toLocaleTimeString()}</span>
                </div>
                <div class="mb-3 space-y-1">
                    ${b.betItems.map(i => `<p class="font-bold text-sm text-white">• ${i.title} <span class="text-[var(--primary-purple)]">(${i.odd}x)</span></p>`).join('')}
                </div>
                <div class="flex justify-between items-end border-t border-white/10 pt-2">
                    <div>
                        <p class="text-xs text-[var(--text-secondary)] uppercase">Valor</p>
                        <p class="font-bold text-white">${(b.betAmount * EXCHANGE_RATE).toFixed(0)} GC</p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs text-[var(--text-secondary)] uppercase">Loot</p>
                        <p class="font-bold text-[var(--accent-cyan)] font-[Orbitron]">${(b.potentialWinnings * EXCHANGE_RATE).toFixed(0)} GC</p>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) { list.innerHTML = `<p class="text-red-400 text-center">${e.message}</p>`; }
}

async function fetchAndRenderHistoryBets() {
    const list = document.getElementById('history-bets-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    try {
        const bets = await fetchWithAuth('/api/get-history-bets');
        if (bets.length === 0) {
            list.innerHTML = '<p class="text-[var(--text-secondary)] text-center italic">Histórico vazio.</p>';
            return;
        }
        list.innerHTML = bets.map(b => {
            const color = b.status === 'won' ? 'green' : (b.status === 'void' ? 'gray' : 'red');
            const statusTxt = b.status === 'won' ? 'VITÓRIA' : (b.status === 'void' ? 'ANULADA' : 'DERROTA');
            const borderColor = b.status === 'won' ? 'border-green-500' : (b.status === 'void' ? 'border-gray-500' : 'border-red-500');
            const textColor = b.status === 'won' ? 'text-green-500' : (b.status === 'void' ? 'text-gray-500' : 'text-red-500');
            const winAmountGC = (b.status === 'won' ? (b.potentialWinnings - b.betAmount) : b.betAmount) * EXCHANGE_RATE;
            
            return `
            <div class="glass-card p-4 border-l-4 ${borderColor} bg-white/5 hover:bg-white/10 transition-colors">
                <div class="flex justify-between mb-2">
                    <span class="text-xs ${textColor} font-bold uppercase tracking-wider">${statusTxt}</span>
                    <span class="text-xs text-[var(--text-secondary)]">${new Date(b.resolvedAt || b.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="mb-2">
                    ${b.betItems.map(i => `<p class="text-sm text-white">• ${i.title}</p>`).join('')}
                </div>
                 <div class="flex justify-between font-bold items-center">
                    <span class="${textColor} font-[Orbitron] text-lg">${b.status === 'won' ? '+' : '-'} ${winAmountGC.toFixed(0)} GC</span>
                    <span class="text-xs text-[var(--text-secondary)] px-2 py-1 bg-black/30 rounded border border-white/10">${b.totalOdd}x</span>
                </div>
            </div>
        `}).join('');
    } catch (e) { list.innerHTML = `<p class="text-red-400 text-center">${e.message}</p>`; }
}

// --- GAME SELECTION ---
async function selectGame(gameType) {
    if (!appState.currentUser) return showError("Faça login primeiro.");
    appState.currentGame = gameType;
    toggleShells('app');
    navigateApp('challenges-page');
    const list = document.getElementById('challenges-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    document.getElementById('challenges-subtitle').textContent = "Analisando seu perfil...";
    try {
        const challenges = await fetchWithAuth('/api/get-challenges', { method: 'POST', body: JSON.stringify({ gameType }) });
        renderChallenges(challenges);
    } catch (e) {
        list.innerHTML = `<p class="text-center text-red-400 p-4 border border-red-500/20 rounded bg-red-500/10">${e.message}</p>`;
        if(e.message.includes("Não conectado")) {
             list.innerHTML += `<div class="text-center mt-4"><button class="connect-btn glass-card px-4 py-2 font-bold border hover:bg-white/10" onclick="navigateApp('profile-page')">IR PARA PERFIL</button></div>`;
        }
    }
}

// ==================================================
// 5. INICIALIZAÇÃO E TEMA
// ==================================================

function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
    
    const btn = document.getElementById('theme-toggle');
    if(btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcons(next);
        });
    }
}

function updateThemeIcons(theme) {
    const sunIcon = document.querySelector('.icon-sun');
    const moonIcon = document.querySelector('.icon-moon');
    if (!sunIcon || !moonIcon) return;
    if (theme === 'light') {
        moonIcon.classList.add('hidden');
        sunIcon.classList.remove('hidden');
    } else {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    }
}

// --- CORE LOGIC ---
function initializeMainApp() {
    onAuthStateChanged(auth, async (user) => {
        if (appState.isRegistering) return;
        
        if (user) {
            appState.currentUser = user;
            try {
                const data = await fetchWithAuth('/api/get-user-data');
                
                const serverWallet = data.wallet || 0.0;
                const serverBonus = data.bonus_wallet || 0.0;
                const serverRollover = data.rollover_target || 0.0;
                const serverLimit = data.currentBetLimit || 3.00;

                Object.assign(appState, {
                    wallet: serverWallet * EXCHANGE_RATE, 
                    bonus_wallet: serverBonus * EXCHANGE_RATE,
                    rollover_target: serverRollover * EXCHANGE_RATE,
                    connectedAccounts: data.connectedAccounts || {},
                    kycData: { 
                        fullname: data.fullname || '', 
                        cpf: data.cpf || '', 
                        birthdate: data.birthdate || '', 
                        kyc_status: data.kyc_status || 'pending' 
                    },
                    currentBetLimit: serverLimit * EXCHANGE_RATE, 
                    myReferralCode: data.my_referral_code || ''
                });
                
                updateUI();
                toggleShells('app');
                navigateApp('home-page');
            } catch (e) {
                console.error("Erro Init:", e);
                await signOut(auth);
                toggleShells('auth');
                showMessage("Erro de conexão. Tente novamente.", 'error');
                updateNavbarUI(); // Garante reset do menu
            }
        } else {
            appState.currentUser = null;
            toggleShells('auth');
            navigateAuth('landing-page');
            updateNavbarUI(); // Garante que o menu suma
        }
    });
}

function setupRegistrationSteps() {
    const next1 = document.getElementById('reg-next-step-1');
    const next2 = document.getElementById('reg-next-step-2');
    const check = document.getElementById('reg-terms');
    const submit = document.getElementById('reg-submit');

    if(next1) next1.addEventListener('click', () => {
        const p1 = document.getElementById('reg-password').value;
        const p2 = document.getElementById('reg-confirm-password').value;
        if (p1 !== p2 || p1.length < 6) return showRegisterError("Senhas inválidas ou curtas.");
        showRegisterError(null); 
        goToRegisterStep(2);
    });

    if(next2) next2.addEventListener('click', () => {
        if (!document.getElementById('reg-fullname').value || !document.getElementById('reg-cpf').value || !document.getElementById('reg-birthdate').value) return showRegisterError("Preencha tudo.");
        showRegisterError(null); 
        goToRegisterStep(3);
    });

    if(check) check.addEventListener('change', () => {
        submit.disabled = !check.checked;
        submit.classList.toggle('opacity-50', !check.checked);
        submit.style.cursor = check.checked ? 'pointer' : 'not-allowed';
    });
}

function goToRegisterStep(step) {
    document.querySelectorAll('.register-step').forEach(s => s.classList.add('hidden'));
    const stepEl = document.getElementById(`register-step-${step}`);
    if (stepEl) stepEl.classList.remove('hidden');
    [1, 2, 3].forEach(i => {
        const el = document.getElementById(`step-ind-${i}`);
        if (el) {
            if (i === step) el.className = 'text-xs font-bold bg-[var(--bg-card)] px-2 text-[var(--primary-purple)] transition-colors';
            else el.className = 'text-xs text-[var(--text-secondary)] bg-[var(--bg-card)] px-2 transition-colors';
        }
    });
}

// --- EXECUÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    console.log(">>> App v6.0 (Reorganized & Fixed) Iniciando...");
    initTheme();
    // A ordem aqui garante que as funcoes existam
    setupAuthListeners();
    setupAppListeners();
    initializeMainApp();
});