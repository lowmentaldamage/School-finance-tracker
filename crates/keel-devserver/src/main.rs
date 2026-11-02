//! DEVELOPMENT ONLY. Never shipped.
//!
//! Serves `POST /call {"cmd": "...", "args": {...}}` on 127.0.0.1 so the UI can be developed and
//! end-to-end tested in a regular browser against the real Rust core and an encrypted database.
//! The database lives in `target/devdata/` and is protected by a fixed development key.

use std::io::Read;
use std::path::PathBuf;

use keel_core::db::{self, DbKey};
use keel_core::error::ErrorPayload;
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
    std::fs::create_dir_all(&dir).expect("create dev data dir");
    let path = dir.join("keel-dev.db");
    if std::env::args().any(|a| a == "--reset") {
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }
    let conn = db::open(&path, &DbKey::from_bytes([0x42; 32])).expect("open dev database");
    let server = Server::http(("127.0.0.1", port)).expect("bind dev server");
    eprintln!(
        "keel-devserver on http://127.0.0.1:{port} using {}",
        path.display()
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
            let _ = req.as_reader().take(1_000_000).read_to_string(&mut body);
            let (status, out) = handle(&conn, &body);
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

fn handle(conn: &db::Connection, body: &str) -> (u16, Value) {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return (
            400,
            json!({"code": "validation", "field": null, "message": "malformed request"}),
        );
    };
    let cmd = v.get("cmd").and_then(Value::as_str).unwrap_or_default();
    if cmd == "app.status" {
        return (
            200,
            json!({"ready": true, "error": null, "key_protection": "development"}),
        );
    }
    let args = v.get("args").cloned().unwrap_or(json!({}));
    match keel_core::api::dispatch(conn, cmd, args) {
        Ok(v) => (200, v),
        Err(e) => (
            422,
            serde_json::to_value(ErrorPayload::from(&e)).unwrap_or(json!({})),
        ),
    }
}
