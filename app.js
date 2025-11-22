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
    currentBetLimit: 3.00,
    myReferralCode: ''
};

// --- API HELPER ---
async function fetchWithAuth(endpoint, options = {}) {
    if (!appState.currentUser) {
        const user = auth.currentUser;
        if (!user) throw new Error("Aguardando autenticação...");
        appState.currentUser = user;
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

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    console.log(">>> App v4.1 (Full Fixed) Iniciando...");
    initTheme();
    initializeMainApp();
    setupAuthListeners();
    setupAppListeners();
});

function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    
    const btn = document.getElementById('theme-toggle');
    if(btn) {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
        });
    }
}

function initializeMainApp() {
    onAuthStateChanged(auth, async (user) => {
        if (appState.isRegistering) return;
        
        if (user) {
            console.log(">>> Usuário Logado:", user.uid);
            appState.currentUser = user;
            try {
                const data = await fetchWithAuth('/api/get-user-data');
                
                Object.assign(appState, {
                    wallet: data.wallet || 0,
                    bonus_wallet: data.bonus_wallet || 0,
                    rollover_target: data.rollover_target || 0,
                    connectedAccounts: data.connectedAccounts || {},
                    kycData: { 
                        fullname: data.fullname || '', 
                        cpf: data.cpf || '', 
                        birthdate: data.birthdate || '', 
                        kyc_status: data.kyc_status || 'pending' 
                    },
                    currentBetLimit: data.currentBetLimit || 3.00,
                    myReferralCode: data.my_referral_code || ''
                });
                
                updateUI();
                toggleShells('app');
                navigateApp('home-page');
            } catch (e) {
                console.error(">>> Erro Init:", e);
                await signOut(auth);
                toggleShells('auth');
                showMessage("Erro de conexão. Tente novamente.", 'error');
            }
        } else {
            console.log(">>> Sem Usuário. Tela de Login.");
            appState.currentUser = null;
            toggleShells('auth');
            navigateAuth('landing-page');
        }
    });
}

// --- GERENCIAMENTO DE TELAS ---
function toggleShells(mode) {
    const loading = document.getElementById('loading-shell');
    const authShell = document.getElementById('auth-shell');
    const appShell = document.getElementById('app-shell');

    if(loading) loading.classList.add('hidden');

    if (mode === 'app') {
        if(authShell) {
            authShell.classList.remove('flex');
            authShell.classList.add('hidden');
        }
        if(appShell) {
            appShell.classList.remove('hidden');
            appShell.classList.add('block');
        }
    } else {
        if(authShell) {
            authShell.classList.remove('hidden');
            authShell.classList.add('flex');
        }
        if(appShell) {
            appShell.classList.remove('block');
            appShell.classList.add('hidden');
        }
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
    document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.dataset.page === pageId);
    });
    
    if (pageId === 'home-page') appState.currentGame = null;
    if (pageId === 'profile-page') updateUI();
    if (pageId === 'bets-page') fetchAndRenderActiveBets();
    if (pageId === 'history-page') fetchAndRenderHistoryBets();
}

// --- LISTENERS ---
function setupAuthListeners() {
    const ids = ['auth-login-btn', 'register-goto-login', 'auth-register-btn', 'landing-cta-btn', 'login-goto-register'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('click', () => navigateAuth(id.includes('login') ? 'login-page' : 'register-page'));
    });

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('reg-submit').addEventListener('click', handleRegister); 
    document.getElementById('google-login-btn').addEventListener('click', handleGoogleLogin);

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

    const lolCard = document.getElementById('select-lol');
    if(lolCard) lolCard.addEventListener('click', () => selectGame('lol'));

    document.getElementById('back-to-home').addEventListener('click', () => navigateApp('home-page'));
    
    // Connect (AQUI ESTAVA O ERRO - FUNÇÕES AGORA EXISTEM)
    document.querySelectorAll('.connect-btn').forEach(btn => btn.addEventListener('click', (e) => openConnectModal(e.target.dataset.game)));
    document.getElementById('connect-modal-cancel').addEventListener('click', () => toggleModal('connect-modal', false));
    document.getElementById('connect-modal-submit').addEventListener('click', handleSubmitConnection);
    document.getElementById('connect-terms-check').addEventListener('change', (e) => {
        const btn = document.getElementById('connect-modal-submit');
        btn.disabled = !e.target.checked;
        btn.classList.toggle('opacity-50', !e.target.checked);
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
    document.getElementById('request-add-to-slip').addEventListener('click', handleAddCustomBetToSlip);
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

// --- FUNÇÕES QUE FALTAVAM (AGORA INCLUÍDAS) ---

function openConnectModal(gameType) {
    appState.currentGame = gameType;
    document.getElementById('connect-modal-title').textContent = `CONECTAR ${gameType === 'lol' ? 'LoL' : ''}`;
    const acc = appState.connectedAccounts[gameType];
    document.getElementById('riot-id-input').value = acc?.playerId || '';
    toggleModal('connect-modal', true);
    toggleError('connect', null);
    
    document.getElementById('connect-terms-check').checked = false;
    const btn = document.getElementById('connect-modal-submit');
    btn.disabled = true;
    btn.classList.add('opacity-50');
}

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
        showMessage("Conectado!", 'success');
    } catch (e) {
        toggleError('connect', e.message);
    } finally {
        toggleLoading('connect', false);
    }
}

async function handleDisconnect(gameType) {
    try {
        await fetchWithAuth('/api/disconnect', { method: 'POST', body: JSON.stringify({ gameType }) });
        delete appState.connectedAccounts[gameType];
        updateUI();
        if (appState.currentGame === gameType) selectGame(gameType);
        showMessage("Desconectado.", 'success');
    } catch (e) { showError(e.message); }
}

async function handleKycSubmit(e) {
    e.preventDefault();
    const fullname = document.getElementById('kyc-modal-fullname').value;
    const cpf = document.getElementById('kyc-modal-cpf').value;
    const birthdate = document.getElementById('kyc-modal-birthdate').value;
    if (!fullname || !cpf || !birthdate) return toggleError('kyc', "Preencha tudo.");
    
    toggleLoading('kyc', true); // Corrigido prefixo
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

function openDepositModal() {
    if (appState.kycData.kyc_status !== 'verified') return showError("Valide identidade.");
    document.getElementById('deposit-step-1').classList.remove('hidden');
    document.getElementById('deposit-step-2').classList.add('hidden');
    toggleModal('deposit-modal', true);
}

async function handleGeneratePix() {
    const val = parseFloat(document.getElementById('deposit-amount').value);
    const couponCode = document.getElementById('deposit-coupon-input').value;
    if (val < 20) return toggleError('deposit', "Mínimo R$ 20.");
    
    toggleLoading('deposit', true);
    try {
        const data = await fetchWithAuth('/api/deposit/generate-pix', { 
            method: 'POST', body: JSON.stringify({ amount: val, couponCode })
        });
        document.getElementById('deposit-qrcode-img').src = data.qrCodeBase64;
        document.getElementById('deposit-copypaste').value = data.copyPaste;
        document.getElementById('deposit-step-1').classList.add('hidden');
        document.getElementById('deposit-step-2').classList.remove('hidden');
        if(data.bonusApplied) showMessage("Cupom aplicado!", 'success');
    } catch (e) { toggleError('deposit', e.message); } finally { toggleLoading('deposit', false); }
}

function copyPixCode() {
    const el = document.getElementById('deposit-copypaste');
    el.select();
    navigator.clipboard.writeText(el.value);
    showMessage("Copiado!", 'success');
}

function openWithdrawModal() {
    if (appState.kycData.kyc_status !== 'verified') return showError("Valide identidade.");
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-max-balance').textContent = `GC ${appState.wallet.toFixed(2)}`;
    document.getElementById('withdraw-pix-key').value = appState.kycData.cpf;
    toggleModal('withdraw-modal', true);
}

async function handleRequestWithdraw() {
    const val = parseFloat(document.getElementById('withdraw-amount').value);
    if (val < 50) return toggleError('withdraw', "Mínimo 50 GC.");
    if (val > appState.wallet) return toggleError('withdraw', "Saldo insuficiente.");
    toggleLoading('withdraw', true);
    try {
        const res = await fetchWithAuth('/api/withdraw/request', { method: 'POST', body: JSON.stringify({ amount: val }) });
        appState.wallet = res.newWallet;
        updateUI();
        toggleModal('withdraw-modal', false);
        showMessage("Solicitado!", 'success');
    } catch (e) { toggleError('withdraw', e.message); } finally { toggleLoading('withdraw', false); }
}

async function handleRedeemCoupon() {
    const code = document.getElementById('coupon-input').value;
    if(!code) return showError("Digite código.");
    try {
        const res = await fetchWithAuth('/api/redeem-coupon', { method: 'POST', body: JSON.stringify({ code }) });
        const data = await fetchWithAuth('/api/get-user-data');
        appState.bonus_wallet = data.bonus_wallet;
        appState.rollover_target = data.rollover_target;
        updateUI();
        showMessage(`Bônus de ${res.amount} GC ativado!`, 'success');
    } catch (e) { showError(e.message); }
}

async function handleConvertBonus() {
    try {
        const res = await fetchWithAuth('/api/convert-bonus', { method: 'POST' });
        appState.wallet += res.convertedAmount;
        appState.bonus_wallet = 0;
        appState.rollover_target = 0;
        updateUI();
        showMessage("Convertido com sucesso!", 'success');
    } catch (e) { showError(e.message); }
}

// --- CUSTOM BET ---
function openRequestBetModal() {
    if (!appState.currentGame || !appState.connectedAccounts[appState.currentGame]) return showError("Conecte a conta.");
    document.getElementById('request-form-container').classList.remove('hidden');
    document.getElementById('request-result-container').classList.add('hidden');
    document.getElementById('request-target-input').value = '';
    toggleModal('request-bet-modal', true);
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
        // Remove listeners antigos para evitar duplicação (clone)
        const newBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newBtn, addBtn);
        
        newBtn.onclick = () => {
            toggleBetSlipItem(c);
            toggleModal('request-bet-modal', false);
        };
        
        document.getElementById('request-form-container').classList.add('hidden');
        document.getElementById('request-result-container').classList.remove('hidden');
    } catch (e) { toggleError('request', e.message); } finally { toggleLoading('request', false); }
}

function resetRequestModal() {
    document.getElementById('request-result-container').classList.add('hidden');
    document.getElementById('request-form-container').classList.remove('hidden');
}

function handleAddCustomBetToSlip(e) {
    // Função vazia pois a lógica foi movida para dentro do handleRequestBet
}

// --- REGISTRO & UI HELPERS ---
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
        if (!document.getElementById('reg-fullname').value || !document.getElementById('reg-cpf').value || !document.getElementById('reg-birthdate').value) {
            return showRegisterError("Preencha tudo.");
        }
        showRegisterError(null); 
        goToRegisterStep(3);
    });

    if(check) check.addEventListener('change', () => {
        submit.disabled = !check.checked;
        submit.classList.toggle('opacity-50', !check.checked);
    });
}

function goToRegisterStep(step) {
    document.querySelectorAll('.register-step').forEach(s => s.classList.add('hidden'));
    const stepEl = document.getElementById(`register-step-${step}`);
    if (stepEl) stepEl.classList.remove('hidden');

    [1, 2, 3].forEach(i => {
        const el = document.getElementById(`step-ind-${i}`);
        if (el) {
            // Cores do novo tema
            el.className = i === step ? 'text-[var(--primary-purple)] font-bold text-xs' : 'text-[var(--text-secondary)] text-xs';
        }
    });
}

async function handleLogin(e) {
    e.preventDefault();
    toggleLoading('login', true);
    try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch (error) {
        toggleError('login', 'Login inválido.');
        toggleLoading('login', false);
    }
}

async function handleGoogleLogin() {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const res = await signInWithPopup(auth, new GoogleAuthProvider());
        if (getAdditionalUserInfo(res).isNewUser) {
            appState.currentUser = res.user;
            await fetchWithAuth('/api/init-user', { method: 'POST', body: JSON.stringify({ email: res.user.email, fullname: res.user.displayName || '' }) }).catch(console.error);
        }
    } catch (e) {
        toggleError('login', 'Erro Google.');
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

function toggleLoading(prefix, show) {
    const loader = document.getElementById(`${prefix}-loader`);
    const text = document.getElementById(`${prefix}-btn-text`);
    if (show) { loader?.classList.remove('hidden'); text?.classList.add('hidden'); }
    else { loader?.classList.add('hidden'); text?.classList.remove('hidden'); }
}

function toggleError(prefix, msg) {
    const el = document.getElementById(`${prefix}-error-msg`);
    if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
}

function showRegisterError(msg) { toggleError('register', msg); }

function showMessage(msg, type) {
    const m = document.getElementById('message-modal');
    const c = document.getElementById('message-modal-content');
    c.textContent = msg;
    c.className = `px-6 py-3 rounded-full shadow-2xl font-bold text-sm border border-[var(--border-color)] ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.add('hidden'), 3000);
}

function showError(msg) { showMessage(msg, 'error'); }

function updateUI() {
    updateWalletUI();
    updateProfileUI();
    updateRolloverUI();
    updateNavbarUI();
}