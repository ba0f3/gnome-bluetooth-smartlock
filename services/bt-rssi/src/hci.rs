// hci.rs — Read RSSI for a connected BR/EDR device via the Bluetooth
// Management API (HCI_CHANNEL_CONTROL).  Requires CAP_NET_ADMIN.
//
// The mgmt channel coexists with bluetoothd — it does not take exclusive
// ownership of the adapter and causes zero radio activity beyond querying
// the signal strength of the existing ACL connection.

use std::io;

const AF_BLUETOOTH:        i32 = 31;
const BTPROTO_HCI:         i32 = 1;
const HCI_CHANNEL_CONTROL: u16 = 3;
const HCI_DEV_NONE:        u16 = 0xffff;

const MGMT_OP_GET_CONN_INFO:      u16 = 0x0031;
const MGMT_EV_CMD_COMPLETE:       u16 = 0x0001;
const MGMT_EV_CMD_STATUS:         u16 = 0x0002;
const MGMT_STATUS_SUCCESS:         u8 = 0x00;
const MGMT_STATUS_NOT_CONNECTED:   u8 = 0x02;
const MGMT_STATUS_PERMISSION_DENIED: u8 = 0x14;

const RECV_TIMEOUT_SECS: u64 = 5;

/// Errors that callers may want to distinguish.
#[derive(Debug)]
pub enum RssiError {
    /// Device is not currently connected — expected when phone walks away.
    NotConnected,
    /// Kernel refused the operation (likely missing CAP_NET_ADMIN).
    PermissionDenied,
    /// MAC address string could not be parsed.
    InvalidAddress(String),
    /// Any other I/O problem.
    Io(io::Error),
    /// Mgmt returned an error status we don't specifically handle.
    MgmtStatus(u8),
}

impl std::fmt::Display for RssiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConnected       => write!(f, "device not connected"),
            Self::PermissionDenied   => write!(f, "permission denied (needs CAP_NET_ADMIN)"),
            Self::InvalidAddress(s)  => write!(f, "invalid MAC address: {s}"),
            Self::Io(e)              => write!(f, "I/O error: {e}"),
            Self::MgmtStatus(s)      => write!(f, "mgmt error status 0x{s:02x}"),
        }
    }
}

impl std::error::Error for RssiError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for RssiError {
    fn from(e: io::Error) -> Self {
        if e.raw_os_error() == Some(libc::EPERM) {
            Self::PermissionDenied
        } else {
            Self::Io(e)
        }
    }
}

// ── address helpers ──────────────────────────────────────────────────────────

/// Parse "AA:BB:CC:DD:EE:FF" into a little-endian 6-byte array as BlueZ
/// expects (reversed byte order relative to the human-readable string).
fn parse_mac(mac: &str) -> Result<[u8; 6], RssiError> {
    let parts: Vec<&str> = mac.split(':').collect();
    if parts.len() != 6 {
        return Err(RssiError::InvalidAddress(mac.to_owned()));
    }
    let mut addr = [0u8; 6];
    for (i, p) in parts.iter().enumerate() {
        addr[5 - i] = u8::from_str_radix(p, 16)
            .map_err(|_| RssiError::InvalidAddress(mac.to_owned()))?;
    }
    Ok(addr)
}

// ── low-level socket ─────────────────────────────────────────────────────────

// Must match the kernel's struct sockaddr_hci exactly.
#[repr(C)]
struct SockAddrHci {
    hci_family:  u16,
    hci_dev:     u16,
    hci_channel: u16,
}

struct MgmtSocket(libc::c_int);

impl MgmtSocket {
    fn open() -> Result<Self, RssiError> {
        let fd = unsafe {
            libc::socket(AF_BLUETOOTH, libc::SOCK_RAW | libc::SOCK_CLOEXEC, BTPROTO_HCI)
        };
        if fd < 0 {
            return Err(io::Error::last_os_error().into());
        }

        // Bind to the management channel — does NOT take exclusive adapter ownership.
        let addr = SockAddrHci {
            hci_family:  AF_BLUETOOTH as u16,
            hci_dev:     HCI_DEV_NONE,
            hci_channel: HCI_CHANNEL_CONTROL,
        };
        let ret = unsafe {
            libc::bind(
                fd,
                &addr as *const SockAddrHci as *const libc::sockaddr,
                std::mem::size_of::<SockAddrHci>() as libc::socklen_t,
            )
        };
        if ret < 0 {
            let err = io::Error::last_os_error();
            unsafe { libc::close(fd); }
            return Err(err.into());
        }

        // Receive timeout — prevents hanging when controller is unresponsive.
        let tv = libc::timeval {
            tv_sec:  RECV_TIMEOUT_SECS as libc::time_t,
            tv_usec: 0,
        };
        let ret = unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                &tv as *const libc::timeval as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            )
        };
        if ret < 0 {
            let err = io::Error::last_os_error();
            unsafe { libc::close(fd); }
            return Err(err.into());
        }

        Ok(MgmtSocket(fd))
    }

    fn send(&self, data: &[u8]) -> Result<(), RssiError> {
        let ret = unsafe {
            libc::write(self.0, data.as_ptr() as *const libc::c_void, data.len())
        };
        if ret < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }

    fn recv(&self, buf: &mut [u8]) -> Result<usize, RssiError> {
        let n = unsafe {
            libc::read(self.0, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
        };
        if n < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(n as usize)
    }
}

impl Drop for MgmtSocket {
    fn drop(&mut self) { unsafe { libc::close(self.0); } }
}

// ── public API ───────────────────────────────────────────────────────────────

/// Read RSSI and TX power (dBm) of a currently-connected device.
///
/// Returns `(rssi, tx_power)`.
/// Runs synchronously — call via `tokio::task::spawn_blocking`.
/// `hci_index` is the adapter number (0 for hci0).
pub fn read_rssi_blocking(mac: &str, hci_index: u16) -> Result<(i8, i8), RssiError> {
    let bdaddr = parse_mac(mac)?;
    let sock = MgmtSocket::open()?;

    // ── send Get_Connection_Information (opcode 0x0031) ──────────────────────
    //   Header:  opcode(2) + controller_index(2) + parameter_length(2)
    //   Params:  address(6) + address_type(1)
    let mut cmd = [0u8; 13];
    cmd[0..2].copy_from_slice(&MGMT_OP_GET_CONN_INFO.to_le_bytes());
    cmd[2..4].copy_from_slice(&hci_index.to_le_bytes());
    cmd[4..6].copy_from_slice(&7u16.to_le_bytes());   // param length = 7
    cmd[6..12].copy_from_slice(&bdaddr);
    cmd[12] = 0x00;                                    // BDADDR_BREDR
    sock.send(&cmd)?;

    // ── read events until CMD_COMPLETE for our opcode ────────────────────────
    //   Event layout:
    //     [0..2]  event_code
    //     [2..4]  controller_index
    //     [4..6]  parameter_length
    //     [6..8]  opcode (in CMD_COMPLETE / CMD_STATUS)
    //     [8]     status
    //     [9..15] address        (CMD_COMPLETE only)
    //     [15]    address_type   (CMD_COMPLETE only)
    //     [16]    rssi           (i8, CMD_COMPLETE only)
    //     [17]    tx_power       (i8, CMD_COMPLETE only)
    //     [18]    max_tx_power   (i8, CMD_COMPLETE only)
    let mut buf = [0u8; 256];
    loop {
        let n = sock.recv(&mut buf)?;
        if n < 9 { continue; }

        let event_code = u16::from_le_bytes([buf[0], buf[1]]);
        let opcode     = u16::from_le_bytes([buf[6], buf[7]]);

        if opcode != MGMT_OP_GET_CONN_INFO { continue; }

        let status = buf[8];

        if event_code == MGMT_EV_CMD_STATUS {
            return match status {
                MGMT_STATUS_NOT_CONNECTED     => Err(RssiError::NotConnected),
                MGMT_STATUS_PERMISSION_DENIED => Err(RssiError::PermissionDenied),
                s => Err(RssiError::MgmtStatus(s)),
            };
        }

        if event_code != MGMT_EV_CMD_COMPLETE { continue; }

        return match status {
            MGMT_STATUS_SUCCESS => {
                if n < 19 {
                    Err(RssiError::Io(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "response too short",
                    )))
                } else {
                    Ok((buf[16] as i8, buf[17] as i8))
                }
            }
            MGMT_STATUS_NOT_CONNECTED     => Err(RssiError::NotConnected),
            MGMT_STATUS_PERMISSION_DENIED => Err(RssiError::PermissionDenied),
            s => Err(RssiError::MgmtStatus(s)),
        };
    }
}
