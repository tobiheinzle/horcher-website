/* =====================================================
   WEBSOCKET CLIENT
   ===================================================== */

let ws = null;
let connecting = false;
let connectionAccepted = false;
let selectedESP = null;

// Per-session media buffers
let imageChunks = [];
let audioChunks = [];

/* =====================================================
   CONNECTION
   ===================================================== */

let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 5000;

function connectBackend() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    selectedESP = localStorage.getItem("selectedESP");

    if (!selectedESP) {
        console.error("No ESP selected - redirecting to selection page");
        window.location.href = "device-selection.html";
        return;
    }

    imageChunks = [];
    audioChunks = [];

    connecting = true;
    connectionAccepted = false;

    ws = new WebSocket("wss://api.htl-horcher.at");
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        console.log(`✅ WebSocket connected - requesting access to ${selectedESP}...`);
        connecting = false;
        reconnectAttempts = 0;
        ws.send(`WEB_CONNECT:${selectedESP}`);
    };

    ws.onmessage = (event) => {
        /* ---------- TEXT ---------- */
        if (typeof event.data === "string") {
            if (event.data.startsWith("CONNECTION_ACCEPTED")) {
                connectionAccepted = true;
                const espId = event.data.split(":")[1];
                console.log(`✅ Connection accepted - connected to ${espId}`);
                showConnectionStatus(`Connected to ${espId}`, true);
                if (typeof window.updateDeviceDisplay === "function") {
                    window.updateDeviceDisplay(espId);
                }
                return;
            }

            if (event.data.startsWith("CONNECTION_REJECTED")) {
                connectionAccepted = false;
                const reason = event.data.split(":")[1];
                console.error("❌ Connection rejected:", reason);
                showConnectionStatus(reason, false);
                setTimeout(() => { window.location.href = "device-selection.html"; }, 3000);
                return;
            }

            if (event.data.startsWith("ERROR:")) {
                console.error("❌ Error:", event.data);
                return;
            }

            if (connectionAccepted) {
                console.log("📩 Text:", event.data);
                if (typeof window.addAssistantMessage === "function") {
                    window.addAssistantMessage(event.data);
                }
            }
            return;
        }

        /* ---------- BINARY ---------- */
        if (!connectionAccepted) return;

        const buf = new Uint8Array(event.data);
        if (buf.length === 0) return;

        const frameType = buf[0];
        // IMPORTANT: slice() copies the data so it won't be GC'd or overwritten
        const payload = buf.slice(1);

        if (frameType === 0x03) {
            handleImageChunk(payload);
        } else if (frameType === 0x02) {
            handleAudioChunk(payload);
        }
    };

    ws.onclose = (event) => {
        console.warn("❌ Disconnected - Code:", event.code, "Reason:", event.reason);
        ws = null;
        connecting = false;
        connectionAccepted = false;
        imageChunks = [];
        audioChunks = [];

        if (event.code !== 1000 && event.code !== 1001) {
            showConnectionStatus("Reconnecting...", false);
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectBackend, delay);
        } else {
            showConnectionStatus("Disconnected", false);
        }
    };

    ws.onerror = (error) => {
        console.error("🔴 WebSocket error:", error);
        connecting = false;
        connectionAccepted = false;
    };
}

/* =====================================================
   CONNECTION STATUS UI
   ===================================================== */

function showConnectionStatus(message, isConnected) {
    let statusDiv = document.getElementById("connection-status-overlay");

    if (!statusDiv) {
        statusDiv = document.createElement("div");
        statusDiv.id = "connection-status-overlay";
        statusDiv.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            padding: 12px 20px; border-radius: 8px;
            font-weight: 600; z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: opacity 0.5s;
        `;
        document.body.appendChild(statusDiv);
    }

    statusDiv.style.opacity = "1";
    statusDiv.style.background = isConnected ? "#10b981" : "#ef4444";
    statusDiv.style.color = "white";
    statusDiv.textContent = message;

    // Auto-hide after 3s on success
    if (isConnected) {
        clearTimeout(statusDiv._hideTimer);
        statusDiv._hideTimer = setTimeout(() => { statusDiv.style.opacity = "0"; }, 3000);
    }
}

/* =====================================================
   SENDING
   ===================================================== */

function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) {
        console.warn("⚠️ Not connected or access denied");
        return false;
    }
    ws.send(text);
    console.log("📤 Sent text:", text);
    return true;
}

async function sendImage(file) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) {
        console.warn("⚠️ Cannot send image - not connected");
        return false;
    }

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await file.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;
    console.log("📤 Sending image:", totalBytes, "bytes");

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x03;
        frame.set(new Uint8Array(chunk), 1);
        ws.send(frame.buffer);
        offset = end;
        await new Promise((r) => setTimeout(r, 10));
    }

    ws.send(new Uint8Array([0x03]).buffer); // end marker
    console.log("✅ Image sent completely");
    return true;
}

async function sendAudio(blob) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) {
        console.warn("⚠️ Cannot send audio - not connected");
        return false;
    }

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await blob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;
    console.log("📤 Sending audio:", totalBytes, "bytes");

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x02;
        frame.set(new Uint8Array(chunk), 1);
        ws.send(frame.buffer);
        offset = end;
        await new Promise((r) => setTimeout(r, 10));
    }

    ws.send(new Uint8Array([0x02]).buffer); // end marker
    console.log("✅ Audio sent completely");
    return true;
}

/* =====================================================
   RECEIVING - IMAGE
   ===================================================== */

function handleImageChunk(payload) {
    // End marker = frame with only the type byte → payload is empty
    if (payload.length === 0) {
        if (imageChunks.length === 0) {
            console.warn("⚠️ Image end marker received but buffer is empty");
            return;
        }

        console.log("🖼️ Assembling image from", imageChunks.length, "chunks");

        // Detect MIME type from magic bytes
        const first = imageChunks[0];
        let mimeType = "image/jpeg"; // default - most ESP cameras output JPEG
        if (first.length >= 2) {
            if (first[0] === 0x89 && first[1] === 0x50) mimeType = "image/png";
            else if (first[0] === 0x47 && first[1] === 0x49) mimeType = "image/gif";
            else if (first[0] === 0x52 && first[1] === 0x49) mimeType = "image/webp";
        }
        console.log("🖼️ Detected MIME:", mimeType, "| first bytes:", first[0].toString(16), first[1].toString(16));

        // Concatenate all chunk arrays into one continuous Uint8Array
        const totalBytes = imageChunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(totalBytes);
        let off = 0;
        for (const chunk of imageChunks) {
            combined.set(chunk, off);
            off += chunk.length;
        }

        const blob = new Blob([combined], { type: mimeType });
        const url = URL.createObjectURL(blob);
        console.log("🖼️ Blob created:", blob.size, "bytes");

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";

        const img = document.createElement("img");
        img.style.cssText = "max-width:100%; border-radius:12px; display:block;";

        img.onerror = () => {
            console.error("❌ Image render failed. Blob size:", blob.size, "MIME:", mimeType);
            contentDiv.textContent = "[Image could not be displayed]";
            URL.revokeObjectURL(url);
        };
        img.onload = () => {
            console.log("✅ Image rendered:", img.naturalWidth, "×", img.naturalHeight, "px");
            const container = document.querySelector(".chat-messages");
            if (container) container.scrollTop = container.scrollHeight;
        };

        // Assign src AFTER hooking events
        img.src = url;
        contentDiv.appendChild(img);
        messageDiv.appendChild(contentDiv);

        const container = document.querySelector(".chat-messages");
        if (container) {
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        imageChunks = [];
        console.log("✅ Image displayed, buffer cleared");
        return;
    }

    // Accumulate - use slice() to guarantee a fresh copy of the data
    imageChunks.push(payload.slice());
    console.log("📦 Image chunk:", payload.length, "bytes | buffered chunks:", imageChunks.length);
}

/* =====================================================
   RECEIVING - AUDIO
   ===================================================== */

function handleAudioChunk(payload) {
    if (payload.length === 0) {
        if (audioChunks.length === 0) {
            console.warn("⚠️ Audio end marker received but buffer is empty");
            return;
        }

        console.log("🔊 Assembling audio from", audioChunks.length, "chunks");

        const totalBytes = audioChunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(totalBytes);
        let off = 0;
        for (const chunk of audioChunks) {
            combined.set(chunk, off);
            off += chunk.length;
        }

        const blob = new Blob([combined], { type: "audio/webm" });
        const url = URL.createObjectURL(blob);

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";

        const audio = document.createElement("audio");
        audio.src = url;
        audio.controls = true;
        audio.style.cssText = "max-width:100%; border-radius:8px;";

        contentDiv.appendChild(audio);
        messageDiv.appendChild(contentDiv);

        const container = document.querySelector(".chat-messages");
        if (container) {
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        audioChunks = [];
        console.log("✅ Audio displayed, buffer cleared");
        return;
    }

    audioChunks.push(payload.slice());
    console.log("📦 Audio chunk:", payload.length, "bytes | buffered chunks:", audioChunks.length);
}

/* =====================================================
   INITIALIZATION
   ===================================================== */

window.addEventListener("load", connectBackend);

window.sendText  = sendText;
window.sendImage = sendImage;
window.sendAudio = sendAudio;