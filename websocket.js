let ws;

function addLog(msg) {
    const log = document.getElementById("log");
    if (!log) return;

    const line = document.createElement("div");
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function connectBackend() {
    //ws = new WebSocket("ws://localhost:3000");            lokal
    ws = new WebSocket("wss://api.htl-horcher.at");       //öffentlich 


    ws.onopen = () => {
        console.log("WebSocket verbunden");
        ws.send("WEB_CONNECT");
    };

    ws.onmessage = (event) => {
        if (typeof event.data === "string") {
            addLog(event.data);
        }
    };

    ws.onclose = () => {
        setTimeout(connectBackend, 2000);
    };

    ws.onerror = () => ws.close();
}


function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(text);
}

window.addEventListener("load", connectBackend);
