let ws = null;                  // Aktive WebSocket-Verbindung (null = getrennt)
let connecting = false;         // true = Verbindungsaufbau läuft gerade
let connectionAccepted = false; // true = ESP hat Verbindung bestätigt
let selectedESP = null;         // ID des gewählten ESP-Geräts (z.B. "ESP_1")

// Eingangspuffer für Bild- und Audio-Fragmente
let imageChunks = [];
let audioChunks = [];

let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 5000; // Maximale Wartezeit zwischen Reconnects: 5s

//VERBINDUNGSAUFBAU
function connectBackend() {
    if (ws && ws.readyState === WebSocket.OPEN) return; // Bereits verbunden -> abbrechen
    if (connecting) return;                             // Verbindungsversuch läuft -> abbrechen

    // ESP-ID aus localStorage laden - fehlt sie -> Auswahlseite
    selectedESP = localStorage.getItem("selectedESP");
    if (!selectedESP) {
        window.location.href = "device-selection.html";
        return;
    }

    // Zustand zurücksetzen
    imageChunks = [];
    audioChunks = [];
    connecting = true;
    connectionAccepted = false;
    
    ws = new WebSocket("wss://api.htl-horcher.at");
    ws.binaryType = "arraybuffer";    // Binärdaten als ArrayBuffer empfangen

    // Verbindung offen -> beim Server anmelden
    ws.onopen = () => {
        connecting = false;
        reconnectAttempts = 0;
        ws.send(`WEB_CONNECT:${selectedESP}`); // Handshake mit gewähltem ESP senden
    };

    ws.onmessage = (event) => {
        
        // --- Textnachrichten ---
        if (typeof event.data === "string") {
            
            if (event.data.startsWith("CONNECTION_ACCEPTED")) {
                // Verbindung akzeptiert -> UI aktualisieren
                connectionAccepted = true;
                const espId = event.data.split(":")[1];
                if (typeof window.updateDeviceDisplay === "function") {
                    window.updateDeviceDisplay(espId);
                }
                return;
            }
            
            if (event.data.startsWith("CONNECTION_REJECTED")) {
                // ESP abgelehnt -> nach 3s zurück zur Auswahlseite
                connectionAccepted = false;
                setTimeout(() => {
                    window.location.href = "device-selection.html";
                }, 3000);
                return;
            }

            if (event.data.startsWith("ERROR:")) return; // Serverfehler -> ignorieren
            
            // Normale Textnachricht vom ESP im Chat anzeigen
            if (connectionAccepted) {
                if (typeof window.addAssistantMessage === "function") {
                    window.addAssistantMessage(event.data);
                }
            }
            return;
        }

        if (!connectionAccepted) return; // Binärdaten nur verarbeiten wenn Verbindung aktiv

        // Binärdaten in lesbares Byte-Array umwandeln
        const buf = new Uint8Array(event.data);
        if (buf.length === 0) return;                // Leere Nachricht ignorieren

        const type = buf[0];          // Erstes Byte = Frame-Typ
        const payload = buf.slice(1); // Rest = Nutzdaten ohne Frame-Typ

        if (type === 0x03) {
            handleImageChunk(payload); // Bild-Chunk an Handler weitergeben
        } else if (type === 0x05) {
            handleAudioChunk(payload); // Audio-Chunk an Handler weitergeben
        }
    };

    // Verbindung getrennt -> Zustand zurücksetzen und Reconnect starten
    ws.onclose = (event) => {
        ws = null;
        connecting = false;
        connectionAccepted = false;
        imageChunks = [];
        audioChunks = [];
        
        // Unerwarteter Abbruch -> Reconnect mit ansteigender Wartezeit
        // Wartezeit = min(reconnectAttempts * 1000ms, 5000ms)
        if (event.code !== 1000 && event.code !== 1001) {
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                connectBackend();
            }, delay);
        }
    };

    // Verbindungsfehler -> Flags zurücksetzen (onclose wird danach automatisch aufgerufen)
    ws.onerror = (error) => {
        connecting = false;
        connectionAccepted = false;
    };
}

//SENDEN
// Einfache Textnachricht senden
function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) return false;
    ws.send(text);
    return true;
}

// Bilddatei in 1024-Byte-Chunks senden
async function sendImage(file) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) return false;

    const CHUNK_SIZE = 1024;                          // Maximale Chunk-Größe in Bytes
    const arrayBuffer = await file.arrayBuffer();     // Bilddatei komplett in Speicher laden
    const totalBytes = arrayBuffer.byteLength;        // Gesamtgröße des Bildes
    let offset = 0;                                   // Aktuelle Position im Bild

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes); // Ende des aktuellen Chunks
        const chunk = arrayBuffer.slice(offset, end);          // Chunk ausschneiden

        // Frame zusammenbauen: [Type][Chunk-Daten]
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x03;                               // Frame-Typ: Bild
        frame.set(new Uint8Array(chunk), 1);           // Chunk-Daten ab Byte 1 einfügen
        
        ws.send(frame.buffer);                         // Frame senden
        offset = end;                                  // Zeiger weiterrücken
        await new Promise(resolve => setTimeout(resolve, 10)); // 10ms Pause -> Empfänger entlasten
    }

    ws.send(new Uint8Array([0x03]).buffer); // Leerer Abschluss-Frame -> Ende der Übertragung
    return true;
}

// Audiodatei in 1024-Byte-Chunks senden (identisches Prinzip wie sendImage)
async function sendAudio(blob) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectionAccepted) return false;

    const CHUNK_SIZE = 1024;
    const arrayBuffer = await blob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let offset = 0;

    while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = arrayBuffer.slice(offset, end);
        
        // Frame zusammenbauen: [Type][Chunk-Daten]
        const frame = new Uint8Array(1 + chunk.byteLength);
        frame[0] = 0x05; // Frame-Typ: Audio
        frame.set(new Uint8Array(chunk), 1);
        
        ws.send(frame.buffer);
        offset = end;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    ws.send(new Uint8Array([0x05]).buffer); // Leerer Abschluss-Frame -> Ende der Übertragung
    return true;
}

//EMPFANGEN
// Eingehende Bild-Chunks puffern; leerer Payload = Bild zusammensetzen und im Chat anzeigen
function handleImageChunk(payload) {
    
    if (payload.length === 0) {
        if (imageChunks.length === 0) return;

        // Alle Chunks zu einem Blob zusammensetzen und als Bild anzeigen
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
        
        const messagesContainer = document.querySelector(".chat-messages");
        if (messagesContainer) {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight; // Zum neuesten Eintrag scrollen
        }

        imageChunks = []; // Puffer leeren
        return;
    }

    imageChunks.push(new Uint8Array(payload)); // Chunk in Puffer speichern
}

// Eingehende Audio-Chunks puffern; leerer Payload = Audio zusammensetzen und im Chat anzeigen
function handleAudioChunk(payload) {
    
    if (payload.length === 0) {
        if (audioChunks.length === 0) return;

        // Alle Chunks zu einem Blob zusammensetzen und als Audio anzeigen
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
        
        contentDiv.appendChild(audio);
        messageDiv.appendChild(contentDiv);
        
        const messagesContainer = document.querySelector(".chat-messages");
        if (messagesContainer) {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight; // Zum neuesten Eintrag scrollen
        }

        audioChunks = []; // Puffer leeren
        return;
    }

    audioChunks.push(new Uint8Array(payload)); // Chunk in Puffer speichern
}

// INITIALISIERUNG
window.addEventListener("load", connectBackend); // Verbindung beim Seitenload starten

// Sendefunktionen global verfügbar machen
window.sendText = sendText;
window.sendImage = sendImage;
window.sendAudio = sendAudio;