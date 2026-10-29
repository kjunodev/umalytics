use crate::wire::{self, MAX_MESSAGE};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io, sync::Arc, time::Duration};
use tauri::Emitter;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Mutex,
    task::JoinSet,
    time::timeout,
};
use tokio_tungstenite::{
    tungstenite::{Error, Message},
    WebSocketStream,
};

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

#[derive(Debug)]
enum FeedEvent {
    Connected,
    Disconnected,
    Left,
    Rejected,
    Error,
    Message(Envelope),
}

async fn dispatch(app: &tauri::AppHandle, inner: &Mutex<Inner>, event: FeedEvent) {
    let mut inner = inner.lock().await;
    match event {
        FeedEvent::Connected => inner.status.state = "connected".into(),
        FeedEvent::Disconnected => inner.status.state = "disconnected".into(),
        FeedEvent::Error => inner.status.state = "error".into(),
        FeedEvent::Left => {
            let _ = app.emit(
                "feed-message",
                Envelope::Left(Left {
                    v: 1,
                    r#type: LeftType::Left,
                }),
            );
        }
        FeedEvent::Message(message) => {
            let _ = app.emit("feed-message", message);
            inner.status.accepted += 1;
        }
        FeedEvent::Rejected => {
            inner.status.rejected += 1;
            // Parser and transport errors can contain identifiers. Log counts only.
            eprintln!("Feed rejected count: {}", inner.status.rejected);
        }
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
            run_listener(listener, |event| {
                let app = app.clone();
                let state = state.clone();
                async move { dispatch(&app, &state, event).await }
            })
            .await;
        });
        Ok(status)
    }
}

type Socket = WebSocketStream<TcpStream>;

async fn disconnect<F, Fut>(active: &mut Option<Socket>, emit: &mut F)
where
    F: FnMut(FeedEvent) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    if let Some(mut old) = active.take() {
        emit(FeedEvent::Left).await;
        emit(FeedEvent::Disconnected).await;
        // A stalled peer must not delay takeover indefinitely. Closing only
        // sends and flushes the close frame; we do not wait for its acknowledgement.
        let _ = timeout(Duration::from_millis(250), old.close(None)).await;
    }
}

async fn run_listener<F, Fut>(listener: TcpListener, mut emit: F)
where
    F: FnMut(FeedEvent) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut handshakes = JoinSet::new();
    let mut active: Option<Socket> = None;
    loop {
        tokio::select! {
            // A completed handshake takes precedence over queued old messages.
            biased;
            completed = handshakes.join_next(), if !handshakes.is_empty() => {
                match completed {
                    Some(Ok(Ok(Ok(socket)))) => {
                        disconnect(&mut active, &mut emit).await;
                        active = Some(socket);
                        emit(FeedEvent::Connected).await;
                    }
                    _ => emit(FeedEvent::Rejected).await,
                }
            }
            connection = listener.accept() => {
                match connection {
                    Ok((stream, _)) if handshakes.len() < 16 => {
                        handshakes.spawn(async move {
                            timeout(Duration::from_secs(5), wire::handshake(stream)).await
                        });
                    }
                    Ok(_) => emit(FeedEvent::Rejected).await,
                    Err(_) => { emit(FeedEvent::Error).await; break; }
                }
            }
            incoming = async {
                match active.as_mut() {
                    Some(socket) => socket.next().await,
                    None => std::future::pending().await,
                }
            } => {
                match incoming {
                    Some(Ok(Message::Text(text))) => match validate(text.as_bytes()) {
                        Some(message) => emit(FeedEvent::Message(message)).await,
                        None => emit(FeedEvent::Rejected).await,
                    },
                    Some(Ok(Message::Close(_))) | None => disconnect(&mut active, &mut emit).await,
                    Some(Err(error)) => {
                        if !matches!(error, Error::ConnectionClosed | Error::AlreadyClosed) {
                            emit(FeedEvent::Rejected).await;
                        }
                        disconnect(&mut active, &mut emit).await;
                    }
                    Some(Ok(_)) => {
                        emit(FeedEvent::Rejected).await;
                        // Tungstenite queues automatic pong responses while reading.
                        if let Some(socket) = active.as_mut() {
                            if !matches!(timeout(Duration::from_millis(250), socket.flush()).await, Ok(Ok(()))) {
                                disconnect(&mut active, &mut emit).await;
                            }
                        }
                    }
                }
            }
        }
    }
    disconnect(&mut active, &mut emit).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncWriteExt, sync::mpsc};
    use tokio_tungstenite::{client_async, tungstenite::client::IntoClientRequest};

    const VALID: &str = r#"{"v":1,"roomCode":"CAS7R1","event":{"type":"room.presence.updated"}}"#;

    struct Server {
        address: std::net::SocketAddr,
        events: mpsc::UnboundedReceiver<FeedEvent>,
        task: tokio::task::JoinHandle<()>,
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl Server {
        async fn new() -> Self {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap();
            let address = listener.local_addr().unwrap();
            let (tx, events) = mpsc::unbounded_channel();
            let task = tokio::spawn(run_listener(listener, move |event| {
                tx.send(event).unwrap();
                std::future::ready(())
            }));
            Self {
                address,
                events,
                task,
            }
        }
        async fn connect(&self, origin: &str) -> Result<Socket, Error> {
            let mut request = format!("ws://{}/", self.address)
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
            let stream = TcpStream::connect(self.address).await.unwrap();
            client_async(request, stream)
                .await
                .map(|(socket, _)| socket)
        }
        async fn event(&mut self) -> FeedEvent {
            timeout(Duration::from_secs(3), self.events.recv())
                .await
                .unwrap()
                .unwrap()
        }
        async fn departed(&mut self) {
            assert!(matches!(self.event().await, FeedEvent::Left));
            assert!(matches!(self.event().await, FeedEvent::Disconnected));
        }
    }

    #[test]
    fn validates_v1_envelopes() {
        assert!(validate(VALID.as_bytes()).is_some());
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
    async fn bad_json_and_nontext_are_counted_without_closing() {
        let mut server = Server::new().await;
        let mut client = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        for message in [
            Message::text("bad json"),
            Message::text(r#"{"v":2,"type":"left"}"#),
            Message::binary(vec![0, 1]),
        ] {
            client.send(message).await.unwrap();
            assert!(matches!(server.event().await, FeedEvent::Rejected));
        }
        client.send(Message::text(VALID)).await.unwrap();
        assert!(matches!(
            server.event().await,
            FeedEvent::Message(Envelope::Event(_))
        ));
    }

    #[tokio::test]
    async fn oversized_message_closes_and_valid_message_after_reconnect_works() {
        let mut server = Server::new().await;
        let mut first = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        let _ = first.send(Message::text("x".repeat(MAX_MESSAGE + 1))).await;
        assert!(matches!(server.event().await, FeedEvent::Rejected));
        server.departed().await;
        assert!(!matches!(
            timeout(Duration::from_secs(3), first.next()).await.unwrap(),
            Some(Ok(Message::Text(_)))
        ));
        let mut next = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        next.send(Message::text(VALID)).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Message(_)));
    }

    #[tokio::test]
    async fn newest_connection_replaces_first_with_left_before_new_messages() {
        let mut server = Server::new().await;
        let mut first = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        first.send(Message::text(VALID)).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Message(_)));
        // A client that has not finished its handshake cannot block takeover.
        let _unfinished = TcpStream::connect(server.address).await.unwrap();
        let mut second = server.connect(wire::SITE_ORIGIN).await.unwrap();
        server.departed().await;
        assert!(matches!(server.event().await, FeedEvent::Connected));
        assert!(matches!(
            timeout(Duration::from_secs(3), first.next()).await.unwrap(),
            Some(Ok(Message::Close(_)))
        ));
        second
            .send(Message::text(VALID.replace("CAS7R1", "NEW123")))
            .await
            .unwrap();
        match server.event().await {
            FeedEvent::Message(Envelope::Event(event)) => assert_eq!(event.room_code, "NEW123"),
            _ => panic!("Expected the new client's event"),
        }
        second.close(None).await.unwrap();
        server.departed().await;
    }

    #[tokio::test]
    async fn failed_handshake_does_not_replace_active_client() {
        let mut server = Server::new().await;
        let mut first = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        assert!(server.connect("https://evil.example").await.is_err());
        assert!(matches!(server.event().await, FeedEvent::Rejected));
        first.send(Message::text(VALID)).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Message(_)));
    }

    #[tokio::test]
    async fn protocol_error_closes_and_emits_left() {
        let mut server = Server::new().await;
        let mut client = server.connect(wire::SITE_ORIGIN).await.unwrap();
        assert!(matches!(server.event().await, FeedEvent::Connected));
        // Client frames must be masked. Deliberately send one invalid frame.
        client
            .get_mut()
            .write_all(&[0x81, 0x02, b'{', b'}'])
            .await
            .unwrap();
        assert!(matches!(server.event().await, FeedEvent::Rejected));
        server.departed().await;
    }
}
