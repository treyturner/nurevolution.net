"""Exercise the host policy in a disposable container's own network namespace.

Requires Docker with privileged-container support. Never uses host networking,
mounts, or PID namespaces and never changes the Docker host's firewall.
"""

from pathlib import Path
import subprocess
import uuid

IMAGE = "docker@sha256:12e683a161823b2a839aeea999b9d960e6e1f9a97b1679ad6b441982e2d9cf07"
firewall_bytes = Path(__file__).with_name("firewall.sh").read_bytes()
if b"\r" in firewall_bytes:
    raise SystemExit("firewall.sh must use LF line endings for direct Bash execution")
firewall = firewall_bytes.decode()
setup = r'''
set -eu
for item in 'hs 172.26.0.1 172.26.0.2 16' 'lan 192.168.1.85 192.168.1.1 24' 'svc 172.19.0.1 172.19.0.13 16'; do
  set -- $item
  ip netns add "$1"
  ip link add "$1-host" type veth peer name "$1-peer"
  ip link set "$1-peer" netns "$1"
  ip addr add "$2/$4" dev "$1-host"
  ip link set "$1-host" up
  ip netns exec "$1" ip addr add "$3/$4" dev "$1-peer"
  ip netns exec "$1" ip link set "$1-peer" up
  ip netns exec "$1" ip link set lo up
  ip netns exec "$1" ip route add default via "$2"
done
ip netns exec lan ip addr add 198.51.100.2/32 dev lo
ip route add 198.51.100.2/32 via 192.168.1.1
sysctl -w net.ipv4.ip_forward=1 >/dev/null
cat > /tmp/respond <<'END'
#!/bin/sh
printf 'ok\n'
END
chmod +x /tmp/respond
nc -lk -p 8081 -e /tmp/respond >/dev/null 2>&1 &
ip netns exec hs nc -lk -p 8080 -e /tmp/respond >/dev/null 2>&1 &
ip netns exec lan nc -lk -p 443 -e /tmp/respond >/dev/null 2>&1 &
ip netns exec lan nc -lk -p 53 -e /tmp/respond >/dev/null 2>&1 &
ip netns exec svc nc -lk -p 8080 -e /tmp/respond >/dev/null 2>&1 &
cat > /tmp/udp.py <<'END'
import socket
import sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("0.0.0.0", int(sys.argv[1])))
while True:
    data, peer = s.recvfrom(1024)
    s.sendto(b"ok", peer)
END
ip netns exec lan python3 /tmp/udp.py 53 >/dev/null 2>&1 &
ip netns exec hs python3 /tmp/udp.py 3478 >/dev/null 2>&1 &
sleep 1
expect_udp_open() {
  result=$(ip netns exec "$1" python3 -c '
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(2)
s.sendto(b"probe", (sys.argv[1], int(sys.argv[2])))
print(s.recv(1024).decode())' "$2" "$3")
  [ "$result" = ok ] || { echo "Failed UDP control $1 $2:$3"; exit 1; }
}
expect_open() {
  ns="$1"; address="$2"; port="$3"
  if [ "$ns" = host ]; then
    result=$(nc -w 2 "$address" "$port" </dev/null)
  else
    result=$(ip netns exec "$ns" nc -w 2 "$address" "$port" </dev/null)
  fi
  [ "$result" = ok ] || { echo "Failed positive control $ns $address:$port"; exit 1; }
}
expect_blocked() {
  result=$(ip netns exec hs nc -w 1 "$1" "$2" </dev/null 2>/dev/null || true)
  [ -z "$result" ] || { echo "Unexpected access $1:$2"; exit 1; }
}
expect_open hs 172.26.0.1 8081
expect_open hs 192.168.1.1 443
expect_open hs 172.19.0.13 8080
expect_open hs 198.51.100.2 443
expect_udp_open hs 192.168.1.1 53
expect_udp_open lan 172.26.0.2 3478
echo 'All outbound targets and UDP reply paths reachable before policy'
'''
run = r'''
for backend in iptables-legacy iptables-nft; do
  mkdir -p /tmp/test-bin
  ln -sf "$(command -v "$backend")" /tmp/test-bin/iptables
  export PATH="/tmp/test-bin:$PATH"
  if iptables -S DOCKER-USER >/dev/null 2>&1; then
    echo 'Unexpected Docker chain in isolated namespace'; exit 1
  fi
  bash /tmp/firewall.sh
  before=$(iptables -t mangle -S)
  bash /tmp/firewall.sh
  [ "$before" = "$(iptables -t mangle -S)" ] || { echo 'Not idempotent'; exit 1; }
  expect_open host 172.26.0.2 8080
  expect_open lan 172.26.0.2 8080
  expect_open hs 192.168.1.1 53
  expect_udp_open hs 192.168.1.1 53
  expect_udp_open lan 172.26.0.2 3478
  expect_open host 172.19.0.13 8080
  expect_blocked 172.26.0.1 8081
  expect_blocked 192.168.1.1 443
  expect_blocked 172.19.0.13 8080
  expect_blocked 198.51.100.2 443
  drops=$(iptables -t mangle -nvxL NUREV-HS-EGRESS | awk '$3 == "DROP" {print $1}')
  [ "$drops" -ge 4 ] || { echo 'Drop counters did not increase'; exit 1; }
  echo "$backend: TCP/UDP replies, TCP/UDP DNS, unrelated host access, four outbound blocks and repeat application passed; drops=$drops"
  iptables -t mangle -D PREROUTING -s 172.26.0.0/16 -j NUREV-HS-EGRESS
  iptables -t mangle -F NUREV-HS-EGRESS
  iptables -t mangle -X NUREV-HS-EGRESS
done
'''
script = setup + "\ncat > /tmp/firewall.sh <<'FIREWALL_END'\n" + firewall + "\nFIREWALL_END\n" + run
name = "nurevolution-hs-firewall-" + uuid.uuid4().hex[:12]
try:
    result = subprocess.run(
        ["docker", "run", "--rm", "--name", name, "-i", "--privileged",
         "--entrypoint", "sh", IMAGE, "-c",
         "apk add --no-cache bash iproute2 python3 >/dev/null && exec sh"],
        input=script, text=True, timeout=180,
    )
    raise SystemExit(result.returncode)
finally:
    subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30)
