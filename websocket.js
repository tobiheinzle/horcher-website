let ws = null;
let connecting = false;

function addLog(msg) {
    const log = document.getElementById("log");
    if (!log) return;

    const line = document.createElement("div");
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function connectBackend() {
    // ⛔ schon verbunden oder im Aufbau
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    connecting = true;

    //ws = new WebSocket("ws://localhost:3000"); // lokal
    ws = new WebSocket("wss://api.htl-horcher.at"); // öffentlich

    ws.onopen = () => {
        console.log("WebSocket verbunden");
        connecting = false;
        ws.send("WEB_CONNECT");
    };

    ws.onmessage = (event) => {
        if (typeof event.data === "string") {
            addLog(event.data);
        }
    };

    ws.onclose = () => {
        console.warn("WebSocket getrennt – reconnect in 2s");
        ws = null;
        connecting = false;
        setTimeout(connectBackend, 2000);
    };

    ws.onerror = () => {
        connecting = false;
        if (ws) ws.close();
    };
}

function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(text);
}

// 🔁 EINMAL beim Laden verbinden
window.addEventListener("load", connectBackend);
