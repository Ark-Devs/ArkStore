// The iPhone app's C interface, driven the way the Swift module drives it: start a job, poll its
// events until "end", free each string.
#![cfg(feature = "ffi")]
use std::ffi::{CStr, CString};

use ark_sideload::ffi::{ark_free, ark_next, ark_start};

fn events(command: &str, request: &str) -> Vec<serde_json::Value> {
    let c = CString::new(command).unwrap();
    let r = CString::new(request).unwrap();
    let job = unsafe { ark_start(c.as_ptr(), r.as_ptr()) };
    let mut out = Vec::new();
    for _ in 0..600 {
        let p = ark_next(job);
        if p.is_null() {
            std::thread::sleep(std::time::Duration::from_millis(20));
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(unsafe { CStr::from_ptr(p) }.to_str().unwrap()).unwrap();
        unsafe { ark_free(p) };
        let end = v["event"] == "end";
        out.push(v);
        if end {
            break;
        }
    }
    out
}

#[test]
fn ping_without_pairing_file_reports_an_error_then_ends() {
    let ev = events("ping", r#"{"target":{"ip":"127.0.0.1","pairingFile":"/nonexistent/ArkStorePairing.plist"}}"#);
    assert_eq!(ev.len(), 2, "{ev:?}");
    assert_eq!(ev[0]["event"], "error");
    assert!(ev[0]["message"].as_str().unwrap().contains("pairing file"), "{ev:?}");
    assert_eq!(ev[1], serde_json::json!({ "event": "end", "ok": false }));
}

#[test]
fn unknown_command_and_bad_request() {
    let ev = events("nope", "{}");
    assert_eq!(ev[0]["event"], "error");
    let ev = events("install", r#"{"email":1}"#);
    assert!(ev[0]["message"].as_str().unwrap().starts_with("Bad request"), "{ev:?}");
    assert_eq!(ev.last().unwrap()["event"], "end");
}
