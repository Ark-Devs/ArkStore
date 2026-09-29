// ark-sideload: ArkStore's iPhone installer, run by the desktop app (desktop/iphone.cjs).
// Signs an app with the person's own free Apple Account and installs it on an iPhone connected
// by USB, the way SideStore / AltServer / iloader do, using isideload (MIT, by nab138).
//
// Protocol: `ark-sideload <command>`, then one JSON request line on stdin (so the Apple Account
// password never appears in the process list). Progress, questions and the result come back as
// JSON lines on stdout, one object per line with an "event" field. Questions (the two-factor
// code, which certificate to replace) are answered with further JSON lines on stdin.
//
//   devices   {}                                      -> {"event":"devices","devices":[...]}
//   install   {"udid","email","password","ipa","dataDir"} -> progress..., {"event":"done"}
//   signin    {"email","password","dataDir"}          -> {"event":"signedIn","team":...}
//   devmode   {"udid"}                                -> {"event":"devmode","enabled":bool}
//
// Everything it keeps (the signing certificate, the anisette identity) is written under
// dataDir, which the desktop app puts in its own user-data folder.
use std::{path::PathBuf, sync::OnceLock};

use idevice::{
    IdeviceService,
    amfi::AmfiClient,
    lockdown::LockdownClient,
    provider::IdeviceProvider,
    usbmuxd::{Connection, UsbmuxdAddr, UsbmuxdDevice},
};
use isideload::{
    anisette::remote_v3::{DEFAULT_ANISETTE_V3_URL, RemoteV3AnisetteProvider},
    auth::apple_account::{AppleAccount, TwoFactorCallbackParams, TwoFactorCallbackResponse},
    dev::{certificates::DevelopmentCertificate, developer_session::DeveloperSession},
    sideload::{SideloaderBuilder, TeamSelection, builder::MaxCertsBehavior},
    util::fs_storage::FsStorage,
};
use rootcause::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, BufReader, Lines, Stdin},
    sync::Mutex,
};

const LABEL: &str = "ArkStore";

static INPUT: OnceLock<Mutex<Lines<BufReader<Stdin>>>> = OnceLock::new();

fn emit(v: Value) {
    // One line per event; stdout is line-buffered by the reader in the desktop app.
    println!("{v}");
}

fn progress(stage: &str, percent: u32) {
    emit(json!({ "event": "progress", "stage": stage, "percent": percent }));
}

/// The next JSON line from the desktop app, or an error when it closed stdin (cancelled).
async fn read_line() -> Result<Value, Report> {
    let input = INPUT.get_or_init(|| Mutex::new(BufReader::new(tokio::io::stdin()).lines()));
    let line = input.lock().await.next_line().await?;
    let line = line.ok_or_else(|| report!("Cancelled"))?;
    Ok(serde_json::from_str(&line)?)
}

async fn device(udid: &str) -> Result<(UsbmuxdDevice, UsbmuxdAddr), Report> {
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let mut mux = addr
        .connect(0)
        .await
        .map_err(|e| report!("Can't reach Apple's device service ({e}). {}", DRIVER_HINT))?;
    let dev = mux
        .get_device(udid)
        .await
        .map_err(|_| report!("The iPhone was disconnected. Plug it in again and unlock it."))?;
    Ok((dev, addr))
}

#[cfg(windows)]
const DRIVER_HINT: &str = "Install Apple Devices from the Microsoft Store (or iTunes), then try again.";
#[cfg(target_os = "linux")]
const DRIVER_HINT: &str = "Install usbmuxd (sudo apt install usbmuxd), then try again.";
#[cfg(target_os = "macos")]
const DRIVER_HINT: &str = "Unlock the iPhone and try again.";

// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------

async fn devices() -> Result<(), Report> {
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let mut mux = match addr.connect(0).await {
        Ok(m) => m,
        Err(_) => {
            // No Apple Mobile Device service (Windows without Apple Devices / iTunes, Linux
            // without usbmuxd): the desktop app offers to install it.
            emit(json!({ "event": "devices", "devices": [], "driver": false }));
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
    emit(json!({ "event": "devices", "devices": out, "driver": true }));
    Ok(())
}

async fn describe(provider: &impl IdeviceProvider) -> Result<(String, String), Report> {
    let mut lockdown = LockdownClient::connect(provider).await?;
    let pairing = provider.get_pairing_file().await?;
    lockdown.start_session(&pairing).await?;
    let mut values = Vec::new();
    for key in ["DeviceName", "ProductVersion"] {
        let v = lockdown.get_value(Some(key), None).await.ok();
        values.push(v.and_then(|v| v.as_string().map(String::from)).unwrap_or_default());
    }
    let ios = values.pop().unwrap_or_default();
    Ok((values.pop().unwrap_or_default(), ios))
}

// ---------------------------------------------------------------------------
// devmode: Developer Mode (iOS 16+) must be on for apps signed this way to open.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DevModeRequest {
    udid: String,
}

async fn devmode(req: DevModeRequest) -> Result<(), Report> {
    let (dev, addr) = device(&req.udid).await?;
    let provider = dev.to_provider(addr, LABEL);
    let mut amfi = AmfiClient::connect(&provider).await?;
    let enabled = amfi.get_developer_mode_status().await.unwrap_or(false);
    if !enabled {
        // Shows the Developer Mode switch in Settings > Privacy & Security (it's hidden until a
        // developer tool asks for it). Turning it on is the person's choice, on the iPhone.
        let _ = amfi.reveal_developer_mode_option_in_ui().await;
    }
    emit(json!({ "event": "devmode", "enabled": enabled }));
    Ok(())
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRequest {
    udid: String,
    email: String,
    password: String,
    ipa: PathBuf,
    data_dir: PathBuf,
    machine_name: Option<String>,
}

async fn ask_two_factor(params: TwoFactorCallbackParams) -> Result<TwoFactorCallbackResponse, Report> {
    let numbers: Vec<Value> = params
        .numbers
        .iter()
        .map(|n| json!({ "id": n.id, "number": n.number_with_dial_code }))
        .collect();
    emit(json!({
        "event": "twoFactor",
        "sms": params.sms,
        "unknown": params.unknown,
        "numbers": numbers,
        "selected": params.selected_number_id,
        "lastError": params.last_error,
    }));
    let answer = read_line().await?;
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
async fn ask_revoke(certs: Vec<DevelopmentCertificate>) -> Result<Option<Vec<String>>, Report> {
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
    emit(json!({ "event": "maxCerts", "certs": list }));
    let answer = read_line().await?;
    let serials: Vec<String> = answer["revoke"]
        .as_array()
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    Ok(if serials.is_empty() { None } else { Some(serials) })
}

async fn sign_in(email: &str, password: &str, data_dir: &std::path::Path) -> Result<DeveloperSession, Report> {
    std::fs::create_dir_all(data_dir)?;
    let anisette = RemoteV3AnisetteProvider::new(
        DEFAULT_ANISETTE_V3_URL,
        Box::new(FsStorage::new(data_dir.join("anisette"))),
        "0".to_string(),
    )?;
    let mut account = AppleAccount::builder(email)
        .anisette_provider(anisette)
        .login(password, ask_two_factor)
        .await
        .context("Apple Account sign-in failed")?;
    Ok(DeveloperSession::from_account(&mut account)
        .await
        .context("Couldn't open the Apple developer session for this account")?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignInRequest {
    email: String,
    password: String,
    data_dir: PathBuf,
}

/// Checks the Apple Account (and does the two-factor step) before an iPhone is involved.
async fn signin(req: SignInRequest) -> Result<(), Report> {
    use isideload::dev::teams::TeamsApi;
    let mut session = sign_in(&req.email, &req.password, &req.data_dir).await?;
    let teams = session.list_teams().await?;
    let team = teams.first().map(|t| json!({ "id": t.team_id, "name": t.name }));
    emit(json!({ "event": "signedIn", "team": team }));
    Ok(())
}

async fn install(req: InstallRequest) -> Result<(), Report> {
    let (dev, addr) = device(&req.udid).await?;
    let provider = dev.to_provider(addr, LABEL);

    progress("signin", 0);
    let session = sign_in(&req.email, &req.password, &req.data_dir).await?;

    progress("sign", 5);
    let mut sideloader = SideloaderBuilder::new(session, req.email.clone())
        .team_selection(TeamSelection::First)
        .max_certs_behavior(MaxCertsBehavior::Prompt(ask_revoke))
        .storage(Box::new(FsStorage::new(req.data_dir.join("signing"))))
        .machine_name(req.machine_name.unwrap_or_else(|| "ArkStore".to_string()))
        .build();

    sideloader
        .install_app(
            &provider,
            req.ipa,
            false,
            Some(|p: f32| {
                // isideload reports signing as 0..1; the USB transfer follows.
                progress(if p < 1.0 { "sign" } else { "transfer" }, (5.0 + p * 90.0).min(95.0) as u32);
                std::future::ready(())
            }),
        )
        .await?;

    progress("done", 100);
    emit(json!({ "event": "done" }));
    Ok(())
}

// ---------------------------------------------------------------------------

async fn run(command: &str) -> Result<(), Report> {
    match command {
        "devices" => devices().await,
        "signin" => signin(serde_json::from_value(read_line().await?)?).await,
        "devmode" => devmode(serde_json::from_value(read_line().await?)?).await,
        "install" => install(serde_json::from_value(read_line().await?)?).await,
        other => bail!("Unknown command {other}"),
    }
}

/// A report's messages without rootcause's tree drawing and source locations, most specific last.
fn plain(report: &str) -> String {
    report
        .lines()
        .map(|l| l.trim().trim_start_matches(['●', '├', '│', '╰', '─', ' ']).trim())
        .filter(|l| !l.is_empty() && !l.starts_with("src/") && !l.contains(".rs:"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let _ = isideload::init();
    // Library logs go to stderr, which the desktop app keeps for the error report.
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).init();

    let command = std::env::args().nth(1).unwrap_or_default();
    if let Err(e) = run(&command).await {
        emit(json!({ "event": "error", "message": plain(&format!("{e}")) }));
        std::process::exit(1);
    }
}
