import os
import math
import threading
import uuid
import random
import string
import json
import time
import logging
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager

# FastAPI Imports
from fastapi import FastAPI, HTTPException, Request, Depends, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict

# Scheduler
from apscheduler.schedulers.background import BackgroundScheduler

# Firebase
import firebase_admin
from firebase_admin import credentials, auth, firestore
from firebase_admin.firestore import FieldFilter
from google.cloud.firestore_v1.transaction import Transaction

# Logic Imports
import prime_engine as odds_engine
import riot_api
from datetime import datetime, timedelta, timezone

# --- CONFIGURAÇÃO DE LOGS ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("GlitchArena")

# --- FIREBASE CONFIG ---
firebase_creds_json = os.getenv("FIREBASE_CREDENTIALS")

if not firebase_admin._apps:
    if firebase_creds_json:
        cred_dict = json.loads(firebase_creds_json)
        cred = credentials.Certificate(cred_dict)
    elif os.path.exists("serviceAccountKey.json"):
        cred = credentials.Certificate("serviceAccountKey.json")
    else:
        logger.critical("Credenciais do Firebase não encontradas! O app vai falhar.")
    
    try:
        firebase_admin.initialize_app(cred)
        logger.info("Firebase inicializado com sucesso.")
    except ValueError: pass

db = firestore.client()

# --- LIFESPAN ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(_resolve_bets_logic, 'interval', minutes=10)
    scheduler.start()
    logger.info(">>> SISTEMA: Agendador de desafios (Worker) INICIADO.")
    yield
    scheduler.shutdown()
    logger.info(">>> SISTEMA: Agendador de desafios DESLIGADO.")

app = FastAPI(lifespan=lifespan, title="Glitch Arena API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MIDDLEWARE ---
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    if process_time > 1.0:
        logger.warning(f"Rota Lenta: {request.url.path} levou {process_time:.4f}s")
    return response

# --- MODELS ---
class InitUserRequest(BaseModel):
    email: str
    cpf: Optional[str] = ""
    fullname: Optional[str] = ""
    birthdate: Optional[str] = ""
    referralCode: Optional[str] = ""

class BetItem(BaseModel):
    gameType: str
    odd: float
    model_config = ConfigDict(extra='allow')

class PlaceBetRequest(BaseModel):
    betAmount: float
    betItems: List[Dict[str, Any]]

class CouponRequest(BaseModel):
    code: str
    amount: Optional[float] = 0
    min_deposit_required: Optional[float] = 0
    max_uses: Optional[int] = 0

class ConnectRequest(BaseModel):
    playerId: str
    gameType: str

class GetChallengesRequest(BaseModel):
    gameType: str

class RequestBetRequest(BaseModel):
    gameType: str
    target: int

class DepositRequest(BaseModel):
    amount: float

class WithdrawRequest(BaseModel):
    amount: float

class ValidationKycRequest(BaseModel):
    fullname: str
    cpf: str
    birthdate: str

# --- DEPENDÊNCIAS ---
async def get_current_user_uid(authorization: str = Header(None)):
    if not authorization: raise HTTPException(401, "Token ausente")
    try:
        token = authorization.split(" ")[1]
        return auth.verify_id_token(token)['uid']
    except Exception as e: 
        logger.warning(f"Falha de Auth UID: {e}")
        raise HTTPException(401, "Token inválido")

async def get_current_user_token(authorization: str = Header(None)):
    if not authorization: raise HTTPException(401, "Token ausente")
    try:
        token = authorization.split(" ")[1]
        return auth.verify_id_token(token)
    except Exception as e: 
        logger.warning(f"Falha de Auth Token: {e}")
        raise HTTPException(401, "Token inválido")

async def verify_admin(authorization: str = Header(None)):
    if not authorization: raise HTTPException(401, "Token ausente")
    try:
        decoded = auth.verify_id_token(authorization.split(" ")[1])
        if not decoded.get('admin'): 
            logger.warning(f"Tentativa de acesso Admin negada: {decoded.get('email')}")
            raise HTTPException(403, "Requer admin")
        return decoded['uid']
    except Exception as e: raise HTTPException(401, f"Erro auth: {str(e)}")

# --- HELPERS ---
def get_platform_config():
    try:
        c = db.collection('platform').document('config').get().to_dict() or {}
        defaults = {
            "risk": {'min_summoner_level': 100}, "payment": {'min_deposit': 20.0, 'min_withdrawal': 50.0},
            "margins": {'main': 0.15, 'stats': 0.30}, "system": {'stats_ttl_minutes': 45, 'resolution_interval_minutes': 10},
            "limits": {'max_global_bet_limit': 200.0}, "referral": {'referrer_amount': 5.00, 'rollover_multiplier': 20.0},
            "payment_gateway": {'client_id': '', 'client_secret': ''}
        }
        for k, v in defaults.items(): 
            if k not in c: c[k] = v
        return c
    except Exception as e:
        logger.error(f"Erro ao ler config: {e}")
        return {}

def _calculate_user_bet_limit(user_data, platform_config):
    total_bets = user_data.get('total_bets_made', 0)
    kyc = user_data.get('kyc_status', 'pending')
    deposited, wagered = user_data.get('total_deposited', 0.0), user_data.get('total_wagered', 0.0)
    limit = 3.00
    if total_bets >= 3: limit = 5.00
    if total_bets >= 7: limit = 10.00
    if kyc == 'verified': limit = 20.00
    if kyc == 'verified' and deposited >= 100 and wagered >= 250: limit = 50.00
    if kyc == 'verified' and deposited >= 500 and wagered >= 1000: limit = 100.00
    
    last = user_data.get('lastBetPlacedAt')
    if last:
        if hasattr(last, 'replace'): last = last.replace(tzinfo=None)
        if (datetime.now(timezone.utc).replace(tzinfo=None) - last) > timedelta(days=30) and limit > 20: limit = 20.00

    global_max = platform_config.get('limits', {}).get('max_global_bet_limit', 200.0)
    return min(limit, user_data.get('wallet', 0.0) * 0.25 or limit, global_max)

def _generate_referral_code(p=''): return (p+''.join(random.choices(string.ascii_uppercase+string.digits,k=6))).upper()

# --- LÓGICA DE BACKGROUND (ASYNC PROCESSING) ---
def process_riot_connection(user_id: str, player_id: str):
    """
    Processa a conexão com a Riot em segundo plano.
    Isso evita que o usuário fique esperando na tela.
    """
    logger.info(f"Background: Iniciando processamento de conexão para {player_id} (User: {user_id})")
    try:
        cfg = get_platform_config()
        
        # 1. Busca dados na Riot (Pode demorar 5-10s)
        p_data = riot_api.get_player_data(player_id, 'lol')
        
        # 2. Valida conta
        val = odds_engine.validate_account(p_data, cfg['risk'].get('min_summoner_level', 100))
        
        if not val['valid']:
            logger.warning(f"Background: Conexão rejeitada para {player_id}: {val['reason']}")
            # Salva erro no perfil para o frontend mostrar
            db.collection('users').document(user_id).set({
                "connection_status": "error",
                "connection_message": val['reason']
            }, merge=True)
            return

        # 3. Sucesso - Salva dados
        db.collection('users').document(user_id).set({
            "connectedAccounts": {
                "lol": {
                    "playerId": player_id, 
                    "puuid": p_data['puuid'], 
                    "stats": p_data['stats'], 
                    "connectedAt": firestore.SERVER_TIMESTAMP
                }
            },
            "connection_status": "connected", # Sinaliza sucesso para o frontend
            "connection_message": "Conectado com sucesso!"
        }, merge=True)
        
        db.collection('riotAccountLinks').document(p_data['puuid']).set({
            "linkedToUserId": user_id, 
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        
        logger.info(f"Background: Conexão finalizada com sucesso para {player_id}")

    except Exception as e:
        logger.error(f"Background: Erro crítico ao conectar {player_id}: {e}")
        db.collection('users').document(user_id).set({
            "connection_status": "error",
            "connection_message": "Erro ao comunicar com a Riot Games. Tente novamente."
        }, merge=True)

# --- TRANSAÇÕES (Mantidas) ---
@firestore.transactional
def tx_place_bet(transaction, user_ref, amount, bet_data):
    snap = user_ref.get(transaction=transaction)
    data = snap.to_dict()
    wallet, bonus = data.get("wallet", 0.0), data.get("bonus_wallet", 0.0)
    
    if (wallet + bonus) < amount: raise ValueError(f"Glitchcoins insuficientes. Disp: {wallet+bonus:.2f} GC")
    
    real_deduct = min(wallet, amount)
    bonus_deduct = amount - real_deduct
    
    updates = {
        "wallet": wallet - real_deduct, "bonus_wallet": bonus - bonus_deduct,
        "total_wagered": firestore.Increment(amount), "lastBetPlacedAt": firestore.SERVER_TIMESTAMP
    }
    if bonus_deduct > 0:
        updates["rollover_target"] = max(0, data.get('rollover_target', 0.0) - bonus_deduct)
        
    transaction.update(user_ref, updates)
    bet_data["split_stake"] = {"real": real_deduct, "bonus": bonus_deduct}
    transaction.set(db.collection('bets').document(), bet_data)
    return {"real": wallet - real_deduct, "bonus": bonus - bonus_deduct}

@firestore.transactional
def tx_redeem_coupon(transaction, user_ref, coupon_ref, usage_ref, amount, rollover_mult, user_id, code):
    c_snap = coupon_ref.get(transaction=transaction)
    if not c_snap.exists: raise ValueError("Cupom não existe")
    c_data = c_snap.to_dict()
    if not c_data.get('active') or c_data.get('type') == 'deposit': raise ValueError("Cupom inválido")
    if c_data.get('max_uses', 0) > 0 and c_data.get('current_uses', 0) >= c_data['max_uses']: raise ValueError("Esgotado")
        
    transaction.update(user_ref, {"bonus_wallet": firestore.Increment(amount), "rollover_target": firestore.Increment(amount * rollover_mult)})
    transaction.update(coupon_ref, {"current_uses": firestore.Increment(1)})
    transaction.set(usage_ref, {"userId": user_id, "code": code, "amount": amount, "usedAt": firestore.SERVER_TIMESTAMP})

@firestore.transactional
def tx_convert_bonus(transaction, user_ref):
    data = user_ref.get(transaction=transaction).to_dict()
    bonus = data.get('bonus_wallet', 0.0)
    if bonus <= 0: raise ValueError("Sem bônus")
    if data.get('rollover_target', 0.0) > 0.50: raise ValueError("Rollover pendente")
    transaction.update(user_ref, {"wallet": firestore.Increment(bonus), "bonus_wallet": 0.0, "rollover_target": 0.0})
    return bonus

@firestore.transactional
def tx_withdraw(transaction, user_ref, amount):
    snap = user_ref.get(transaction=transaction)
    current = snap.to_dict().get('wallet', 0.0)
    if current < amount: raise ValueError("Glitchcoins insuficientes")
    transaction.update(user_ref, {"wallet": current - amount})
    return current - amount

@firestore.transactional
def tx_resolve_bet(transaction, bet_ref, user_ref, bet_data, result):
    if bet_ref.get(transaction=transaction).to_dict().get('status') != 'pending': return
    
    up_user = {}
    up_bet = {"resolvedAt": firestore.SERVER_TIMESTAMP, "status": result}
    split = bet_data.get("split_stake", {"real": bet_data['betAmount'], "bonus": 0})

    if result == "void":
        up_user["wallet"] = firestore.Increment(split["real"])
        up_user["bonus_wallet"] = firestore.Increment(split["bonus"])
    elif result == "won":
        total = bet_data['betAmount']
        win = bet_data['potentialWinnings']
        ratio = split['real'] / total if total > 0 else 1
        up_user["wallet"] = firestore.Increment(win * ratio)
        up_user["bonus_wallet"] = firestore.Increment(win * (1 - ratio))
        up_user["profit_loss"] = firestore.Increment(win - total)
        up_user["total_bets_made"] = firestore.Increment(1)
    elif result == "lost":
        up_user["profit_loss"] = firestore.Increment(-bet_data['betAmount'])
        up_user["total_bets_made"] = firestore.Increment(1)

    transaction.update(user_ref, up_user)
    transaction.update(bet_ref, up_bet)

# --- ROTAS ---
@app.post("/api/init-user")
async def init_user(payload: InitUserRequest, user_id: str = Depends(get_current_user_uid)):
    try:
        if db.collection('users').document(user_id).get().exists: return {"status": "exists"}
        status = "verified" if payload.cpf and len(payload.cpf) >= 11 else "pending"
        db.collection('users').document(user_id).set({
            "email": payload.email, "wallet": 0.0, "bonus_wallet": 0.0, "rollover_target": 0.0,
            "connectedAccounts": {}, "createdAt": firestore.SERVER_TIMESTAMP, "profit_loss": 0.0, "total_bets_made": 0,
            "fullname": payload.fullname, "cpf": payload.cpf, "birthdate": payload.birthdate, "kyc_status": status,
            "total_wagered": 0.0, "total_deposited": 0.0, "currentBetLimit": 3.00, 
            "my_referral_code": _generate_referral_code("GLITCH"), "referred_by": None,
            "connection_status": "idle" # Estado inicial da conexão
        })
        return {"status": "success", "kyc_status": status}
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/get-user-data")
async def get_user_data_endpoint(decoded_token: dict = Depends(get_current_user_token)):
    user_id = decoded_token['uid']
    ref = db.collection('users').document(user_id)
    doc = ref.get()
    
    # AUTO-HEAL
    if not doc.exists:
        logger.warning(f"AUTO-HEAL: Usuário {user_id} sem dados. Recriando...")
        new_user_data = {
            "email": decoded_token.get('email', ''), 
            "wallet": 0.0, "bonus_wallet": 0.0, "rollover_target": 0.0,
            "connectedAccounts": {}, "createdAt": firestore.SERVER_TIMESTAMP, 
            "profit_loss": 0.0, "total_bets_made": 0,
            "fullname": "", "cpf": "", "birthdate": "", "kyc_status": "pending",
            "total_wagered": 0.0, "total_deposited": 0.0, "currentBetLimit": 3.00, 
            "my_referral_code": _generate_referral_code("GLITCH"), "referred_by": None,
            "connection_status": "idle"
        }
        ref.set(new_user_data)
        data = new_user_data
    else:
        data = doc.to_dict()

    limit = _calculate_user_bet_limit(data, get_platform_config())
    if limit != data.get('currentBetLimit'): 
        ref.update({'currentBetLimit': limit})
        data['currentBetLimit'] = limit
    
    return {
        "wallet": data.get("wallet", 0.0), "bonus_wallet": data.get("bonus_wallet", 0.0),
        "rollover_target": max(0, data.get("rollover_target", 0.0)), "connectedAccounts": data.get("connectedAccounts", {}),
        "profit_loss": data.get("profit_loss", 0.0), "total_bets_made": data.get("total_bets_made", 0),
        "fullname": data.get("fullname", ""), "cpf": data.get("cpf", ""), "birthdate": data.get("birthdate", ""),
        "kyc_status": data.get("kyc_status", "pending"), "currentBetLimit": limit,
        "my_referral_code": data.get("my_referral_code", "ERROR"),
        # Novos campos para feedback assíncrono
        "connection_status": data.get("connection_status", "idle"),
        "connection_message": data.get("connection_message", "")
    }

@app.post("/api/place-bet")
async def place_bet_endpoint(payload: PlaceBetRequest, user_id: str = Depends(get_current_user_uid)):
    # ... (Mantido igual) ...
    if payload.betAmount <= 0 or not payload.betItems: raise HTTPException(400, "Inválido")
    user_ref = db.collection('users').document(user_id)
    user_data = user_ref.get().to_dict()
    
    if payload.betAmount > user_data.get('currentBetLimit', 3.00): raise HTTPException(400, "Limite excedido")
    
    acct = user_data.get("connectedAccounts", {}).get(payload.betItems[0].get('gameType'))
    if not acct: raise HTTPException(400, "Conta não conectada")
    
    total_odd = round(math.prod([float(i.get('odd', 1.0)) for i in payload.betItems]), 2)
    bet_data = {
        "userId": user_id, "puuid": acct.get("puuid"), "gameType": payload.betItems[0].get('gameType'),
        "betAmount": payload.betAmount, "totalOdd": total_odd, "potentialWinnings": payload.betAmount * total_odd,
        "betItems": payload.betItems, "status": "pending", "createdAt": firestore.SERVER_TIMESTAMP,
        "lastMatchId": riot_api.get_last_match_id(acct.get("puuid"), "lol")
    }
    
    try:
        transaction = db.transaction()
        res = tx_place_bet(transaction, user_ref, payload.betAmount, bet_data)
        logger.info(f"Aposta recebida: User {user_id} apostou {payload.betAmount} em {total_odd}x")
        return {"status": "success", "newWallet": res['real'], "newBonusWallet": res['bonus']}
    except ValueError as e: 
        logger.warning(f"Aposta rejeitada: {e}")
        raise HTTPException(400, str(e))
    except Exception as e: 
        logger.error(f"Erro interno aposta: {e}")
        raise HTTPException(500, "Erro interno")

@app.post("/api/redeem-coupon")
async def redeem_coupon_endpoint(payload: CouponRequest, user_id: str = Depends(get_current_user_uid)):
    # ... (Mantido igual) ...
    code = payload.code.upper()
    coupons = list(db.collection('coupons').where(filter=FieldFilter('code', '==', code)).limit(1).stream())
    if not coupons: raise HTTPException(404, "Inválido")
    
    try:
        cfg = get_platform_config()
        transaction = db.transaction()
        tx_redeem_coupon(transaction, db.collection('users').document(user_id), coupons[0].reference, db.collection('coupon_usages').document(), coupons[0].to_dict()['amount'], float(cfg['referral']['rollover_multiplier']), user_id, code)
        logger.info(f"Cupom {code} resgatado por {user_id}")
        return {"status": "success", "amount": coupons[0].to_dict()['amount']}
    except ValueError as e: raise HTTPException(400, str(e))
    except Exception as e: raise HTTPException(500, str(e))

@app.post("/api/convert-bonus")
async def convert_bonus_endpoint(user_id: str = Depends(get_current_user_uid)):
    # ... (Mantido igual) ...
    try:
        transaction = db.transaction()
        val = tx_convert_bonus(transaction, db.collection('users').document(user_id))
        logger.info(f"User {user_id} converteu {val} de bônus.")
        return {"status": "success", "convertedAmount": val}
    except ValueError as e: raise HTTPException(400, str(e))

# --- ROTA MODIFICADA: BACKGROUND TASKS ---
@app.post("/api/connect")
async def connect_account_endpoint(
    payload: ConnectRequest, 
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_uid)
):
    """
    Inicia o processo de conexão em segundo plano e retorna IMEDIATAMENTE para o usuário.
    """
    try:
        # Define estado inicial como "processando"
        db.collection('users').document(user_id).set({
            "connection_status": "processing",
            "connection_message": "Analisando perfil na Riot Games..."
        }, merge=True)
        
        # Joga o trabalho pesado para o background
        background_tasks.add_task(process_riot_connection, user_id, payload.playerId)
        
        logger.info(f"Conexão agendada para {payload.playerId}")
        return {"status": "processing", "message": "Conexão iniciada. Aguarde a confirmação."}
        
    except Exception as e: 
        logger.error(f"Erro ao agendar conexão: {e}")
        raise HTTPException(500, "Erro interno ao processar solicitação.")

@app.post("/api/disconnect")
async def disconnect_endpoint(user_id: str = Depends(get_current_user_uid)):
    try:
        db.collection('users').document(user_id).update({
            "connectedAccounts.lol": firestore.DELETE_FIELD,
            "connection_status": "idle",
            "connection_message": ""
        })
        return {"status": "disconnected"}
    except Exception as e: raise HTTPException(500, str(e))

# ... (Resto das rotas mantidas iguais) ...
@app.post("/api/get-challenges")
async def get_challenges_endpoint(payload: GetChallengesRequest, user_id: str = Depends(get_current_user_uid)):
    try:
        acct = db.collection('users').document(user_id).get().to_dict().get("connectedAccounts", {}).get(payload.gameType)
        if not acct: raise HTTPException(400, "Não conectado")
        return odds_engine.generate_odds(acct, payload.gameType, get_platform_config().get("margins"))
    except Exception as e: raise HTTPException(500, str(e))

@app.post("/api/request-bet")
async def request_bet_endpoint(payload: RequestBetRequest, user_id: str = Depends(get_current_user_uid)):
    try:
        acct = db.collection('users').document(user_id).get().to_dict().get("connectedAccounts", {}).get(payload.gameType)
        if not acct: raise HTTPException(400, "Não conectado")
        res = odds_engine.calculate_custom_odd(acct, 'lol', payload.target, get_platform_config().get("margins"))
        if "error" in res: raise HTTPException(400, res["error"])
        return res
    except Exception as e: raise HTTPException(500, str(e))

@app.post("/api/validate-kyc")
async def validate_kyc_endpoint(payload: ValidationKycRequest, user_id: str = Depends(get_current_user_uid)):
    if not payload.cpf: raise HTTPException(400, "Dados inválidos")
    db.collection('users').document(user_id).update({"fullname": payload.fullname, "cpf": payload.cpf, "birthdate": payload.birthdate, "kyc_status": "verified"})
    logger.info(f"KYC atualizado para {user_id}")
    return {"status": "verified"}

@app.post("/api/withdraw/request")
async def withdraw_request_endpoint(payload: WithdrawRequest, user_id: str = Depends(get_current_user_uid)):
    if payload.amount < 50: raise HTTPException(400, "Mínimo 50 GC")
    try:
        transaction = db.transaction()
        new_bal = tx_withdraw(transaction, db.collection('users').document(user_id), payload.amount)
        db.collection('withdrawals').add({"userId": user_id, "amount": payload.amount, "status": "processing", "createdAt": firestore.SERVER_TIMESTAMP})
        logger.info(f"Saque solicitado: {payload.amount} por {user_id}")
        return {"status": "success", "newWallet": new_bal}
    except ValueError as e: raise HTTPException(400, str(e))

@app.post("/api/deposit/generate-pix")
async def deposit_pix_endpoint(payload: DepositRequest, user_id: str = Depends(get_current_user_uid)):
    if payload.amount < 20: raise HTTPException(400, "Mínimo R$ 20")
    fake_pix = f"00020126580014BR.GOV.BCB.PIX0136{uuid.uuid4()}520400005303986540{payload.amount:.2f}5802BR5913SUITPAY"
    db.collection('pending_deposits').add({"userId": user_id, "amount": payload.amount, "status": "pending", "qrCode": fake_pix, "createdAt": firestore.SERVER_TIMESTAMP})
    logger.info(f"PIX gerado para {user_id} de R$ {payload.amount}")
    return {"qrCodeBase64": f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={fake_pix}", "copyPaste": fake_pix, "bonusApplied": False}

@app.get("/api/get-active-bets")
async def get_active_bets(user_id: str = Depends(get_current_user_uid)):
    docs = db.collection('bets').where(filter=FieldFilter('userId', '==', user_id)).where(filter=FieldFilter('status', '==', 'pending')).stream()
    return [{**d.to_dict(), 'id': d.id} for d in docs]

@app.get("/api/get-history-bets")
async def get_history_bets(user_id: str = Depends(get_current_user_uid)):
    docs = db.collection('bets').where(filter=FieldFilter('userId', '==', user_id)).where(filter=FieldFilter('status', 'in', ["won", "lost", "void"])).stream()
    return [{**d.to_dict(), 'id': d.id, 'createdAt': str(d.to_dict().get('createdAt', '')), 'resolvedAt': str(d.to_dict().get('resolvedAt', ''))} for d in docs]

# --- ROTAS ADMIN ---
@app.post("/api/admin/set-admin")
async def set_admin_claim(req: Request, uid: str = Depends(verify_admin)):
    data = await req.json()
    user = auth.get_user_by_email(data.get('email'))
    auth.set_custom_user_claims(user.uid, {'admin': True})
    return {"status": "Sucesso"}

@app.get("/api/admin/dashboard-stats")
async def get_dashboard_stats(uid: str = Depends(verify_admin)):
    pl = db.collection('platform').document('stats').get().to_dict().get("total_profit_loss", 0.0) or 0.0
    return {"platform_pl": pl, "total_users": 0, "top_winners": [], "revenue_data": [], "kyc_pending_queue": []}

@app.get("/api/admin/get-config")
async def get_config_route(uid: str = Depends(verify_admin)): return get_platform_config()

@app.post("/api/admin/set-config")
async def set_config_route(req: Request, uid: str = Depends(verify_admin)):
    db.collection('platform').document('config').set(await req.json())
    return {"status": "sucesso"}

@app.get("/api/admin/find-user")
async def find_user(email: str, uid: str = Depends(verify_admin)):
    users = list(db.collection('users').where(filter=FieldFilter('email', '==', email)).limit(1).stream())
    if not users: raise HTTPException(404, "Não encontrado")
    return {**users[0].to_dict(), 'userId': users[0].id}

@app.get("/api/admin/resolve-bets")
async def admin_resolve_bets(uid: str = Depends(verify_admin)):
    _resolve_bets_logic()
    return {"status": "Triggered"}

@app.post("/api/admin/create-coupon")
async def create_coupon_admin(payload: CouponRequest, uid: str = Depends(verify_admin)):
    code = payload.code.upper() or _generate_referral_code("BONUS")
    if list(db.collection('coupons').where(filter=FieldFilter('code', '==', code)).stream()): raise HTTPException(400, "Já existe")
    db.collection('coupons').add({"code": code, "amount": payload.amount, "type": 'deposit' if payload.min_deposit_required > 0 else 'manual', "min_deposit_required": payload.min_deposit_required, "max_uses": payload.max_uses, "current_uses": 0, "created_at": firestore.SERVER_TIMESTAMP, "active": True})
    return {"status": "success", "code": code}

def _resolve_bets_logic():
    logger.info("--- [Scheduler] Iniciando ciclo de resolução ---")
    processed, errors = 0, 0
    try:
        pending_bets = list(db.collection('bets').where(filter=FieldFilter('status', '==', 'pending')).stream())
        if not pending_bets:
            logger.info("--- [Scheduler] Nenhuma aposta pendente.")
            return

        for doc in pending_bets:
            try:
                bet = doc.to_dict()
                res = riot_api.get_match_details_and_resolve(bet['puuid'], bet['lastMatchId'], bet['betItems'])
                
                if res["status"] != "pending":
                    transaction = db.transaction()
                    tx_resolve_bet(transaction, db.collection('bets').document(doc.id), db.collection('users').document(bet['userId']), bet, res["status"])
                    logger.info(f"RESOLVIDO: Aposta {doc.id} -> {res['status']}")
                    processed += 1
            except Exception as e:
                logger.error(f"Erro ao resolver aposta {doc.id}: {e}")
                errors += 1
        
        logger.info(f"--- [Scheduler] Ciclo fim. Processados: {processed}, Erros: {errors}")
            
    except Exception as e: 
        logger.critical(f"FALHA CRÍTICA NO SCHEDULER: {e}")

# --- PÁGINA INICIAL (ROOT) ---
@app.get("/")
async def serve_spa():
    return FileResponse("mvp_demo.html")

@app.get("/admin-panel")
async def serve_admin():
    return FileResponse("admin.html")

# --- STATIC FILES ---
app.mount("/", StaticFiles(directory=".", html=True), name="static")