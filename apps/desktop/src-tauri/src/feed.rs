use crate::wire::{self, MAX_MESSAGE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io, sync::Arc, time::Duration};
use tauri::Emitter;
use tokio::{io::AsyncWriteExt, net::TcpListener, sync::Mutex, time::timeout};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Envelope {
    Left(Left),
    Event(RoomEvent),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Left {
    v: u8,
    r#type: LeftType,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum LeftType {
    Left,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoomEvent {
    v: u8,
    room_code: String,
    event: Value,
}

pub fn validate(bytes: &[u8]) -> Option<Envelope> {
    if bytes.len() > MAX_MESSAGE {
        return None;
    }
    let envelope: Envelope = serde_json::from_slice(bytes).ok()?;
    match &envelope {
        Envelope::Left(left) if left.v == 1 => Some(envelope),
        Envelope::Event(event)
            if event.v == 1
                && !event.room_code.is_empty()
                && event.room_code.len() <= 64
                && event
                    .room_code
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
                && event.event.is_object() =>
        {
            Some(envelope)
        }
        _ => None,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FeedStatus {
    pub state: String,
    accepted: u64,
    rejected: u64,
}

impl Default for FeedStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            accepted: 0,
            rejected: 0,
        }
    }
}

#[derive(Default)]
struct Inner {
    started: bool,
    status: FeedStatus,
}

#[derive(Default)]
pub struct Feed {
    inner: Arc<Mutex<Inner>>,
}

async fn emit_status(
    app: &tauri::AppHandle,
    inner: &Mutex<Inner>,
    state: Option<&str>,
    rejected: bool,
    accepted: bool,
) {
    let mut inner = inner.lock().await;
    if let Some(state) = state {
        inner.status.state = state.into();
    }
    inner.status.rejected += u64::from(rejected);
    inner.status.accepted += u64::from(accepted);
    // Only counters cross the diagnostic boundary; never log payloads or errors
    // from parsers, which may contain room codes or account IDs.
    if rejected {
        eprintln!("Feed rejected count: {}", inner.status.rejected);
    }
    let _ = app.emit("feed-status", inner.status.clone());
}

impl Feed {
    pub async fn start(&self, app: tauri::AppHandle) -> Result<FeedStatus, String> {
        let mut inner = self.inner.lock().await;
        if inner.started {
            return Ok(inner.status.clone());
        }
        let listener = match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 38917)).await {
            Ok(listener) => listener,
            Err(error) => {
                inner.status.state = if error.kind() == io::ErrorKind::AddrInUse {
                    "port-in-use"
                } else {
                    "error"
                }
                .into();
                let _ = app.emit("feed-status", inner.status.clone());
                return Ok(inner.status.clone());
            }
        };
        inner.started = true;
        inner.status.state = "listening".into();
        let status = inner.status.clone();
        let state = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            // One active producer prevents interleaving unrelated room streams.
            // Other clients remain in the OS backlog until the current one leaves.
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    emit_status(&app, &state, Some("error"), false, false).await;
                    break;
                };
                if !matches!(
                    timeout(Duration::from_secs(5), wire::handshake(&mut stream)).await,
                    Ok(Ok(()))
                ) {
                    emit_status(&app, &state, None, true, false).await;
                    continue;
                }
                emit_status(&app, &state, Some("connected"), false, false).await;
                serve(&mut stream, |message| {
                    let app = app.clone();
                    let state = state.clone();
                    async move {
                        let accepted = message.is_some();
                        if let Some(message) = message {
                            let _ = app.emit("feed-message", message);
                        }
                        emit_status(&app, &state, None, !accepted, accepted).await;
                    }
                })
                .await;
                let _ = app.emit(
                    "feed-message",
                    Envelope::Left(Left {
                        v: 1,
                        r#type: LeftType::Left,
                    }),
                );
                emit_status(&app, &state, Some("disconnected"), false, false).await;
            }
        });
        Ok(status)
    }
}

async fn serve<S, F, Fut>(stream: &mut S, mut on_message: F)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    F: FnMut(Option<Envelope>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut fragmented = false;
    let mut rejected = false;
    let mut message = Vec::new();
    loop {
        let budget = MAX_MESSAGE.saturating_sub(message.len());
        let frame = match timeout(
            Duration::from_secs(60 * 30),
            wire::read_frame(stream, budget),
        )
        .await
        {
            Ok(Ok(frame)) => frame,
            _ => break,
        };
        if frame.opcode >= 8 {
            if frame.opcode == 8 {
                let _ = stream.write_all(&[0x88, 0]).await;
                break;
            }
            on_message(None).await;
            // Ping/pong are never forwarded, but answer a valid ping to keep
            // the transport alive. No application data is echoed elsewhere.
            if frame.opcode == 9 && frame.fin {
                if let Some(payload) = frame.payload.filter(|p| p.len() <= 125) {
                    let mut pong = vec![0x8a, payload.len() as u8];
                    pong.extend(payload);
                    if stream.write_all(&pong).await.is_err() {
                        break;
                    }
                }
            }
            continue;
        }
        let valid_opcode = (frame.opcode == 1 && !fragmented) || (frame.opcode == 0 && fragmented);
        rejected |= !valid_opcode || frame.payload.is_none();
        if !rejected {
            message.extend(frame.payload.unwrap_or_default());
        }
        if frame.fin {
            on_message(if rejected { None } else { validate(&message) }).await;
            message.clear();
            fragmented = false;
            rejected = false;
        } else {
            fragmented = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_v1_envelopes() {
        assert!(validate(
            br#"{"v":1,"roomCode":"CAS7R1","event":{"type":"room.presence.updated"}}"#
        )
        .is_some());
        assert!(validate(br#"{"v":1,"type":"left"}"#).is_some());
        for bytes in [
            br#"{"v":2,"type":"left"}"#.as_slice(),
            br#"{"v":1,"type":"other"}"#,
            br#"{"v":1,"roomCode":"","event":{}}"#,
            br#"{"v":1,"roomCode":"ROOM","event":null}"#,
            br#"{"v":1,"type":"left","event":{}}"#,
            b"not json",
            &[0xff],
        ] {
            assert!(validate(bytes).is_none());
        }
        assert!(validate(&vec![b' '; MAX_MESSAGE + 1]).is_none());
    }

    #[tokio::test]
    async fn rejects_bad_messages_and_keeps_the_connection() {
        let (mut client, mut server) = tokio::io::duplex(MAX_MESSAGE * 3);
        let valid = br#"{"v":1,"type":"left"}"#;
        let mut frames = wire::masked_frame(2, true, b"binary");
        frames.extend(wire::masked_frame(1, true, b"bad json"));
        frames.extend(wire::masked_frame(1, true, br#"{"v":2,"type":"left"}"#));
        frames.extend(wire::masked_frame(1, true, &vec![b'x'; MAX_MESSAGE + 1]));
        frames.extend(wire::masked_frame(1, true, &[0xff]));
        frames.extend(wire::masked_frame(1, false, &vec![b'x'; MAX_MESSAGE]));
        frames.extend(wire::masked_frame(0, true, b"overflow"));
        frames.extend(wire::masked_frame(1, false, &valid[..10]));
        frames.extend(wire::masked_frame(0, true, &valid[10..]));
        client.write_all(&frames).await.unwrap();
        client.shutdown().await.unwrap();
        let mut results = Vec::new();
        serve(&mut server, |message| {
            results.push(message.is_some());
            std::future::ready(())
        })
        .await;
        assert_eq!(results, [false, false, false, false, false, false, true]);
    }
}
