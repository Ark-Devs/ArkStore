// C interface for ArkStore on the iPhone (modules/ark-sideload/ios). A job runs on its own thread
// with its own Tokio runtime; the app polls for events and sends answers:
//
//   uint64_t ark_start(const char *command, const char *request_json);
//   char *ark_next(uint64_t job);      // next event as JSON, or NULL if none yet; free with ark_free
//   void ark_answer(uint64_t job, const char *answer_json);
//   void ark_cancel(uint64_t job);     // ends the answers channel; the job stops at its next question
//   void ark_free(char *s);
//
// After the final event the job sends {"event":"end","ok":bool} and is forgotten.
use std::{
    collections::{HashMap, VecDeque},
    ffi::{CStr, CString, c_char},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{Io, run};

struct Job {
    events: Arc<Mutex<VecDeque<String>>>,
    answers: Option<mpsc::UnboundedSender<Value>>,
}

fn jobs() -> &'static Mutex<HashMap<u64, Job>> {
    static JOBS: OnceLock<Mutex<HashMap<u64, Job>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT: AtomicU64 = AtomicU64::new(1);

unsafe fn text(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_start(command: *const c_char, request_json: *const c_char) -> u64 {
    let command = unsafe { text(command) };
    let request: Value = serde_json::from_str(&unsafe { text(request_json) }).unwrap_or(Value::Null);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let events = Arc::new(Mutex::new(VecDeque::new()));
    let (tx, rx) = mpsc::unbounded_channel();
    jobs().lock().unwrap().insert(id, Job { events: events.clone(), answers: Some(tx) });

    std::thread::spawn(move || {
        let push = {
            let events = events.clone();
            move |v: Value| events.lock().unwrap().push_back(v.to_string())
        };
        let ok = match tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() {
            Ok(rt) => rt.block_on(run(&command, request, Io::new(push, rx))),
            Err(e) => {
                events.lock().unwrap().push_back(json!({ "event": "error", "message": e.to_string() }).to_string());
                false
            }
        };
        events.lock().unwrap().push_back(json!({ "event": "end", "ok": ok }).to_string());
    });
    id
}

#[unsafe(no_mangle)]
pub extern "C" fn ark_next(job: u64) -> *mut c_char {
    let mut all = jobs().lock().unwrap();
    let Some(j) = all.get(&job) else { return std::ptr::null_mut() };
    let next = j.events.lock().unwrap().pop_front();
    match next {
        Some(s) => {
            if s.contains("\"event\":\"end\"") {
                all.remove(&job);
            }
            CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
        }
        None => std::ptr::null_mut(),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_answer(job: u64, answer_json: *const c_char) {
    let answer: Value = serde_json::from_str(&unsafe { text(answer_json) }).unwrap_or(Value::Null);
    if let Some(tx) = jobs().lock().unwrap().get(&job).and_then(|j| j.answers.as_ref()) {
        let _ = tx.send(answer);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ark_cancel(job: u64) {
    if let Some(j) = jobs().lock().unwrap().get_mut(&job) {
        j.answers = None;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_free(s: *mut c_char) {
    if !s.is_null() {
        drop(unsafe { CString::from_raw(s) });
    }
}
