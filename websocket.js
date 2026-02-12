/* =====================================================
   WEBSOCKET CLIENT - With ESP Selection Support
   ===================================================== */

let ws = null;
let connecting = false;
let connectionAccepted = false;
let selectedESP = null;

// Buffers for incoming media
let imageChunks = [];
let audioChunks = [];

/* =====================================================
   CONNECTION
   ===================================================== */

function connectBackend() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    // Get selected ESP from localStorage
    selectedESP = localStorage.getItem("selectedESP");
    
    if (!selectedESP) {
        console.error("No ESP selected - redirecting to selection page");
        window.location.href = "device-selection.html";
        return;
    }

    connecting = true;
    connectionAccepted = false;
    
    //ws = new WebSocket("ws://localhost:3000");
    ws = new WebSocket("wss://api.htl-horcher.at");
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        console.log(`✅ WebSocket connected - requesting access to ${selectedESP}...`);
        connecting = false;
        ws.send(`WEB_CONNECT:${selectedESP}`);
    };

    ws.onmessage = (event) => {
        // Handle connection status
        if (typeof event.data === "string") {
            if (event.data.startsWith("CONNECTION_ACCEPTED")) {
                connectionAccepted = true;
                const espId = event.data.split(":")[1];
                console.log(`✅ Connection accepted - connected to ${espId}`);
                showConnectionStatus(`Connected to ${espId}`, true);
                return;
            }
            
            if (event.data.startsWith("CONNECTION_REJECTED")) {
                connectionAccepted = false;
                const reason = event.data.split(":")[1];
                console.error("❌ Connection rejected:", reason);
                showConnectionStatus(reason, false);
                
                // Redirect back to selection after 3 seconds
                setTimeout(() => {
                    window.location.href = "device-selection.html";
                }, 3000);
                return;
            }

            if (event.data.startsWith("ERROR:")) {
                console.error("❌ Error:", event.data);
                return;
            }
        }

        // Only process messages if connection is accepted
        if (!connectionAccepted) return;

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
        console.warn("❌ Disconnected");
        ws = null;
        connecting = false;
        connectionAccepted = false;
        showConnectionStatus("Disconnected - redirecting...", false);
        
        // Redirect to selection page after disconnect
        setTimeout(() => {
            window.location.href = "device-selection.html";
        }, 2000);
    };

    ws.onerror = (error) => {
        console.error("🔴 Error:", error);
        connecting = false;
        connectionAccepted = false;
        if (ws) ws.close();
    };
}

/* =====================================================
   CONNECTION STATUS UI
   ===================================================== */

function showConnectionStatus(message, isConnected) {
    let statusDiv = document.getElementById('connection-status');
    
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'connection-status';
        statusDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 600;
            z-index: 10000;
        `;
        document.body.appendChild(statusDiv);
    }
    
    if (isConnected) {
        statusDiv.style.background = '#10b981';
        statusDiv.style.color = 'white';
    } else {
        statusDiv.style.background = '#ef4444';
        statusDiv.style.color = 'white';
    }
    
    statusDiv.textContent = message;
}

/* =====================================================
   SENDING - Same as before
   ===================================================== */

function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) {
        console.warn("⚠️ Not connected or access denied");
        return false;
    }
    ws.send(text);
    return true;
}

async function sendImage(file) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) return false;

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await file.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x03;
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    ws.send(new Uint8Array([0x03]).buffer);
    console.log("✅ Image sent:", totalBytes, "bytes");
    return true;
}

async function sendAudio(blob) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) return false;

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await blob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x02;
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    ws.send(new Uint8Array([0x02]).buffer);
    console.log("✅ Audio sent:", totalBytes, "bytes");
    return true;
}

/* =====================================================
   RECEIVING - Same as before
   ===================================================== */

function handleImageChunk(payload) {
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

    imageChunks.push(payload);
}

function handleAudioChunk(payload) {
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