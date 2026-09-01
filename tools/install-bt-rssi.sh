#!/usr/bin/env bash
# install.sh — install or uninstall the bt-rssi D-Bus service.
# Default mode installs; pass --uninstall to remove.

set -euo pipefail

log()  { printf '[install-bt-rssi] %s\n' "$*" >&2; }
die()  { log "error: $*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Resolve paths relative to this script so the tarball can be extracted
# anywhere (the script expects its staged file tree beside it).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_SRC="${SCRIPT_DIR}/usr/local/bin/bt-rssi"
UNIT_SRC="${SCRIPT_DIR}/etc/systemd/system/bt-rssi.service"
POLICY_SRC="${SCRIPT_DIR}/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf"
ACTIVATE_SRC="${SCRIPT_DIR}/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service"

do_install() {
    [[ ${EUID:-$(id -u)} -ne 0 ]] && die "must run as root (try: sudo $0)"

    [[ -f "$BIN_SRC"      ]] || die "missing staged binary:      $BIN_SRC"
    [[ -f "$UNIT_SRC"     ]] || die "missing staged unit:        $UNIT_SRC"
    [[ -f "$POLICY_SRC"   ]] || die "missing staged policy:      $POLICY_SRC"
    [[ -f "$ACTIVATE_SRC" ]] || die "missing staged activation:  $ACTIVATE_SRC"

    have systemctl || die "systemctl not found — is systemd installed?"
    have install   || die "coreutils install(1) not found"

    id -u bt-rssi >/dev/null 2>&1 || \
        useradd --system --shell /usr/sbin/nologin bt-rssi

    install -Dm755 "$BIN_SRC"      /usr/local/bin/bt-rssi
    install -Dm644 "$UNIT_SRC"     /etc/systemd/system/bt-rssi.service
    install -Dm644 "$POLICY_SRC"   /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
    install -Dm644 "$ACTIVATE_SRC" /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service

    systemctl daemon-reload
    systemctl reload dbus.service 2>/dev/null || \
        log "warning: failed to reload dbus.service (continuing)"

    log "installed"
    log "  binary:    /usr/local/bin/bt-rssi"
    log "  unit:      /etc/systemd/system/bt-rssi.service"
    log "  policy:    /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf"
    log "  activate:  /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service"
    log "enable and start with:  systemctl enable --now bt-rssi.service"
}

do_uninstall() {
    [[ ${EUID:-$(id -u)} -ne 0 ]] && die "must run as root (try: sudo $0)"

    have systemctl && systemctl disable --now bt-rssi.service 2>/dev/null || true

    rm -f \
        /usr/local/bin/bt-rssi \
        /etc/systemd/system/bt-rssi.service \
        /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf \
        /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service

    have userdel && userdel bt-rssi 2>/dev/null || true

    have systemctl && systemctl daemon-reload || true
    have systemctl && systemctl reload dbus.service 2>/dev/null || true

    log "uninstalled"
}

case "${1:-install}" in
    install|"")    do_install ;;
    --uninstall)   do_uninstall ;;
    -h|--help)
        cat <<'USAGE'
Usage: install.sh [--uninstall]
USAGE
        exit 0
        ;;
    *) die "unknown argument: $1 (use --uninstall)" ;;
esac
