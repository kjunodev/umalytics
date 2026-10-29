use std::io;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tungstenite::handshake::server::{create_response, Request};

pub const MAX_MESSAGE: usize = 2 * 1024 * 1024;
pub const SITE_ORIGIN: &str = "https://drafter.uma.guide";
pub const DEV_ORIGIN: &str = "http://umalytics-replay.localhost";

pub fn origin_allowed(origin: &str) -> bool {
    origin == SITE_ORIGIN || (cfg!(debug_assertions) && origin == DEV_ORIGIN)
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid WebSocket protocol")
}

pub async fn handshake<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S) -> io::Result<()> {
    // Read exactly through the header boundary so pipelined frames stay in TCP.
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 {
            return Err(invalid());
        }
        header.push(stream.read_u8().await?);
    }
    let text = std::str::from_utf8(&header).map_err(|_| invalid())?;
    let mut lines = text.split("\r\n");
    if lines.next() != Some("GET / HTTP/1.1") {
        return Err(invalid());
    }
    let mut request = Request::builder().uri("/");
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        request = request.header(name, value.trim());
    }
    let request = request.body(()).map_err(|_| invalid())?;
    let origins = request.headers().get_all("origin");
    if origins.iter().count() != 1
        || !origins
            .iter()
            .next()
            .and_then(|v| v.to_str().ok())
            .is_some_and(origin_allowed)
    {
        stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Err(invalid());
    }
    let response = create_response(&request).map_err(|_| invalid())?;
    let mut bytes = b"HTTP/1.1 101 Switching Protocols\r\n".to_vec();
    for (name, value) in response.headers() {
        bytes.extend_from_slice(name.as_str().as_bytes());
        bytes.extend_from_slice(b": ");
        bytes.extend_from_slice(value.as_bytes());
        bytes.extend_from_slice(b"\r\n");
    }
    bytes.extend_from_slice(b"\r\n");
    stream.write_all(&bytes).await
}

pub struct Frame {
    pub fin: bool,
    pub opcode: u8,
    pub payload: Option<Vec<u8>>,
}

// Library message-size errors terminate a WebSocket. Drain rejected frames in
// bounded chunks instead, preserving framing and the connection for the next
// message. Fragmented messages share the same aggregate allocation budget.
pub async fn read_frame<S: AsyncRead + Unpin>(stream: &mut S, budget: usize) -> io::Result<Frame> {
    let flags = stream.read_u8().await?;
    let length = stream.read_u8().await?;
    if flags & 0x70 != 0 || length & 0x80 == 0 {
        return Err(invalid());
    }
    let size = match length & 0x7f {
        126 => u64::from(stream.read_u16().await?),
        127 => stream.read_u64().await?,
        size => u64::from(size),
    };
    if size & (1 << 63) != 0 {
        return Err(invalid());
    }
    let mut mask = [0; 4];
    stream.read_exact(&mut mask).await?;
    let keep = size <= budget as u64 && size <= MAX_MESSAGE as u64;
    let mut payload = keep.then(|| Vec::with_capacity(size as usize));
    let mut offset = 0_u64;
    let mut chunk = [0_u8; 8192];
    while offset < size {
        let count = (size - offset).min(chunk.len() as u64) as usize;
        stream.read_exact(&mut chunk[..count]).await?;
        if let Some(payload) = &mut payload {
            for (index, byte) in chunk[..count].iter_mut().enumerate() {
                *byte ^= mask[((offset + index as u64) % 4) as usize];
            }
            payload.extend_from_slice(&chunk[..count]);
        }
        offset += count as u64;
    }
    Ok(Frame {
        fin: flags & 0x80 != 0,
        opcode: flags & 0x0f,
        payload,
    })
}

#[cfg(test)]
pub fn masked_frame(opcode: u8, fin: bool, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![opcode | if fin { 0x80 } else { 0 }];
    if payload.len() < 126 {
        frame.push(0x80 | payload.len() as u8);
    } else if payload.len() <= u16::MAX as usize {
        frame.push(0xfe);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(0xff);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    frame.extend_from_slice(&[0; 4]);
    frame.extend_from_slice(payload);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn upgrade(origin_headers: &str) -> bool {
        let (mut client, mut server) = tokio::io::duplex(16384);
        let request = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:38917\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{origin_headers}\r\n");
        client.write_all(request.as_bytes()).await.unwrap();
        handshake(&mut server).await.is_ok()
    }

    #[tokio::test]
    async fn handshake_requires_one_allowed_origin() {
        assert!(upgrade(&format!("Origin: {SITE_ORIGIN}\r\n")).await);
        assert_eq!(
            upgrade(&format!("Origin: {DEV_ORIGIN}\r\n")).await,
            cfg!(debug_assertions)
        );
        assert!(!upgrade("").await);
        assert!(!upgrade("Origin: null\r\n").await);
        assert!(
            !upgrade(&format!(
                "Origin: {SITE_ORIGIN}\r\nOrigin: https://evil.example\r\n"
            ))
            .await
        );
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
    async fn oversized_frame_is_drained_and_next_frame_survives() {
        let mut bytes = masked_frame(1, true, &vec![b'x'; MAX_MESSAGE + 1]);
        bytes.extend(masked_frame(1, true, b"next"));
        let mut stream = bytes.as_slice();
        assert!(read_frame(&mut stream, MAX_MESSAGE)
            .await
            .unwrap()
            .payload
            .is_none());
        assert_eq!(
            read_frame(&mut stream, MAX_MESSAGE)
                .await
                .unwrap()
                .payload
                .unwrap(),
            b"next"
        );
    }

    #[tokio::test]
    async fn exact_size_and_fragment_budget() {
        let bytes = masked_frame(1, true, &vec![b'x'; MAX_MESSAGE]);
        assert_eq!(
            read_frame(&mut bytes.as_slice(), MAX_MESSAGE)
                .await
                .unwrap()
                .payload
                .unwrap()
                .len(),
            MAX_MESSAGE
        );
        let bytes = masked_frame(0, true, b"abc");
        assert!(read_frame(&mut bytes.as_slice(), 2)
            .await
            .unwrap()
            .payload
            .is_none());
    }
}
