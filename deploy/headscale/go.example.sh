# Replace the final emhttp section of /boot/config/go with this block.
# Preserve the rest of go; this is a fragment, not a standalone startup script.
# Load Headscale firewall before emhttp can start Docker.
if ! /bin/bash /boot/config/plugins/user.scripts/scripts/isolate_headscale_network/script; then
  logger -t headscale 'Early Headscale firewall setup failed.'
fi

# Start the Management Utility. The selected policy logs and continues on failure.
/usr/local/sbin/emhttp
