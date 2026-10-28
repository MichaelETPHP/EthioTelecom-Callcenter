#!/usr/bin/env bash
# coturn setup for telecontactcenter.et - RUN THIS ON THE PBX SERVER AS ROOT,
# not on your dev machine. (ssh into telecontactcenter.et first.)
#
# Why: a live SIP/ICE debug trace showed the call console reaching "ICE
# checking" after Answer, then stalling for ~9s with no further progress -
# the PBX's SDP offer only gave one actually-reachable candidate (a
# server-reflexive address found via its own STUN query), and when that
# connectivity check didn't succeed, the PBX gave up and sent CANCEL. STUN
# alone can't fix this; a TURN relay can, because it gives both sides a
# guaranteed-reachable address instead of hoping a direct path works.
#
# Usage:
#   scp call/infra/coturn-setup.sh root@telecontactcenter.et:/root/
#   ssh root@telecontactcenter.et
#   bash /root/coturn-setup.sh
#
# After it finishes, send the full output back - specifically the
# "Public IP detected" and "external-ip" lines - so the client config can
# be verified against the real values before anything is wired in.

set -euo pipefail

REALM="telecontactcenter.et"
TURN_USER="callcenter"
# Generates its own random password each run unless TURN_PASSWORD is set in
# the environment beforehand - nothing secret is hardcoded in this script,
# so it's safe to keep in git. The actual password only ever exists in this
# run's terminal output and in /etc (not in git) - copy it from the summary
# at the end, it won't be printed again.
TURN_PASSWORD="${TURN_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 32)}"
RELAY_MIN_PORT=49152
RELAY_MAX_PORT=49452

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

echo "== Detecting OS =="
if [ -f /etc/redhat-release ] || grep -qi 'rhel\|centos\|sangoma\|fedora' /etc/os-release 2>/dev/null; then
  PKG_MANAGER="yum"
  CONF_PATH="/etc/coturn/turnserver.conf"
  ENV_PATH="/etc/sysconfig/coturn"
elif [ -f /etc/debian_version ]; then
  PKG_MANAGER="apt"
  CONF_PATH="/etc/turnserver.conf"
  ENV_PATH="/etc/default/coturn"
else
  echo "Could not detect a supported OS (expected RHEL/CentOS/Sangoma/Fedora or Debian/Ubuntu)." >&2
  echo "Contents of /etc/os-release for reference:" >&2
  cat /etc/os-release 2>/dev/null || true
  exit 1
fi
echo "OS family: $PKG_MANAGER-based. Config will be written to $CONF_PATH"

echo "== Installing coturn =="
if [ "$PKG_MANAGER" = "yum" ]; then
  yum install -y epel-release >/dev/null
  yum install -y coturn
else
  apt-get update -qq
  apt-get install -y coturn
fi

echo "== Detecting IP addresses =="
PUBLIC_IP=$(curl -fs https://ifconfig.me || curl -fs https://api.ipify.org)
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -n1)
echo "Public IP detected: ${PUBLIC_IP:-<failed to detect>}"
echo "Local IP detected:  ${LOCAL_IP:-<failed to detect>}"

if [ -z "$PUBLIC_IP" ]; then
  echo "Could not auto-detect a public IP. Edit external-ip/relay-ip in $CONF_PATH manually after this runs." >&2
fi

if [ -n "$LOCAL_IP" ] && [ "$LOCAL_IP" != "$PUBLIC_IP" ]; then
  echo "Server is behind NAT (local IP differs from public IP) - using public/private mapping."
  EXTERNAL_IP_LINE="external-ip=${PUBLIC_IP}/${LOCAL_IP}"
  RELAY_IP_LINE="relay-ip=${LOCAL_IP}"
else
  EXTERNAL_IP_LINE="external-ip=${PUBLIC_IP}"
  RELAY_IP_LINE="relay-ip=${PUBLIC_IP}"
fi

echo "== Writing $CONF_PATH =="
mkdir -p "$(dirname "$CONF_PATH")"
cat > "$CONF_PATH" <<EOF
listening-port=3478
listening-ip=0.0.0.0
${RELAY_IP_LINE}
${EXTERNAL_IP_LINE}

min-port=${RELAY_MIN_PORT}
max-port=${RELAY_MAX_PORT}

fingerprint
lt-cred-mech
realm=${REALM}
user=${TURN_USER}:${TURN_PASSWORD}

# Never let this relay be used to reach addresses on your own internal
# network or other private ranges - only real internet peers.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255

no-cli
no-multicast-peers
no-loopback-peers
no-tcp-relay

syslog
EOF

echo "== Enabling the coturn daemon =="
if [ "$PKG_MANAGER" = "yum" ]; then
  if [ -f "$ENV_PATH" ]; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' "$ENV_PATH"
    grep -q '^TURNSERVER_ENABLED=1' "$ENV_PATH" || echo 'TURNSERVER_ENABLED=1' >> "$ENV_PATH"
  else
    echo 'TURNSERVER_ENABLED=1' > "$ENV_PATH"
  fi
else
  if [ -f "$ENV_PATH" ]; then
    sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' "$ENV_PATH"
    grep -q '^TURNSERVER_ENABLED=1' "$ENV_PATH" || echo 'TURNSERVER_ENABLED=1' >> "$ENV_PATH"
  else
    echo 'TURNSERVER_ENABLED=1' > "$ENV_PATH"
  fi
fi

echo "== Opening firewall ports =="
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port=3478/tcp
  firewall-cmd --permanent --add-port=3478/udp
  firewall-cmd --permanent --add-port=${RELAY_MIN_PORT}-${RELAY_MAX_PORT}/udp
  firewall-cmd --reload
  echo "firewalld: opened 3478/tcp+udp and ${RELAY_MIN_PORT}-${RELAY_MAX_PORT}/udp"
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 3478/tcp
  ufw allow 3478/udp
  ufw allow ${RELAY_MIN_PORT}:${RELAY_MAX_PORT}/udp
  echo "ufw: opened 3478/tcp+udp and ${RELAY_MIN_PORT}-${RELAY_MAX_PORT}/udp"
else
  echo "No active firewalld/ufw found - if this server has iptables rules or"
  echo "lives behind a cloud security group (AWS/GCP/Azure/DO/etc.), open"
  echo "these manually: TCP+UDP 3478, and UDP ${RELAY_MIN_PORT}-${RELAY_MAX_PORT}."
fi

echo "== Starting coturn =="
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl --no-pager --full status coturn || true

echo ""
echo "============================================================"
echo " coturn is configured and running."
echo ""
echo "   TURN URL:  turn:${REALM}:3478"
echo "   username:  ${TURN_USER}"
echo "   password:  ${TURN_PASSWORD}"
echo "   realm:     ${REALM}"
echo "   relay-ip:        ${RELAY_IP_LINE#relay-ip=}"
echo "   external-ip:     ${EXTERNAL_IP_LINE#external-ip=}"
echo ""
echo " IMPORTANT: if this server sits behind a cloud provider's external"
echo " firewall/security group (separate from the OS firewall above), you"
echo " must also open TCP+UDP 3478 and UDP ${RELAY_MIN_PORT}-${RELAY_MAX_PORT} there,"
echo " or none of this works despite coturn running fine locally."
echo ""
echo " Send this whole output back once it's done - verifying the server"
echo " actually answers on port 3478 from the outside happens next, before"
echo " anything is wired into the call console."
echo "============================================================"
