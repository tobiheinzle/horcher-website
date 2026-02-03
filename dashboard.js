// dashboard.js

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    
    // ---------- DOM ----------
    const input = document.querySelector(".chat-input");
    const messages = document.querySelector(".chat-messages");
    const sidebar = document.querySelector(".sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle");
    const chatHistory = document.querySelector(".chat-history");
    const newChatBtn = document.querySelector(".nav-item");
    const deleteHistoryBtn = document.querySelectorAll(".nav-item")[1];

    // Check if elements exist
    if (!input || !messages || !sidebar || !toggleBtn) {
        console.error("Required DOM elements not found!");
        return;
    }

    // ---------- Conversation Management ----------
    let currentConversation = {
        id: Date.now(),
        title: "New Chat",
        messages: [],
        timestamp: Date.now()
    };

    // Load conversations from localStorage
    function loadConversations() {
        const saved = localStorage.getItem('conversations');
        return saved ? JSON.parse(saved) : [];
    }

    // Save conversations to localStorage
    function saveConversations(conversations) {
        localStorage.setItem('conversations', JSON.stringify(conversations));
    }

    // Save current conversation
    function saveCurrentConversation() {
        const conversations = loadConversations();
        const index = conversations.findIndex(c => c.id === currentConversation.id);
        
        if (index !== -1) {
            conversations[index] = currentConversation;
        } else {
            conversations.unshift(currentConversation);
        }
        
        saveConversations(conversations);
        updateSidebar();
    }

    // Generate conversation title from first message
    function generateTitle(firstMessage) {
        return firstMessage.length > 30 
            ? firstMessage.substring(0, 30) + "..." 
            : firstMessage;
    }

    // Group conversations by date
    function groupConversationsByDate(conversations) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        const groups = {
            today: [],
            yesterday: [],
            lastWeek: [],
            lastMonth: [],
            older: []
        };

        conversations.forEach(conv => {
            const convDate = new Date(conv.timestamp);
            
            if (convDate >= today) {
                groups.today.push(conv);
            } else if (convDate >= yesterday) {
                groups.yesterday.push(conv);
            } else if (convDate >= lastWeek) {
                groups.lastWeek.push(conv);
            } else if (convDate >= lastMonth) {
                groups.lastMonth.push(conv);
            } else {
                groups.older.push(conv);
            }
        });

        return groups;
    }

    // Update sidebar with conversations
    function updateSidebar() {
        const conversations = loadConversations();
        const groups = groupConversationsByDate(conversations);
        
        // Clear existing history (keep only the h3)
        const h3 = chatHistory.querySelector('h3');
        chatHistory.innerHTML = '';
        chatHistory.appendChild(h3);

        // Helper to create conversation item
        function createConvItem(conv) {
            const item = document.createElement('a');
            item.href = '#';
            item.className = 'history-item';
            if (conv.id === currentConversation.id) {
                item.classList.add('active');
            }
            
            item.innerHTML = `
                <span class="history-text">${conv.title}</span>
                <button class="more-btn" aria-label="More options">⋯</button>
            `;
            
            item.addEventListener('click', (e) => {
                e.preventDefault();
                loadConversation(conv.id);
            });

            // Delete conversation on more button click
            const moreBtn = item.querySelector('.more-btn');
            moreBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteConversation(conv.id);
            });
            
            return item;
        }

        // Add Today
        if (groups.today.length > 0) {
            const section = document.createElement('div');
            section.className = 'history-section';
            section.innerHTML = '<span class="history-label">Today</span>';
            groups.today.forEach(conv => section.appendChild(createConvItem(conv)));
            chatHistory.appendChild(section);
        }

        // Add Yesterday
        if (groups.yesterday.length > 0) {
            const section = document.createElement('div');
            section.className = 'history-section';
            section.innerHTML = '<span class="history-date">Yesterday</span>';
            groups.yesterday.forEach(conv => section.appendChild(createConvItem(conv)));
            chatHistory.appendChild(section);
        }

        // Add Last Week
        if (groups.lastWeek.length > 0) {
            const section = document.createElement('div');
            section.className = 'history-section';
            section.innerHTML = '<span class="history-date">Last Week</span>';
            groups.lastWeek.forEach(conv => section.appendChild(createConvItem(conv)));
            chatHistory.appendChild(section);
        }

        // Add Last Month
        if (groups.lastMonth.length > 0) {
            const section = document.createElement('div');
            section.className = 'history-section';
            section.innerHTML = '<span class="history-date">Last Month</span>';
            groups.lastMonth.forEach(conv => section.appendChild(createConvItem(conv)));
            chatHistory.appendChild(section);
        }

        // Add Older
        if (groups.older.length > 0) {
            const section = document.createElement('div');
            section.className = 'history-section';
            section.innerHTML = '<span class="history-date">Older</span>';
            groups.older.forEach(conv => section.appendChild(createConvItem(conv)));
            chatHistory.appendChild(section);
        }
    }

    // Load a conversation
    function loadConversation(id) {
        const conversations = loadConversations();
        const conv = conversations.find(c => c.id === id);
        
        if (!conv) return;

        currentConversation = conv;
        
        // Clear messages
        messages.innerHTML = '';
        
        // Load messages
        conv.messages.forEach(msg => {
            if (msg.type === 'user') {
                addUserMessage(msg.text, false);
            } else {
                addAssistantMessage(msg.text, false);
            }
        });

        updateSidebar();
    }

    // Delete a conversation
    function deleteConversation(id) {
        if (!confirm('Delete this conversation?')) return;
        
        let conversations = loadConversations();
        conversations = conversations.filter(c => c.id !== id);
        saveConversations(conversations);
        
        if (currentConversation.id === id) {
            startNewChat();
        } else {
            updateSidebar();
        }
    }

    // Start new chat
    function startNewChat() {
        currentConversation = {
            id: Date.now(),
            title: "New Chat",
            messages: [],
            timestamp: Date.now()
        };
        
        messages.innerHTML = '';
        updateSidebar();
    }

    // ---------- Sidebar Toggle ----------
    toggleBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
    });

    // ---------- New Chat Button ----------
    newChatBtn.addEventListener("click", (e) => {
        e.preventDefault();
        startNewChat();
    });

    // ---------- Delete History Button ----------
    deleteHistoryBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (confirm('Delete all conversation history?')) {
            localStorage.removeItem('conversations');
            startNewChat();
        }
    });

    // ---------- Chat Input ----------
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();

            const text = input.value.trim();
            if (!text) return;

            // Update conversation title if it's the first message
            if (currentConversation.messages.length === 0) {
                currentConversation.title = generateTitle(text);
            }

            // Add message to conversation
            currentConversation.messages.push({
                type: 'user',
                text: text,
                timestamp: Date.now()
            });
            currentConversation.timestamp = Date.now();

            // Check if sendText exists (from websocket.js)
            if (typeof sendText === 'function') {
                sendText(text);
            } else {
                console.warn("sendText function not found");
            }
            
            addUserMessage(text);
            saveCurrentConversation();
            input.value = "";
        }
    });

    // ---------- Messages ----------
    function addUserMessage(text, save = true) {
        const msg = document.createElement("div");
        msg.className = "message user-message";
        msg.innerHTML = `<div class="message-content">${text}</div>`;
        messages.appendChild(msg);
        scrollDown();

        if (save) {
            currentConversation.messages.push({
                type: 'user',
                text: text,
                timestamp: Date.now()
            });
            saveCurrentConversation();
        }
    }

    function addAssistantMessage(text, save = true) {
        const msg = document.createElement("div");
        msg.className = "message assistant-message";
        msg.innerHTML = `<div class="message-content"><p>${text}</p></div>`;
        messages.appendChild(msg);
        scrollDown();

        if (save) {
            currentConversation.messages.push({
                type: 'assistant',
                text: text,
                timestamp: Date.now()
            });
            currentConversation.timestamp = Date.now();
            saveCurrentConversation();
        }
    }

    function scrollDown() {
        messages.scrollTop = messages.scrollHeight;
    }

    // ---------- WebSocket → UI ----------
    const originalAddLog = window.addLog;
    window.addLog = function (msg) {
        addAssistantMessage(msg);
        if (originalAddLog) originalAddLog(msg);
    };

    // Make functions globally available if needed
    window.addUserMessage = addUserMessage;
    window.addAssistantMessage = addAssistantMessage;

    // Initialize sidebar on load
    updateSidebar();
});