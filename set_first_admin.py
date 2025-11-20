import firebase_admin
from firebase_admin import credentials, auth

# --- CONFIGURAÇÃO ---
# (Certifique-se que o 'serviceAccountKey.json' está na mesma pasta)
cred = credentials.Certificate('serviceAccountKey.json')
try:
    firebase_admin.initialize_app(cred)
except ValueError:
    print("[Info] Firebase App já inicializado.")

# --- LÓGICA DO SCRIPT ---
def make_first_admin():
    print("--- Promover Primeiro Administrador ---")
    email = input("Digite o e-mail do usuário que será o primeiro Admin: ")
    
    if not email:
        print("E-mail inválido. Abortando.")
        return

    try:
        # 1. Encontra o usuário pelo e-mail
        user = auth.get_user_by_email(email)
        
        # 2. Define o "Custom Claim" de admin
        # Isso é o que o server.py (admin_required) procura
        auth.set_custom_user_claims(user.uid, {'admin': True})
        
        print("\n---------------------------------------------------")
        print(f" SUCESSO! ")
        print(f" O usuário: {email} (UID: {user.uid})")
        print(f" AGORA É UM ADMINISTRADOR.")
        print("---------------------------------------------------")
        print(f"Você já pode logar no painel /admin-panel.")
        print("Por segurança, você pode deletar este script agora.")

    except auth.UserNotFoundError:
        print(f"\nERRO: Nenhum usuário encontrado com o e-mail: {email}")
        print("Por favor, crie uma conta para este e-mail no app primeiro.")
    except Exception as e:
        print(f"\nOcorreu um erro inesperado: {e}")

if __name__ == "__main__":
    make_first_admin()