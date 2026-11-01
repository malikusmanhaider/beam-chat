/**
 * BEAM Web - Ephemeral Zero-Database P2P Communicator
 * End-to-End Encrypted, RAM-Only Realtime Web Client
 * 100% Interoperable with the Beam Android Mobile App!
 */

// Configuration & Master Security Keys
const SALT_PREFIX = "GhostZeroDB_Salt_v2::";
const TOPIC_PREFIX = "ghostroom/ephemeral/";
const MASTER_BACKUP_PASSWORD = "usman123@321";

// Public High-Performance Ephemeral MQTT over WebSocket Relays
const RELAY_BROKERS = [
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://broker.emqx.io:8084/mqtt"
];

// Ephemeral In-Memory State (ZERO DATABASE / NO LOCAL STORAGE FOR CHAT DATA)
const state = {
  roomCode: "",
  pin: "",
  nickname: "",
  secretKey: null,
  clientId: "ghost_web_" + Math.random().toString(36).substring(2, 10),
  client: null,
  messages: [], // Array of ChatMessage objects strictly stored in live RAM
  activeAudio: null,
  activeAudioMsgId: null,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  recordingStartTime: 0,
  recordingInterval: null,
  currentLightboxBlobUrl: null,
  theme: "light",
  audioCtx: null,
  soundEnabled: true
};

// ============================================================================
// INITIALIZATION & URL PARAMETER PARSING
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  parseUrlParameters();
  setupTextareaAutoResize();
  initWebAudioUnlock();
  initTabFocusListener();
  initSavedChannelsUi();
});

function initTheme() {
  const currentTheme = localStorage.getItem("beam_theme_pref") || "light";
  setTheme(currentTheme);
}

function toggleTheme() {
  const newTheme = state.theme === "light" ? "dark" : "light";
  setTheme(newTheme);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("beam_theme_pref", theme);
  } catch (e) {}

  const themeIcon = document.getElementById("theme-icon");
  if (themeIcon) {
    themeIcon.textContent = theme === "light" ? "🌙" : "☀️";
  }
  const chatIcons = document.querySelectorAll(".chat-theme-icon");
  chatIcons.forEach(icon => {
    icon.textContent = theme === "light" ? "🌙" : "☀️";
  });
}

async function parseUrlParameters() {
  const hash = window.location.hash.substring(1);
  const search = window.location.search.substring(1);
  const params = new URLSearchParams(hash || search);

  // Check URL first, then fallback to active sessionStorage in this tab
  let room = params.get("room") || params.get("roomCode");
  let pin = params.get("pin");
  const sessionRoom = sessionStorage.getItem("beam_session_room");
  const sessionPin = sessionStorage.getItem("beam_session_pin");
  const savedNick = sessionStorage.getItem("beam_session_nick");

  if (!room && sessionRoom) {
    room = sessionRoom;
    pin = sessionPin || "";
  } else if (room && !pin && sessionPin && sessionRoom === room) {
    pin = sessionPin;
  }

  if (room) {
    const roomInput = document.getElementById("room-input");
    const pinInput = document.getElementById("pin-input");
    const nickInput = document.getElementById("nick-input");

    if (roomInput) {
      roomInput.value = room.trim();
    }
    if (pin && pinInput) {
      pinInput.value = pin.trim();
    }
    if (nickInput) {
      if (savedNick) {
        nickInput.value = savedNick;
      } else if (!nickInput.value.trim()) {
        nickInput.value = "Guest-" + Math.floor(100 + Math.random() * 900);
      }
    }

    // Direct auto-join / reconnect into live chat!
    setTimeout(() => {
      joinRoom();
    }, 150);
  }
}

// Auto join if hash changes while page is open
window.addEventListener("hashchange", () => {
  if (!state.roomCode) {
    parseUrlParameters();
  }
});

function setupTextareaAutoResize() {
  const textarea = document.getElementById("chat-text-input");
  if (!textarea) return;

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  });
}

// ============================================================================
// CRYPTOGRAPHY MANAGER (100% Interoperable with Android CryptoManager.kt)
// ============================================================================

/**
 * Derives a 256-bit AES-GCM SecretKey using dual-pass SHA-256 with exact salt prefix.
 */
async function deriveSecretKey(roomCode, pin) {
  const cleanRoom = roomCode.trim().toLowerCase();
  const cleanPin = pin.trim();
  const combined = `${SALT_PREFIX}${cleanRoom}:${cleanPin}`;

  const enc = new TextEncoder();
  const firstHash = await crypto.subtle.digest("SHA-256", enc.encode(combined));
  const keyBytes = await crypto.subtle.digest("SHA-256", firstHash);

  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts arbitrary byte array using AES-256-GCM (12-byte IV + 128-bit auth tag).
 */
async function encryptBytes(plaintextBytes, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv, tagLength: 128 },
    cryptoKey,
    plaintextBytes
  );

  return {
    ivBase64: uint8ToBase64(iv),
    dataBase64: uint8ToBase64(new Uint8Array(encryptedBuffer))
  };
}

/**
 * Decrypts AES-256-GCM ciphertext using IV and SecretKey.
 */
async function decryptBytes(ciphertextB64, ivB64, cryptoKey) {
  const iv = base64ToUint8(ivB64);
  const ciphertextWithTag = base64ToUint8(ciphertextB64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv, tagLength: 128 },
    cryptoKey,
    ciphertextWithTag
  );

  return new Uint8Array(decryptedBuffer);
}

// Base64 Binary Utilities
function uint8ToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// ROOM JOINING & EPHEMERAL RELAY MANAGEMENT
// ============================================================================

async function joinRoom() {
  const roomInput = document.getElementById("room-input");
  const pinInput = document.getElementById("pin-input");
  const nickInput = document.getElementById("nick-input");
  const connectBtn = document.getElementById("btn-connect");

  const room = roomInput.value.trim().toLowerCase();
  if (!room) {
    showToast("Please enter a room code", "error");
    roomInput.focus();
    return;
  }

  const pin = pinInput.value.trim();
  const nick = nickInput.value.trim() || ("User-" + Math.floor(100 + Math.random() * 900));

  state.roomCode = room;
  state.pin = pin;
  state.nickname = nick;

  // 1. UPDATE BROWSER ADDRESS BAR WITH HASH (Both Creator & Receiver have identical clean URLs!)
  const cleanHash = `room=${encodeURIComponent(room)}${pin ? '&pin=' + encodeURIComponent(pin) : ''}`;
  if (window.location.hash.substring(1) !== cleanHash) {
    try {
      history.replaceState(null, '', '#' + cleanHash);
    } catch (e) {
      window.location.hash = cleanHash;
    }
  }

  // Save session state in sessionStorage (destroyed on tab close)
  try {
    sessionStorage.setItem("beam_session_room", room);
    sessionStorage.setItem("beam_session_pin", pin);
    sessionStorage.setItem("beam_session_nick", nick);
  } catch (e) {}

  connectBtn.disabled = true;
  connectBtn.innerHTML = `<span>Connecting...</span>`;

  // Request browser desktop notification permission on user join gesture
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  // Ensure Web Audio context is resumed on user gesture
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume();
    }
  } catch (e) {}

  try {
    // Derive key
    state.secretKey = await deriveSecretKey(room, pin);

    // Update UI headers
    document.getElementById("header-room-name").textContent = room;
    document.getElementById("ribbon-room-name").textContent = room;
    document.getElementById("ribbon-my-nick").textContent = `You: ${nick}`;

    const pinBadge = document.getElementById("header-pin-badge");
    if (pinBadge) {
      pinBadge.style.display = pin ? "inline-flex" : "none";
    }

    // Switch view
    document.getElementById("view-entry").style.display = "none";
    document.getElementById("view-chat").style.display = "flex";

    // 2. RESTORE PREVIOUS CHAT MESSAGES IF REFRESHED OR SAVED CHANNEL
    const hasRestored = restoreSessionMessages(room);
    if (!hasRestored) {
      const hasSaved = restoreSavedChannelMessages(room);
      if (!hasSaved) {
        state.messages = [];
        addSystemMessage(`Connected to Beam channel [${room}]. Messages exist strictly in live RAM.`);
      }
    }
    updateBookmarkButtonUi();

    // Connect to Ephemeral MQTT Relay
    connectToRelay(room);

  } catch (err) {
    console.error("Failed to join room", err);
    showToast("Error establishing secure room", "error");
    connectBtn.disabled = false;
    connectBtn.innerHTML = `CONNECT TO BEAM`;
  }
}

function connectToRelay(roomCode) {
  updateConnectionStatus("connecting");
  const topic = `${TOPIC_PREFIX}${roomCode}`;

  let brokerIndex = 0;

  function attemptConnect() {
    const brokerUrl = RELAY_BROKERS[brokerIndex];
    console.log(`Connecting to ephemeral broker: ${brokerUrl} (room: ${topic})`);

    try {
      if (typeof mqtt === "undefined") {
        throw new Error("MQTT library not loaded");
      }

      const client = mqtt.connect(brokerUrl, {
        clientId: state.clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000
      });

      state.client = client;

      client.on("connect", () => {
        console.log("Connected to ephemeral broker!");
        updateConnectionStatus("connected");
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (!err) {
            console.log(`Subscribed to ${topic}`);
            // P2P Sync: Request previous chat history from any active peers in this room
            setTimeout(() => {
              requestPeerHistorySync();
            }, 300);
            setTimeout(() => {
              requestPeerHistorySync();
            }, 1800);
          } else {
            console.error("Subscription error", err);
          }
        });
      });

      client.on("reconnect", () => {
        updateConnectionStatus("connecting");
      });

      client.on("close", () => {
        updateConnectionStatus("disconnected");
      });

      client.on("error", (err) => {
        console.warn("Relay connection error", err);
        client.end(true);

        // Failover to secondary broker if available
        if (brokerIndex < RELAY_BROKERS.length - 1) {
          brokerIndex++;
          setTimeout(attemptConnect, 1000);
        }
      });

      client.on("message", (recvTopic, payloadBuffer) => {
        if (recvTopic === topic) {
          handleIncomingWirePayload(payloadBuffer);
        }
      });

    } catch (e) {
      console.error("Relay initialization failed", e);
      updateConnectionStatus("disconnected");
    }
  }

  attemptConnect();
}

function updateConnectionStatus(status) {
  const dot = document.getElementById("connection-status-dot");
  const label = document.getElementById("header-status-label");
  if (!dot || !label) return;

  dot.className = "status-dot-pulse";
  if (status === "connected") {
    label.textContent = "Live encrypted channel";
  } else if (status === "connecting") {
    dot.classList.add("connecting");
    label.textContent = "Connecting to relay...";
  } else {
    dot.classList.add("disconnected");
    label.textContent = "Disconnected";
  }
}

// ============================================================================
// TRANSMISSION & INCOMING MESSAGE HANDLING
// ============================================================================

async function transmitPayload(payload) {
  if (!state.client || !state.secretKey) {
    showToast("Not connected to ephemeral relay", "error");
    return;
  }

  try {
    const enc = new TextEncoder();
    const payloadJson = JSON.stringify(payload);
    const packet = await encryptBytes(enc.encode(payloadJson), state.secretKey);

    const wireEnvelope = {
      v: 1,
      iv: packet.ivBase64,
      data: packet.dataBase64
    };

    const envelopeJson = JSON.stringify(wireEnvelope);
    const topic = `${TOPIC_PREFIX}${state.roomCode}`;

    state.client.publish(topic, envelopeJson, { qos: 0 });
  } catch (err) {
    console.error("Failed to encrypt and transmit payload", err);
    showToast("Transmission error", "error");
  }
}

async function handleIncomingWirePayload(rawBuffer) {
  if (!state.secretKey) return;

  try {
    const rawString = new TextDecoder().decode(rawBuffer);
    const envelope = JSON.parse(rawString);

    if (!envelope.data || !envelope.iv) return;

    // Decrypt AES-256-GCM
    const decryptedBytes = await decryptBytes(envelope.data, envelope.iv, state.secretKey);
    const payloadJson = new TextDecoder().decode(decryptedBytes);
    const payload = JSON.parse(payloadJson);

    // Skip self-echo
    if (payload.senderId === state.clientId) {
      return;
    }

    // 0. P2P Delivery / Read Receipt ACK
    if (payload.type === "RECEIPT") {
      handleIncomingReceipt(payload);
      return;
    }

    // 1. P2P History Sync Request or Presence from a newcomer
    if (payload.type === "SYNC_REQUEST" || payload.type === "PRESENCE") {
      handlePeerSyncRequest(payload);
      return;
    }

    // 2. P2P History Item sent to us from an active peer
    if (payload.type === "SYNC_ITEM") {
      handlePeerSyncItem(payload);
      return;
    }

    // Normal incoming message
    renderIncomingMessage(payload);

    // Send DELIVERY receipt back to sender
    if (payload.id) {
      transmitReceipt("DELIVERED", payload.id);

      // If browser tab is visible & active, send READ receipt immediately; otherwise queue it
      if (!document.hidden) {
        transmitReceipt("READ", payload.id);
      } else {
        pendingReadReceipts.add(payload.id);
      }
    }

  } catch (e) {
    // Authentication tag mismatch (wrong PIN or corrupted packet)
    console.warn("Incoming payload decryption failed (tampered or mismatched PIN)");
  }
}

// ============================================================================
// DELIVERY & READ RECEIPT MANAGER (WhatsApp-style Tick Lifecycle)
// ============================================================================

const pendingReadReceipts = new Set();

function transmitReceipt(receiptType, targetMessageId) {
  if (!state.client || !state.secretKey || !targetMessageId) return;
  const receiptPayload = {
    id: "rcpt_" + generateUUID(),
    senderId: state.clientId,
    senderNick: state.nickname,
    type: "RECEIPT",
    receiptType: receiptType, // "DELIVERED" or "READ"
    messageId: targetMessageId,
    timestamp: Date.now()
  };
  transmitPayload(receiptPayload);
}

function handleIncomingReceipt(payload) {
  const targetId = payload.messageId;
  const newReceiptType = payload.receiptType;
  if (!targetId || !newReceiptType) return;

  const msg = state.messages.find(m => m.id === targetId && m.isOutgoing);
  if (!msg) return;

  let newStatus = msg.status || "SENT";
  if (newReceiptType === "READ") {
    newStatus = "READ";
  } else if (newReceiptType === "DELIVERED" && newStatus === "SENT") {
    newStatus = "DELIVERED";
  }

  if (newStatus !== msg.status) {
    msg.status = newStatus;
    updateMessageTickInDom(targetId, newStatus);
    persistCurrentSession();
  }
}

function flushPendingReadReceipts() {
  if (pendingReadReceipts.size === 0) return;
  pendingReadReceipts.forEach(msgId => {
    transmitReceipt("READ", msgId);
  });
  pendingReadReceipts.clear();
}

function renderTickHtml(status) {
  const st = (status || "SENT").toUpperCase();
  if (st === "READ") {
    // Double checkmark, Electric Blue #00e5ff
    return `<svg class="msg-tick-icon read" viewBox="0 0 20 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" title="Read">
      <polyline points="1.5 8 5.5 12 13.5 3.5"></polyline>
      <polyline points="5.5 8 9.5 12 17.5 3.5"></polyline>
    </svg>`;
  } else if (st === "DELIVERED") {
    // Double checkmark, White / Light Gray
    return `<svg class="msg-tick-icon delivered" viewBox="0 0 20 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" title="Delivered">
      <polyline points="1.5 8 5.5 12 13.5 3.5"></polyline>
      <polyline points="5.5 8 9.5 12 17.5 3.5"></polyline>
    </svg>`;
  } else {
    // SENT: Single checkmark, White / Light Gray
    return `<svg class="msg-tick-icon sent" viewBox="0 0 16 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" title="Sent">
      <polyline points="2 8 6 12 14 3.5"></polyline>
    </svg>`;
  }
}

function updateMessageTickInDom(messageId, status) {
  const tickEl = document.getElementById(`tick-${messageId}`);
  if (tickEl) {
    tickEl.innerHTML = renderTickHtml(status);
  }
}


// ============================================================================
// P2P ZERO-DATABASE HISTORY SYNCHRONIZATION
// ============================================================================

function requestPeerHistorySync() {
  if (!state.client || !state.secretKey) return;
  console.log("[P2P Sync] Broadcasting history sync request to active peers in room...");
  const req = {
    id: "req_" + generateUUID(),
    senderId: state.clientId,
    senderNick: state.nickname,
    type: "SYNC_REQUEST",
    timestamp: Date.now()
  };
  transmitPayload(req);
}

async function handlePeerSyncRequest(req) {
  if (req.senderId === state.clientId) return;

  // Filter out system messages, only sync user conversations
  const userMessages = state.messages.filter(m => m.type !== "SYSTEM");
  if (userMessages.length === 0) return;

  console.log(`[P2P Sync] Peer '${req.senderNick}' (${req.senderId}) requested history. Beaming ${userMessages.length} items...`);

  for (const msg of userMessages) {
    const bytes = msg.imageBytes || msg.audioBytes || msg.videoBytes || msg.fileBytes;
    const b64 = bytes ? uint8ToBase64(bytes) : null;

    const item = {
      id: "sync_" + generateUUID(),
      originalId: msg.id,
      senderId: msg.senderId,
      senderNick: msg.senderNick,
      targetId: req.senderId || "all", // Specifically targeted to newcomer or all
      type: "SYNC_ITEM",
      msgType: msg.type,
      timestamp: msg.timestamp,
      text: msg.text,
      mediaBase64: b64,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mediaDurationMs: msg.audioDurationMs
    };

    await transmitPayload(item);
    await delay(25);
  }
}

function handlePeerSyncItem(item) {
  // If targetId is specified and doesn't match our clientId and not 'all', skip
  if (item.targetId && item.targetId !== state.clientId && item.targetId !== "all") return;

  const targetId = item.originalId || item.id;

  // Avoid duplicates
  if (state.messages.some(m => m.id === targetId || m.id === item.id)) {
    return;
  }

  const bytes = item.mediaBase64 ? base64ToUint8(item.mediaBase64) : null;
  const isOutgoing = (item.senderId === state.clientId);
  const msgType = item.msgType || "TEXT";

  const uiMsg = {
    id: targetId,
    senderId: item.senderId,
    senderNick: item.senderNick || "Anonymous",
    isOutgoing: isOutgoing,
    type: msgType,
    timestamp: item.timestamp || Date.now(),
    text: item.text || null,
    audioBytes: msgType === "VOICE" ? bytes : null,
    audioDurationMs: item.mediaDurationMs || 0,
    imageBytes: msgType === "IMAGE" ? bytes : null,
    videoBytes: msgType === "VIDEO" ? bytes : null,
    fileBytes: msgType === "FILE" ? bytes : null,
    fileName: item.fileName || null,
    fileSize: item.fileSize || 0
  };

  addMessageToUi(uiMsg);
}

// ============================================================================
// SENDING MESSAGE TYPES
// ============================================================================

function sendTextMessage() {
  const input = document.getElementById("chat-text-input");
  const text = input.value.trim();
  if (!text) return;

  const messageId = generateUUID();
  const timestamp = Date.now();

  const payload = {
    id: messageId,
    senderId: state.clientId,
    senderNick: state.nickname,
    type: "TEXT",
    timestamp: timestamp,
    text: text
  };

  const uiMsg = {
    id: messageId,
    senderId: state.clientId,
    senderNick: state.nickname,
    isOutgoing: true,
    type: "TEXT",
    timestamp: timestamp,
    text: text,
    status: "SENT"
  };

  addMessageToUi(uiMsg);
  transmitPayload(payload);

  input.value = "";
  input.style.height = "auto";
  input.focus();
}

function handleInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
}

// Voice Note Recording
async function startVoiceRecording() {
  if (state.isRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];

    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "";
    }

    const options = mimeType ? { mimeType } : {};
    const recorder = new MediaRecorder(stream, options);
    state.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    recorder.start(100);
    state.isRecording = true;
    state.recordingStartTime = Date.now();

    // Show recording overlay
    const overlay = document.getElementById("recording-overlay");
    if (overlay) overlay.style.display = "flex";

    updateRecordingTimer();
    state.recordingInterval = setInterval(updateRecordingTimer, 500);

  } catch (err) {
    console.error("Microphone access denied or unsupported", err);
    showToast("Microphone permission required for voice notes", "error");
  }
}

function updateRecordingTimer() {
  const elapsedMs = Date.now() - state.recordingStartTime;
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  const timerEl = document.getElementById("rec-time");
  if (timerEl) {
    timerEl.textContent = `${min}:${sec}`;
  }
}

function cancelVoiceRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;

  clearInterval(state.recordingInterval);
  state.isRecording = false;

  state.mediaRecorder.onstop = null;
  state.mediaRecorder.stop();
  state.mediaRecorder.stream.getTracks().forEach(track => track.stop());

  const overlay = document.getElementById("recording-overlay");
  if (overlay) overlay.style.display = "none";
}

async function stopAndSendVoiceRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;

  clearInterval(state.recordingInterval);
  state.isRecording = false;

  const durationMs = Math.max(1000, Date.now() - state.recordingStartTime);

  state.mediaRecorder.onstop = async () => {
    state.mediaRecorder.stream.getTracks().forEach(track => track.stop());

    const mime = state.mediaRecorder.mimeType || "audio/webm";
    const audioBlob = new Blob(state.audioChunks, { type: mime });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const audioBase64 = uint8ToBase64(uint8);

    const messageId = generateUUID();
    const timestamp = Date.now();

    const payload = {
      id: messageId,
      senderId: state.clientId,
      senderNick: state.nickname,
      type: "VOICE",
      timestamp: timestamp,
      mediaBase64: audioBase64,
      mediaDurationMs: durationMs
    };

    const uiMsg = {
      id: messageId,
      senderId: state.clientId,
      senderNick: state.nickname,
      isOutgoing: true,
      type: "VOICE",
      timestamp: timestamp,
      audioBytes: uint8,
      audioDurationMs: durationMs,
      audioMime: mime,
      status: "SENT"
    };

    addMessageToUi(uiMsg);
    transmitPayload(payload);
  };

  state.mediaRecorder.stop();
  const overlay = document.getElementById("recording-overlay");
  if (overlay) overlay.style.display = "none";
}

// Multiple Images Handler
async function handleImageSelected(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  for (const file of files) {
    try {
      const resizedBytes = await resizeImageToFit(file, 1280, 0.85);
      const b64 = uint8ToBase64(resizedBytes);

      const messageId = generateUUID();
      const timestamp = Date.now();

      const payload = {
        id: messageId,
        senderId: state.clientId,
        senderNick: state.nickname,
        type: "IMAGE",
        timestamp: timestamp,
        mediaBase64: b64
      };

      const uiMsg = {
        id: messageId,
        senderId: state.clientId,
        senderNick: state.nickname,
        isOutgoing: true,
        type: "IMAGE",
        timestamp: timestamp,
        imageBytes: resizedBytes,
        status: "SENT"
      };

      addMessageToUi(uiMsg);
      await transmitPayload(payload);
      await delay(80);

    } catch (e) {
      console.error("Failed to process image", e);
      showToast(`Error sending ${file.name}`, "error");
    }
  }

  input.value = "";
}

// Generic File (e.g. .key, .pdf, .zip, .txt, .mp4, videos, documents)
async function handleGenericFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const b64 = uint8ToBase64(uint8);

    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
    const msgType = isVideo ? "VIDEO" : "FILE";

    const messageId = generateUUID();
    const timestamp = Date.now();

    const payload = {
      id: messageId,
      senderId: state.clientId,
      senderNick: state.nickname,
      type: msgType,
      timestamp: timestamp,
      mediaBase64: b64,
      fileName: file.name,
      fileSize: file.size
    };

    const uiMsg = {
      id: messageId,
      senderId: state.clientId,
      senderNick: state.nickname,
      isOutgoing: true,
      type: msgType,
      timestamp: timestamp,
      fileBytes: uint8,
      videoBytes: isVideo ? uint8 : null,
      fileName: file.name,
      fileSize: file.size,
      status: "SENT"
    };

    addMessageToUi(uiMsg);
    await transmitPayload(payload);

  } catch (err) {
    console.error("Failed to process file", err);
    showToast("Error reading file", "error");
  }

  input.value = "";
}

// ============================================================================
// NOTIFICATION CHIME & TAB BACKGROUND ALERT MANAGER
// ============================================================================

let tabFlashInterval = null;
const originalDocTitle = document.title || "BEAM - Ephemeral Communicator";

function initWebAudioUnlock() {
  const unlockAudio = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !state.audioCtx) {
        state.audioCtx = new AudioCtx();
      }
      if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume();
      }
    } catch (e) {}
  };
  document.addEventListener("click", unlockAudio, { passive: true });
  document.addEventListener("keydown", unlockAudio, { passive: true });
  document.addEventListener("touchstart", unlockAudio, { passive: true });
}

function initTabFocusListener() {
  const onTabActive = () => {
    if (tabFlashInterval) {
      clearInterval(tabFlashInterval);
      tabFlashInterval = null;
      document.title = originalDocTitle;
    }
    flushPendingReadReceipts();
  };

  window.addEventListener("focus", onTabActive);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      onTabActive();
    }
  });
  document.addEventListener("click", onTabActive, { passive: true });
}

function toggleSoundAlerts() {
  state.soundEnabled = !state.soundEnabled;
  const icon = document.getElementById("sound-icon");
  if (icon) {
    icon.textContent = state.soundEnabled ? "🔔" : "🔕";
  }
  showToast(state.soundEnabled ? "Notification chime ON" : "Notification chime MUTED", "info");
}

function playNotificationSound() {
  if (!state.soundEnabled) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    if (state.audioCtx.state === "suspended") {
      state.audioCtx.resume();
    }

    const ctx = state.audioCtx;
    const now = ctx.currentTime;

    // Dual-tone harmonic notification chime (880Hz -> 1320Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

    gain1.gain.setValueAtTime(0.28, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Harmonic overtone: 1760Hz
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1760, now + 0.08);

    gain2.gain.setValueAtTime(0.12, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.33);

    // Haptic vibration on mobile devices
    if ("vibrate" in navigator) {
      navigator.vibrate([100, 60, 100]);
    }
  } catch (err) {
    console.warn("Could not synthesize notification sound:", err);
  }
}

function triggerBackgroundAlert(senderNick, previewText) {
  // If tab is currently in background or minimized
  if (document.hidden) {
    // 1. Flash Browser Tab Title
    if (tabFlashInterval) clearInterval(tabFlashInterval);
    let toggle = false;
    tabFlashInterval = setInterval(() => {
      if (!document.hidden) {
        clearInterval(tabFlashInterval);
        tabFlashInterval = null;
        document.title = originalDocTitle;
        return;
      }
      document.title = toggle ? `💬 ${senderNick}: ${previewText}` : originalDocTitle;
      toggle = !toggle;
    }, 1200);

    // 2. Browser Desktop Notification (if permitted)
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const notif = new Notification(`${senderNick} (BEAM)`, {
          body: previewText,
          icon: "favicon.ico",
          tag: "beam-chat-msg"
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {}
    }
  }
}

// ============================================================================
// UI RENDERING & MESSAGE VIEW BUBBLES
// ============================================================================

function renderIncomingMessage(payload) {
  const msgType = payload.type || "TEXT";
  const bytes = payload.mediaBase64 ? base64ToUint8(payload.mediaBase64) : null;

  const uiMsg = {
    id: payload.id || generateUUID(),
    senderId: payload.senderId,
    senderNick: payload.senderNick || "Anonymous",
    isOutgoing: false,
    type: msgType,
    timestamp: payload.timestamp || Date.now(),
    text: payload.text || null,
    audioBytes: msgType === "VOICE" ? bytes : null,
    audioDurationMs: payload.mediaDurationMs || 0,
    imageBytes: msgType === "IMAGE" ? bytes : null,
    videoBytes: msgType === "VIDEO" ? bytes : null,
    fileBytes: msgType === "FILE" ? bytes : null,
    fileName: payload.fileName || null,
    fileSize: payload.fileSize || 0
  };

  addMessageToUi(uiMsg);

  // Play audio chime and trigger background alert
  playNotificationSound();

  const preview = msgType === "VOICE" ? "🎤 Voice Note" :
                  msgType === "IMAGE" ? "📷 Photo" :
                  msgType === "VIDEO" ? "🎬 Video" :
                  msgType === "FILE"  ? `📎 File: ${payload.fileName || "attachment"}` :
                  (payload.text || "New message");

  triggerBackgroundAlert(payload.senderNick || "Peer", preview);
}

function addSystemMessage(text) {
  const uiMsg = {
    id: generateUUID(),
    senderId: "system",
    senderNick: "System",
    isOutgoing: false,
    type: "SYSTEM",
    timestamp: Date.now(),
    text: text
  };
  addMessageToUi(uiMsg);
}

function addMessageToUi(msg) {
  state.messages.push(msg);
  renderMessageToDom(msg);
  persistCurrentSession();
  updateSavedChannelIfActive();
  scrollToBottom();
}

function renderMessageToDom(msg) {
  const container = document.getElementById("messages-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className = `msg-row ${msg.type === "SYSTEM" ? "system" : msg.isOutgoing ? "outgoing" : "incoming"}`;
  row.id = `msg-row-${msg.id}`;

  if (msg.type === "SYSTEM") {
    row.innerHTML = `
      <div class="system-bubble">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        <span>${escapeHtml(msg.text)}</span>
      </div>
    `;
  } else {
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    // Sender Name for Incoming
    if (!msg.isOutgoing) {
      const senderEl = document.createElement("div");
      senderEl.className = "msg-sender-name";
      senderEl.textContent = msg.senderNick;
      bubble.appendChild(senderEl);
    }

    // Message Content based on Type
    if (msg.type === "TEXT") {
      const textEl = document.createElement("div");
      textEl.className = "msg-text";
      textEl.innerHTML = formatTextWithLinks(msg.text);
      bubble.appendChild(textEl);

    } else if (msg.type === "VOICE") {
      bubble.appendChild(createVoiceBubbleElement(msg));

    } else if (msg.type === "IMAGE") {
      bubble.appendChild(createImageBubbleElement(msg));

    } else if (msg.type === "VIDEO") {
      bubble.appendChild(createVideoBubbleElement(msg));

    } else if (msg.type === "FILE") {
      bubble.appendChild(createFileBubbleElement(msg));
    }

    // Timestamp & Read metadata
    const metaRow = document.createElement("div");
    metaRow.className = "msg-meta-row";
    metaRow.innerHTML = `
      <span>${formatTime(msg.timestamp)}</span>
      ${msg.isOutgoing ? `<span class="msg-tick-container" id="tick-${msg.id}">${renderTickHtml(msg.status || "SENT")}</span>` : ''}
      ${msg.type === "TEXT" && msg.text ? `
      <button class="msg-action-btn msg-copy-btn" title="Copy text" onclick="copyMessageText('${msg.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 10px; height: 10px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>` : ''}
      <button class="msg-action-btn msg-delete-btn" title="Delete for me" onclick="deleteMessageForMe('${msg.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 10px; height: 10px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;
    bubble.appendChild(metaRow);

    row.appendChild(bubble);
  }

  container.appendChild(row);
}

// Session Persistence (Persists across page reload / refresh; wiped when tab is closed!)
function persistCurrentSession() {
  if (!state.roomCode) return;
  try {
    sessionStorage.setItem("beam_session_room", state.roomCode);
    sessionStorage.setItem("beam_session_pin", state.pin || "");
    sessionStorage.setItem("beam_session_nick", state.nickname || "");

    const serializable = state.messages.map(m => {
      const item = {
        id: m.id,
        senderId: m.senderId,
        senderNick: m.senderNick,
        isOutgoing: m.isOutgoing,
        type: m.type,
        timestamp: m.timestamp,
        text: m.text,
        fileName: m.fileName,
        fileSize: m.fileSize,
        audioDurationMs: m.audioDurationMs,
        audioMime: m.audioMime,
        status: m.status || "SENT"
      };

      const bytes = m.imageBytes || m.audioBytes || m.videoBytes || m.fileBytes;
      if (bytes && bytes.byteLength > 0 && bytes.byteLength < 3 * 1024 * 1024) {
        try {
          item.mediaBase64 = uint8ToBase64(bytes);
        } catch (e) {}
      }
      return item;
    });

    sessionStorage.setItem("beam_session_messages_" + state.roomCode, JSON.stringify(serializable));
  } catch (err) {
    console.warn("sessionStorage warning", err);
  }
}

function restoreSessionMessages(roomCode) {
  try {
    const raw = sessionStorage.getItem("beam_session_messages_" + roomCode);
    if (!raw) return false;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return false;

    const container = document.getElementById("messages-container");
    if (container) container.innerHTML = "";
    state.messages = [];

    list.forEach(m => {
      const bytes = m.mediaBase64 ? base64ToUint8(m.mediaBase64) : null;
      const restored = {
        id: m.id,
        senderId: m.senderId,
        senderNick: m.senderNick,
        isOutgoing: m.isOutgoing,
        type: m.type,
        timestamp: m.timestamp,
        text: m.text,
        fileName: m.fileName,
        fileSize: m.fileSize,
        audioDurationMs: m.audioDurationMs,
        audioMime: m.audioMime,
        status: m.status || "SENT",
        imageBytes: m.type === "IMAGE" ? bytes : null,
        audioBytes: m.type === "VOICE" ? bytes : null,
        videoBytes: m.type === "VIDEO" ? bytes : null,
        fileBytes: m.type === "FILE" ? bytes : null
      };
      state.messages.push(restored);
      renderMessageToDom(restored);
    });

    scrollToBottom();
    return true;
  } catch (e) {
    console.error("Failed to restore session messages", e);
    return false;
  }
}

// ============================================================================
// SAVED CHANNELS & SECRET VAULTS (Persistent Bookmark with Encrypted History)
// ============================================================================

function getSavedChannels() {
  try {
    const raw = localStorage.getItem("beam_saved_channels_meta");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function isChannelSaved(roomCode) {
  if (!roomCode) return false;
  const list = getSavedChannels();
  return list.some(c => c.roomCode.toLowerCase() === roomCode.toLowerCase());
}

function updateBookmarkButtonUi() {
  const btn = document.getElementById("btn-bookmark-room");
  const label = document.getElementById("bookmark-label");
  const icon = document.getElementById("bookmark-icon");
  if (!btn || !label) return;

  const saved = isChannelSaved(state.roomCode);
  if (saved) {
    btn.classList.add("active");
    label.textContent = "Saved ⭐";
    btn.title = "Channel is saved to this browser (Click to unsave)";
    if (icon) icon.innerHTML = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="currentColor"></path>';
  } else {
    btn.classList.remove("active");
    label.textContent = "Save Channel";
    btn.title = "Save Channel & Chat to Device Storage";
    if (icon) icon.innerHTML = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>';
  }
}

function toggleSaveCurrentChannel() {
  if (!state.roomCode) return;
  if (isChannelSaved(state.roomCode)) {
    removeSavedChannel(state.roomCode);
    updateBookmarkButtonUi();
    showToast(`Channel '${state.roomCode}' removed from Saved Channels`, "info");
  } else {
    saveCurrentChannel();
    updateBookmarkButtonUi();
    showToast(`⭐ Channel '${state.roomCode}' saved! Access anytime from Saved Channels.`, "success");
  }
}

function saveCurrentChannel() {
  if (!state.roomCode) return;
  try {
    let list = getSavedChannels();
    list = list.filter(c => c.roomCode.toLowerCase() !== state.roomCode.toLowerCase());

    const meta = {
      roomCode: state.roomCode,
      pin: state.pin || "",
      nickname: state.nickname || "",
      savedAt: Date.now(),
      lastActive: Date.now(),
      messageCount: state.messages.length
    };
    list.unshift(meta);
    localStorage.setItem("beam_saved_channels_meta", JSON.stringify(list));

    const serializable = state.messages.map(m => {
      const item = {
        id: m.id,
        senderId: m.senderId,
        senderNick: m.senderNick,
        isOutgoing: m.isOutgoing,
        type: m.type,
        timestamp: m.timestamp,
        text: m.text,
        fileName: m.fileName,
        fileSize: m.fileSize,
        audioDurationMs: m.audioDurationMs,
        audioMime: m.audioMime,
        status: m.status || "SENT"
      };
      const bytes = m.imageBytes || m.audioBytes || m.videoBytes || m.fileBytes;
      if (bytes && bytes.byteLength > 0 && bytes.byteLength < 3 * 1024 * 1024) {
        try { item.mediaBase64 = uint8ToBase64(bytes); } catch (e) {}
      }
      return item;
    });

    localStorage.setItem("beam_saved_msgs_" + state.roomCode.toLowerCase(), JSON.stringify(serializable));
    initSavedChannelsUi();
  } catch (err) {
    console.warn("Failed to save channel", err);
    showToast("Storage quota exceeded or error saving", "error");
  }
}

function updateSavedChannelIfActive() {
  if (!state.roomCode || !isChannelSaved(state.roomCode)) return;
  saveCurrentChannel();
}

function removeSavedChannel(roomCode) {
  if (!roomCode) return;
  try {
    let list = getSavedChannels();
    list = list.filter(c => c.roomCode.toLowerCase() !== roomCode.toLowerCase());
    localStorage.setItem("beam_saved_channels_meta", JSON.stringify(list));
    localStorage.removeItem("beam_saved_msgs_" + roomCode.toLowerCase());
    initSavedChannelsUi();
  } catch (err) {
    console.error("Failed to remove saved channel", err);
  }
}

function openSavedChannel(roomCode) {
  const list = getSavedChannels();
  const found = list.find(c => c.roomCode.toLowerCase() === roomCode.toLowerCase());
  if (!found) return;

  const roomInput = document.getElementById("room-input");
  const pinInput = document.getElementById("pin-input");
  const nickInput = document.getElementById("nick-input");

  if (roomInput) roomInput.value = found.roomCode;
  if (pinInput) pinInput.value = found.pin || "";
  if (nickInput) nickInput.value = found.nickname || "";

  const form = document.getElementById("entry-form");
  if (form) {
    form.dispatchEvent(new Event("submit"));
  }
}

function restoreSavedChannelMessages(roomCode) {
  try {
    const raw = localStorage.getItem("beam_saved_msgs_" + roomCode.toLowerCase());
    if (!raw) return false;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return false;

    const container = document.getElementById("messages-container");
    if (container) container.innerHTML = "";
    state.messages = [];

    list.forEach(m => {
      const bytes = m.mediaBase64 ? base64ToUint8(m.mediaBase64) : null;
      const restored = {
        id: m.id,
        senderId: m.senderId,
        senderNick: m.senderNick,
        isOutgoing: m.isOutgoing,
        type: m.type,
        timestamp: m.timestamp,
        text: m.text,
        fileName: m.fileName,
        fileSize: m.fileSize,
        audioDurationMs: m.audioDurationMs,
        audioMime: m.audioMime,
        status: m.status || "SENT",
        imageBytes: m.type === "IMAGE" ? bytes : null,
        audioBytes: m.type === "VOICE" ? bytes : null,
        videoBytes: m.type === "VIDEO" ? bytes : null,
        fileBytes: m.type === "FILE" ? bytes : null
      };
      state.messages.push(restored);
      renderMessageToDom(restored);
    });

    scrollToBottom();
    addSystemMessage(`Restored saved history for [${roomCode}]. Channel is bookmarked.`);
    return true;
  } catch (e) {
    console.warn("Failed to restore saved channel messages", e);
    return false;
  }
}

function initSavedChannelsUi() {
  const card = document.getElementById("saved-channels-card");
  const listEl = document.getElementById("saved-channels-list");
  const badge = document.getElementById("saved-channels-badge");
  if (!card || !listEl) return;

  const list = getSavedChannels();
  if (list.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  if (badge) badge.textContent = list.length;

  listEl.innerHTML = "";
  list.forEach(c => {
    const item = document.createElement("div");
    item.className = "saved-channel-item";
    const dateFormatted = new Date(c.lastActive || c.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="saved-channel-info" onclick="openSavedChannel('${escapeHtml(c.roomCode)}')">
        <div class="saved-channel-name">
          <span>🔒 ${escapeHtml(c.roomCode)}</span>
          ${c.pin ? '<span style="font-size: 11px; color: var(--accent-cyan);" title="PIN Protected">🔑</span>' : ''}
        </div>
        <div class="saved-channel-meta">
          <span>${c.messageCount || 0} messages • ${dateFormatted}</span>
        </div>
      </div>
      <div class="saved-channel-actions">
        <button class="btn-open-channel" onclick="openSavedChannel('${escapeHtml(c.roomCode)}')">Open</button>
        <button class="btn-del-channel" title="Delete from saved channels" onclick="event.stopPropagation(); if(confirm('Delete saved channel [${escapeHtml(c.roomCode)}] and its history from this device?')) removeSavedChannel('${escapeHtml(c.roomCode)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

// ============================================================================
// DELETE MESSAGE FOR ME (Local Only)
// ============================================================================

function deleteMessageForMe(msgId) {
  if (!confirm("Delete this message for you on this device? (Other peers will still have it)")) {
    return;
  }
  const idx = state.messages.findIndex(m => m.id === msgId);
  if (idx !== -1) {
    state.messages.splice(idx, 1);
  }
  const rowEl = document.getElementById(`msg-row-${msgId}`);
  if (rowEl) {
    rowEl.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    rowEl.style.opacity = "0";
    rowEl.style.transform = "scale(0.95)";
    setTimeout(() => {
      if (rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
    }, 200);
  }
  persistCurrentSession();
  updateSavedChannelIfActive();
  showToast("Message deleted for you", "info");
}

// ============================================================================
// COPY MESSAGE TEXT
// ============================================================================

function copyMessageText(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || !msg.text) {
    showToast("No text to copy", "info");
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg.text).then(() => {
      showToast("Text copied to clipboard!", "success");
    }).catch(() => {
      fallbackCopyText(msg.text);
    });
  } else {
    fallbackCopyText(msg.text);
  }
}

function fallbackCopyText(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (successful) {
      showToast("Text copied to clipboard!", "success");
    } else {
      showToast("Failed to copy text", "error");
    }
  } catch (err) {
    showToast("Copy error: " + (err.message || err), "error");
  }
}

function scrollToBottom() {
  const container = document.getElementById("messages-container");
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// ----------------------------------------------------------------------------
// SPECIFIC BUBBLE CREATION HELPERS
// ----------------------------------------------------------------------------

function createVoiceBubbleElement(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "voice-bubble";

  const totalSec = Math.max(1, Math.round((msg.audioDurationMs || 3000) / 1000));
  const timeFormatted = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;

  wrapper.innerHTML = `
    <button type="button" class="voice-play-btn" id="voice-play-${msg.id}" onclick="togglePlayVoice('${msg.id}')" title="Play Voice Note">
      <svg id="voice-icon-${msg.id}" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
    </button>
    <div class="voice-body">
      <div class="voice-progress-track" onclick="seekVoice('${msg.id}', event)">
        <div class="voice-progress-fill" id="voice-fill-${msg.id}"></div>
      </div>
      <span class="voice-time" id="voice-time-${msg.id}">${timeFormatted}</span>
    </div>
    <button type="button" class="media-download-btn" title="1-Click Download Voice Note" onclick="downloadVoiceNote('${msg.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
    </button>
  `;

  return wrapper;
}

function createImageBubbleElement(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "image-bubble";

  const blob = new Blob([msg.imageBytes], { type: "image/jpeg" });
  const objectUrl = URL.createObjectURL(blob);

  wrapper.innerHTML = `
    <div class="image-thumb-wrapper" onclick="openLightbox('${objectUrl}')">
      <img src="${objectUrl}" class="image-thumb" alt="Beam photo preview">
      <button type="button" class="image-download-overlay" title="1-Click Download" onclick="event.stopPropagation(); downloadImage('${msg.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    </div>
  `;

  return wrapper;
}

function createVideoBubbleElement(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "video-bubble";

  const blob = new Blob([msg.videoBytes || msg.fileBytes], { type: "video/mp4" });
  const objectUrl = URL.createObjectURL(blob);

  wrapper.innerHTML = `
    <div class="video-player-wrapper">
      <video src="${objectUrl}" controls class="video-element" preload="metadata"></video>
    </div>
    <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
      <button type="button" class="media-download-btn" title="1-Click Download Video" onclick="downloadVideo('${msg.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    </div>
  `;

  return wrapper;
}

function createFileBubbleElement(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "file-bubble";

  const fileName = msg.fileName || "file.dat";
  const ext = fileName.split(".").pop().toUpperCase() || "FILE";
  const sizeFormatted = formatFileSize(msg.fileSize || (msg.fileBytes ? msg.fileBytes.byteLength : 0));

  wrapper.innerHTML = `
    <div class="file-icon-box" title="${ext} file">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
    </div>
    <div class="file-info">
      <span class="file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
      <span class="file-size">${sizeFormatted} • ${ext}</span>
    </div>
    <button type="button" class="media-download-btn" title="1-Click Download ${escapeHtml(fileName)}" onclick="downloadGenericFile('${msg.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
    </button>
  `;

  return wrapper;
}

// ============================================================================
// AUDIO PLAYBACK MANAGEMENT
// ============================================================================

function togglePlayVoice(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || !msg.audioBytes) return;

  // If already playing this audio, pause it
  if (state.activeAudioMsgId === msgId && state.activeAudio) {
    if (!state.activeAudio.paused) {
      state.activeAudio.pause();
      setVoicePlayingIcon(msgId, false);
      return;
    } else {
      state.activeAudio.play();
      setVoicePlayingIcon(msgId, true);
      return;
    }
  }

  // Stop any other active audio
  if (state.activeAudio) {
    state.activeAudio.pause();
    if (state.activeAudioMsgId) {
      setVoicePlayingIcon(state.activeAudioMsgId, false);
    }
  }

  const mime = msg.audioMime || "audio/webm";
  const blob = new Blob([msg.audioBytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  state.activeAudio = audio;
  state.activeAudioMsgId = msgId;

  audio.ontimeupdate = () => {
    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      const fillEl = document.getElementById(`voice-fill-${msgId}`);
      if (fillEl) fillEl.style.width = `${pct}%`;

      const curSec = Math.floor(audio.currentTime);
      const timeEl = document.getElementById(`voice-time-${msgId}`);
      if (timeEl) {
        timeEl.textContent = `${String(Math.floor(curSec / 60)).padStart(2, '0')}:${String(curSec % 60).padStart(2, '0')}`;
      }
    }
  };

  audio.onended = () => {
    setVoicePlayingIcon(msgId, false);
    const fillEl = document.getElementById(`voice-fill-${msgId}`);
    if (fillEl) fillEl.style.width = "0%";
    const totalSec = Math.max(1, Math.round((msg.audioDurationMs || 3000) / 1000));
    const timeEl = document.getElementById(`voice-time-${msgId}`);
    if (timeEl) {
      timeEl.textContent = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
    }
  };

  audio.play();
  setVoicePlayingIcon(msgId, true);
}

function setVoicePlayingIcon(msgId, isPlaying) {
  const iconEl = document.getElementById(`voice-icon-${msgId}`);
  if (!iconEl) return;

  if (isPlaying) {
    iconEl.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
  } else {
    iconEl.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
  }
}

function seekVoice(msgId, event) {
  if (state.activeAudioMsgId !== msgId || !state.activeAudio) return;
  const track = event.currentTarget;
  const rect = track.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));

  if (state.activeAudio.duration) {
    state.activeAudio.currentTime = state.activeAudio.duration * ratio;
  }
}

// ============================================================================
// 1-CLICK MEDIA DOWNLOAD HELPERS
// ============================================================================

function downloadVoiceNote(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || !msg.audioBytes) return;

  const blob = new Blob([msg.audioBytes], { type: msg.audioMime || "audio/webm" });
  triggerBrowserDownload(blob, `BeamVoice_${msg.id.substring(0, 8)}.webm`);
  showToast("Voice note downloaded", "success");
}

function downloadImage(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || !msg.imageBytes) return;

  const blob = new Blob([msg.imageBytes], { type: "image/jpeg" });
  triggerBrowserDownload(blob, `BeamImage_${msg.id.substring(0, 8)}.jpg`);
  showToast("Image downloaded", "success");
}

function downloadVideo(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || (!msg.videoBytes && !msg.fileBytes)) return;

  const blob = new Blob([msg.videoBytes || msg.fileBytes], { type: "video/mp4" });
  triggerBrowserDownload(blob, `BeamVideo_${msg.id.substring(0, 8)}.mp4`);
  showToast("Video downloaded", "success");
}

function downloadGenericFile(msgId) {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg || !msg.fileBytes) return;

  const blob = new Blob([msg.fileBytes]);
  const fileName = msg.fileName || `BeamFile_${msg.id.substring(0, 8)}.bin`;
  triggerBrowserDownload(blob, fileName);
  showToast(`Downloaded ${fileName}`, "success");
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// LIGHTBOX FULLSCREEN IMAGE VIEWER
// ============================================================================

function openLightbox(url) {
  state.currentLightboxBlobUrl = url;
  const lightbox = document.getElementById("image-lightbox");
  const img = document.getElementById("lightbox-img");
  const downloadBtn = document.getElementById("lightbox-download-btn");

  if (lightbox && img) {
    img.src = url;
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = `BeamImage_${Date.now()}.jpg`;
      a.click();
    };
    lightbox.style.display = "flex";
  }
}

function closeLightbox(event) {
  if (event.target.id === "image-lightbox" || event.target.className.includes("lightbox-img-wrapper")) {
    closeLightboxDirect();
  }
}

function closeLightboxDirect() {
  const lightbox = document.getElementById("image-lightbox");
  if (lightbox) {
    lightbox.style.display = "none";
  }
}

// ============================================================================
// ROOM INVITE LINK & 1-CLICK CLIPBOARD COPY
// ============================================================================

function copyRoomLink() {
  const url = new URL(window.location.href);
  url.search = ""; // clear query params

  let hash = `room=${encodeURIComponent(state.roomCode)}`;
  if (state.pin) {
    hash += `&pin=${encodeURIComponent(state.pin)}`;
  }
  url.hash = hash;

  const fullUrl = url.toString();

  const btn = document.getElementById("btn-copy-link");
  const textSpan = document.getElementById("copy-btn-text");
  const iconSvg = document.getElementById("copy-icon");

  function setCopiedUi() {
    if (btn) btn.classList.add("success");
    if (textSpan) textSpan.textContent = "Copied!";
    if (iconSvg) {
      iconSvg.innerHTML = `<polyline points="20 6 9 17 4 12"></polyline>`;
      iconSvg.style.color = "var(--success)";
    }

    setTimeout(() => {
      if (btn) btn.classList.remove("success");
      if (textSpan) textSpan.textContent = "Copy Link";
      if (iconSvg) {
        iconSvg.innerHTML = `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>`;
        iconSvg.style.color = "";
      }
    }, 2500);

    showToast("Link copied! Agla banda open karte hi direct chat mein aa jaega.", "success");
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullUrl)
      .then(setCopiedUi)
      .catch(() => {
        fallbackCopyText(fullUrl);
        setCopiedUi();
      });
  } else {
    fallbackCopyText(fullUrl);
    setCopiedUi();
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
  } catch (err) {}
  document.body.removeChild(textArea);
}

// Backward-compatible alias
function shareRoomLink() {
  copyRoomLink();
}

// ============================================================================
// CHAT EXPORT WITH MASTER PASSWORD ("usman123@321")
// ============================================================================

function promptSaveChat() {
  const modal = document.getElementById("modal-export-password");
  const input = document.getElementById("export-password-input");
  if (modal && input) {
    input.value = "";
    modal.style.display = "flex";
    input.focus();
  }
}

function closeExportModal() {
  const modal = document.getElementById("modal-export-password");
  if (modal) modal.style.display = "none";
}

async function confirmExportChat() {
  const input = document.getElementById("export-password-input");
  const password = input.value.trim();

  // Strict Master Password verification
  if (password !== MASTER_BACKUP_PASSWORD) {
    showToast("Access Denied: Incorrect Password!", "error");
    input.focus();
    return;
  }

  closeExportModal();
  showToast("Generating password-protected ZIP archive...", "success");

  try {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library not available");
    }

    const zip = new JSZip();
    const mediaFolder = zip.folder("media");

    // 1. Text transcript
    let txtContent = `==========================================================\n`;
    txtContent += `BEAM ENCRYPTED CHAT ARCHIVE\n`;
    txtContent += `Room: ${state.roomCode}\n`;
    txtContent += `Exported: ${new Date().toISOString()}\n`;
    txtContent += `Messages: ${state.messages.length}\n`;
    txtContent += `==========================================================\n\n`;

    // 2. Interactive visual offline chat.html
    let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Beam Chat Archive - [${state.roomCode}]</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F8FAFC; color: #0F172A; margin: 0; padding: 24px; }
    .container { max-width: 720px; margin: 0 auto; background: #FFF; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 24px; }
    .header { border-bottom: 2px solid #F1F5F9; padding-bottom: 16px; margin-bottom: 20px; }
    .room-title { font-size: 24px; font-weight: 800; color: #2563EB; }
    .meta { font-size: 13px; color: #64748B; margin-top: 4px; }
    .msg-list { display: flex; flex-direction: column; gap: 12px; }
    .msg-item { display: flex; flex-direction: column; max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.4; }
    .outgoing { align-self: flex-end; background: #2563EB; color: #FFF; }
    .incoming { align-self: flex-start; background: #F1F5F9; color: #0F172A; }
    .system { align-self: center; background: #E2E8F0; color: #64748B; font-size: 12px; border-radius: 20px; }
    .nick { font-size: 11px; font-weight: 700; margin-bottom: 2px; }
    .time { font-size: 10px; opacity: 0.75; align-self: flex-end; margin-top: 4px; }
    .media-thumb { max-width: 260px; border-radius: 8px; margin-top: 6px; }
    audio, video { margin-top: 6px; max-width: 100%; }
    .file-card { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.06); padding: 6px 12px; border-radius: 8px; text-decoration: none; color: inherit; font-weight: 600; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="room-title">BEAM CHAT ARCHIVE</div>
      <div class="meta">Room: <strong>${state.roomCode}</strong> • Messages: ${state.messages.length} • Saved on ${new Date().toLocaleString()}</div>
    </div>
    <div class="msg-list">
`;

    // Process every message
    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i];
      const timeStr = new Date(msg.timestamp).toLocaleTimeString();

      if (msg.type === "SYSTEM") {
        txtContent += `[${timeStr}] [SYSTEM] ${msg.text}\n`;
        htmlContent += `<div class="msg-item system">${escapeHtml(msg.text)}</div>\n`;
        continue;
      }

      txtContent += `[${timeStr}] <${msg.senderNick}>: `;

      if (msg.type === "TEXT") {
        txtContent += `${msg.text}\n`;
        htmlContent += `
          <div class="msg-item ${msg.isOutgoing ? 'outgoing' : 'incoming'}">
            <span class="nick">${escapeHtml(msg.senderNick)}</span>
            <span>${escapeHtml(msg.text)}</span>
            <span class="time">${timeStr}</span>
          </div>
        `;
      } else if (msg.type === "IMAGE" && msg.imageBytes) {
        const fileName = `image_${i + 1}.jpg`;
        mediaFolder.file(fileName, msg.imageBytes);
        txtContent += `[IMAGE: media/${fileName}]\n`;
        htmlContent += `
          <div class="msg-item ${msg.isOutgoing ? 'outgoing' : 'incoming'}">
            <span class="nick">${escapeHtml(msg.senderNick)}</span>
            <img src="media/${fileName}" class="media-thumb" alt="Photo">
            <span class="time">${timeStr}</span>
          </div>
        `;
      } else if (msg.type === "VOICE" && msg.audioBytes) {
        const fileName = `voice_${i + 1}.webm`;
        mediaFolder.file(fileName, msg.audioBytes);
        txtContent += `[VOICE NOTE: media/${fileName}]\n`;
        htmlContent += `
          <div class="msg-item ${msg.isOutgoing ? 'outgoing' : 'incoming'}">
            <span class="nick">${escapeHtml(msg.senderNick)}</span>
            <audio controls src="media/${fileName}"></audio>
            <span class="time">${timeStr}</span>
          </div>
        `;
      } else if (msg.type === "VIDEO" && (msg.videoBytes || msg.fileBytes)) {
        const fileName = `video_${i + 1}.mp4`;
        mediaFolder.file(fileName, msg.videoBytes || msg.fileBytes);
        txtContent += `[VIDEO: media/${fileName}]\n`;
        htmlContent += `
          <div class="msg-item ${msg.isOutgoing ? 'outgoing' : 'incoming'}">
            <span class="nick">${escapeHtml(msg.senderNick)}</span>
            <video controls src="media/${fileName}"></video>
            <span class="time">${timeStr}</span>
          </div>
        `;
      } else if (msg.type === "FILE" && msg.fileBytes) {
        const fileName = msg.fileName || `file_${i + 1}.bin`;
        mediaFolder.file(fileName, msg.fileBytes);
        txtContent += `[DOCUMENT: media/${fileName} (${formatFileSize(msg.fileSize || msg.fileBytes.byteLength)})]\n`;
        htmlContent += `
          <div class="msg-item ${msg.isOutgoing ? 'outgoing' : 'incoming'}">
            <span class="nick">${escapeHtml(msg.senderNick)}</span>
            <a href="media/${fileName}" download class="file-card">📄 ${escapeHtml(fileName)}</a>
            <span class="time">${timeStr}</span>
          </div>
        `;
      }
    }

    htmlContent += `
    </div>
  </div>
</body>
</html>
`;

    zip.file("chat_history.txt", txtContent);
    zip.file("chat.html", htmlContent);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerBrowserDownload(zipBlob, `Beam_Chat_${state.roomCode}_${Date.now()}.zip`);
    showToast("Chat exported successfully!", "success");

  } catch (err) {
    console.error("Export failed", err);
    showToast("Failed to generate ZIP archive", "error");
  }
}

// ============================================================================
// WIPE SCREEN & LEAVE ROOM
// ============================================================================

function leaveRoom() {
  const isSaved = isChannelSaved(state.roomCode);
  const promptText = isSaved
    ? "Leave room? Your saved channel history is securely stored on this device."
    : "Leave room and wipe memory? All unexported messages will be permanently destroyed.";

  if (confirm(promptText)) {
    if (state.client) {
      try {
        state.client.end(true);
      } catch (e) {}
    }

    if (state.activeAudio) {
      state.activeAudio.pause();
      state.activeAudio = null;
    }

    // Wipe sessionStorage completely if not saved
    if (!isSaved) {
      try {
        sessionStorage.removeItem("beam_session_room");
        sessionStorage.removeItem("beam_session_pin");
        sessionStorage.removeItem("beam_session_nick");
        sessionStorage.removeItem("beam_session_messages_" + state.roomCode);
      } catch (e) {}
    }

    // Reset address bar URL back to clean path without hash
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      window.location.hash = "";
    }

    // Completely wipe state in RAM
    state.roomCode = "";
    state.pin = "";
    state.secretKey = null;
    state.messages = [];

    // Clear DOM
    const container = document.getElementById("messages-container");
    if (container) container.innerHTML = "";

    // Switch back to lobby
    document.getElementById("view-chat").style.display = "none";
    document.getElementById("view-entry").style.display = "flex";

    const connectBtn = document.getElementById("btn-connect");
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
        CONNECT TO BEAM
      `;
    }

    initSavedChannelsUi();
    showToast(isSaved ? "Exited room (History saved in Saved Channels)" : "Memory wiped completely", "success");
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTextWithLinks(text) {
  const escaped = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return escaped.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">${url}</a>`;
  });
}

async function resizeImageToFit(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas conversion to blob failed"));
          return;
        }
        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
      }, "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  }, 3200);
}
