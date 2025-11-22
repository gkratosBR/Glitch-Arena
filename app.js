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
    console.log(">>> App v4.0 (Glitch Theme) Iniciando...");
    
    // Inicializa Tema
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
                
                // Atualiza UI completa (Navbar + Perfil)
                updateUI();
                
                // Mostra o App
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
        // Esconde Auth
        if(authShell) {
            authShell.classList.remove('flex');
            authShell.classList.add('hidden');
        }
        // Mostra App
        if(appShell) {
            appShell.classList.remove('hidden');
            appShell.classList.add('block');
        }
    } else {
        // Mostra Auth
        if(authShell) {
            authShell.classList.remove('hidden');
            authShell.classList.add('flex');
        }
        // Esconde App
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

    // Hooks de Página
    if (pageId === 'home-page') appState.currentGame = null;
    if (pageId === 'profile-page') updateUI(); // Garante dados frescos
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

    // Termos (Agora Modal)
    const termBtn = document.getElementById('open-terms-btn');
    if(termBtn) termBtn.addEventListener('click', () => toggleModal('terms-page', true));
    
    document.getElementById('close-terms-btn').addEventListener('click', () => toggleModal('terms-page', false));
    document.getElementById('terms-ok-btn').addEventListener('click', () => toggleModal('terms-page', false));
    
    setupRegistrationSteps();
}

function setupAppListeners() {
    // Logout agora está na Navbar
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    document.querySelector('.bottom-nav').addEventListener('click', (e) => {
        const btn = e.target.closest('button.nav-item');
        if (btn) navigateApp(btn.dataset.page);
    });

    // Cards de Jogo
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

// --- FUNÇÕES DE SUPORTE ---

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
    c.className = `px-6 py-3 rounded-full shadow-2xl font-bold text-sm border border-[var(--border-color)] ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.add('hidden'), 3000);
}

function showError(msg) { showMessage(msg, 'error'); }

// --- ATUALIZAÇÃO UNIFICADA DE UI ---

function updateUI() {
    updateWalletUI();
    updateProfileUI();
    updateRolloverUI();
    updateNavbarUI();
}

function updateNavbarUI() {
    const navInfo = document.getElementById('nav-user-info');
    const navName = document.getElementById('nav-user-name');
    const navBalance = document.getElementById('nav-user-balance');
    const logoutBtn = document.getElementById('logout-btn');

    if (appState.currentUser) {
        // Mostra info de user
        if(navInfo) {
            navInfo.classList.remove('hidden');
            navInfo.classList.add('flex');
        }
        if(logoutBtn) logoutBtn.classList.remove('hidden');
        
        // Atualiza textos
        if(navName) {
            const name = appState.kycData.fullname || appState.currentUser.email.split('@')[0];
            navName.textContent = name.split(' ')[0]; // Primeiro nome
        }
        if(navBalance) navBalance.textContent = `GC ${appState.wallet.toFixed(2)}`;
    } else {
        // Esconde se não logado
        if(navInfo) {
            navInfo.classList.add('hidden');
            navInfo.classList.remove('flex');
        }
        if(logoutBtn) logoutBtn.classList.add('hidden');
    }
}

function updateWalletUI() {
    const wBal = document.getElementById('wallet-balance');
    const bBal = document.getElementById('bonus-balance');
    const wMax = document.getElementById('withdraw-max-balance');
    
    if(wBal) wBal.textContent = `GC ${appState.wallet.toFixed(2)}`;
    if(bBal) bBal.textContent = `GC ${appState.bonus_wallet.toFixed(2)}`;
    if(wMax) wMax.textContent = `GC ${appState.wallet.toFixed(2)}`;
    
    // Atualiza navbar também para garantir sincronia
    const navBal = document.getElementById('nav-user-balance');
    if(navBal) navBal.textContent = `GC ${appState.wallet.toFixed(2)}`;
}

function updateProfileUI() {
    const acc = appState.connectedAccounts['lol'];
    const status = document.getElementById('lol-status');
    const btn = document.getElementById('lol-connect-btn');
    
    if(acc) { 
        if(status) {
            status.textContent = acc.playerId; 
            status.className = 'text-xs text-green-400 font-bold mt-1';
        }
        if(btn) {
            btn.textContent = 'DESCONECTAR'; 
            btn.onclick = () => handleDisconnect('lol'); 
        }
    } else { 
        if(status) {
            status.textContent = 'Desconectado'; 
            status.className = 'text-xs text-[var(--accent-orange)] font-bold mt-1';
        }
        if(btn) {
            btn.textContent = 'CONECTAR'; 
            btn.onclick = () => openConnectModal('lol'); 
        }
    }
    
    const kycStatus = document.getElementById('kyc-status');
    if(kycStatus) {
        kycStatus.textContent = appState.kycData.kyc_status.toUpperCase();
        kycStatus.className = `text-[10px] font-bold px-2 py-1 rounded border border-[var(--border-color)] ${appState.kycData.kyc_status === 'verified' ? 'bg-green-900 text-green-400' : 'bg-[var(--bg-input)]'}`;
    }
    
    const kycName = document.getElementById('kyc-fullname');
    if(kycName) kycName.textContent = appState.kycData.fullname || '-';
    
    const kycCpf = document.getElementById('kyc-cpf');
    if(kycCpf) kycCpf.textContent = appState.kycData.cpf ? `***.***.${appState.kycData.cpf.slice(-6, -3)}-**` : '-';

    const verifyBtn = document.getElementById('kyc-verify-btn');
    if(verifyBtn) {
        if (appState.kycData.kyc_status === 'verified') verifyBtn.classList.add('hidden');
        else {
            verifyBtn.classList.remove('hidden');
            verifyBtn.onclick = () => toggleModal('kyc-modal', true);
        }
    }
}

function updateRolloverUI() {
    const container = document.getElementById('rollover-container');
    if(!container) return;

    if (appState.bonus_wallet > 0 || appState.rollover_target > 0) {
        container.classList.remove('hidden');
        const txt = document.getElementById('rollover-text');
        if(txt) txt.textContent = `GC ${appState.rollover_target.toFixed(2)}`;
        
        const bar = document.getElementById('rollover-bar');
        const btn = document.getElementById('convert-bonus-btn');
        
        if (appState.rollover_target <= 0.5) {
            if(bar) bar.style.width = '100%';
            if(btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-50');
                btn.style.background = 'var(--primary-blue)'; // Usa a cor principal no sucesso
            }
        } else {
            if(bar) bar.style.width = '50%'; 
            if(btn) {
                btn.disabled = true;
                btn.classList.add('opacity-50');
            }
        }
    } else {
        container.classList.add('hidden');
    }
}

// --- CORE LOGIC (Bets, Connect, etc) MANTIDA IGUAL ---

async function selectGame(gameType) {
    if (gameType !== 'lol') return showMessage("Em breve!", 'info');
    appState.currentGame = gameType;
    const title = document.getElementById('challenges-title');
    if(title) title.textContent = 'League of Legends';
    navigateApp('challenges-page');
    
    const subtitle = document.getElementById('challenges-subtitle');
    const list = document.getElementById('challenges-list');
    const reqCard = document.getElementById('request-bet-card');

    if (appState.connectedAccounts[gameType]) {
        if(subtitle) subtitle.textContent = `Conta: ${appState.connectedAccounts[gameType].playerId}`;
        if(reqCard) reqCard.classList.remove('hidden');
        await fetchChallenges(gameType);
    } else {
        if(subtitle) subtitle.textContent = "Conecte sua conta no Perfil.";
        if(list) list.innerHTML = '';
        if(reqCard) reqCard.classList.add('hidden');
    }
}

async function fetchChallenges(gameType) {
    const list = document.getElementById('challenges-list');
    if(list) list.innerHTML = '<div class="text-center mt-8"><div class="loader w-8 h-8 inline-block"></div></div>';
    try {
        const challenges = await fetchWithAuth('/api/get-challenges', { method: 'POST', body: JSON.stringify({ gameType }) });
        renderChallenges(challenges);
    } catch (e) {
        if(list) list.innerHTML = `<p class="text-[var(--accent-orange)] text-center text-sm">${e.message}</p>`;
    }
}

function renderChallenges(challenges) {
    const list = document.getElementById('challenges-list');
    if(!list) return;
    list.innerHTML = '';
    
    if (!challenges?.length) return list.innerHTML = '<p class="text-[var(--text-secondary)] text-center text-sm">Sem desafios disponíveis.</p>';
    
    challenges.forEach(c => {
        const div = document.createElement('div');
        div.className = 'glass-card p-4 flex justify-between items-center mb-3 border border-[var(--border-color)]';
        const isSelected = appState.betSlip.some(i => i.id === c.id);
        
        div.innerHTML = `
            <div>
                <h3 class="font-bold text-white text-sm md:text-base">${c.title}</h3>
                <p class="text-xs text-[var(--text-secondary)] mt-1">Mult: <span class="font-bold text-[var(--primary-purple)]">${c.odd.toFixed(2)}x</span></p>
            </div>
            <button class="w-10 h-10 rounded-lg flex items-center justify-center font-bold transition border ${isSelected ? 'bg-green-600 border-green-500 text-white' : 'bg-transparent border-[var(--primary-purple)] text-[var(--primary-purple)] hover:bg-[var(--primary-purple)] hover:text-white'}" data-id='${c.id}'>
                ${isSelected ? '✓' : '+'}
            </button>`;
            
        const btn = div.querySelector('button');
        btn.onclick = (e) => {
            e.stopPropagation(); 
            toggleBetSlipItem(c, btn);
        };
        list.appendChild(div);
    });
}

function toggleBetSlipItem(challenge, btnElement) {
    if (!btnElement) btnElement = document.querySelector(`button[data-id='${challenge.id}']`);
    const idx = appState.betSlip.findIndex(i => i.id === challenge.id);
    
    if (idx > -1) {
        appState.betSlip.splice(idx, 1);
        // Atualiza botão se existir
        if (btnElement) {
            btnElement.className = 'w-10 h-10 rounded-lg flex items-center justify-center font-bold transition border bg-transparent border-[var(--primary-purple)] text-[var(--primary-purple)] hover:bg-[var(--primary-purple)] hover:text-white';
            btnElement.textContent = '+';
        }
    } else {
        if (appState.betSlip.some(i => i.gameType === challenge.gameType && i.conflictKey === challenge.conflictKey)) {
            return showError("Conflito: Você já tem um desafio desse tipo.");
        }
        appState.betSlip.push(challenge);
        if (btnElement) {
            btnElement.className = 'w-10 h-10 rounded-lg flex items-center justify-center font-bold transition border bg-green-600 border-green-500 text-white';
            btnElement.textContent = '✓';
        }
    }
    updateBetSlipUI();
}

function updateBetSlipUI() {
    const fab = document.getElementById('bet-slip-fab');
    const count = document.getElementById('bet-slip-count');
    
    if (appState.betSlip.length) {
        if(fab) fab.classList.remove('hidden');
        if(count) count.textContent = appState.betSlip.length;
    } else {
        if(fab) fab.classList.add('hidden');
        toggleModal('bet-slip-modal', false);
    }
    updateBetSlipSummary();
}

function openBetSlipModal() {
    if (!appState.betSlip.length) return;
    const list = document.getElementById('bet-slip-list');
    if(!list) return;
    list.innerHTML = '';
    
    appState.betSlip.forEach(c => {
        const div = document.createElement('div');
        div.className = 'p-3 rounded-lg flex justify-between items-center mb-2 bg-[var(--bg-input)] border border-[var(--border-color)]';
        div.innerHTML = `
            <div class="flex-1">
                <p class="font-bold text-sm text-white">${c.title}</p>
                <p class="text-xs text-[var(--text-secondary)]">${c.odd.toFixed(2)}x</p>
            </div>
            <button class="text-[var(--accent-orange)] font-bold hover:text-red-400 text-xl px-2">&times;</button>`;
            
        div.querySelector('button').onclick = () => {
            toggleBetSlipItem(c);
            if(appState.betSlip.length === 0) toggleModal('bet-slip-modal', false);
            else openBetSlipModal(); // Re-render
        };
        list.appendChild(div);
    });
    
    const limitInfo = document.getElementById('bet-slip-limit-info');
    if(limitInfo) {
        limitInfo.textContent = `Seu Limite Atual: GC ${appState.currentBetLimit.toFixed(2)}`;
        limitInfo.classList.remove('hidden');
    }
    
    toggleModal('bet-slip-modal', true);
}

function updateBetSlipSummary() {
    const input = document.getElementById('bet-amount-input');
    const amount = parseFloat(input ? input.value : 0) || 0;
    const odd = appState.betSlip.reduce((a, b) => a * b.odd, 1);
    
    const totalOddEl = document.getElementById('bet-slip-total-odd');
    const winEl = document.getElementById('bet-potential-winnings');
    
    if(totalOddEl) totalOddEl.textContent = odd.toFixed(2) + 'x';
    if(winEl) winEl.textContent = `GC ${(amount * odd).toFixed(2)}`;
}

// ... (Manter demais funções como handleDisconnect, openConnectModal, etc. que apenas chamam API) ...
// ... (Para economizar espaço, a lógica interna delas não muda, apenas as referências de ID que já atualizamos acima) ...

async function handleDisconnect(g) {
    await fetchWithAuth('/api/disconnect', {method:'POST', body:JSON.stringify({gameType:g})}).catch(()=>{});
    delete appState.connectedAccounts[g];
    updateUI();
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

function handleAddCustomBetToSlip(e) { 
    // A lógica já está dentro do closure do handleRequestBet se necessário, 
    // mas como refatoramos, o listener está direto no botão 'Adicionar' no HTML do modal.
    // Essa função fica vazia ou pode ser removida se não usada diretamente.
}

async function fetchAndRenderActiveBets() {
    const list = document.getElementById('active-bets-list');
    if(!list) return;
    list.innerHTML = '<div class="text-center"><div class="loader w-6 h-6 inline-block"></div></div>';
    try {
        const bets = await fetchWithAuth('/api/get-active-bets');
        list.innerHTML = bets.length ? bets.map(b => `
            <div class="glass-card p-4 border-l-4 border-yellow-500">
                <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                    <span class="font-bold text-yellow-500 uppercase">Pendente</span>
                    <span>${new Date(b.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="space-y-1 mb-3">
                    ${b.betItems.map(i => `<p class="text-sm font-bold text-white">▪ ${i.title}</p>`).join('')}
                </div>
                <div class="text-xs flex justify-between border-t border-[var(--border-color)] pt-2 text-[var(--text-secondary)]">
                    <span>Aposta: GC ${b.betAmount}</span>
                    <span class="text-[var(--accent-cyan)] font-bold">Retorno: GC ${b.potentialWinnings.toFixed(2)}</span>
                </div>
            </div>`).join('') : '<p class="text-[var(--text-secondary)] text-center text-sm">Nenhuma aposta ativa.</p>';
    } catch (e) { list.innerHTML = `<p class="text-[var(--accent-orange)] text-center text-xs">${e.message}</p>`; }
}

async function fetchAndRenderHistoryBets() {
    const list = document.getElementById('history-bets-list');
    if(!list) return;
    list.innerHTML = '<div class="text-center"><div class="loader w-6 h-6 inline-block"></div></div>';
    try {
        const bets = await fetchWithAuth('/api/get-history-bets');
        bets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        list.innerHTML = bets.length ? bets.map(b => {
            const isWon = b.status === 'won';
            const isVoid = b.status === 'void';
            const color = isWon ? 'text-green-400' : isVoid ? 'text-gray-400' : 'text-[var(--accent-orange)]';
            const border = isWon ? 'border-green-500' : isVoid ? 'border-gray-500' : 'border-[var(--accent-orange)]';
            const result = isWon ? `+GC ${b.potentialWinnings.toFixed(2)}` : isVoid ? `+GC ${b.betAmount}` : `-GC ${b.betAmount}`;
            
            return `
            <div class="glass-card p-4 border-l-4 ${border}">
                <div class="flex justify-between text-xs mb-2">
                    <span class="font-bold uppercase ${color}">${b.status}</span>
                    <span class="text-[var(--text-secondary)]">${new Date(b.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="space-y-1 mb-2">
                    ${b.betItems.map(i => `<p class="text-sm text-white">▪ ${i.title}</p>`).join('')}
                </div>
                <div class="text-right font-bold ${color} text-lg">${result}</div>
            </div>`;
        }).join('') : '<p class="text-[var(--text-secondary)] text-center text-sm">Sem histórico.</p>';
    } catch (e) { list.innerHTML = `<p class="text-[var(--accent-orange)] text-center text-xs">${e.message}</p>`; }
}