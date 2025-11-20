import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdTokenResult
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCb3csf_fKDif-PwQXfTf6P_aolbK4Dm3Y",
    authDomain: "primegame-7cea1.firebaseapp.com",
    projectId: "primegame-7cea1",
    storageBucket: "primegame-7cea1.firebasestorage.app",
    messagingSenderId: "369035051769",
    appId: "1:369035051769:web:c72189abab203fdb8c1828",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const API_URL = '';
let revenueChart = null;

async function fetchWithAdminAuth(endpoint, options = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error("Admin não autenticado.");
    
    const idToken = await user.getIdToken();
    options.headers = { ...options.headers, 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    
    const response = await fetch(`${API_URL}${endpoint}`, options);
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${response.status}`);
    }
    return response.json();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
    document.getElementById('admin-logout-btn').addEventListener('click', () => signOut(auth));
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const tokenResult = await getIdTokenResult(user, true);
                if (tokenResult.claims.admin) showAdminPanel(user);
                else {
                    showLoginError("Acesso negado. Não é admin.");
                    await signOut(auth);
                }
            } catch (e) { showLoginError("Erro de permissão."); }
        } else {
            showLoginPage();
        }
    });
});

async function handleAdminLogin(e) {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('admin-email').value, document.getElementById('admin-password').value);
    } catch (e) {
        showLoginError("Credenciais inválidas.");
    }
}

function showLoginPage() {
    document.getElementById('admin-login-shell').classList.remove('hidden');
    document.getElementById('admin-panel-shell').classList.add('hidden');
}

function showAdminPanel(user) {
    document.getElementById('admin-user-email').textContent = user.email;
    document.getElementById('admin-login-shell').classList.add('hidden');
    document.getElementById('admin-panel-shell').classList.remove('hidden');
    
    loadDashboardData();
    loadConfigData();
    
    document.getElementById('config-form').addEventListener('submit', handleSaveConfig);
    document.getElementById('create-coupon-form').addEventListener('submit', handleCreateCoupon);
    
    const refBtn = document.getElementById('save-referral-btn');
    if (refBtn) {
        refBtn.addEventListener('click', handleSaveReferralConfig);
    }

    const depReqCheck = document.getElementById('config-referral-deposit-req');
    if(depReqCheck) {
        depReqCheck.addEventListener('change', (e) => {
            document.getElementById('config-referral-min-trigger').disabled = !e.target.checked;
        });
    }

    document.getElementById('search-user-btn').addEventListener('click', handleSearchUser);
}

function showLoginError(msg) {
    const el = document.getElementById('admin-login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

async function loadDashboardData() {
    try {
        const stats = await fetchWithAdminAuth('/api/admin/dashboard-stats');

        const plEl = document.getElementById('kpi-platform-pl');
        plEl.textContent = `R$ ${stats.platform_pl.toFixed(2)}`;
        plEl.className = `text-2xl font-bold ${stats.platform_pl >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        document.getElementById('kpi-total-users').textContent = stats.total_users;
        document.getElementById('kpi-revenue').textContent = `R$ ${(stats.revenue_data.reduce((a, b) => a + b.faturamento, 0)).toFixed(2)}`;

        renderRevenueChart(stats.revenue_data);
        
        const winnersList = document.getElementById('top-winners-list');
        winnersList.innerHTML = stats.top_winners.length ? stats.top_winners.map(e => `<li class="text-sm text-white">${e}</li>`).join('') : '<li class="text-sm text-gray-400">Sem dados.</li>';
        
        const kycList = document.getElementById('kyc-queue-list');
        kycList.innerHTML = stats.kyc_pending_queue.length ? stats.kyc_pending_queue.map(u => `
            <li class="text-sm text-white bg-gray-800 p-2 rounded-md mb-2">
                <p>${u.email}</p>
                <p class="text-xs text-gray-400">${u.fullname} | CPF: ${u.cpf}</p>
                <div class="mt-2 flex gap-2">
                    <button class="bg-green-600 text-xs py-1 px-2 rounded hover:bg-green-500">Aprovar</button>
                    <button class="bg-red-600 text-xs py-1 px-2 rounded hover:bg-red-500">Rejeitar</button>
                </div>
            </li>`).join('') : '<li class="text-sm text-gray-400">Fila vazia.</li>';

    } catch (e) { console.error(e); }
}

async function loadConfigData() {
    try {
        const c = await fetchWithAdminAuth('/api/admin/get-config');
        
        // Configurações Gerais
        document.getElementById('config-margin-main').value = (c.margins.main * 100).toFixed(0);
        document.getElementById('config-margin-stats').value = (c.margins.stats * 100).toFixed(0);
        document.getElementById('config-min-deposit').value = c.payment.min_deposit;
        document.getElementById('config-min-withdrawal').value = c.payment.min_withdrawal;
        
        document.getElementById('config-suitpay-client-id').value = c.payment_gateway?.client_id || '';
        document.getElementById('config-suitpay-client-secret').value = c.payment_gateway?.client_secret || '';
        
        document.getElementById('config-min-level').value = c.risk.min_summoner_level;
        document.getElementById('config-max-global-bet-limit').value = c.limits?.max_global_bet_limit || 200;
        
        document.getElementById('config-stats-ttl').value = c.system.stats_ttl_minutes;
        document.getElementById('config-resolution-interval').value = c.system.resolution_interval_minutes;

        // --- REFERRAL ---
        const ref = c.referral || {};
        
        document.getElementById('config-referrer-amount').value = ref.referrer_amount || 5.00;
        document.getElementById('config-referrer-type').value = ref.referrer_reward_type || 'bonus_wallet';

        document.getElementById('config-referee-amount').value = ref.referee_amount || 5.00;
        document.getElementById('config-referee-type').value = ref.referee_reward_type || 'bonus_wallet';
        
        const depositReq = ref.deposit_required || false;
        document.getElementById('config-referral-deposit-req').checked = depositReq;
        
        const triggerInput = document.getElementById('config-referral-min-trigger');
        triggerInput.value = ref.min_deposit_trigger || 20.00;
        triggerInput.disabled = !depositReq;

        // NOVO: Carrega o Multiplicador de Rollover
        document.getElementById('config-rollover-multiplier').value = ref.rollover_multiplier || 20.0;

    } catch (e) { console.error("Erro ao carregar config:", e); }
}

async function handleSaveConfig(e) {
    e.preventDefault();
    await saveAllConfig("main");
}

async function handleSaveReferralConfig(e) {
    e.preventDefault();
    await saveAllConfig("referral");
}

async function saveAllConfig(source) {
    const btnId = source === "main" ? 'config-save-btn' : 'save-referral-btn';
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const originalTxt = btn.textContent;
    btn.textContent = "Salvando...";
    btn.disabled = true;

    try {
        const getVal = (id, def) => {
            const el = document.getElementById(id);
            return el ? parseFloat(el.value) : def;
        };
        const getStr = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };
        const getBool = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        };

        const newConfig = {
            margins: {
                main: getVal('config-margin-main', 15) / 100,
                stats: getVal('config-margin-stats', 30) / 100
            },
            payment: {
                min_deposit: getVal('config-min-deposit', 20),
                min_withdrawal: getVal('config-min-withdrawal', 50)
            },
            payment_gateway: {
                client_id: getStr('config-suitpay-client-id'),
                client_secret: getStr('config-suitpay-client-secret')
            },
            risk: {
                min_summoner_level: parseInt(getVal('config-min-level', 100))
            },
            limits: {
                max_global_bet_limit: getVal('config-max-global-bet-limit', 200)
            },
            referral: {
                referrer_amount: getVal('config-referrer-amount', 5.00),
                referrer_reward_type: getStr('config-referrer-type') || 'bonus_wallet',
                
                referee_amount: getVal('config-referee-amount', 5.00),
                referee_reward_type: getStr('config-referee-type') || 'bonus_wallet',
                
                deposit_required: getBool('config-referral-deposit-req'),
                min_deposit_trigger: getVal('config-referral-min-trigger', 20.00),
                
                // NOVO: Salva o Multiplicador de Rollover
                rollover_multiplier: getVal('config-rollover-multiplier', 20.0)
            },
            system: {
                stats_ttl_minutes: parseInt(getVal('config-stats-ttl', 45)),
                resolution_interval_minutes: parseInt(getVal('config-resolution-interval', 10))
            }
        };
        
        await fetchWithAdminAuth('/api/admin/set-config', { method: 'POST', body: JSON.stringify(newConfig) });
        alert(source === "main" ? "Configurações Gerais salvas!" : "Regra de Indicação atualizada!");
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        btn.textContent = originalTxt;
        btn.disabled = false;
    }
}

async function handleCreateCoupon(e) {
    e.preventDefault();
    const btn = document.getElementById('create-coupon-btn');
    const resDiv = document.getElementById('coupon-result');
    const resCode = document.getElementById('coupon-result-code');
    
    btn.disabled = true;
    btn.innerHTML = "Criando...";
    resDiv.classList.add('hidden');

    const payload = {
        code: document.getElementById('coupon-code').value,
        amount: document.getElementById('coupon-amount').value,
        min_deposit_required: document.getElementById('coupon-min-deposit').value,
        max_uses: document.getElementById('coupon-max-uses').value
    };

    try {
        const data = await fetchWithAdminAuth('/api/admin/create-coupon', { 
            method: 'POST', 
            body: JSON.stringify(payload) 
        });
        
        resCode.textContent = data.code;
        resCode.onclick = () => {
            navigator.clipboard.writeText(data.code);
            alert("Copiado!");
        };
        resDiv.classList.remove('hidden');
        document.getElementById('create-coupon-form').reset();
    } catch (error) {
        alert(`Erro ao criar cupom: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Criar Cupom";
    }
}

async function handleSearchUser() {
    const email = document.getElementById('search-user-email').value;
    const res = document.getElementById('search-user-result');
    
    if (!email) return;
    res.textContent = "Buscando...";
    res.classList.remove('hidden', 'text-red-400');
    res.className = "mt-4 text-gray-400 text-sm";
    
    try {
        const u = await fetchWithAdminAuth(`/api/admin/find-user?email=${email}`);
        res.className = "mt-4 text-sm text-white p-3 bg-gray-800 rounded-lg space-y-1";
        
        res.innerHTML = `
            <p><strong>ID:</strong> ${u.userId}</p>
            <p><strong>Nome:</strong> ${u.fullname || '-'}</p>
            <p><strong>CPF:</strong> ${u.cpf || '-'}</p>
            <p><strong>KYC:</strong> <span class="${u.kyc_status === 'verified' ? 'text-green-400' : 'text-yellow-400'} font-bold">${u.kyc_status}</span></p>
            <hr class="border-gray-600 my-2">
            <p><strong>Saldo Real:</strong> R$ ${u.wallet.toFixed(2)}</p>
            <p><strong>Saldo Bônus:</strong> <span class="text-purple-400 font-bold">R$ ${(u.bonus_wallet || 0).toFixed(2)}</span></p>
            <p><strong>Rollover Restante:</strong> R$ ${(u.rollover_target || 0).toFixed(2)}</p>
            <p><strong>P/L:</strong> <span class="${u.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'}">R$ ${u.profit_loss.toFixed(2)}</span></p>
            <hr class="border-gray-600 my-2">
            <p><strong>Meu Código:</strong> <span class="font-mono bg-gray-700 px-1 rounded">${u.my_referral_code || '-'}</span></p>
            <p><strong>Indicado por:</strong> ${u.referred_by || 'Ninguém'}</p>
        `;
    } catch (e) {
        res.textContent = e.message;
        res.className = "mt-4 text-red-400 text-sm";
    }
}

function renderRevenueChart(data) {
    const ctx = document.getElementById('revenue-chart').getContext('2d');
    if (revenueChart) revenueChart.destroy();
    
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.month),
            datasets: [{
                label: 'Faturamento',
                data: data.map(d => d.faturamento),
                borderColor: '#8A2BE2',
                backgroundColor: 'rgba(138, 43, 226, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#9ca3af' } },
                x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#9ca3af' } }
            },
            plugins: { legend: { labels: { color: '#e5e7eb' } } }
        }
    });
}