/* =====================================================
   WEBSOCKET CLIENT - Simplified
   Handles connection, text, images, and audio
   ===================================================== */

let ws = null;
let connecting = false;

// Buffers for incoming media
let imageChunks = [];
let audioChunks = [];

/* =====================================================
   CONNECTION
   ===================================================== */

function connectBackend() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    connecting = true;
    //ws = new WebSocket("ws://localhost:3000");                !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    ws = new WebSocket("wss://api.htl-horcher.at"); // öffentlich
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        console.log("✅ WebSocket connected");
        connecting = false;
        ws.send("WEB_CONNECT");
    };

    ws.onmessage = (event) => {
        // TEXT message
        if (typeof event.data === "string") {
            console.log("📩 Text:", event.data);
            if (typeof window.addAssistantMessage === "function") {
                window.addAssistantMessage(event.data);
            }
            return;
        }

        // BINARY message (image or audio)
        const buf = new Uint8Array(event.data);
        if (buf.length === 0) return;
        
        const type = buf[0];
        const payload = buf.slice(1);

        if (type === 0x03) {
            handleImageChunk(payload);
        } else if (type === 0x02) {
            handleAudioChunk(payload);
        }
    };

    ws.onclose = () => {
        console.warn("❌ Disconnected - reconnecting in 2s");
        ws = null;
        connecting = false;
        setTimeout(connectBackend, 2000);
    };

    ws.onerror = (error) => {
        console.error("🔴 Error:", error);
        connecting = false;
        if (ws) ws.close();
    };
}

/* =====================================================
   SENDING
   ===================================================== */

function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("⚠️ Not connected");
        return false;
    }
    ws.send(text);
    return true;
}

async function sendImage(file) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await file.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;

    // Send chunks
    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x03; // IMAGE type
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Send END frame
    ws.send(new Uint8Array([0x03]).buffer);
    console.log("✅ Image sent:", totalBytes, "bytes");
    return true;
}

async function sendAudio(blob) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await blob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;

    // Send chunks
    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x02; // AUDIO type
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Send END frame
    ws.send(new Uint8Array([0x02]).buffer);
    console.log("✅ Audio sent:", totalBytes, "bytes");
    return true;
}

/* =====================================================
   RECEIVING
   ===================================================== */

function handleImageChunk(payload) {
    // END frame - assemble and display
    if (payload.length === 0) {
        if (imageChunks.length === 0) return;

        const blob = new Blob(imageChunks, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message";
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        const img = document.createElement("img");
        img.src = url;
        img.style.maxWidth = "100%";
        img.style.borderRadius = "12px";
        
        contentDiv.appendChild(img);
        messageDiv.appendChild(contentDiv);
        document.querySelector(".chat-messages").appendChild(messageDiv);
        document.querySelector(".chat-messages").scrollTop = document.querySelector(".chat-messages").scrollHeight;

        imageChunks = [];
        console.log("🖼️ Image received");
        return;
    }

    // Regular chunk
    imageChunks.push(payload);
}

function handleAudioChunk(payload) {
    // END frame - assemble and display
    if (payload.length === 0) {
        if (audioChunks.length === 0) return;

        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message";
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        const audio = document.createElement("audio");
        audio.src = url;
        audio.controls = true;
        audio.style.maxWidth = "100%";
        audio.style.borderRadius = "8px";
        
        contentDiv.appendChild(audio);
        messageDiv.appendChild(contentDiv);
        document.querySelector(".chat-messages").appendChild(messageDiv);
        document.querySelector(".chat-messages").scrollTop = document.querySelector(".chat-messages").scrollHeight;

        audioChunks = [];
        console.log("🔊 Audio received");
        return;
    }

    // Regular chunk
    audioChunks.push(payload);
}

/* =====================================================
   INITIALIZATION
   ===================================================== */

window.addEventListener("load", connectBackend);

// Export functions
window.sendText = sendText;
window.sendImage = sendImage;
window.sendAudio = sendAudio;