#!/usr/bin/env bash
# ============================================================
# Title TBD — run the installed Lubuntu worker VM (after setup)
# ============================================================
set -e

VM_DIR="$HOME/VMs"
DISK="$VM_DIR/lubuntu-worker.qcow2"

exec qemu-system-x86_64 \
  -name "TitleTBD-Worker-VM" \
  -enable-kvm -cpu host \
  -smp 4 -m 4096 \
  -drive file="$DISK",format=qcow2,if=virtio \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -virtfs local,path="$HOME/schol-comp-thingy",mount_tag=hostrepo,security_model=mapped-xattr,id=hostrepo \
  -vga virtio \
  -vnc 127.0.0.1:1 \
  -qmp unix:/tmp/ttbd-qmp.sock,server,nowait \
  -usb -device usb-tablet \
  -device virtio-rng-pci \
  -rtc base=localtime
