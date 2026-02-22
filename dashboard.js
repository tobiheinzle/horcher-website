/* =====================================================
   DASHBOARD
   Handles UI, file uploads, voice recording, and chat.
   Conversation history is namespaced per ESP device so
   histories from ESP_1 and ESP_2 never mix.
   ===================================================== */

document.addEventListener("DOMContentLoaded", function () {

    /* =====================================================
       DOM ELEMENTS
       ===================================================== */

    const input             = document.querySelector(".chat-input");
    const messages          = document.querySelector(".chat-messages");
    const sidebar           = document.querySelector(".sidebar");
    const toggleBtn         = document.getElementById("sidebar-toggle");
    const chatHistory       = document.querySelector(".chat-history");
    const fileInput         = document.getElementById("file-input");
    const attachBtn         = document.getElementById("attach-btn");
    const voiceBtn          = document.getElementById("voice-btn");
    const recordingIndicator = document.getElementById("recording-indicator");

    const navItems        = document.querySelectorAll(".nav-item");
    const newChatBtn      = navItems[0];
    const deleteHistoryBtn = navItems[1];

    /* =====================================================
       DEVICE-SCOPED STORAGE HELPERS
       Each ESP device gets its own localStorage key so
       switching devices never mixes conversation history.
       ===================================================== */

    function getStorageKey() {
        // Use the ESP id stored by the selection page.
        // Falls back to "default" so the page still works without a selection.
        const esp = localStorage.getItem("selectedESP") || "default";
        return `conversations_${esp}`;
    }

    function loadConversations() {
        return JSON.parse(localStorage.getItem(getStorageKey()) || "[]");
    }

    function persistConversations(conversations) {
        localStorage.setItem(getStorageKey(), JSON.stringify(conversations));
    }

    /* =====================================================
       CONVERSATION STATE
       ===================================================== */

    let currentConversation = {
        id: Date.now(),
        title: "New Chat",
        messages: [],
        timestamp: Date.now()
    };

    /* =====================================================
       CONVERSATION MANAGEMENT
       ===================================================== */

    function saveConversation() {
        const conversations = loadConversations();
        const index = conversations.findIndex((c) => c.id === currentConversation.id);

        if (index !== -1) {
            conversations[index] = currentConversation;
        } else {
            conversations.unshift(currentConversation);
        }

        persistConversations(conversations);
        updateSidebar();
    }

    function loadConversation(id) {
        const conversations = loadConversations();
        const conv = conversations.find((c) => c.id === id);
        if (!conv) return;

        currentConversation = conv;
        messages.innerHTML = "";

        conv.messages.forEach((msg) => {
            if (msg.type === "user") {
                if (msg.imageData)      addUserImage(msg.imageData);
                else if (msg.audioData) addUserAudio(msg.audioData);
                else                    addUserMessage(msg.text);
            } else {
                addAssistantMessage(msg.text);
            }
        });

        updateSidebar();
    }

    function startNewChat() {
        currentConversation = {
            id: Date.now(),
            title: "New Chat",
            messages: [],
            timestamp: Date.now()
        };
        messages.innerHTML = "";
        updateSidebar();
    }

    function updateSidebar() {
        const conversations = loadConversations();

        // Keep the <h3> that's already in the DOM
        const h3 = chatHistory.querySelector("h3");
        chatHistory.innerHTML = "";
        chatHistory.appendChild(h3);

        // Show the currently connected device as a small label
        const esp = localStorage.getItem("selectedESP");
        if (esp) {
            const deviceLabel = document.createElement("div");
            deviceLabel.style.cssText =
                "font-size:11px; color:#49B5FE; padding:4px 12px 8px; font-weight:600; text-transform:uppercase;";
            deviceLabel.textContent = esp.replace("_", " ");
            chatHistory.appendChild(deviceLabel);
        }

        if (conversations.length === 0) return;

        const section = document.createElement("div");
        section.className = "history-section";

        conversations.forEach((conv) => {
            const item = document.createElement("a");
            item.href = "#";
            item.className =
                "history-item" + (conv.id === currentConversation.id ? " active" : "");
            item.innerHTML = `<span class="history-text">${conv.title}</span>`;
            item.onclick = (e) => {
                e.preventDefault();
                loadConversation(conv.id);
            };
            section.appendChild(item);
        });

        chatHistory.appendChild(section);
    }

    /* =====================================================
       UI HANDLERS
       ===================================================== */

    // Sidebar toggle
    toggleBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
    });

    // New chat
    newChatBtn.addEventListener("click", (e) => {
        e.preventDefault();
        startNewChat();
    });

    // Delete history (only for this device)
    deleteHistoryBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const esp = localStorage.getItem("selectedESP") || "this device";
        if (confirm(`Delete all conversation history for ${esp}?`)) {
            localStorage.removeItem(getStorageKey());
            startNewChat();
        }
    });

    // Text input → Enter to send
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;

            if (currentConversation.messages.length === 0) {
                currentConversation.title =
                    text.length > 30 ? text.substring(0, 30) + "…" : text;
            }

            sendText(text);
            addUserMessage(text, true);
            input.value = "";
        }
    });

    /* =====================================================
       FILE UPLOAD
       ===================================================== */

    attachBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith("image/")) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            addUserImage(event.target.result, true);
            await sendImage(file);
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
    });

    /* =====================================================
       VOICE RECORDING
       ===================================================== */

    let mediaRecorder = null;
    let audioChunks   = [];
    let isRecording   = false;

    voiceBtn.addEventListener("click", async () => {
        if (isRecording) stopRecording();
        else await startRecording();
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks  = [];
            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
                stream.getTracks().forEach((t) => t.stop());

                const reader = new FileReader();
                reader.onloadend = async () => {
                    addUserAudio(reader.result, true);
                    await sendAudio(audioBlob);
                };
                reader.readAsDataURL(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
            voiceBtn.classList.add("recording");
            recordingIndicator.style.display = "flex";
        } catch (error) {
            console.error("Microphone error:", error);
            alert("Could not access microphone");
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
            isRecording = false;
            voiceBtn.classList.remove("recording");
            recordingIndicator.style.display = "none";
        }
    }

    /* =====================================================
       MESSAGE DISPLAY
       ===================================================== */

    function addUserMessage(text, save = false) {
        const msg = document.createElement("div");
        msg.className = "message user-message";
        msg.innerHTML = `<div class="message-content">${text}</div>`;
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;

        if (save) {
            currentConversation.messages.push({
                type: "user",
                text,
                timestamp: Date.now()
            });
            currentConversation.timestamp = Date.now();
            saveConversation();
        }
    }

    function addAssistantMessage(text) {
        const msg = document.createElement("div");
        msg.className = "message assistant-message";
        msg.innerHTML = `<div class="message-content"><p>${text}</p></div>`;
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;
    }

    function addUserImage(dataUrl, save = false) {
        const msg = document.createElement("div");
        msg.className = "message user-message";

        const img = document.createElement("img");
        img.src = dataUrl;
        img.style.cssText = "max-width:100%; border-radius:8px; display:block;";

        const content = document.createElement("div");
        content.className = "message-content";
        content.appendChild(img);
        msg.appendChild(content);
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;

        if (save) {
            currentConversation.messages.push({
                type: "user",
                imageData: dataUrl,
                timestamp: Date.now()
            });
            currentConversation.timestamp = Date.now();
            saveConversation();
        }
    }

    function addUserAudio(dataUrl, save = false) {
        const msg = document.createElement("div");
        msg.className = "message user-message";

        const audio = document.createElement("audio");
        audio.src = dataUrl;
        audio.controls = true;
        audio.style.cssText = "max-width:100%; border-radius:8px;";

        const content = document.createElement("div");
        content.className = "message-content";
        content.appendChild(audio);
        msg.appendChild(content);
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;

        if (save) {
            currentConversation.messages.push({
                type: "user",
                audioData: dataUrl,
                timestamp: Date.now()
            });
            currentConversation.timestamp = Date.now();
            saveConversation();
        }
    }

    /* =====================================================
       EXPORT & INITIALIZE
       ===================================================== */

    window.addUserMessage      = addUserMessage;
    window.addAssistantMessage = addAssistantMessage;

    updateSidebar();
});