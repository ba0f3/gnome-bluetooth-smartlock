# Disable rpmlint's "no-changelog" warning; we track changes in git, not RPM.
%global _disable_source_fetch 0
%global debug_package %{nil}

Name:           bt-rssi
Version:        0.1.0
Release:        1%{?dist}
Summary:        Bluetooth RSSI D-Bus service for gnome-bluetooth-smartlock
License:        MIT
URL:            https://github.com/ba0f3/gnome-bluetooth-smartlock
Source0:        bt-rssi

BuildRequires:  systemd
Requires:       systemd
Requires:       dbus

%description
Bluetooth RSSI D-Bus service for gnome-bluetooth-smartlock. Exposes
org.gnome.BluetoothRSSI on the system bus so the GNOME Shell extension
can read RSSI values for already-paired Bluetooth devices. Requires
CAP_NET_ADMIN (granted by the bundled systemd unit).

%install
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}%{_unitdir}
mkdir -p %{buildroot}%{_sysconfdir}/dbus-1/system.d
mkdir -p %{buildroot}%{_datadir}/dbus-1/system-services
install -m 755 %{SOURCE0}                                     %{buildroot}%{_bindir}/bt-rssi
install -m 644 %{_sourcedir}/../bt-rssi.service              %{buildroot}%{_unitdir}/bt-rssi.service
install -m 644 %{_sourcedir}/../org.gnome.BluetoothRSSI.conf %{buildroot}%{_sysconfdir}/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
install -m 644 %{_sourcedir}/../org.gnome.BluetoothRSSI.dbus-service %{buildroot}%{_datadir}/dbus-1/system-services/org.gnome.BluetoothRSSI.service

%files
%{_bindir}/bt-rssi
%{_unitdir}/bt-rssi.service
%config(noreplace) %{_sysconfdir}/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
%{_datadir}/dbus-1/system-services/org.gnome.BluetoothRSSI.service

%pre
getent group bt-rssi >/dev/null || groupadd -r bt-rssi
getent passwd bt-rssi >/dev/null || useradd -r -g bt-rssi -s /usr/sbin/nologin -d / -M bt-rssi
exit 0

%post
%systemd_post bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :

%preun
%systemd_preun bt-rssi.service

%postun
%systemd_postun_with_restart bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :

%changelog
