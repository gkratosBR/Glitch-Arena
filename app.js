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
        } catch (e) { throw new Error("Sessão expirada. Faça login novamente."); }
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

document.addEventListener('DOMContentLoaded', () => {
    initializeMainApp();
    setupAuthListeners();
    setupAppListeners();
});

// --- INICIALIZAÇÃO (LOGS [SYSTEM] PARA CONFIRMAR VERSÃO) ---
function initializeMainApp() {
    console.log(">>> [System] Inicializando App v2.3...");
    onAuthStateChanged(auth, async (user) => {
        if (appState.isRegistering) return;
        
        if (user) {
            console.log(">>> [System] Usuário detectado:", user.uid);
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
                showApp();
            } catch (e) {
                console.error(">>> [System] Erro init:", e);
                await signOut(auth);
                showAuth();
                if (!e.message.includes("404")) {
                    showMessage("Erro de conexão. Reconectando...", 'error');
                }
            }
        } else {
            console.log(">>> [System] Sem sessão. Mostrando Login.");
            appState.currentUser = null;
            showAuth();
        }
    });
}

// --- NAVEGAÇÃO BLINDADA ---

function navigateAuth(pageId) {
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.style.display = ''; 
    });
    const target = document.getElementById(pageId);
    if(target) {
        target.classList.add('active');
    }
    appState.currentAuthPage = pageId;
}

function navigateApp(pageId) {
    if (appState.currentAppPage === pageId) return;
    
    if (appState.currentAppPage) {
        const curr = document.getElementById(appState.currentAppPage);
        if(curr) curr.classList.remove('active');
    }
    
    const target = document.getElementById(pageId);
    if(target) {
        target.classList.add('active');
        // REMOVE HIDDEN do Tailwind se existir na página específica
        target.classList.remove('hidden'); 
    }
    
    appState.currentAppPage = pageId;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === pageId));
    
    if (pageId === 'home-page') appState.currentGame = null;
    if (pageId === 'profile-page') updateProfileUI();
    if (pageId === 'bets-page') fetchAndRenderActiveBets();
    if (pageId === 'history-page') fetchAndRenderHistoryBets();
}

// --- GERENCIAMENTO DE TELAS (O CORAÇÃO DO FIX) ---

function toggleShells(isApp) {
    const loading = document.getElementById('loading-shell');
    const authShell = document.getElementById('auth-shell');
    const appShell = document.getElementById('app-shell');

    // Esconde Loading
    if(loading) loading.classList.add('hidden');

    if (isApp) {
        // Esconde Auth
        if(authShell) {
            authShell.classList.add('hidden');
            authShell.classList.remove('flex'); 
        }
        // Mostra App
        if(appShell) {
            console.log(">>> [System] Revelando App Shell (Removendo .hidden)");
            appShell.classList.remove('hidden'); // ESSENCIAL: Remove a classe do Tailwind
            appShell.style.display = 'block'; // Força display
            setTimeout(() => appShell.style.opacity = '1', 50);
        }
    } else {
        // Mostra Auth
        if(authShell) {
            authShell.classList.remove('hidden');
            authShell.style.display = 'flex';
        }
        // Esconde App
        if(appShell) {
            appShell.classList.add('hidden');
            appShell.style.display = 'none';
        }
    }
}

function showApp() { 
    toggleShells(true); 
    appState.currentAppPage = null; 
    navigateApp('home-page');
    
    // Verificação final de segurança para forçar exibição
    setTimeout(() => {
        const home = document.getElementById('home-page');
        if(home && getComputedStyle(home).display === 'none') {
            console.warn(">>> [System] Forçando visibilidade da Home via JS");
            home.style.display = 'block';
            home.style.opacity = '1';
        }
    }, 200);
}

function showAuth() { 
    toggleShells(false); 
    navigateAuth('landing-page'); 
}

// --- LISTENERS E UI (Mantidos) ---

function setupAuthListeners() {
    const ids = ['auth-login-btn', 'register-goto-login', 'auth-register-btn', 'landing-cta-btn', 'login-goto-register'];
    ids.forEach(id => document.getElementById(id)?.addEventListener('click', () => navigateAuth(id.includes('login') ? 'login-page' : 'register-page')));

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('reg-submit').addEventListener('click', handleRegister); 
    document.getElementById('google-login-btn').addEventListener('click', handleGoogleLogin);

    document.getElementById('open-terms-btn').addEventListener('click', () => navigateAuth('terms-page'));
    const closeTerms = () => navigateAuth('register-page');
    document.getElementById('close-terms-btn').addEventListener('click', closeTerms);
    document.getElementById('terms-ok-btn').addEventListener('click', closeTerms);
    
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
    
    document.querySelectorAll('.connect-btn').forEach(btn => btn.addEventListener('click', (e) => openConnectModal(e.target.dataset.game)));
    
    document.getElementById('connect-modal-cancel').addEventListener('click', () => toggleModal('connect-modal', false));
    document.getElementById('connect-modal-submit').addEventListener('click', handleSubmitConnection);
    document.getElementById('connect-terms-check').addEventListener('change', (e) => {
        const btn = document.getElementById('connect-modal-submit');
        btn.disabled = !e.target.checked;
        btn.classList.toggle('opacity-50', !e.target.checked);
    });

    document.getElementById('bet-slip-fab').addEventListener('click', openBetSlipModal);
    document.getElementById('bet-slip-modal-close').addEventListener('click', () => toggleModal('bet-slip-modal', false));
    document.getElementById('bet-amount-input').addEventListener('input', updateBetSlipSummary);
    document.getElementById('place-bet-btn').addEventListener('click', handlePlaceBet);

    document.getElementById('open-request-bet-modal').addEventListener('click', openRequestBetModal);
    document.getElementById('request-modal-cancel').addEventListener('click', () => toggleModal('request-bet-modal', false));
    document.getElementById('request-modal-submit').addEventListener('click', handleRequestBet);
    document.getElementById('request-add-to-slip').addEventListener('click', handleAddCustomBetToSlip);
    document.getElementById('request-try-again').addEventListener('click', resetRequestModal);

    document.getElementById('kyc-form').addEventListener('submit', handleKycSubmit);
    document.getElementById('kyc-modal-cancel').addEventListener('click', () => toggleModal('kyc-modal', false));

    document.getElementById('open-deposit-modal').addEventListener('click', openDepositModal);
    document.getElementById('deposit-modal-cancel').addEventListener('click', () => toggleModal('deposit-modal', false));
    document.getElementById('deposit-confirm-btn').addEventListener('click', handleGeneratePix);
    document.getElementById('deposit-copy-btn').addEventListener('click', copyPixCode);
    document.getElementById('deposit-finish-btn').addEventListener('click', () => toggleModal('deposit-modal', false));
    
    document.querySelectorAll('.deposit-preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => document.getElementById('deposit-amount').value = e.target.dataset.value);
    });

    document.getElementById('open-withdraw-modal').addEventListener('click', openWithdrawModal);
    document.getElementById('withdraw-modal-cancel').addEventListener('click', () => toggleModal('withdraw-modal', false));
    document.getElementById('withdraw-confirm-btn').addEventListener('click', handleRequestWithdraw);

    document.getElementById('redeem-coupon-btn').addEventListener('click', handleRedeemCoupon);
    const refCodeEl = document.getElementById('my-referral-code');
    if(refCodeEl) {
        refCodeEl.addEventListener('click', () => {
            if(appState.myReferralCode) {
                navigator.clipboard.writeText(appState.myReferralCode);
                showMessage("Código copiado!", 'success');
            }
        });
    }

    document.getElementById('convert-bonus-btn').addEventListener('click', handleConvertBonus);
}

function setupRegistrationSteps() {
    const next1 = document.getElementById('reg-next-step-1');
    const next2 = document.getElementById('reg-next-step-2');
    const check = document.getElementById('reg-terms');
    const submit = document.getElementById('reg-submit');

    next1.addEventListener('click', () => {
        const p1 = document.getElementById('reg-password').value;
        const p2 = document.getElementById('reg-confirm-password').value;
        if (p1 !== p2 || p1.length < 6) return showRegisterError(p1 !== p2 ? "Senhas não coincidem." : "Mínimo 6 caracteres.");
        showRegisterError(null); 
        goToRegisterStep(2);
    });

    next2.addEventListener('click', () => {
        if (!document.getElementById('reg-fullname').value || !document.getElementById('reg-cpf').value || !document.getElementById('reg-birthdate').value) {
            return showRegisterError("Preencha todos os campos.");
        }
        showRegisterError(null); 
        goToRegisterStep(3);
    });

    check.addEventListener('change', () => {
        submit.disabled = !check.checked;
        submit.classList.toggle('opacity-50', !check.checked);
    });
}

function goToRegisterStep(step) {
    document.querySelectorAll('.register-step').forEach(s => s.classList.add('hidden'));
    const currentStepEl = document.getElementById(`register-step-${step}`);
    if (currentStepEl) currentStepEl.classList.remove('hidden');

    const indicators = [1, 2, 3];
    indicators.forEach(i => {
        const el = document.getElementById(`step-ind-${i}`);
        if (el) {
            el.classList.toggle('text-purple-400', i === step);
            el.classList.toggle('text-gray-600', i > step);
            el.classList.toggle('text-green-500', i < step);
            el.classList.toggle('font-bold', i === step);
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
        toggleError('login', error.code === 'auth/invalid-credential' ? 'Credenciais inválidas.' : 'Erro no login.');
        toggleLoading('login', false);
    }
}

async function handleGoogleLogin() {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const res = await signInWithPopup(auth, new GoogleAuthProvider());
        if (getAdditionalUserInfo(res).isNewUser) {
            appState.currentUser = res.user;
            await fetchWithAuth('/api/init-user', { method: 'POST', body: JSON.stringify({ email: res.user.email, fullname: res.user.displayName || '' }) });
        }
    } catch (e) {
        toggleError('login', 'Erro no Google Login.');
    }
}

async function handleRegister() {
    appState.isRegistering = true;
    toggleLoading('reg', true);
    const email = document.getElementById('reg-email').value;
    const referral = document.getElementById('reg-referral').value;
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
                referralCode: referral
            })
        });
        
        const data = await fetchWithAuth('/api/get-user-data');
        Object.assign(appState, { 
            wallet: data.wallet, bonus_wallet: data.bonus_wallet, rollover_target: data.rollover_target,
            connectedAccounts: data.connectedAccounts, 
            kycData: { fullname: data.fullname, cpf: data.cpf, birthdate: data.birthdate, kyc_status: data.kyc_status }, 
            currentBetLimit: data.currentBetLimit, myReferralCode: data.my_referral_code
        });
        
        showMessage("Cadastro com sucesso!", 'success');
        showApp();
    } catch (error) {
        showRegisterError(error.code === 'auth/email-already-in-use' ? 'E-mail em uso.' : error.message);
        if (appState.currentUser) await appState.currentUser.delete().catch(() => {});
        appState.currentUser = null;
        toggleLoading('reg', false);
    } finally {
        appState.isRegistering = false;
    }
}

async function handleLogout() {
    await signOut(auth);
    Object.assign(appState, { wallet: 0, bonus_wallet: 0, rollover_target: 0, connectedAccounts: {}, betSlip: [], currentGame: null, currentBetLimit: 3.00 });
    showAuth();
}

async function selectGame(gameType) {
    if (gameType !== 'lol') return showMessage("Em breve!", 'info');
    appState.currentGame = gameType;
    document.getElementById('challenges-title').textContent = 'League of Legends';
    navigateApp('challenges-page');
    
    if (appState.connectedAccounts[gameType]) {
        document.getElementById('challenges-subtitle').textContent = `Desafios para ${appState.connectedAccounts[gameType].playerId}`;
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
        list.innerHTML = `<p class="text-red-400">${e.message}</p>`;
    }
}

function renderChallenges(challenges) {
    const list = document.getElementById('challenges-list');
    list.innerHTML = '';
    if (!challenges?.length) return list.innerHTML = '<p class="text-gray-400">Sem desafios.</p>';
    
    challenges.forEach(c => {
        const div = document.createElement('div');
        div.className = 'glass-card p-4 flex justify-between items-center mb-2';
        
        const isSelected = appState.betSlip.some(i => i.id === c.id);
        
        div.innerHTML = `
            <div>
                <h3 class="text-lg font-semibold text-white">${c.title}</h3>
                <p class="text-sm text-gray-400">Multiplicador: <span class="font-bold primary-gradient-text">${c.odd.toFixed(2)}x</span></p>
            </div>
            <button class="add-to-slip-btn ${isSelected ? 'bg-green-600' : 'bg-purple-600'} text-white font-bold py-2 px-4 rounded-lg transition-all transform active:scale-95" data-id='${c.id}'>
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
    if (!btnElement) {
        btnElement = document.querySelector(`button[data-id='${challenge.id}']`);
    }

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
            return showError("Você já tem um desafio desse tipo selecionado.");
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

function openConnectModal(gameType) {
    appState.currentGame = gameType;
    document.getElementById('connect-modal-title').textContent = `Conectar ${gameType === 'lol' ? 'League of Legends' : ''}`;
    const acc = appState.connectedAccounts[gameType];
    document.getElementById('riot-id-input').value = acc?.playerId || '';
    toggleModal('connect-modal', true);
    toggleError('connect', null);
    
    const termCheck = document.getElementById('connect-terms-check');
    termCheck.checked = false;
    
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
        const userData = await fetchWithAuth('/api/get-user-data'); // Refresh
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

function openKycModal() {
    toggleError('kyc', null);
    const { fullname, cpf, birthdate } = appState.kycData;
    document.getElementById('kyc-modal-fullname').value = fullname;
    document.getElementById('kyc-modal-cpf').value = cpf;
    document.getElementById('kyc-modal-birthdate').value = birthdate;
    toggleModal('kyc-modal', true);
}

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

function updateWalletUI() {
    document.getElementById('wallet-balance').textContent = `GC ${appState.wallet.toFixed(2)}`;
    document.getElementById('bonus-balance').textContent = `GC ${appState.bonus_wallet.toFixed(2)}`;
}

function updateProfileUI() {
    const acc = appState.connectedAccounts['lol'];
    const status = document.getElementById('lol-status');
    const btn = document.getElementById('lol-connect-btn');
    
    if (acc) {
        status.textContent = `Conectado: ${acc.playerId}`;
        status.className = 'text-sm text-green-400';
        btn.textContent = 'Desconectar';
        btn.className = 'connect-btn bg-red-700 text-white font-semibold py-2 px-4 rounded-lg text-sm hover:bg-red-600';
        btn.onclick = () => handleDisconnect('lol');
    } else {
        status.textContent = 'Não conectado';
        status.className = 'text-sm text-gray-400';
        btn.textContent = 'Conectar';
        btn.className = 'connect-btn bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg text-sm hover:bg-gray-600';
        btn.onclick = () => openConnectModal('lol');
    }
    
    const { fullname, cpf, kyc_status } = appState.kycData;
    document.getElementById('kyc-loading').classList.add('hidden');
    document.getElementById('kyc-content').classList.remove('hidden');
    document.getElementById('kyc-fullname').textContent = fullname || appState.currentUser.email;
    document.getElementById('kyc-cpf').textContent = cpf ? `***.***.${cpf.slice(-6, -3)}-**` : 'Pendente';
    
    const statusEl = document.getElementById('kyc-status');
    statusEl.textContent = kyc_status.toUpperCase();
    
    let statusColor = 'bg-red-500';
    if(kyc_status === 'verified') statusColor = 'bg-green-500';
    else if(kyc_status === 'pending') statusColor = 'bg-yellow-500';
    
    statusEl.className = `text-white font-bold py-1 px-2 rounded-md text-sm ${statusColor}`;
    
    const verifyBtn = document.getElementById('kyc-verify-btn');
    verifyBtn.classList.toggle('hidden', kyc_status === 'verified');
    verifyBtn.onclick = openKycModal;

    const refEl = document.getElementById('my-referral-code');
    if(refEl) refEl.textContent = appState.myReferralCode || '...';

    const rolloverCont = document.getElementById('rollover-container');
    if (appState.bonus_wallet > 0 || appState.rollover_target > 0) {
        rolloverCont.classList.remove('hidden');
        const target = appState.rollover_target;
        document.getElementById('rollover-text').textContent = `GC ${target.toFixed(2)} restantes`;
        
        const bar = document.getElementById('rollover-bar');
        const convBtn = document.getElementById('convert-bonus-btn');
        
        if (target <= 0.50 && appState.bonus_wallet > 0) {
            bar.style.width = '100%';
            bar.className = 'bg-green-500 h-2.5 rounded-full';
            convBtn.disabled = false;
            convBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            convBtn.classList.add('bg-green-600', 'hover:bg-green-500');
            convBtn.textContent = "Converter para GC Reais";
        } else {
            bar.style.width = target > 0 ? '50%' : '0%'; 
            bar.className = 'bg-purple-600 h-2.5 rounded-full';
            convBtn.disabled = true;
            convBtn.classList.add('opacity-50', 'cursor-not-allowed');
            convBtn.classList.remove('bg-green-600', 'hover:bg-green-500');
            convBtn.textContent = "Complete o Desbloqueio";
        }
    } else {
        rolloverCont.classList.add('hidden');
    }
}

async function handleConvertBonus() {
    const btn = document.getElementById('convert-bonus-btn');
    const originalText = btn.textContent;
    btn.textContent = "Processando...";
    btn.disabled = true;
    
    try {
        const res = await fetchWithAuth('/api/convert-bonus', { method: 'POST' });
        appState.wallet += res.convertedAmount;
        appState.bonus_wallet = 0;
        appState.rollover_target = 0;
        updateWalletUI();
        updateProfileUI();
        showMessage(`GC ${res.convertedAmount.toFixed(2)} convertidos com sucesso!`, 'success');
    } catch (e) {
        showError(e.message);
    } finally {
        btn.textContent = originalText;
    }
}

async function handleRedeemCoupon() {
    const input = document.getElementById('coupon-input');
    const code = input.value.trim();
    if(!code) return showError("Digite um código.");
    
    const btn = document.getElementById('redeem-coupon-btn');
    const originalTxt = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/api/redeem-coupon', { method: 'POST', body: JSON.stringify({ code }) });
        const newData = await fetchWithAuth('/api/get-user-data'); 
        appState.bonus_wallet = newData.bonus_wallet;
        appState.rollover_target = newData.rollover_target;
        updateWalletUI();
        updateProfileUI();
        showMessage(`Bônus de GC ${res.amount.toFixed(2)} ativado!`, 'success');
        input.value = '';
    } catch (e) {
        showError(e.message);
    } finally {
        btn.textContent = originalTxt;
        btn.disabled = false;
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
        div.className = 'bet-slip-item p-3 rounded-lg flex justify-between items-center mb-2 bg-white/5';
        div.innerHTML = `<div class="flex-1"><p class="text-white font-semibold text-sm">${c.title}</p><p class="text-xs text-gray-400">Mult: ${c.odd.toFixed(2)}x</p></div><button class="text-red-500 font-bold p-2 hover:text-red-400">&times;</button>`;
        div.querySelector('button').onclick = () => {
            toggleBetSlipItem(c);
            openBetSlipModal(); 
            if(appState.betSlip.length === 0) toggleModal('bet-slip-modal', false);
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
    if (amount > totalFunds) return toggleError('bet-slip', "Glitchcoins insuficientes.");
    
    if (amount > appState.currentBetLimit) return toggleError('bet-slip', `Limite excedido (Máx: GC ${appState.currentBetLimit}).`);
    if (appState.kycData.kyc_status !== 'verified') return showError("KYC Pendente.");

    toggleLoading('place-bet', true);
    try {
        await fetchWithAuth('/api/place-bet', { method: 'POST', body: JSON.stringify({ betItems: appState.betSlip, betAmount: amount }) });
        
        const data = await fetchWithAuth('/api/get-user-data');
        appState.wallet = data.wallet;
        appState.bonus_wallet = data.bonus_wallet;
        appState.rollover_target = data.rollover_target;
        
        updateWalletUI();
        updateProfileUI();
        
        appState.betSlip = [];
        updateBetSlipUI();
        if(appState.currentGame) selectGame(appState.currentGame);
        
        showMessage("Desafio aceito!", 'success');
    } catch (e) {
        toggleError('bet-slip', e.message);
    } finally {
        toggleLoading('place-bet', false);
    }
}

async function fetchAndRenderActiveBets() {
    const list = document.getElementById('active-bets-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    try {
        const bets = await fetchWithAuth('/api/get-active-bets');
        list.innerHTML = bets.length ? bets.map(b => `
            <div class="glass-card p-4 mb-2">
                <p class="text-xs text-gray-400">Pendente...</p>
                <h3 class="text-lg font-semibold text-white">Desafio (${b.betItems.length}x)</h3>
                <ul class="text-sm text-gray-300 list-disc list-inside my-2">${b.betItems.map(i => `<li>${i.title}</li>`).join('')}</ul>
                <div class="text-sm border-t border-gray-700 pt-2 mt-2">Valor: GC ${b.betAmount.toFixed(2)} | Retorno: <span class="text-green-400">GC ${b.potentialWinnings.toFixed(2)}</span></div>
            </div>`).join('') : '<p class="text-gray-400">Nenhum desafio ativo.</p>';
    } catch (e) { list.innerHTML = '<p class="text-red-400">Erro ao carregar.</p>'; }
}

async function fetchAndRenderHistoryBets() {
    const list = document.getElementById('history-bets-list');
    list.innerHTML = '<div class="loader mx-auto"></div>';
    try {
        const bets = await fetchWithAuth('/api/get-history-bets');
        bets.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        list.innerHTML = bets.length ? bets.map(b => {
            const colors = { won: 'text-green-400 border-green-500', lost: 'text-red-400 border-red-500', void: 'text-gray-400 border-gray-500' };
            const st = b.status || 'lost';
            return `
            <div class="glass-card p-4 border-l-4 ${colors[st].split(' ')[1]} mb-2">
                <p class="text-xs font-bold ${colors[st].split(' ')[0]}">${st.toUpperCase()}</p>
                <h3 class="text-lg font-semibold text-white">Desafio (${b.betItems.length}x)</h3>
                <ul class="text-sm text-gray-300 list-disc list-inside my-2">${b.betItems.map(i => `<li>${i.title}</li>`).join('')}</ul>
                <div class="text-sm border-t border-gray-700 pt-2 mt-2">Resultado: <span class="${colors[st].split(' ')[0]} font-bold">${st === 'won' ? '+' : st === 'void' ? '+' : '-'}GC ${st === 'won' ? b.potentialWinnings.toFixed(2) : b.betAmount.toFixed(2)}</span></div>
            </div>`;
        }).join('') : '<p class="text-gray-400">Sem histórico.</p>';
    } catch (e) { list.innerHTML = '<p class="text-red-400">Erro ao carregar.</p>'; }
}

function openRequestBetModal() {
    if (!appState.currentGame || !appState.connectedAccounts[appState.currentGame]) return showError("Conecte a conta.");
    document.getElementById('request-target-label').textContent = `Meta de Kills`;
    resetRequestModal();
    toggleModal('request-bet-modal', true);
}

function resetRequestModal() {
    document.getElementById('request-result-container').classList.add('hidden');
    document.getElementById('request-form-container').classList.remove('hidden');
    document.getElementById('request-target-input').value = '';
    toggleError('request', null);
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
        document.getElementById('request-add-to-slip').dataset.challenge = JSON.stringify(c);
        document.getElementById('request-form-container').classList.add('hidden');
        document.getElementById('request-result-container').classList.remove('hidden');
    } catch (e) { toggleError('request', e.message); } finally { toggleLoading('request', false); }
}

function handleAddCustomBetToSlip(e) {
    toggleBetSlipItem(JSON.parse(e.target.dataset.challenge));
    toggleModal('request-bet-modal', false);
}

function openDepositModal() {
    if (appState.kycData.kyc_status !== 'verified') return showError("Valide o KYC.");
    document.getElementById('deposit-amount').value = '';
    document.getElementById('deposit-step-1').classList.remove('hidden');
    document.getElementById('deposit-step-2').classList.add('hidden');
    const couponInput = document.getElementById('deposit-coupon-input');
    if(couponInput) couponInput.value = '';
    toggleModal('deposit-modal', true);
}

async function handleGeneratePix() {
    const val = parseFloat(document.getElementById('deposit-amount').value);
    const couponCode = document.getElementById('deposit-coupon-input')?.value || '';
    if (val < 20) return toggleError('deposit', "Mínimo R$ 20.");
    
    toggleLoading('deposit', true);
    try {
        const data = await fetchWithAuth('/api/deposit/generate-pix', { 
            method: 'POST', body: JSON.stringify({ amount: val, couponCode: couponCode })
        });
        document.getElementById('deposit-qrcode-img').src = data.qrCodeBase64;
        document.getElementById('deposit-copypaste').value = data.copyPaste;
        document.getElementById('deposit-step-1').classList.add('hidden');
        document.getElementById('deposit-step-2').classList.remove('hidden');
        if(data.bonusApplied) showMessage("Cupom ativado!", 'success');
    } catch (e) { toggleError('deposit', e.message); } finally { toggleLoading('deposit', false); }
}

function copyPixCode() {
    const el = document.getElementById('deposit-copypaste');
    el.select();
    navigator.clipboard.writeText(el.value);
    showMessage("Copiado!", 'success');
}

function openWithdrawModal() {
    if (appState.kycData.kyc_status !== 'verified') return showError("Valide o KYC.");
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
        updateWalletUI();
        toggleModal('withdraw-modal', false);
        showMessage("Solicitado!", 'success');
    } catch (e) { toggleError('withdraw', e.message); } finally { toggleLoading('withdraw', false); }
}

function toggleModal(id, show) {
    const el = document.getElementById(id);
    const back = document.getElementById('modal-backdrop');
    if (show) { el.classList.remove('hidden'); back.classList.remove('hidden'); }
    else { el.classList.add('hidden'); back.classList.add('hidden'); }
}

function toggleLoading(prefix, show) {
    const loader = document.getElementById(`${prefix}-loader`) || document.getElementById(`${prefix}-modal-loader`);
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
    c.className = `p-4 rounded-lg text-white font-semibold ${type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.add('hidden'), 3000);
}

function showError(msg) { showMessage(msg, 'error'); }