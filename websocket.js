/* =====================================================
   WEBSOCKET CLIENT - Fixed Version
   ===================================================== */

let ws = null;
let connecting = false;
let connectionAccepted = false;
let selectedESP = null;

// Buffers for incoming media - MUST be separate for each session
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

    // Get selected ESP from localStorage
    selectedESP = localStorage.getItem("selectedESP");
    
    if (!selectedESP) {
        console.error("No ESP selected - redirecting to selection page");
        window.location.href = "device-selection.html";
        return;
    }

    // Clear old chunks when starting new connection
    imageChunks = [];
    audioChunks = [];
    
    connecting = true;
    connectionAccepted = false;
    
    //ws = new WebSocket("ws://localhost:3000");
    ws = new WebSocket("wss://api.htl-horcher.at");
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        console.log(`✅ WebSocket connected - requesting access to ${selectedESP}...`);
        connecting = false;
        reconnectAttempts = 0;
        ws.send(`WEB_CONNECT:${selectedESP}`);
    };

    ws.onmessage = (event) => {
        // Handle connection status messages
        if (typeof event.data === "string") {
            if (event.data.startsWith("CONNECTION_ACCEPTED")) {
                connectionAccepted = true;
                const espId = event.data.split(":")[1];
                console.log(`✅ Connection accepted - connected to ${espId}`);
                showConnectionStatus(`Connected to ${espId}`, true);
                
                // Update the displayed device name in sidebar
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
                
                setTimeout(() => {
                    window.location.href = "device-selection.html";
                }, 3000);
                return;
            }

            if (event.data.startsWith("ERROR:")) {
                console.error("❌ Error:", event.data);
                return;
            }
            
            // TEXT message from ESP
            if (connectionAccepted) {
                console.log("📩 Text:", event.data);
                if (typeof window.addAssistantMessage === "function") {
                    window.addAssistantMessage(event.data);
                }
            }
            return;
        }

        // Only process binary if connection is accepted
        if (!connectionAccepted) return;

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

    ws.onclose = (event) => {
        console.warn("❌ Disconnected - Code:", event.code, "Reason:", event.reason);
        ws = null;
        connecting = false;
        connectionAccepted = false;
        
        // Clear buffers on disconnect
        imageChunks = [];
        audioChunks = [];
        
        // Only auto-reconnect on unexpected disconnections
        if (event.code !== 1000 && event.code !== 1001) {
            showConnectionStatus("Reconnecting...", false);
            
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            
            console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
            
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                connectBackend();
            }, delay);
        } else {
            showConnectionStatus("Disconnected", false);
            console.log("Normal disconnect - not reconnecting");
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
    let statusDiv = document.getElementById('connection-status-overlay');
    
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'connection-status-overlay';
        statusDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
        frame[0] = 0x03; // Image type
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Send end marker
    ws.send(new Uint8Array([0x03]).buffer);
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
        frame[0] = 0x02; // Audio type
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Send end marker
    ws.send(new Uint8Array([0x02]).buffer);
    console.log("✅ Audio sent completely");
    return true;
}

/* =====================================================
   RECEIVING - CRITICAL FIX
   ===================================================== */

function handleImageChunk(payload) {
    // End marker (empty payload)
    if (payload.length === 0) {
        if (imageChunks.length === 0) {
            console.warn("⚠️ Received image end marker but no chunks buffered");
            return;
        }

        console.log("🖼️ Assembling image from", imageChunks.length, "chunks");

        // Create blob from chunks
        const blob = new Blob(imageChunks, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);

        console.log("🖼️ Image blob size:", blob.size, "bytes");

        // Create message element
        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message";
        
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        
        const img = document.createElement("img");
        img.src = url;
        img.style.maxWidth = "100%";
        img.style.borderRadius = "12px";
        img.onerror = () => {
            console.error("❌ Failed to load image");
        };
        img.onload = () => {
            console.log("✅ Image loaded successfully");
        };
        
        contentDiv.appendChild(img);
        messageDiv.appendChild(contentDiv);
        
        const messagesContainer = document.querySelector(".chat-messages");
        if (messagesContainer) {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // Clear chunks for next image
        imageChunks = [];
        console.log("✅ Image displayed, chunks cleared");
        return;
    }

    // Data chunk - store as ArrayBuffer
    const chunk = new Uint8Array(payload);
    imageChunks.push(chunk);
    console.log("📦 Image chunk received:", chunk.length, "bytes (total chunks:", imageChunks.length, ")");
}

function handleAudioChunk(payload) {
    // End marker (empty payload)
    if (payload.length === 0) {
        if (audioChunks.length === 0) {
            console.warn("⚠️ Received audio end marker but no chunks buffered");
            return;
        }

        console.log("🔊 Assembling audio from", audioChunks.length, "chunks");

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
        
        const messagesContainer = document.querySelector(".chat-messages");
        if (messagesContainer) {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // Clear chunks for next audio
        audioChunks = [];
        console.log("✅ Audio displayed, chunks cleared");
        return;
    }

    // Data chunk
    const chunk = new Uint8Array(payload);
    audioChunks.push(chunk);
    console.log("📦 Audio chunk received:", chunk.length, "bytes (total chunks:", audioChunks.length, ")");
}

/* =====================================================
   INITIALIZATION
   ===================================================== */

window.addEventListener("load", connectBackend);

// Export functions
window.sendText = sendText;
window.sendImage = sendImage;
window.sendAudio = sendAudio;