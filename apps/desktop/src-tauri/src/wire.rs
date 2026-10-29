use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::{
    accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{Callback, ErrorResponse, Request, Response},
        http::StatusCode,
        protocol::WebSocketConfig,
        Error,
    },
    WebSocketStream,
};

pub const MAX_MESSAGE: usize = 2 * 1024 * 1024;
pub const SITE_ORIGIN: &str = "https://drafter.uma.guide";
pub const DEV_ORIGIN: &str = "http://umalytics-replay.localhost";

pub fn origin_allowed(origin: &str) -> bool {
    origin == SITE_ORIGIN || (cfg!(debug_assertions) && origin == DEV_ORIGIN)
}

struct CheckOrigin;

impl Callback for CheckOrigin {
    fn on_request(self, request: &Request, response: Response) -> Result<Response, ErrorResponse> {
        let mut origins = request.headers().get_all("origin").iter();
        let allowed = origins
            .next()
            .and_then(|value| value.to_str().ok())
            .is_some_and(origin_allowed)
            && origins.next().is_none();
        if allowed {
            Ok(response)
        } else {
            let mut rejection = ErrorResponse::new(None);
            *rejection.status_mut() = StatusCode::FORBIDDEN;
            Err(rejection)
        }
    }
}

pub async fn handshake<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
) -> Result<WebSocketStream<S>, Error> {
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    accept_hdr_async_with_config(stream, CheckOrigin, Some(config)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{
        protocol::frame::{
            coding::{Data, OpCode},
            Frame,
        },
        Message,
    };
    use tokio_tungstenite::{client_async, tungstenite::client::IntoClientRequest};

    async fn upgrade(origins: &[&str]) -> Result<(), Error> {
        let (client, server) = tokio::io::duplex(16384);
        let mut request = "ws://127.0.0.1/".into_client_request().unwrap();
        for origin in origins {
            request
                .headers_mut()
                .append("origin", origin.parse().unwrap());
        }
        let (server_result, client_result) =
            tokio::join!(handshake(server), client_async(request, client));
        assert_eq!(server_result.is_ok(), client_result.is_ok());
        client_result.map(|_| ())
    }

    #[test]
    fn origins_are_exact_and_dev_is_debug_only() {
        assert!(origin_allowed(SITE_ORIGIN));
        assert_eq!(origin_allowed(DEV_ORIGIN), cfg!(debug_assertions));
        for origin in [
            "null",
            "",
            "https://drafter.uma.guide/",
            "http://drafter.uma.guide",
            "https://drafter.uma.guide.evil",
        ] {
            assert!(!origin_allowed(origin));
        }
    }

    #[tokio::test]
    async fn handshake_rejects_missing_duplicate_and_wrong_origins_with_403() {
        assert!(upgrade(&[SITE_ORIGIN]).await.is_ok());
        assert_eq!(upgrade(&[DEV_ORIGIN]).await.is_ok(), cfg!(debug_assertions));
        for origins in [
            vec![],
            vec!["null"],
            vec![SITE_ORIGIN, SITE_ORIGIN],
            vec![SITE_ORIGIN, "https://evil.example"],
        ] {
            match upgrade(&origins).await {
                Err(Error::Http(response)) => assert_eq!(response.status(), StatusCode::FORBIDDEN),
                _ => panic!("Expected HTTP 403"),
            }
        }
    }

    #[tokio::test]
    async fn limits_cover_individual_frames_and_assembled_messages() {
        let (client, server) = tokio::io::duplex(MAX_MESSAGE * 3);
        let mut request = "ws://127.0.0.1/".into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", SITE_ORIGIN.parse().unwrap());
        let (server, client) = tokio::join!(handshake(server), client_async(request, client));
        let mut server = server.unwrap();
        let (mut client, _) = client.unwrap();
        assert_eq!(server.get_config().max_frame_size, Some(MAX_MESSAGE));
        assert_eq!(server.get_config().max_message_size, Some(MAX_MESSAGE));
        client
            .send(Message::Frame(Frame::message(
                vec![b'x'; MAX_MESSAGE],
                OpCode::Data(Data::Text),
                false,
            )))
            .await
            .unwrap();
        client
            .send(Message::Frame(Frame::message(
                vec![b'x'],
                OpCode::Data(Data::Continue),
                true,
            )))
            .await
            .unwrap();
        assert!(matches!(server.next().await, Some(Err(Error::Capacity(_)))));
    }
}
