//! DEVELOPMENT ONLY. Never shipped.
//!
//! Serves `POST /call {"cmd": "...", "args": {...}}` on 127.0.0.1 so the UI can be developed and
//! end-to-end tested in a regular browser against the real Rust core (the same `Session` the
//! Android app uses). Data lives in `target/devdata/` (or `KEEL_DEV_DATA`), with the key file
//! stored unprotected, so never use it for real data.

use std::io::Read;
use std::path::PathBuf;

use keel_core::crypto::TEST_KDF;
use keel_core::error::ErrorPayload;
use keel_core::keystore::PlainProtector;
use keel_core::session::Session;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Response, Server};

fn main() {
    let port: u16 = std::env::var("KEEL_DEV_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5174);
    let dir = std::env::var("KEEL_DEV_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("target/devdata"));
    if std::env::args().any(|a| a == "--reset") {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::create_dir_all(&dir).expect("create dev data dir");
    // Development server: fast KDF and a "biometric" that always succeeds, to exercise the UI.
    let mut session = Session::new(
        dir.clone(),
        Box::new(PlainProtector),
        Some(Box::new(PlainProtector)),
        TEST_KDF,
    );
    let server = Server::http(("127.0.0.1", port)).expect("bind dev server");
    eprintln!(
        "keel-devserver on http://127.0.0.1:{port} using {}",
        dir.display()
    );

    let cors = [
        Header::from_bytes("Access-Control-Allow-Origin", "http://localhost:5173").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "content-type").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "POST, OPTIONS").unwrap(),
        Header::from_bytes("Content-Type", "application/json").unwrap(),
    ];

    for mut req in server.incoming_requests() {
        let mut resp = if req.method() == &Method::Options {
            Response::from_string("").with_status_code(204)
        } else if req.method() == &Method::Post && req.url() == "/call" {
            let mut body = String::new();
            let _ = req.as_reader().take(300_000_000).read_to_string(&mut body);
            let (status, out) = handle(&mut session, &body);
            Response::from_string(out.to_string()).with_status_code(status)
        } else {
            Response::from_string("{}").with_status_code(404)
        };
        for h in &cors {
            resp.add_header(h.clone());
        }
        let _ = req.respond(resp);
    }
}

fn handle(session: &mut Session, body: &str) -> (u16, Value) {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return (
            400,
            json!({"code": "validation", "field": null, "message": "malformed request"}),
        );
    };
    let cmd = v.get("cmd").and_then(Value::as_str).unwrap_or_default();
    let args = v.get("args").cloned().unwrap_or(json!({}));
    match session.call(cmd, args) {
        Ok(v) => (200, v),
        Err(e) => (
            422,
            serde_json::to_value(ErrorPayload::from(&e)).unwrap_or(json!({})),
        ),
    }
}
