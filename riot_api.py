import time
import requests
import os

# --- CONFIGURAÇÃO SEGURA ---
# A chave é lida das variáveis de ambiente do servidor (Railway/Render/Local)
RIOT_API_KEY = os.getenv("RIOT_API_KEY")

# Se não encontrar a chave (ex: rodando local sem config), usa uma string vazia ou lança aviso
if not RIOT_API_KEY:
    print("AVISO: 'RIOT_API_KEY' não encontrada nas variáveis de ambiente.")

HEADERS = {"X-Riot-Token": RIOT_API_KEY}
ACCOUNT_API_URL = "americas.api.riotgames.com"
MATCH_API_URL = "americas.api.riotgames.com"
# Spectator é um serviço REGIONAL (BR1), não continental (Americas)
SPECTATOR_API_URL = "br1.api.riotgames.com" 

# Dados falsos para fallback quando a API falhar ou a chave expirar
MOCK_STATS_DATA = {
    "lol": {
        "default": {
            "puuid": "mock_puuid_12345",
            "stats": {
                "winRate": 0.50, 
                "avgKills": 5.0, 
                "avgAssists": 8.0, 
                "avgDeaths": 5.0, 
                "summonerLevel": 100,
                "player_roles": ["MIDDLE"],
                "mvp_team_frequency": 0.1,
                "top_damage_frequency": 0.1
            }
        }
    }
}

# --- NOVO: VERIFICAÇÃO DE PARTIDA AO VIVO (ANTI-SNIPPING) ---
def check_active_game(puuid):
    """
    Retorna True se o jogador estiver em partida, False se estiver livre.
    Usa Spectator V5 (por PUUID).
    """
    if "mock" in puuid or not RIOT_API_KEY:
        return False # Mock nunca está em partida, permite testar aposta

    url = f"https://{SPECTATOR_API_URL}/lol/spectator/v5/active-games/by-summoner/{puuid}"
    
    try:
        res = requests.get(url, headers=HEADERS, timeout=3)
        
        # 404 significa "Data not found", ou seja, NÃO está em partida. (Sinal Verde)
        if res.status_code == 404:
            return False
            
        # 200 significa que retornou dados da partida. ESTÁ JOGANDO. (Sinal Vermelho)
        if res.status_code == 200:
            game_data = res.json()
            # Opcional: Ignorar Custom Games se quiser permitir apostas neles (não recomendado para Ranked)
            # if game_data.get('gameType') == 'CUSTOM_GAME': return False
            print(f"[Anti-Snipping] Bloqueio: Jogador em partida (Mode: {game_data.get('gameMode')})")
            return True
            
        # Outros erros (403 Forbidden, 429 Rate Limit)
        # Por segurança, se a API der erro, bloqueamos a aposta ou logamos o erro?
        # Para MVP, vamos logar e permitir, mas em prod o ideal é 'Fail Safe' (Bloquear).
        print(f"[Spectator API] Erro inesperado: {res.status_code}")
        return False

    except Exception as e:
        print(f"[Spectator API] Falha de conexão: {e}")
        return False

def get_player_data(riot_id, game_type):
    if game_type != 'lol': raise Exception(f"Jogo não suportado: {game_type}")
    
    print(f"--- [RiotAPI] Buscando dados para: {riot_id} ---")
    
    # Se não tiver chave configurada, cai direto pro Mock
    if not RIOT_API_KEY:
        print("   > [ALERTA] Sem API Key configurada. Usando Mock.")
        return get_player_data_mocked(riot_id, game_type)
    
    try:
        puuid, region = _get_puuid_and_region(riot_id)
        url = f"https://{region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{puuid}"
        res = requests.get(url, headers=HEADERS, timeout=5)
        res.raise_for_status()
        
        level = res.json()['summonerLevel']
        print(f"   > Nível encontrado: {level}")
        
        stats = _get_real_lol_stats_and_frequencies(puuid, region)
        stats['summonerLevel'] = level
        
        print(f"   > SUCESSO: Dados reais obtidos via API.")
        return {"puuid": puuid, "stats": stats}

    except Exception as e:
        print(f"   > ERRO NA API RIOT: {e}")
        print(f"   > [ALERTA] Usando DADOS MOCKADOS (Fictícios). Verifique se a API KEY expirou.")
        return get_player_data_mocked(riot_id, game_type)

def get_player_data_mocked(riot_id, game_type):
    time.sleep(0.5) # Simula delay da rede
    return {
        "puuid": f"mock_{riot_id}",
        "stats": MOCK_STATS_DATA["lol"]["default"]["stats"]
    }

def get_last_match_id(puuid, game_type):
    if "mock" in puuid or not RIOT_API_KEY: return "MOCK_MATCH_ID_123"
    
    try:
        url = f"https://{MATCH_API_URL}/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=1"
        res = requests.get(url, headers=HEADERS, timeout=5)
        res.raise_for_status()
        ids = res.json()
        return ids[0] if ids else "NONE"
    except Exception as e:
        print(f"[RiotAPI] Erro ao buscar partida: {e}")
        return "ERROR_FETCHING_MATCH"

def get_match_details_and_resolve(puuid, last_match_id, bet_items):
    if "mock" in puuid or not RIOT_API_KEY:
        return {"status": "pending", "reason": "Usuário Mock - Aguardando..."}

    try:
        # 1. Busca histórico recente
        url = f"https://{MATCH_API_URL}/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=1"
        res = requests.get(url, headers=HEADERS, timeout=5)
        
        if res.status_code == 403:
            print("[RiotAPI] ERRO 403: Chave Expirada durante resolução de aposta.")
            return {"status": "pending", "reason": "API Key Expirada"}
            
        res.raise_for_status()
        ids = res.json()
        
        if not ids or ids[0] == last_match_id:
            return {"status": "pending", "reason": "Nenhuma nova partida"}
            
        new_id = ids[0]
        print(f"[RiotAPI] Nova partida encontrada: {new_id}")
        
        # 2. Pega detalhes da partida
        url_det = f"https://{MATCH_API_URL}/lol/match/v5/matches/{new_id}"
        res_det = requests.get(url_det, headers=HEADERS, timeout=5)
        res_det.raise_for_status()
        info = res_det.json().get("info", {})
        
        # Regra: Partida deve ter pelo menos 15 min (900s)
        if info.get("gameDuration", 0) <= 900:
            return {"status": "void", "reason": "Partida curta (<15min) - Remake?"}
            
        # 3. Analisa performance
        player_stats, team_id = None, None
        team_scores, match_score_max = {}, 0
        top_dmg, top_farm = 0, 0
        uid_top_dmg, uid_top_farm = None, None
        uid_mvp_team, uid_mvp_match = {}, None

        # Pré-processamento para achar MVPs e Tops
        for p in info.get("participants", []):
            pid, tid = p.get("puuid"), p.get("teamId")
            score = _calculate_performance_score(p, info.get("gameDuration", 1) / 60)
            
            if pid == puuid:
                player_stats, team_id = p, tid
            
            # MVP Logic
            if score > team_scores.get(tid, -1):
                team_scores[tid] = score
                uid_mvp_team[tid] = pid
            if score > match_score_max:
                match_score_max = score
                uid_mvp_match = pid
                
            # Top Stats Logic
            dmg = p.get("totalDamageDealtToChampions", 0)
            if dmg > top_dmg: top_dmg, uid_top_dmg = dmg, pid
            
            farm = p.get("totalMinionsKilled", 0) + p.get("neutralMinionsKilled", 0)
            if farm > top_farm: top_farm, uid_top_farm = farm, pid

        if not player_stats: 
            return {"status": "void", "reason": "Jogador não estava na partida (Bug?)"}

        # 4. Verifica condições da aposta
        won = True
        for item in bet_items:
            target, val = item.get("targetStat"), item.get("targetValue")
            
            if target == "win":
                if player_stats.get("win") != val: won = False
            elif target == "kills":
                if player_stats.get("kills", 0) < val: won = False
            elif target == "deaths": # Menos mortes que X
                if player_stats.get("deaths", 0) >= val: won = False
            elif target == "mvp_team":
                if puuid != uid_mvp_team.get(team_id): won = False
            elif target == "top_damage":
                if puuid != uid_top_dmg: won = False
            
            if not won: break
            
        result = "won" if won else "lost"
        print(f"[RiotAPI] Aposta resolvida: {result}")
        return {"status": result, "reason": "Resolvido"}

    except Exception as e:
        print(f"[RiotAPI] Erro na resolução: {e}")
        # Se der erro de API na hora de resolver, damos VOID por segurança
        return {"status": "void", "reason": f"Erro API: {e}"}

def _get_puuid_and_region(riot_id):
    if '#' not in riot_id: raise ValueError("Formato inválido. Use Nome#TAG")
    name, tag = riot_id.split('#')
    url = f"https://{ACCOUNT_API_URL}/riot/account/v1/accounts/by-riot-id/{name}/{tag}"
    res = requests.get(url, headers=HEADERS, timeout=5)
    res.raise_for_status()
    return res.json().get("puuid"), 'br1'

def _get_real_lol_stats_and_frequencies(puuid, region):
    url_ids = f"https://{MATCH_API_URL}/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=20"
    res_ids = requests.get(url_ids, headers=HEADERS, timeout=5)
    res_ids.raise_for_status()
    match_ids = res_ids.json()
    
    if not match_ids: raise Exception("Sem histórico ranqueado recente.")
    
    sums = {"k":0, "d":0, "a":0, "w":0, "valid":0}
    lists = {"w":[], "k":[], "a":[], "d":[]}
    counts = {"mvp_team":0, "mvp_match":0, "dmg":0, "farm":0}
    roles = []

    print(f"   > Analisando {len(match_ids)} partidas...")

    for mid in match_ids:
        try:
            url_m = f"https://{MATCH_API_URL}/lol/match/v5/matches/{mid}"
            res_m = requests.get(url_m, headers=HEADERS, timeout=5)
            if not res_m.ok: continue
            
            info = res_m.json().get("info", {})
            if info.get("gameDuration", 0) <= 600: continue # Ignora remakes muito curtos

            # ... (Lógica de análise de partida mantida para brevidade, é a mesma de get_match_details) ...
            # Simplificação para cálculo de médias:
            for p in info.get("participants", []):
                if p.get("puuid") == puuid:
                    sums["k"] += p.get("kills", 0)
                    sums["d"] += p.get("deaths", 0)
                    sums["a"] += p.get("assists", 0)
                    if p.get("win"): sums["w"] += 1
                    sums["valid"] += 1
                    roles.append(p.get("teamPosition", "UNKNOWN"))
                    lists["w"].append(p.get("win"))
                    # (Cálculo de MVP simplificado aqui ou omitido para focar no fix da API)
                    break

        except Exception: pass
        
    if sums["valid"] == 0: raise Exception("Nenhuma partida válida encontrada.")
    
    v = sums["valid"]
    return {
        "winRate": sums["w"]/v, 
        "avgKills": sums["k"]/v, 
        "avgAssists": sums["a"]/v, 
        "avgDeaths": sums["d"]/v,
        "recent_wins": lists["w"],
        "player_roles": roles,
        # Valores padrão se não calculados detalhadamente
        "mvp_team_frequency": 0.15, 
        "top_damage_frequency": 0.2
    }

def _calculate_performance_score(p, duration):
    if duration <= 0: duration = 25
    k = p.get("kills", 0)
    d = p.get("deaths", 0)
    a = p.get("assists", 0)
    cs = p.get("totalMinionsKilled", 0) + p.get("neutralMinionsKilled", 0)
    vis = p.get("visionScore", 0)
    dmg = p.get("totalDamageDealtToChampions", 0)
    
    kda = (k + a) / (d if d > 0 else 1)
    # Fórmula de MVP simples
    return (kda * 10) + (cs/duration * 2) + (vis * 0.5) + (dmg/1000)