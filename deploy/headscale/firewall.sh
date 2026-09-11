#!/bin/bash
set -euo pipefail

hs_chain=NUREV-HS-EGRESS
hs_subnet=172.26.0.0/16

ipt() {
  iptables -w 5 -t mangle "$@"
}

# This host chain exists independently of Docker.
ipt -S PREROUTING >/dev/null

if ! ipt -S "$hs_chain" >/dev/null 2>&1; then
  ipt -N "$hs_chain"
fi

add_rule() {
  ipt -C "$@" 2>/dev/null || ipt -A "$@"
}

# Permit replies to incoming connections and DNS to pfSense.
add_rule "$hs_chain" \
  -m conntrack --ctstate ESTABLISHED,RELATED --ctdir REPLY -j RETURN
add_rule "$hs_chain" -d 192.168.1.1 -p udp --dport 53 -j RETURN
add_rule "$hs_chain" -d 192.168.1.1 -p tcp --dport 53 -j RETURN
add_rule "$hs_chain" -j DROP

# Attach only after the complete policy is in place.
ipt -C PREROUTING -s "$hs_subnet" -j "$hs_chain" 2>/dev/null ||
  ipt -I PREROUTING 1 -s "$hs_subnet" -j "$hs_chain"

echo 'Headscale firewall installed.'
