// bt-rssi — Bluetooth RSSI D-Bus service
//
// Exposes org.gnome.BluetoothRSSI on the system bus.
// Reads RSSI via HCI_CHANNEL_CONTROL (mgmt API) — no scanning,
// no disturbance to other devices, queries the existing ACL connection.
//
// Runs as a system service with CAP_NET_ADMIN (via AmbientCapabilities).

mod hci;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, mpsc};
use tokio::task::JoinHandle;
use zbus::{connection, interface, object_server::SignalEmitter};

const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

const DBUS_NAME: &str = "org.gnome.BluetoothRSSI";
const DBUS_PATH: &str = "/org/gnome/BluetoothRSSI";

// ── D-Bus interface ──────────────────────────────────────────────────────────

struct BtRssiService {
    tasks:     Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    tx:        mpsc::Sender<(String, i16)>,
}

#[interface(name = "org.gnome.BluetoothRSSI")]
impl BtRssiService {
    /// Start emitting RSSIUpdate signals for `address` every `interval_seconds`.
    /// `hci_index` selects the Bluetooth adapter (0 = hci0, 1 = hci1, …).
    /// If already monitoring this address, restarts with the new interval.
    async fn start_monitoring(
        &self,
        address: String,
        interval_seconds: u32,
        hci_index: u16,
    ) -> zbus::fdo::Result<()> {
        let mut tasks = self.tasks.lock().await;

        // Stop existing monitor for this address so we can restart
        // with a (possibly different) interval.
        if let Some(handle) = tasks.remove(&address) {
            handle.abort();
        }

        let addr      = address;
        let tx        = self.tx.clone();
        let interval  = Duration::from_secs(interval_seconds.max(1) as u64);
        let tasks_ref = self.tasks.clone();

        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                ticker.tick().await;

                let mac = addr.clone();
                let result = tokio::task::spawn_blocking(move || {
                    hci::read_rssi_blocking(&mac, hci_index)
                })
                .await;

                match result {
                    Ok(Ok((rssi, _tx_power))) => {
                        if tx.send((addr.clone(), i16::from(rssi))).await.is_err() {
                            break;
                        }
                    }
                    Ok(Err(hci::RssiError::NotConnected)) => {
                        eprintln!("[bt-rssi] {addr}: device disconnected, stopping monitor");
                        break;
                    }
                    Ok(Err(hci::RssiError::PermissionDenied)) => {
                        eprintln!("[bt-rssi] {addr}: permission denied — check AmbientCapabilities in service unit");
                    }
                    Ok(Err(e)) => eprintln!("[bt-rssi] {addr}: {e}"),
                    Err(e) => {
                        eprintln!("[bt-rssi] {addr}: task panic: {e}");
                        break;
                    }
                }
            }

            tasks_ref.lock().await.remove(&addr);
        });

        tasks.insert(address, handle);
        Ok(())
    }

    /// Stop monitoring `address` and cancel its background task.
    async fn stop_monitoring(&self, address: String) -> zbus::fdo::Result<()> {
        if let Some(handle) = self.tasks.lock().await.remove(&address) {
            handle.abort();
        }
        Ok(())
    }

    /// Emitted whenever a new RSSI reading is available.
    #[zbus(signal)]
    async fn rssi_update(
        ctx: &SignalEmitter<'_>,
        address: &str,
        rssi: i16,
    ) -> zbus::Result<()>;
}

// ── main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (tx, mut rx) = mpsc::channel::<(String, i16)>(32);
    let tasks = Arc::new(Mutex::new(HashMap::new()));

    let service = BtRssiService {
        tasks:     tasks.clone(),
        tx,
    };

    let conn = connection::Builder::system()?
        .name(DBUS_NAME)?
        .serve_at(DBUS_PATH, service)?
        .build()
        .await?;

    // Obtain a typed handle to the registered interface so we can emit
    // signals from outside the interface implementation.
    let iface_ref = conn
        .object_server()
        .interface::<_, BtRssiService>(DBUS_PATH)
        .await?;

    // Dispatch RSSI readings received from background tasks as D-Bus signals.
    // Exit after IDLE_TIMEOUT with no active monitors (D-Bus activation will
    // restart us on the next StartMonitoring call).
    let signal_ctx = iface_ref.signal_emitter();
    loop {
        match tokio::time::timeout(IDLE_TIMEOUT, rx.recv()).await {
            Ok(Some((mac, rssi))) => {
                if let Err(e) = BtRssiService::rssi_update(signal_ctx, &mac, rssi).await {
                    eprintln!("[bt-rssi] signal emit failed: {e}");
                }
            }
            Ok(None) => break,
            Err(_) => {
                if tasks.lock().await.is_empty() {
                    eprintln!("[bt-rssi] idle for {IDLE_TIMEOUT:?} with no monitors, exiting");
                    break;
                }
            }
        }
    }

    Ok(())
}
