// Global variables
let sessionId = generateSessionId();
let currentDocument = null;
let isUploading = false; // Flag to prevent multiple uploads
const API_BASE_URL = 'http://localhost:5000';

// Generate unique session ID
function generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// PDF preview variables
let pdfFileUrl = null;
let pdfViewer = document.getElementById('pdfViewer');
let currentHighlights = [];

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const mainContentRow = document.getElementById('mainContentRow');
const chatSection = document.getElementById('chatSection');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const documentInfo = document.getElementById('documentInfo');
const errorModal = document.getElementById('errorModal');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    
    // Ensure main content row is hidden initially
    mainContentRow.style.display = 'none';
    uploadSection.style.display = 'flex';
    
    // Add periodic check to ensure chat functionality
    setInterval(() => {
        if (chatSection.style.display === 'flex') {
            // Check if chat input is disabled
            if (chatInput.disabled) {
                console.log('Chat input was disabled, re-enabling...');
                chatInput.disabled = false;
                chatInput.focus();
            }
            
            // Check if chat input container is visible
            const chatInputContainer = document.querySelector('.chat-input-container');
            if (chatInputContainer && (chatInputContainer.style.display === 'none' || 
                chatInputContainer.style.visibility === 'hidden' || 
                chatInputContainer.style.opacity === '0')) {
                console.log('Chat input container was hidden, forcing visibility...');
                forceChatInputVisible();
            }
        }
    }, 1000);
});

function setupEventListeners() {
    // File input change
    fileInput.addEventListener('change', handleFileSelect);
    
    // Browse button click
    const browseBtn = document.getElementById('browseBtn');
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering upload area click
            fileInput.click();
        });
    }
    
    // Send button click
    if (sendBtn) {
        sendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Send button clicked');
            sendMessage();
        });
    }
    
    // Drag and drop - only trigger file input on direct click, not on child elements
    uploadArea.addEventListener('click', (e) => {
        // Only trigger if clicking directly on the upload area, not on child elements
        if (e.target === uploadArea || e.target.classList.contains('upload-content')) {
            fileInput.click();
        }
    });
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDragOver(e) {
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

function handleFile(file) {
    // Prevent multiple uploads
    if (isUploading) {
        console.log('Upload already in progress, ignoring duplicate request');
        return;
    }
    
    // Validate file type
    if (!file.type.includes('pdf')) {
        showError('Please select a PDF file.');
        return;
    }
    
    // Validate file size (16MB limit)
    if (file.size > 16 * 1024 * 1024) {
        showError('File size must be less than 16MB.');
        return;
    }
    
    uploadDocument(file);
}

// Load and render PDF in the preview panel using browser's built-in viewer
async function renderPDF(url) {
    pdfViewer.innerHTML = '<div style="text-align:center;padding:2em;">Loading PDF...</div>';
    try {
        // Use browser's built-in PDF viewer
        pdfViewer.innerHTML = `
            <iframe 
                src="${url}" 
                style="width: 100%; height: 100%; border: none; display: block;" 
                title="PDF Preview" id="pdfIframe">
            </iframe>
        `;
        // Fallback if iframe doesn't work
        const iframe = pdfViewer.querySelector('iframe');
        iframe.onerror = () => {
            pdfViewer.innerHTML = `
                <div style="text-align:center;padding:2em;">
                    <h3>PDF Preview</h3>
                    <p>Your browser doesn't support PDF preview.</p>
                    <p>You can still chat with your document!</p>
                    <a href="${url}" target="_blank" style="color: #1976d2; text-decoration: underline;">
                        Click here to view PDF in new tab
                    </a>
                </div>
            `;
        };
    } catch (err) {
        console.error('Failed to load PDF:', err);
        pdfViewer.innerHTML = `
            <div style="text-align:center;padding:2em;">
                <h3>PDF Preview</h3>
                <p>Could not load PDF preview.</p>
                <p>You can still chat with your document!</p>
                <a href="${url}" target="_blank" style="color: #1976d2; text-decoration: underline;">
                    Click here to view PDF in new tab
                </a>
            </div>
        `;
    }
}

// Highlight sources in the PDF preview
function highlightSources(sources) {
    // Remove previous highlights
    const container = document.getElementById('pdfViewerContainer');
    if (container) {
        container.querySelectorAll('.pdf-highlight').forEach(el => el.remove());
    }
    if (!sources || !Array.isArray(sources)) return;
    const iframe = document.getElementById('pdfIframe');
    if (iframe && container) {
        // Wait for iframe to load and get its height
        const totalPages = 5; // crude estimate, adjust if you know the page count
        const containerHeight = container.offsetHeight;
        sources.forEach(src => {
            if (src.page) {
                const highlightDiv = document.createElement('div');
                highlightDiv.className = 'pdf-highlight';
                highlightDiv.style.position = 'absolute';
                highlightDiv.style.left = '0';
                highlightDiv.style.top = ((src.page - 1) * (containerHeight / totalPages)) + 'px';
                highlightDiv.style.width = '100%';
                highlightDiv.style.height = (containerHeight / totalPages) + 'px';
                highlightDiv.style.background = 'rgba(255, 255, 0, 0.25)';
                highlightDiv.style.pointerEvents = 'none';
                highlightDiv.style.zIndex = '10';
                container.appendChild(highlightDiv);
            }
        });
    }
}

// Hook into file upload to render PDF
async function uploadDocument(file) {
    isUploading = true; // Set upload flag
    const uploadProgress = document.getElementById('uploadProgress');
    const uploadContent = document.querySelector('.upload-content');
    const progressFill = document.getElementById('progressFill');
    const uploadStatus = document.getElementById('uploadStatus');
    uploadContent.style.display = 'none';
    uploadProgress.style.display = 'block';
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        progressFill.style.width = progress + '%';
    }, 200);
    try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        clearInterval(progressInterval);
        progressFill.style.width = '100%';
        if (response.ok) {
            uploadStatus.textContent = 'Processing complete!';
            currentDocument = {
                name: file.name,
                collectionName: result.collection_name,
                pdfUrl: result.pdf_url || URL.createObjectURL(file)
            };
            pdfFileUrl = currentDocument.pdfUrl;
            setTimeout(() => {
                showMainContentRow();
                renderPDF(pdfFileUrl);
            }, 1000);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        clearInterval(progressInterval);
        console.error('Upload error:', error);
        showError('Failed to upload document: ' + error.message);
        resetUploadSection();
    } finally {
        isUploading = false; // Reset upload flag
    }
}

// Show the main content row (PDF + Chat)
function showMainContentRow() {
    // Hide upload section with fade out effect
    uploadSection.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    uploadSection.style.opacity = '0';
    uploadSection.style.transform = 'translateY(-20px)';
    
    setTimeout(() => {
        uploadSection.style.display = 'none';
        
        // Show main content row with fade in effect
        mainContentRow.style.display = 'flex';
        mainContentRow.style.opacity = '0';
        mainContentRow.style.transform = 'translateY(20px)';
        
        // Force a reflow
        mainContentRow.offsetHeight;
        
        mainContentRow.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        mainContentRow.style.opacity = '1';
        mainContentRow.style.transform = 'translateY(0)';
        
        document.getElementById('documentName').textContent = currentDocument.name;
        
        setTimeout(() => {
            ensureChatInputReady();
            console.log('Main content row shown and ready');
        }, 100);
    }, 500);
}

// Parse sources from bot response (expects sources in a known format)
function parseSourcesFromResponse(response) {
    // Example: response contains a 'sources' array or a string like 'Sources: Page 2, Page 5, Page 7'
    if (response.sources && Array.isArray(response.sources)) {
        return response.sources;
    }
    const match = /Sources?:\s*([\w\s,\d]+)/i.exec(response.response || response);
    if (match) {
        // Extract page numbers
        return match[1].split(',').map(s => {
            const pageMatch = /\d+/.exec(s);
            return pageMatch ? { page: parseInt(pageMatch[0], 10) } : null;
        }).filter(Boolean);
    }
    return [];
}

// Hook into addMessage to highlight sources after bot response
const originalAddMessage = addMessage;
addMessage = function(content, sender) {
    originalAddMessage(content, sender);
    if (sender === 'bot') {
        // Try to parse sources and highlight
        let sources = parseSourcesFromResponse(content);
        highlightSources(sources);
    }
};

function showChatSection() {
    uploadSection.style.display = 'none';
    chatSection.style.display = 'flex';
    document.getElementById('documentName').textContent = currentDocument.name;
    
    // Use the comprehensive function to ensure everything is ready
    setTimeout(() => {
        ensureChatInputReady();
        console.log('Chat section shown and ready');
    }, 100);
}

function resetUploadSection() {
    const uploadProgress = document.getElementById('uploadProgress');
    const uploadContent = document.querySelector('.upload-content');
    const progressFill = document.getElementById('progressFill');
    
    uploadProgress.style.display = 'none';
    uploadContent.style.display = 'block';
    progressFill.style.width = '0%';
    fileInput.value = '';
}

function resetApp() {
    currentDocument = null;
    sessionId = generateSessionId();
    
    // Hide main content row with fade out effect
    mainContentRow.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    mainContentRow.style.opacity = '0';
    mainContentRow.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
        mainContentRow.style.display = 'none';
        
        // Show upload section with fade in effect
        uploadSection.style.display = 'flex';
        uploadSection.style.opacity = '0';
        uploadSection.style.transform = 'translateY(-20px)';
        
        // Force a reflow
        uploadSection.offsetHeight;
        
        uploadSection.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        uploadSection.style.opacity = '1';
        uploadSection.style.transform = 'translateY(0)';
        
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="bot-message">
                    <div class="avatar bot-avatar">🤖</div>
                    <div class="message-content">
                        <p>Hello! I've processed your document. Ask me anything about it!</p>
                    </div>
                </div>
            </div>
        `;
        resetUploadSection();
    }, 500);
}

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        console.log('Enter key pressed, sending message');
        sendMessage();
    }
}

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Add user message to chat
    addMessage(message, 'user');
    chatInput.value = '';
    
    // Show typing indicator
    showTypingIndicator();
    
    // Disable send button
    sendBtn.disabled = true;
    document.getElementById('sendIcon').style.display = 'none';
    document.getElementById('loadingIcon').style.display = 'inline';
    
    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: message,
                session_id: sessionId,
                collection_name: currentDocument?.collectionName
            })
        });
        
        const result = await response.json();
        
        // Remove typing indicator
        removeTypingIndicator();
        
        if (response.ok) {
            // Add bot response
            addMessage(result.response, 'bot');

            // Highlight sources in PDF preview if present
            if (result.sources) {
                highlightSources(result.sources);
            }

            // Log chat history (you can see it in browser console)
            console.log('Chat History:', result.chat_history);
            
            // Force chat input to be visible and ready for next message
            setTimeout(() => {
                ensureChatInputReady();
                forceChatInputVisible();
            }, 100);
            
        } else {
            throw new Error(result.error || 'Chat failed');
        }
        
    } catch (error) {
        removeTypingIndicator();
        console.error('Chat error:', error);
        addMessage('Sorry, I encountered an error. Please try again.', 'bot');
        showError('Failed to send message: ' + error.message);
    } finally {
        // Re-enable send button
        sendBtn.disabled = false;
        document.getElementById('sendIcon').style.display = 'inline';
        document.getElementById('loadingIcon').style.display = 'none';
        
        // Ensure chat input is ready for next message
        ensureChatInputReady();
    }
}

function addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (sender === 'user') {
        messageDiv.classList.add('user-message');
        messageDiv.innerHTML = `
            <div class="avatar user-avatar">👤</div>
            <div class="message-content">
                <p>${escapeHtml(content)}</p>
            </div>
        `;
    } else {
        messageDiv.classList.add('bot-message');
        messageDiv.innerHTML = `
            <div class="avatar bot-avatar">🤖</div>
            <div class="message-content">
                <p>${escapeHtml(content)}</p>
            </div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    
    // Debug: Log message addition
    console.log(`Added ${sender} message:`, content.substring(0, 50) + '...');
    
    // Ensure chat section is visible
    if (chatSection.style.display === 'none') {
        console.log('Chat section was hidden, making it visible again');
        chatSection.style.display = 'flex';
    }
    
    // Ensure chat input container is visible and properly positioned
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
        chatInputContainer.style.display = 'block';
        chatInputContainer.style.visibility = 'visible';
        console.log('Chat input container ensured visible');
    }
}

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot-message';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
        <div class="avatar bot-avatar">🤖</div>
        <div class="typing-indicator">
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    scrollToBottom();
}

function removeTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Also ensure the chat section itself scrolls to show the input
    setTimeout(() => {
        const chatSection = document.getElementById('chatSection');
        if (chatSection) {
            chatSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, 50);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    errorModal.style.display = 'flex';
}

function ensureChatInputReady() {
    // Ensure chat section is visible
    if (chatSection.style.display !== 'flex') {
        chatSection.style.display = 'flex';
        console.log('Chat section made visible');
    }
    
    // Force chat input container to be visible and properly positioned
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
        chatInputContainer.style.display = 'block !important';
        chatInputContainer.style.visibility = 'visible !important';
        chatInputContainer.style.opacity = '1 !important';
        chatInputContainer.style.position = 'relative';
        chatInputContainer.style.zIndex = '10';
        chatInputContainer.style.flexShrink = '0';
        chatInputContainer.style.minHeight = '80px';
        chatInputContainer.style.background = 'white';
        chatInputContainer.style.borderTop = '1px solid #e9ecef';
        console.log('Chat input container forced visible');
    }
    
    // Ensure chat input is ready
    chatInput.disabled = false;
    chatInput.style.display = 'block !important';
    chatInput.style.visibility = 'visible !important';
    chatInput.style.opacity = '1 !important';
    chatInput.placeholder = "Ask another question about your document...";
    
    // Add visual feedback that input is ready
    chatInput.style.border = '2px solid #667eea';
    chatInput.style.boxShadow = '0 0 10px rgba(102, 126, 234, 0.3)';
    
    // Force scroll to bottom to show input
    setTimeout(() => {
        scrollToBottom();
        chatInput.focus();
        console.log('Chat input focused and ready');
        
        // Remove the highlight after a moment
        setTimeout(() => {
            chatInput.style.border = 'none';
            chatInput.style.boxShadow = 'none';
        }, 2000);
    }, 100);
    
    // Ensure send button is ready
    sendBtn.disabled = false;
    document.getElementById('sendIcon').style.display = 'inline';
    document.getElementById('loadingIcon').style.display = 'none';
    
    // Force a reflow to ensure proper layout
    chatSection.offsetHeight;
}

function forceChatInputVisible() {
    // Force the chat input container to be visible
    const chatInputContainer = document.querySelector('.chat-input-container');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');
    
    if (chatInputContainer) {
        // Force all styles to ensure visibility
        chatInputContainer.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            z-index: 999 !important;
            background: white !important;
            border-top: 1px solid #e9ecef !important;
            padding: 20px 25px !important;
            flex-shrink: 0 !important;
            min-height: 80px !important;
        `;
    }
    
    if (chatInputWrapper) {
        chatInputWrapper.style.cssText = `
            display: flex !important;
            align-items: center !important;
            background: #f8f9fa !important;
            border-radius: 25px !important;
            padding: 5px !important;
            visibility: visible !important;
            opacity: 1 !important;
        `;
    }
    
    // Force chat input to be visible
    chatInput.style.cssText = `
        flex: 1 !important;
        border: none !important;
        background: transparent !important;
        padding: 15px 20px !important;
        font-size: 1rem !important;
        outline: none !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
    `;
    
    // Force send button to be visible
    sendBtn.style.cssText = `
        background: linear-gradient(45deg, #667eea, #764ba2) !important;
        border: none !important;
        width: 45px !important;
        height: 45px !important;
        border-radius: 50% !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.3s ease !important;
        color: white !important;
        font-size: 1.2rem !important;
        visibility: visible !important;
        opacity: 1 !important;
    `;
    
    console.log('Chat input forcefully made visible');
    
    // Scroll to ensure input is visible
    setTimeout(() => {
        chatInputContainer?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        chatInput.focus();
    }, 200);
}

function closeModal() {
    errorModal.style.display = 'none';
}