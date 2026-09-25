#!/usr/bin/env bash
# ============================================================
# Title TBD — create the Lubuntu worker VM (QEMU, no root needed)
# Networking: user-mode NAT (same model as GNOME Boxes) → the VM
# reaches the host laptop at 10.0.2.2, internet flows through.
# Shares the patched repo into the VM over 9p (mount_tag=hostrepo).
# ============================================================
set -e

VM_DIR="$HOME/VMs"
DISK="$VM_DIR/lubuntu-worker.qcow2"
ISO="$HOME/Downloads/lubuntu-24.04.5-desktop-amd64.iso"

mkdir -p "$VM_DIR"
[ -f "$DISK" ] || qemu-img create -f qcow2 "$DISK" 25G

# First boot: installer from the ISO
exec qemu-system-x86_64 \
  -name "TitleTBD-Worker-VM" \
  -enable-kvm -cpu host \
  -smp 4 -m 4096 \
  -drive file="$DISK",format=qcow2,if=virtio \
  -cdrom "$ISO" -boot d \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -virtfs local,path="$HOME/schol-comp-thingy",mount_tag=hostrepo,security_model=mapped-xattr,id=hostrepo \
  -vga virtio \
  -vnc 127.0.0.1:1 \
  -qmp unix:/tmp/ttbd-qmp.sock,server,nowait \
  -usb -device usb-tablet \
  -device virtio-rng-pci \
  -rtc base=localtime
