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
        let errorMsg = `Erro ${response.status}`;
        try {
            const data = await response.json();
            errorMsg = data.detail || data.error || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
    }
    return response.json();
}

// --- INICIALIZAÇÃO (CLEAN) ---
document.addEventListener('DOMContentLoaded', () => {
    console.log(">>> App v3.0 Iniciando (Clean Slate)...");
    initializeMainApp();
    setupAuthListeners();
    setupAppListeners();
});

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
                
                updateWalletUI();
                updateProfileUI();
                
                // Mostra o App Shell
                toggleShells('app');
                navigateApp('home-page');
            } catch (e) {
                console.error(">>> Erro Init:", e);
                await signOut(auth);
                toggleShells('auth');
                showMessage("Erro de conexão. Tente novamente.", 'error');
            }
        } else {
            console.log(">>> Sem Usuário. Mostrando Login.");
            appState.currentUser = null;
            toggleShells('auth');
            navigateAuth('landing-page');
        }
    });
}

// --- GERENCIAMENTO DE TELAS (LÓGICA CORRETA) ---

function toggleShells(mode) {
    const loading = document.getElementById('loading-shell');
    const authShell = document.getElementById('auth-shell');
    const appShell = document.getElementById('app-shell');

    // 1. Remove Loader
    loading.classList.add('hidden');

    if (mode === 'app') {
        // Esconde Auth (remove display:flex, add hidden)
        authShell.classList.remove('flex');
        authShell.classList.add('hidden');
        
        // Mostra App (remove hidden, add display:block)
        appShell.classList.remove('hidden');
        appShell.classList.add('block');
    } else {
        // Mostra Auth (remove hidden, add display:flex para centralizar)
        authShell.classList.remove('hidden');
        authShell.classList.add('flex');
        
        // Esconde App
        appShell.classList.remove('block');
        appShell.classList.add('hidden');
    }
}

function navigateAuth(pageId) {
    // Esconde todas as páginas de Auth
    document.querySelectorAll('#auth-shell .page').forEach(p => p.classList.remove('active'));
    
    // Mostra a desejada
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    
    appState.currentAuthPage = pageId;
}

function navigateApp(pageId) {
    if (appState.currentAppPage === pageId) return;

    // Remove active da atual
    if (appState.currentAppPage) {
        const curr = document.getElementById(appState.currentAppPage);
        if (curr) curr.classList.remove('active');
    }

    // Adiciona active na nova e garante que não esteja hidden
    const target = document.getElementById(pageId);
    if (target) {
        target.classList.remove('hidden'); // Remove a classe do Tailwind se existir
        target.classList.add('active');    // Ativa a animação do CSS
    }

    appState.currentAppPage = pageId;

    // Atualiza Barra de Navegação
    document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.dataset.page === pageId);
    });

    // Hooks de Página
    if (pageId === 'home-page') appState.currentGame = null;
    if (pageId === 'profile-page') updateProfileUI();
    if (pageId === 'bets-page') fetchAndRenderActiveBets();
    if (pageId === 'history-page') fetchAndRenderHistoryBets();
}

// --- UI HELPERS ---

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
    c.className = `px-6 py-3 rounded-full shadow-2xl font-bold text-sm ${type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.add('hidden'), 3000);
}

function showError(msg) { showMessage(msg, 'error'); }

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

    // Termos
    document.getElementById('open-terms-btn').addEventListener('click', () => toggleModal('terms-page', true));
    document.getElementById('close-terms-btn').addEventListener('click', () => toggleModal('terms-page', false));
    document.getElementById('terms-ok-btn').addEventListener('click', () => toggleModal('terms-page', false));
    
    setupRegistrationSteps();
}

function setupAppListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    document.querySelector('.bottom-nav').addEventListener('click', (e) => {
        const btn = e.target.closest('button.nav-item');
        if (btn) navigateApp(btn.dataset.page);
    });

    document.querySelectorAll('.game-select-card').forEach(card => {
        card.addEventListener('click', () => selectGame(card.id.split('-')[1]));
    });

    document.getElementById('back-to-home').addEventListener('click', () => navigateApp('home-page'));
    
    // Connect
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
            el.className = i === step ? 'text-purple-400 font-bold text-xs' : 'text-gray-600 text-xs';
        }
    });
}

// --- AUTH HANDLERS ---

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
            // Tenta criar, se falhar o backend auto-heal cuida
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
        
        // Force reload para pegar dados limpos
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

// --- LÓGICA DE NEGÓCIO ---

async function selectGame(gameType) {
    if (gameType !== 'lol') return showMessage("Em breve!", 'info');
    appState.currentGame = gameType;
    document.getElementById('challenges-title').textContent = 'League of Legends';
    navigateApp('challenges-page');
    
    if (appState.connectedAccounts[gameType]) {
        document.getElementById('challenges-subtitle').textContent = `Conta: ${appState.connectedAccounts[gameType].playerId}`;
        document.getElementById('request-bet-card').classList.remove('hidden');
        await fetchChallenges(gameType);
    } else {
        document.getElementById('challenges-subtitle').textContent = "Conecte sua conta no Perfil.";
        document.getElementById('challenges-list').innerHTML = '';
        document.getElementById('request-bet-card').classList.add('hidden');
    }
}

async function fetchChallenges(gameType) {
    const list = document.getElementById('challenges-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    try {
        const challenges = await fetchWithAuth('/api/get-challenges', { method: 'POST', body: JSON.stringify({ gameType }) });
        renderChallenges(challenges);
    } catch (e) {
        list.innerHTML = `<p class="text-red-400 text-center text-sm">${e.message}</p>`;
    }
}

function renderChallenges(challenges) {
    const list = document.getElementById('challenges-list');
    list.innerHTML = '';
    if (!challenges?.length) return list.innerHTML = '<p class="text-gray-400 text-center text-sm">Sem desafios disponíveis.</p>';
    
    challenges.forEach(c => {
        const div = document.createElement('div');
        div.className = 'glass-card p-4 flex justify-between items-center mb-2';
        const isSelected = appState.betSlip.some(i => i.id === c.id);
        
        div.innerHTML = `
            <div>
                <h3 class="font-bold text-white">${c.title}</h3>
                <p class="text-xs text-gray-400">Mult: <span class="font-bold text-purple-400">${c.odd.toFixed(2)}x</span></p>
            </div>
            <button class="w-8 h-8 rounded flex items-center justify-center font-bold transition ${isSelected ? 'bg-green-600' : 'bg-purple-600'}" data-id='${c.id}'>
                ${isSelected ? '✓' : '+'}
            </button>`;
            
        div.querySelector('button').onclick = (e) => {
            e.stopPropagation(); 
            toggleBetSlipItem(c, e.target);
        };
        list.appendChild(div);
    });
}

function toggleBetSlipItem(challenge, btnElement) {
    if (!btnElement) btnElement = document.querySelector(`button[data-id='${challenge.id}']`);
    const idx = appState.betSlip.findIndex(i => i.id === challenge.id);
    
    if (idx > -1) {
        appState.betSlip.splice(idx, 1);
        if (btnElement) {
            btnElement.classList.remove('bg-green-600');
            btnElement.classList.add('bg-purple-600');
            btnElement.textContent = '+';
        }
    } else {
        if (appState.betSlip.some(i => i.gameType === challenge.gameType && i.conflictKey === challenge.conflictKey)) {
            return showError("Conflito de aposta.");
        }
        appState.betSlip.push(challenge);
        if (btnElement) {
            btnElement.classList.remove('bg-purple-600');
            btnElement.classList.add('bg-green-600');
            btnElement.textContent = '✓';
        }
    }
    updateBetSlipUI();
}

// --- PERFIL & CONEXÃO ---

function openConnectModal(gameType) {
    appState.currentGame = gameType;
    document.getElementById('connect-modal-title').textContent = `Conectar ${gameType === 'lol' ? 'LoL' : ''}`;
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
        updateProfileUI();
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
        updateProfileUI();
        if (appState.currentGame === gameType) selectGame(gameType);
        showMessage("Desconectado.", 'success');
    } catch (e) { showError(e.message); }
}

function updateProfileUI() {
    const acc = appState.connectedAccounts['lol'];
    const status = document.getElementById('lol-status');
    const btn = document.getElementById('lol-connect-btn');
    
    if (acc) {
        status.textContent = acc.playerId;
        status.className = 'text-[10px] text-green-400';
        btn.textContent = 'Desconectar';
        btn.className = 'connect-btn text-xs bg-red-900/50 px-3 py-1 rounded hover:bg-red-900 text-white';
        btn.onclick = () => handleDisconnect('lol');
    } else {
        status.textContent = 'Não conectado';
        status.className = 'text-[10px] text-gray-500';
        btn.textContent = 'Conectar';
        btn.className = 'connect-btn text-xs bg-white/10 px-3 py-1 rounded hover:bg-white/20 text-white';
        btn.onclick = () => openConnectModal('lol');
    }
    
    const { fullname, cpf, kyc_status } = appState.kycData;
    document.getElementById('kyc-loading').classList.add('hidden');
    document.getElementById('kyc-content').classList.remove('hidden');
    document.getElementById('kyc-fullname').textContent = fullname || appState.currentUser.email;
    document.getElementById('kyc-cpf').textContent = cpf ? `***.***.${cpf.slice(-6, -3)}-**` : 'Pendente';
    
    const statusEl = document.getElementById('kyc-status');
    statusEl.textContent = kyc_status.toUpperCase();
    statusEl.className = `text-[10px] px-2 rounded py-0.5 font-bold ${kyc_status === 'verified' ? 'bg-green-600' : 'bg-gray-700'}`;
    
    const verifyBtn = document.getElementById('kyc-verify-btn');
    verifyBtn.classList.toggle('hidden', kyc_status === 'verified');
    verifyBtn.onclick = () => toggleModal('kyc-modal', true);

    const refEl = document.getElementById('my-referral-code');
    if(refEl) refEl.textContent = appState.myReferralCode || '...';

    updateWalletUI();
    updateRolloverUI();
}

// --- KYC ---
async function handleKycSubmit(e) {
    e.preventDefault();
    const fullname = document.getElementById('kyc-modal-fullname').value;
    const cpf = document.getElementById('kyc-modal-cpf').value;
    const birthdate = document.getElementById('kyc-modal-birthdate').value;
    if (!fullname || !cpf || !birthdate) return toggleError('kyc', "Preencha tudo.");
    
    toggleLoading('kyc-modal', true);
    try {
        appState.kycData = await fetchWithAuth('/api/validate-kyc', { method: 'POST', body: JSON.stringify({ fullname, cpf, birthdate }) });
        const userData = await fetchWithAuth('/api/get-user-data');
        appState.currentBetLimit = userData.currentBetLimit;
        updateProfileUI();
        toggleModal('kyc-modal', false);
        showMessage("Verificado!", 'success');
    } catch (e) {
        toggleError('kyc', e.message);
    } finally {
        toggleLoading('kyc-modal', false);
    }
}

// --- CARTEIRA & APOSTAS ---

function updateWalletUI() {
    document.getElementById('wallet-balance').textContent = `GC ${appState.wallet.toFixed(2)}`;
    document.getElementById('bonus-balance').textContent = `GC ${appState.bonus_wallet.toFixed(2)}`;
    document.getElementById('withdraw-max-balance').textContent = appState.wallet.toFixed(2);
}

function updateRolloverUI() {
    const container = document.getElementById('rollover-container');
    if (appState.bonus_wallet > 0 || appState.rollover_target > 0) {
        container.classList.remove('hidden');
        document.getElementById('rollover-text').textContent = `GC ${appState.rollover_target.toFixed(2)}`;
        const bar = document.getElementById('rollover-bar');
        const btn = document.getElementById('convert-bonus-btn');
        
        if (appState.rollover_target <= 0.5) {
            bar.style.width = '100%';
            bar.classList.replace('bg-purple-600', 'bg-green-500');
            btn.disabled = false;
            btn.classList.replace('bg-gray-700', 'bg-green-600');
            btn.textContent = "Resgatar Bônus";
        } else {
            bar.style.width = '50%'; // Simplificado
            btn.disabled = true;
            btn.textContent = "Complete o Rollover";
        }
    } else {
        container.classList.add('hidden');
    }
}

function updateBetSlipUI() {
    const fab = document.getElementById('bet-slip-fab');
    if (appState.betSlip.length) {
        fab.classList.remove('hidden');
        document.getElementById('bet-slip-count').textContent = appState.betSlip.length;
    } else {
        fab.classList.add('hidden');
        toggleModal('bet-slip-modal', false);
    }
    updateBetSlipSummary();
}

function openBetSlipModal() {
    if (!appState.betSlip.length) return;
    const list = document.getElementById('bet-slip-list');
    list.innerHTML = '';
    appState.betSlip.forEach(c => {
        const div = document.createElement('div');
        div.className = 'p-3 rounded flex justify-between items-center mb-2 bg-white/5 border border-white/5';
        div.innerHTML = `<div class="flex-1"><p class="font-bold text-sm">${c.title}</p><p class="text-xs text-gray-400">${c.odd.toFixed(2)}x</p></div><button class="text-red-500 font-bold">&times;</button>`;
        div.querySelector('button').onclick = () => {
            toggleBetSlipItem(c);
            if(appState.betSlip.length === 0) toggleModal('bet-slip-modal', false);
            else openBetSlipModal();
        };
        list.appendChild(div);
    });
    document.getElementById('bet-slip-limit-info').textContent = `Limite: GC ${appState.currentBetLimit.toFixed(2)}`;
    document.getElementById('bet-slip-limit-info').classList.remove('hidden');
    toggleModal('bet-slip-modal', true);
}

function updateBetSlipSummary() {
    const amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    const odd = appState.betSlip.reduce((a, b) => a * b.odd, 1);
    document.getElementById('bet-slip-total-odd').textContent = odd.toFixed(2) + 'x';
    document.getElementById('bet-potential-winnings').textContent = `GC ${(amount * odd).toFixed(2)}`;
}

async function handlePlaceBet() {
    const amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    if (amount <= 0) return toggleError('bet-slip', "Valor inválido.");
    
    const totalFunds = appState.wallet + appState.bonus_wallet;
    if (amount > totalFunds) return toggleError('bet-slip', "Saldo insuficiente.");
    if (amount > appState.currentBetLimit) return toggleError('bet-slip', `Limite: GC ${appState.currentBetLimit}`);
    if (appState.kycData.kyc_status !== 'verified') return showError("Valide sua identidade.");

    toggleLoading('place-bet', true);
    try {
        await fetchWithAuth('/api/place-bet', { method: 'POST', body: JSON.stringify({ betItems: appState.betSlip, betAmount: amount }) });
        
        const data = await fetchWithAuth('/api/get-user-data');
        appState.wallet = data.wallet;
        appState.bonus_wallet = data.bonus_wallet;
        appState.rollover_target = data.rollover_target;
        
        updateWalletUI();
        updateRolloverUI();
        appState.betSlip = [];
        updateBetSlipUI();
        toggleModal('bet-slip-modal', false);
        showMessage("Aposta confirmada!", 'success');
    } catch (e) {
        toggleError('bet-slip', e.message);
    } finally {
        toggleLoading('place-bet', false);
    }
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
        addBtn.onclick = () => {
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

function handleAddCustomBetToSlip(e) { /* Logic moved inside handleRequestBet closure */ }

// --- DEPOSIT / WITHDRAW / COUPON ---

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
        updateWalletUI();
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
        updateWalletUI();
        updateRolloverUI();
        showMessage(`Bônus de ${res.amount} GC ativado!`, 'success');
    } catch (e) { showError(e.message); }
}

async function handleConvertBonus() {
    try {
        const res = await fetchWithAuth('/api/convert-bonus', { method: 'POST' });
        appState.wallet += res.convertedAmount;
        appState.bonus_wallet = 0;
        appState.rollover_target = 0;
        updateWalletUI();
        updateRolloverUI();
        showMessage("Convertido com sucesso!", 'success');
    } catch (e) { showError(e.message); }
}

// --- HISTORY ---
async function fetchAndRenderActiveBets() {
    const list = document.getElementById('active-bets-list');
    list.innerHTML = '<div class="text-center"><div class="loader w-6 h-6 inline-block"></div></div>';
    try {
        const bets = await fetchWithAuth('/api/get-active-bets');
        list.innerHTML = bets.length ? bets.map(b => `
            <div class="glass-card p-4">
                <div class="flex justify-between text-xs text-gray-400 mb-2"><span>Pendente</span><span>${new Date(b.createdAt).toLocaleDateString()}</span></div>
                <div class="space-y-1 mb-3">${b.betItems.map(i => `<p class="text-sm font-bold">▪ ${i.title}</p>`).join('')}</div>
                <div class="text-xs flex justify-between border-t border-white/10 pt-2">
                    <span>Aposta: GC ${b.betAmount}</span>
                    <span class="text-green-400">Retorno: GC ${b.potentialWinnings.toFixed(2)}</span>
                </div>
            </div>`).join('') : '<p class="text-gray-500 text-center text-sm">Nenhuma aposta ativa.</p>';
    } catch (e) { list.innerHTML = `<p class="text-red-400 text-center text-xs">${e.message}</p>`; }
}

async function fetchAndRenderHistoryBets() {
    const list = document.getElementById('history-bets-list');
    list.innerHTML = '<div class="text-center"><div class="loader w-6 h-6 inline-block"></div></div>';
    try {
        const bets = await fetchWithAuth('/api/get-history-bets');
        bets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        list.innerHTML = bets.length ? bets.map(b => {
            const color = b.status === 'won' ? 'text-green-400' : b.status === 'void' ? 'text-gray-400' : 'text-red-400';
            const result = b.status === 'won' ? `+GC ${b.potentialWinnings.toFixed(2)}` : b.status === 'void' ? `+GC ${b.betAmount}` : `-GC ${b.betAmount}`;
            return `
            <div class="glass-card p-4 border-l-2 ${b.status === 'won' ? 'border-green-500' : 'border-red-500'}">
                <div class="flex justify-between text-xs mb-2"><span class="font-bold uppercase ${color}">${b.status}</span><span class="text-gray-500">${new Date(b.createdAt).toLocaleDateString()}</span></div>
                <div class="space-y-1 mb-2">${b.betItems.map(i => `<p class="text-sm">▪ ${i.title}</p>`).join('')}</div>
                <div class="text-right font-bold ${color}">${result}</div>
            </div>`;
        }).join('') : '<p class="text-gray-500 text-center text-sm">Sem histórico.</p>';
    } catch (e) { list.innerHTML = `<p class="text-red-400 text-center text-xs">${e.message}</p>`; }
}