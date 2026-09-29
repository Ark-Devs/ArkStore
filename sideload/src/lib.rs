// ArkStore's iPhone installer: signs an app with the person's own free Apple Account and installs
// it, the way SideStore / AltServer / iloader do, using isideload (MIT, by nab138).
//
// Two front ends share this library:
//   - the desktop app runs `ark-sideload` (src/main.rs): the iPhone is on USB (or Wi-Fi sync);
//   - the iPhone app links it (ffi.rs, modules/ark-sideload): ArkStore installs and renews apps
//     on the iPhone itself, reaching its own lockdownd through LocalDevVPN with the pairing
//     file the desktop app left in ArkStore's Documents during the first setup.
//
// A job is one command plus a JSON request. Progress, questions and the result are JSON events
// (an "event" field); questions (the two-factor code, which certificate to replace) are answered
// with further JSON values. Commands:
//
//   devices  {}                                   -> {"event":"devices","devices":[...],"driver":bool}
//   signin   {email,password,dataDir}             -> {"event":"signedIn","team":{id,name}}
//   install  {target,email,password,ipa,dataDir,machineName?,pairFor?} -> progress, {"event":"done",...}
//   pair     {udid,bundleId}                      -> {"event":"paired"}      (desktop: USB only)
//   devmode  {udid}                               -> {"event":"devmode","enabled":bool}
//   ping     {target}                             -> {"event":"pong","name","ios"}
//
// `target` is {"udid": "..."} for a device on usbmuxd, or {"ip": "10.7.0.1", "pairingFile":
// "/path"} for a device reached over the network (the iPhone itself, through LocalDevVPN).
// `udid` alone is accepted as {"udid"} for older callers.
use std::{net::IpAddr, path::PathBuf, sync::Arc};

use idevice::{
    IdeviceService,
    afc::opcode::AfcFopenMode,
    amfi::AmfiClient,
    house_arrest::HouseArrestClient,
    lockdown::LockdownClient,
    pairing_file::PairingFile,
    provider::{IdeviceProvider, TcpProvider},
    usbmuxd::{Connection, UsbmuxdAddr},
};
use isideload::{
    anisette::remote_v3::{DEFAULT_ANISETTE_V3_URL, RemoteV3AnisetteProvider},
    auth::apple_account::{AppleAccount, TwoFactorCallbackParams, TwoFactorCallbackResponse},
    dev::{certificates::DevelopmentCertificate, developer_session::DeveloperSession, teams::TeamsApi},
    sideload::{SideloaderBuilder, TeamSelection, builder::MaxCertsBehavior},
    util::fs_storage::FsStorage,
};
use rootcause::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};

#[cfg(any(target_os = "ios", feature = "ffi"))]
pub mod ffi;

const LABEL: &str = "ArkStore";
/// Where ArkStore on the iPhone finds the pairing file the desktop app leaves in its Documents.
pub const PAIRING_FILE_NAME: &str = "ArkStorePairing.plist";

// ---------------------------------------------------------------------------
// Talking to the front end
// ---------------------------------------------------------------------------

/// A job's two-way channel: events out, answers in.
pub struct Io {
    emit: Box<dyn Fn(Value) + Send + Sync>,
    answers: Mutex<mpsc::UnboundedReceiver<Value>>,
}

impl Io {
    pub fn new(emit: impl Fn(Value) + Send + Sync + 'static, answers: mpsc::UnboundedReceiver<Value>) -> Arc<Self> {
        Arc::new(Self { emit: Box::new(emit), answers: Mutex::new(answers) })
    }

    fn emit(&self, v: Value) {
        (self.emit)(v)
    }

    fn progress(&self, stage: &str, percent: u32) {
        self.emit(json!({ "event": "progress", "stage": stage, "percent": percent }));
    }

    /// The next answer, or an error when the front end hung up (cancelled).
    async fn read(&self) -> Result<Value, Report> {
        self.answers.lock().await.recv().await.ok_or_else(|| report!("Cancelled").into_dynamic())
    }
}

/// Runs one job. Every outcome ends in exactly one final event (or {"event":"error"}).
pub async fn run(command: &str, request: Value, io: Arc<Io>) -> bool {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let result = match command {
        "devices" => devices(&io).await,
        "signin" => match serde_json::from_value(request) {
            Ok(r) => signin(r, &io).await,
            Err(e) => Err(report!("Bad request: {e}").into_dynamic()),
        },
        "install" => match serde_json::from_value(request) {
            Ok(r) => install(r, &io).await,
            Err(e) => Err(report!("Bad request: {e}").into_dynamic()),
        },
        "pair" => match serde_json::from_value(request) {
            Ok(r) => pair(r, &io).await,
            Err(e) => Err(report!("Bad request: {e}").into_dynamic()),
        },
        "devmode" => match serde_json::from_value(request) {
            Ok(r) => devmode(r, &io).await,
            Err(e) => Err(report!("Bad request: {e}").into_dynamic()),
        },
        "ping" => match serde_json::from_value(request) {
            Ok(r) => ping(r, &io).await,
            Err(e) => Err(report!("Bad request: {e}").into_dynamic()),
        },
        other => Err(report!("Unknown command {other}").into_dynamic()),
    };
    match result {
        Ok(()) => true,
        Err(e) => {
            io.emit(json!({ "event": "error", "message": plain(&format!("{e}")) }));
            false
        }
    }
}

/// A report's messages without rootcause's tree drawing and source locations, most specific last.
pub fn plain(report: &str) -> String {
    report
        .lines()
        .map(|l| l.trim().trim_start_matches(['●', '├', '│', '╰', '─', ' ']).trim())
        .filter(|l| !l.is_empty() && !l.starts_with("src/") && !l.contains(".rs:"))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Reaching the device
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    udid: Option<String>,
    ip: Option<IpAddr>,
    pairing_file: Option<PathBuf>,
}

enum Provider {
    Usb(idevice::provider::UsbmuxdProvider),
    Tcp(TcpProvider),
}

/// Runs `$body` with `$p` bound to whichever kind of provider the target resolved to.
macro_rules! with_provider {
    ($provider:expr, |$p:ident| $body:expr) => {
        match $provider {
            Provider::Usb($p) => $body,
            Provider::Tcp($p) => $body,
        }
    };
}

#[cfg(windows)]
const DRIVER_HINT: &str = "Install Apple Devices from the Microsoft Store (or iTunes), then try again.";
#[cfg(target_os = "linux")]
const DRIVER_HINT: &str = "Install usbmuxd (sudo apt install usbmuxd), then try again.";
#[cfg(not(any(windows, target_os = "linux")))]
const DRIVER_HINT: &str = "Unlock the iPhone and try again.";

async fn provider(target: &Target) -> Result<Provider, Report> {
    if let (Some(ip), Some(file)) = (target.ip, &target.pairing_file) {
        let pairing_file = PairingFile::read_from_file(file)
            .map_err(|e| report!("ArkStore's pairing file is missing or damaged ({e}). Connect the iPhone to ArkStore on a computer once to set it up again."))?;
        return Ok(Provider::Tcp(TcpProvider { addr: ip, scope_id: None, pairing_file, label: LABEL.to_string() }));
    }
    let udid = target.udid.as_deref().ok_or_else(|| report!("No iPhone chosen"))?;
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let mut mux = addr
        .connect(0)
        .await
        .map_err(|e| report!("Can't reach Apple's device service ({e}). {}", DRIVER_HINT))?;
    let dev = mux
        .get_device(udid)
        .await
        .map_err(|_| report!("The iPhone was disconnected. Plug it in again and unlock it."))?;
    Ok(Provider::Usb(dev.to_provider(addr, LABEL)))
}

async fn lockdown_session(provider: &impl IdeviceProvider) -> Result<LockdownClient, Report> {
    let mut lockdown = LockdownClient::connect(provider).await?;
    let pairing = provider.get_pairing_file().await?;
    lockdown.start_session(&pairing).await?;
    Ok(lockdown)
}

async fn describe(provider: &impl IdeviceProvider) -> Result<(String, String), Report> {
    let mut lockdown = lockdown_session(provider).await?;
    let mut values = Vec::new();
    for key in ["DeviceName", "ProductVersion"] {
        let v = lockdown.get_value(Some(key), None).await.ok();
        values.push(v.and_then(|v| v.as_string().map(String::from)).unwrap_or_default());
    }
    let ios = values.pop().unwrap_or_default();
    Ok((values.pop().unwrap_or_default(), ios))
}

// ---------------------------------------------------------------------------
// devices / ping / devmode
// ---------------------------------------------------------------------------

async fn devices(io: &Io) -> Result<(), Report> {
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let mut mux = match addr.connect(0).await {
        Ok(m) => m,
        Err(_) => {
            // No Apple Mobile Device service (Windows without Apple Devices / iTunes, Linux
            // without usbmuxd): the desktop app offers to install it.
            io.emit(json!({ "event": "devices", "devices": [], "driver": false }));
            return Ok(());
        }
    };
    let list = mux.get_devices().await.unwrap_or_default();
    let mut out = Vec::new();
    for dev in list {
        let connection = match dev.connection_type {
            Connection::Usb => "usb",
            Connection::Network(_) => "wifi",
            Connection::Unknown(_) => "other",
        };
        // A device shows up before "Trust This Computer" is accepted; it has no pairing record
        // yet and its name can't be read.
        let provider = dev.to_provider(addr.clone(), LABEL);
        let trusted = provider.get_pairing_file().await.is_ok();
        let (name, ios) = if trusted { describe(&provider).await.unwrap_or_default() } else { Default::default() };
        out.push(json!({ "udid": dev.udid, "connection": connection, "trusted": trusted, "name": name, "ios": ios }));
    }
    io.emit(json!({ "event": "devices", "devices": out, "driver": true }));
    Ok(())
}

#[derive(Deserialize)]
struct TargetRequest {
    #[serde(default)]
    target: Option<Target>,
    udid: Option<String>,
}

impl TargetRequest {
    fn target(&self) -> Target {
        self.target.clone().unwrap_or(Target { udid: self.udid.clone(), ip: None, pairing_file: None })
    }
}

/// The iPhone checks it can reach itself (LocalDevVPN connected, pairing file valid).
async fn ping(req: TargetRequest, io: &Io) -> Result<(), Report> {
    let p = provider(&req.target()).await?;
    let (name, ios) = with_provider!(&p, |p| tokio::time::timeout(std::time::Duration::from_secs(6), describe(p))
        .await
        .map_err(|_| report!("Couldn't reach the iPhone. Connect LocalDevVPN and try again."))??);
    io.emit(json!({ "event": "pong", "name": name, "ios": ios }));
    Ok(())
}

// Developer Mode (iOS 16+) must be on for apps signed this way to open.
async fn devmode(req: TargetRequest, io: &Io) -> Result<(), Report> {
    let p = provider(&req.target()).await?;
    let enabled = with_provider!(&p, |p| {
        let mut amfi = AmfiClient::connect(p).await?;
        let enabled = amfi.get_developer_mode_status().await.unwrap_or(false);
        if !enabled {
            // Shows the Developer Mode switch in Settings > Privacy & Security (it's hidden until
            // a developer tool asks for it). Turning it on is the person's choice, on the iPhone.
            let _ = amfi.reveal_developer_mode_option_in_ui().await;
        }
        enabled
    });
    io.emit(json!({ "event": "devmode", "enabled": enabled }));
    Ok(())
}

// ---------------------------------------------------------------------------
// pair: set up ArkStore on the iPhone to work without a computer
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    udid: String,
    bundle_id: String,
}

async fn pair(req: PairRequest, io: &Io) -> Result<(), Report> {
    place_pairing_file(&req.udid, &req.bundle_id).await?;
    io.emit(json!({ "event": "paired" }));
    Ok(())
}

/// Lets this computer's pairing be used over the network (which is how the iPhone reaches its
/// own lockdownd through LocalDevVPN), and copies the pairing file into the app's Documents.
async fn place_pairing_file(udid: &str, bundle_id: &str) -> Result<(), Report> {
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let mut mux = addr.connect(0).await.map_err(|e| report!("Can't reach Apple's device service ({e})."))?;
    let record = mux.get_pair_record(udid).await.context("This computer isn't paired with the iPhone")?;
    let dev = mux.get_device(udid).await.map_err(|_| report!("The iPhone was disconnected."))?;
    let provider = dev.to_provider(addr, LABEL);

    let mut lockdown = lockdown_session(&provider).await?;
    lockdown
        .set_value("EnableWifiConnections", plist::Value::Boolean(true), Some("com.apple.mobile.wireless_lockdown"))
        .await
        .context("Couldn't allow network connections on the iPhone")?;

    let bytes = record.serialize().map_err(|e| report!("Couldn't write the pairing file: {e}"))?;
    let house_arrest = HouseArrestClient::connect(&provider).await?;
    let mut afc = house_arrest
        .vend_documents(bundle_id)
        .await
        .context("Couldn't open ArkStore's Documents on the iPhone")?;
    let mut file = afc.open(format!("/Documents/{PAIRING_FILE_NAME}"), AfcFopenMode::WrOnly).await?;
    file.write_entire(&bytes).await?;
    file.close().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Apple Account
// ---------------------------------------------------------------------------

async fn ask_two_factor(io: Arc<Io>, params: TwoFactorCallbackParams) -> Result<TwoFactorCallbackResponse, Report> {
    let numbers: Vec<Value> = params
        .numbers
        .iter()
        .map(|n| json!({ "id": n.id, "number": n.number_with_dial_code }))
        .collect();
    io.emit(json!({
        "event": "twoFactor",
        "sms": params.sms,
        "unknown": params.unknown,
        "numbers": numbers,
        "selected": params.selected_number_id,
        "lastError": params.last_error,
    }));
    let answer = io.read().await?;
    Ok(match answer.get("action").and_then(Value::as_str).unwrap_or("code") {
        "sms" => TwoFactorCallbackResponse::SendSms(answer["id"].as_u64().unwrap_or(0) as u32),
        "devices" => TwoFactorCallbackResponse::SendToDevices,
        "resend" => TwoFactorCallbackResponse::ResendCode,
        "abort" => TwoFactorCallbackResponse::Abort,
        _ => TwoFactorCallbackResponse::SubmitCode(answer["code"].as_str().unwrap_or_default().trim().to_string()),
    })
}

/// A free Apple Account can have 2 development certificates. When both are taken (SideStore,
/// AltServer, another computer), the person picks one to replace; that tool's apps stop opening
/// until it refreshes, which is why this is never done silently.
async fn ask_revoke(io: Arc<Io>, certs: Vec<DevelopmentCertificate>) -> Result<Option<Vec<String>>, Report> {
    let list: Vec<Value> = certs
        .iter()
        .map(|c| {
            json!({
                "serial": c.serial_number,
                "name": c.name,
                "machine": c.machine_name,
                "expires": c.expiration_date.map(|d| format!("{d:?}")),
            })
        })
        .collect();
    io.emit(json!({ "event": "maxCerts", "certs": list }));
    let answer = io.read().await?;
    let serials: Vec<String> = answer["revoke"]
        .as_array()
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    Ok(if serials.is_empty() { None } else { Some(serials) })
}

/// Public anisette servers (Apple's sign-in needs the "anisette" data a Mac would send), tried
/// in order: any one can be down or refuse some networks. ARK_ANISETTE_URL puts another first
/// (for example one ArkStore hosts itself). The one that worked is remembered in dataDir.
const ANISETTE_SERVERS: &[&str] = &[
    DEFAULT_ANISETTE_V3_URL,
    "https://ani.sidestore.io",
    "https://ani.sidestore.app",
    "https://ani.sidestore.zip",
    "https://ani.846969.xyz",
    "https://ani.neoarz.xyz",
];

fn anisette_servers(data_dir: &std::path::Path) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    if let Ok(url) = std::env::var("ARK_ANISETTE_URL") {
        list.push(url);
    }
    if let Ok(last) = std::fs::read_to_string(data_dir.join("anisette-server")) {
        list.push(last.trim().to_string());
    }
    list.extend(ANISETTE_SERVERS.iter().map(|s| s.to_string()));
    let mut seen = std::collections::HashSet::new();
    list.retain(|u| !u.is_empty() && seen.insert(u.clone()));
    list
}

async fn sign_in(email: &str, password: &str, data_dir: &std::path::Path, io: &Arc<Io>) -> Result<DeveloperSession, Report> {
    std::fs::create_dir_all(data_dir)?;
    let mut last_error = None;
    for url in anisette_servers(data_dir) {
        // Each server keeps its own provisioned identity.
        let host = url.trim_start_matches("https://").replace(['/', ':'], "_");
        let anisette = RemoteV3AnisetteProvider::new(
            &url,
            Box::new(FsStorage::new(data_dir.join("anisette").join(host))),
            "0".to_string(),
        )?;
        let io2 = io.clone();
        let two_factor = move |p: TwoFactorCallbackParams| ask_two_factor(io2.clone(), p);
        match AppleAccount::builder(email).anisette_provider(anisette).login(password, two_factor).await {
            Ok(mut account) => {
                let _ = std::fs::write(data_dir.join("anisette-server"), &url);
                return Ok(DeveloperSession::from_account(&mut account)
                    .await
                    .context("Couldn't open the Apple developer session for this account")?);
            }
            Err(e) => {
                let text = format!("{e}");
                // Anisette trouble happens before the password is sent: try the next server.
                // Anything else (wrong password, two-factor, Apple's limits) is final.
                if !(text.contains("anisette") || text.contains("provision")) {
                    return Err(e.context("Apple Account sign-in failed").into_dynamic());
                }
                tracing::warn!("anisette server {url} failed: {text}");
                last_error = Some(e);
            }
        }
    }
    Err(last_error
        .map(|e| e.context("Couldn't reach any anisette server (needed for Apple sign-in)").into_dynamic())
        .unwrap_or_else(|| report!("No anisette server configured").into_dynamic()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignInRequest {
    email: String,
    password: String,
    data_dir: PathBuf,
}

/// Checks the Apple Account (and does the two-factor step) before an iPhone is involved.
async fn signin(req: SignInRequest, io: &Arc<Io>) -> Result<(), Report> {
    let mut session = sign_in(&req.email, &req.password, &req.data_dir, io).await?;
    let teams = session.list_teams().await?;
    let team = teams.first().map(|t| json!({ "id": t.team_id, "name": t.name }));
    io.emit(json!({ "event": "signedIn", "team": team }));
    Ok(())
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRequest {
    #[serde(default)]
    target: Option<Target>,
    udid: Option<String>,
    email: String,
    password: String,
    ipa: PathBuf,
    data_dir: PathBuf,
    machine_name: Option<String>,
    /// The app's own bundle ID (e.g. com.arkdevs.arkstore): after installing it over USB, set
    /// it up to renew apps on the iPhone by itself (see place_pairing_file).
    pair_for: Option<String>,
}

async fn install(req: InstallRequest, io: &Arc<Io>) -> Result<(), Report> {
    let target = req.target.clone().unwrap_or(Target { udid: req.udid.clone(), ip: None, pairing_file: None });
    let p = provider(&target).await?;

    io.progress("signin", 0);
    let session = sign_in(&req.email, &req.password, &req.data_dir, io).await?;

    io.progress("sign", 5);
    let io2 = io.clone();
    let revoke = move |certs: Vec<DevelopmentCertificate>| ask_revoke(io2.clone(), certs);
    let mut sideloader = SideloaderBuilder::new(session, req.email.clone())
        .team_selection(TeamSelection::First)
        .max_certs_behavior(MaxCertsBehavior::Prompt(revoke))
        .storage(Box::new(FsStorage::new(req.data_dir.join("signing"))))
        .machine_name(req.machine_name.clone().unwrap_or_else(|| "ArkStore".to_string()))
        .build();

    let io3 = io.clone();
    let on_progress = move |p: f32| {
        // isideload reports signing as 0..1; the transfer to the iPhone follows.
        io3.progress(if p < 1.0 { "sign" } else { "transfer" }, (5.0 + p * 90.0).min(95.0) as u32);
        std::future::ready(())
    };
    with_provider!(&p, |p| sideloader.install_app(p, req.ipa.clone(), false, Some(on_progress.clone())).await)?;

    let team = sideloader.get_team().await?;
    let installed_as = req.pair_for.as_ref().map(|id| format!("{id}.{}", team.team_id));
    if let (Some(bundle_id), Some(udid)) = (&installed_as, &target.udid) {
        io.progress("pair", 97);
        place_pairing_file(udid, bundle_id).await.context("Installed, but couldn't set up renewing on the iPhone")?;
    }

    io.progress("done", 100);
    io.emit(json!({ "event": "done", "teamId": team.team_id, "bundleId": installed_as }));
    Ok(())
}
