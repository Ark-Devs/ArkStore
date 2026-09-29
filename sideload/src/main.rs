// ark-sideload: the desktop app's front end for the installer in lib.rs (desktop/iphone.cjs runs
// it). `ark-sideload <command>`, then one JSON request line on stdin (so the Apple Account
// password never appears in the process list); events come back as JSON lines on stdout, and
// answers to questions go in as further lines on stdin. Library logs go to stderr.
use ark_sideload::{Io, run};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let _ = isideload::init();
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).init();

    let command = std::env::args().nth(1).unwrap_or_default();
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let request = match lines.next_line().await {
        Ok(Some(line)) => serde_json::from_str(&line).unwrap_or(serde_json::Value::Null),
        _ => serde_json::Value::Null,
    };

    // Later lines are answers; stdin closing (the desktop app cancelled) ends the channel.
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str(&line) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });

    let io = Io::new(|v| println!("{v}"), rx);
    let ok = run(&command, request, io).await;
    std::process::exit(if ok { 0 } else { 1 });
}
