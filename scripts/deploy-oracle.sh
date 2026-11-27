#!/usr/bin/env bash
# Despliegue en una VM Oracle Cloud (Oracle Linux u Ubuntu). Ejecutar en la VM:
#   curl -fsSL https://raw.githubusercontent.com/santiagotllrz/prueba-periferia/main/scripts/deploy-oracle.sh | bash
# Luego crear ~/prueba-periferia/.env con ANTHROPIC_API_KEY=... y: sudo systemctl restart agente-oc
set -euo pipefail

APP_DIR="$HOME/prueba-periferia"
PORT="${PORT:-3000}"

command -v git >/dev/null || { sudo dnf install -y git unzip 2>/dev/null || (sudo apt-get update && sudo apt-get install -y git unzip); }
command -v unzip >/dev/null || { sudo dnf install -y unzip 2>/dev/null || sudo apt-get install -y unzip; }

if [ ! -x "$HOME/.bun/bin/bun" ]; then curl -fsSL https://bun.sh/install | bash; fi
BUN="$HOME/.bun/bin/bun"

if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone https://github.com/santiagotllrz/prueba-periferia.git "$APP_DIR"; fi
cd "$APP_DIR"
"$BUN" install --production
[ -f .env ] || { cp .env.example .env; echo ">> Edita $APP_DIR/.env y pon ANTHROPIC_API_KEY"; }
chmod 600 .env

sudo tee /etc/systemd/system/agente-oc.service >/dev/null <<EOF
[Unit]
Description=Agente OC SAP (reto 03)
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=PORT=$PORT
ExecStart=$BUN run src/server.ts
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now agente-oc
sudo systemctl restart agente-oc

# Firewall del sistema operativo (además hay que abrir el puerto en la Security List de la VCN)
if command -v firewall-cmd >/dev/null; then
  sudo firewall-cmd --permanent --add-port="$PORT"/tcp && sudo firewall-cmd --reload
elif command -v iptables >/dev/null; then
  sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
  sudo netfilter-persistent save 2>/dev/null || true
fi

sleep 2
curl -s "localhost:$PORT/api/health" && echo && echo ">> Listo: http://$(curl -s ifconfig.me):$PORT"
