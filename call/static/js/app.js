(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const regStatusEl = $("regStatus");
  const serverLabelEl = $("serverLabel");
  const remoteAudio = $("remoteAudio");

  const stageIdle = $("stageIdle");
  const stageIncoming = $("stageIncoming");
  const stageActive = $("stageActive");
  const stageOutgoing = $("stageOutgoing");

  const incomingNumberEl = $("incomingNumber");
  const activeNumberEl = $("activeNumber");
  const outgoingNumberEl = $("outgoingNumber");
  const callTimerEl = $("callTimer");

  const btnAccept = $("btnAccept");
  const btnReject = $("btnReject");
  const btnHangup = $("btnHangup");
  const btnMute = $("btnMute");
  const btnHold = $("btnHold");
  const btnKeypad = $("btnKeypad");
  const btnCancelOutgoing = $("btnCancelOutgoing");
  const dtmfPad = $("dtmfPad");

  const dialInput = $("dialInput");
  const dialpad = document.querySelector(".dialpad");
  const btnClear = $("btnClear");
  const btnCall = $("btnCall");

  const btnAvailable = $("btnAvailable");
  const btnAway = $("btnAway");

  const navItems = document.querySelectorAll(".nav-item");
  const views = { phone: $("view-phone"), sms: $("view-sms"), history: $("view-history") };
  const callLogBody = $("callLogBody");

  const smsSenderLabelEl = $("smsSenderLabel");
  const smsToEl = $("smsTo");
  const smsRecipientCountEl = $("smsRecipientCount");
  const smsRecipientChipsEl = $("smsRecipientChips");
  const smsMessageEl = $("smsMessage");
  const smsCharCountEl = $("smsCharCount");
  const btnSendSms = $("btnSendSms");
  const smsResultEl = $("smsResult");
  const smsLogBody = $("smsLogBody");

  const pickerFilterEl = $("pickerFilter");
  const pickerListEl = $("pickerList");
  const pickerSelectAllEl = $("pickerSelectAll");
  const btnAddSelected = $("btnAddSelected");

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let ua = null;
  let currentSession = null;
  let callStartedAt = null;
  let timerInterval = null;
  let ringtoneNodes = null;
  let sessionDirection = null; // 'inbound' | 'outbound'
  let sessionPeer = null;

  const stages = { idle: stageIdle, incoming: stageIncoming, active: stageActive, outgoing: stageOutgoing };

  function setStage(name) {
    Object.entries(stages).forEach(([key, el]) => {
      if (key === name) {
        el.classList.remove("hidden");
        el.classList.remove("stage-visible");
        void el.offsetWidth; // force reflow so the transition below actually runs
        requestAnimationFrame(() => el.classList.add("stage-visible"));
      } else {
        el.classList.add("hidden");
        el.classList.remove("stage-visible");
      }
    });
  }

  function setRegStatus(state, label) {
    const dotClass = { ok: "dot-green", bad: "dot-red", pending: "dot-yellow" }[state] || "dot-gray";
    regStatusEl.innerHTML = `<span class="dot ${dotClass}"></span> ${label}`;
  }

  // ---------------------------------------------------------------------
  // Ringtone — classic two-tone telephone ring (440Hz + 480Hz),
  // 2s on / 4s off cadence. Generated with WebAudio, no asset needed.
  // ---------------------------------------------------------------------
  let sharedAudioCtx = null;

  // Browsers block audio until a user gesture; unlock a shared context on
  // the first click/tap anywhere so the ringtone can play automatically
  // the moment a real incoming call arrives later.
  function unlockAudio() {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  }
  ["click", "touchstart", "keydown"].forEach((evt) =>
    document.addEventListener(evt, unlockAudio, { once: true, passive: true })
  );

  const RING_ON = 2; // seconds
  const RING_OFF = 4; // seconds
  const RING_CYCLE = RING_ON + RING_OFF;

  function startRingtone() {
    stopRingtone();
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 440;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 480;
    osc1.connect(gain);
    osc2.connect(gain);
    osc1.start();
    osc2.start();

    // Schedule the on/off envelope ahead of time on the audio clock itself
    // (not setInterval) so the cadence stays precise and click-free.
    function scheduleCycle(startTime) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.03);
      gain.gain.setValueAtTime(0.18, startTime + RING_ON - 0.03);
      gain.gain.linearRampToValueAtTime(0, startTime + RING_ON);
    }

    let nextStart = ctx.currentTime + 0.05;
    scheduleCycle(nextStart);
    const timerId = setInterval(() => {
      nextStart += RING_CYCLE;
      scheduleCycle(nextStart);
    }, RING_CYCLE * 1000);

    ringtoneNodes = { osc1, osc2, gain, timerId };
  }

  function stopRingtone() {
    if (ringtoneNodes) {
      clearInterval(ringtoneNodes.timerId);
      try {
        ringtoneNodes.osc1.stop();
        ringtoneNodes.osc2.stop();
      } catch (e) {}
    }
    ringtoneNodes = null;
  }

  // ---------------------------------------------------------------------
  // Call timer
  // ---------------------------------------------------------------------
  function startTimer() {
    callStartedAt = Date.now();
    timerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - callStartedAt) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, "0");
      const s = String(secs % 60).padStart(2, "0");
      callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    const elapsed = callStartedAt ? Math.floor((Date.now() - callStartedAt) / 1000) : 0;
    callStartedAt = null;
    callTimerEl.textContent = "00:00";
    return elapsed;
  }

  // ---------------------------------------------------------------------
  // Call log
  // ---------------------------------------------------------------------
  async function logCall(direction, peer, status, durationSeconds) {
    try {
      await fetch("api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, peer, status, durationSeconds }),
      });
    } catch (e) {
      console.warn("Failed to log call", e);
    }
    if (!views.history.classList.contains("hidden")) loadCallHistory();
  }

  async function loadCallHistory() {
    try {
      const res = await fetch("api/calls");
      const rows = await res.json();
      if (!rows.length) {
        callLogBody.innerHTML = `<tr><td colspan="5" class="muted">No calls yet.</td></tr>`;
        return;
      }
      callLogBody.innerHTML = rows
        .map((r) => {
          const when = new Date(r.started_at).toLocaleString();
          const dur = `${String(Math.floor(r.duration_seconds / 60)).padStart(2, "0")}:${String(r.duration_seconds % 60).padStart(2, "0")}`;
          return `<tr>
            <td>${r.direction === "inbound" ? "⬇ Inbound" : "⬆ Outbound"}</td>
            <td>${r.peer}</td>
            <td>${r.status}</td>
            <td>${dur}</td>
            <td>${when}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      console.warn("Failed to load call history", e);
    }
  }

  // ---------------------------------------------------------------------
  // SMS — recipient picker (check callers from Call History, add them to
  // the "To" field below instead of typing numbers by hand)
  // ---------------------------------------------------------------------
  let callerDirectory = []; // [{ peer, lastContact }], most recent first, deduped
  const selectedCallers = new Set();

  async function loadCallerDirectory() {
    try {
      const res = await fetch("api/calls");
      const rows = await res.json();
      const seen = new Set();
      callerDirectory = [];
      for (const r of rows) {
        if (seen.has(r.peer)) continue;
        seen.add(r.peer);
        callerDirectory.push({ peer: r.peer, lastContact: r.started_at });
      }
      renderPickerList();
    } catch (e) {
      console.warn("Failed to load caller directory", e);
    }
  }

  function renderPickerList() {
    const filter = pickerFilterEl.value.trim().toLowerCase();
    const visible = filter ? callerDirectory.filter((c) => c.peer.toLowerCase().includes(filter)) : callerDirectory;

    if (!callerDirectory.length) {
      pickerListEl.innerHTML = `<div class="muted picker-empty">No callers yet.</div>`;
    } else if (!visible.length) {
      pickerListEl.innerHTML = `<div class="muted picker-empty">No matches.</div>`;
    } else {
      pickerListEl.innerHTML = "";
      visible.forEach((c) => {
        const row = document.createElement("label");
        row.className = "picker-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedCallers.has(c.peer);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedCallers.add(c.peer);
          else selectedCallers.delete(c.peer);
          updatePickerControls();
        });

        const number = document.createElement("span");
        number.className = "picker-number";
        number.textContent = c.peer;

        const when = document.createElement("span");
        when.className = "picker-when";
        when.textContent = new Date(c.lastContact).toLocaleDateString();

        row.append(checkbox, number, when);
        pickerListEl.appendChild(row);
      });
    }

    updatePickerControls();
  }

  function updatePickerControls() {
    const visibleCount = pickerListEl.querySelectorAll(".picker-row").length;
    const visibleChecked = pickerListEl.querySelectorAll(".picker-row input:checked").length;

    pickerSelectAllEl.checked = visibleCount > 0 && visibleChecked === visibleCount;
    pickerSelectAllEl.indeterminate = visibleChecked > 0 && visibleChecked < visibleCount;

    btnAddSelected.disabled = selectedCallers.size === 0;
    btnAddSelected.textContent = selectedCallers.size > 0 ? `Add selected (${selectedCallers.size})` : "Add selected";
  }

  if (pickerFilterEl) {
    pickerFilterEl.addEventListener("input", renderPickerList);
  }

  if (pickerSelectAllEl) {
    pickerSelectAllEl.addEventListener("change", () => {
      pickerListEl.querySelectorAll(".picker-row").forEach((row) => {
        const checkbox = row.querySelector("input");
        const peer = row.querySelector(".picker-number").textContent;
        checkbox.checked = pickerSelectAllEl.checked;
        if (pickerSelectAllEl.checked) selectedCallers.add(peer);
        else selectedCallers.delete(peer);
      });
      updatePickerControls();
    });
  }

  if (btnAddSelected) {
    btnAddSelected.addEventListener("click", () => {
      const existing = smsToEl.value.trim();
      const additions = Array.from(selectedCallers).join(", ");
      smsToEl.value = existing ? `${existing}, ${additions}` : additions;

      selectedCallers.clear();
      renderPickerList();
      renderRecipients();
    });
  }

  // ---------------------------------------------------------------------
  // SMS — recipients (single or bulk, same field)
  //
  // Same normalization rules as android_sms_gateway.py's _to_e164 on the
  // backend, mirrored here for instant feedback as the agent types/pastes
  // — the backend re-validates regardless, this is just UX, not the source
  // of truth.
  // ---------------------------------------------------------------------
  const SMS_BULK_MAX_RECIPIENTS = 100;

  function normalizeEthiopianNumber(raw) {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, "");

    if (trimmed.startsWith("+")) {
      return { raw: trimmed, e164: `+${digits}`, valid: digits.length >= 9 && digits.length <= 15 };
    }
    if (digits.startsWith("0") && digits.length === 10) {
      return { raw: trimmed, e164: `+251${digits.slice(1)}`, valid: true };
    }
    if (digits.startsWith("251") && digits.length === 12) {
      return { raw: trimmed, e164: `+${digits}`, valid: true };
    }
    return { raw: trimmed, e164: trimmed, valid: false };
  }

  function parseRecipients() {
    const tokens = smsToEl.value
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const seen = new Set();
    const recipients = [];
    for (const token of tokens) {
      const parsed = normalizeEthiopianNumber(token);
      const key = parsed.valid ? parsed.e164 : `!${parsed.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(parsed);
    }
    return recipients;
  }

  function renderRecipients() {
    const recipients = parseRecipients();
    const validCount = recipients.filter((r) => r.valid).length;
    const invalidCount = recipients.length - validCount;

    const showChips = recipients.length > 1 || invalidCount > 0;
    smsRecipientChipsEl.classList.toggle("hidden", !showChips);
    smsRecipientCountEl.classList.toggle("hidden", recipients.length <= 1 && invalidCount === 0);
    smsRecipientCountEl.classList.toggle("has-invalid", invalidCount > 0);

    if (recipients.length > 1 || invalidCount > 0) {
      smsRecipientCountEl.textContent =
        invalidCount > 0
          ? `${validCount} recipient${validCount === 1 ? "" : "s"} • ${invalidCount} invalid`
          : `${validCount} recipient${validCount === 1 ? "" : "s"}`;
    }

    if (showChips) {
      smsRecipientChipsEl.innerHTML = "";
      recipients.forEach((r, i) => {
        const chip = document.createElement("span");
        chip.className = `chip${r.valid ? "" : " invalid"}`;
        const label = document.createElement("span");
        label.textContent = r.valid ? r.e164 : r.raw;
        chip.appendChild(label);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove";
        removeBtn.addEventListener("click", () => {
          const remaining = parseRecipients().filter((_, idx) => idx !== i);
          smsToEl.value = remaining.map((r2) => r2.raw).join(", ");
          renderRecipients();
        });
        chip.appendChild(removeBtn);
        smsRecipientChipsEl.appendChild(chip);
      });
    }

    btnSendSms.textContent = validCount > 1 ? `Send to ${validCount}` : "Send SMS";

    return recipients;
  }

  if (smsToEl) {
    smsToEl.addEventListener("input", renderRecipients);
  }

  // ---------------------------------------------------------------------
  // SMS
  // ---------------------------------------------------------------------
  function setSmsResult(message, ok) {
    smsResultEl.textContent = message;
    smsResultEl.className = `sms-result ${ok ? "ok" : "fail"}`;
  }

  async function loadSmsLog() {
    try {
      const res = await fetch("api/sms");
      const rows = await res.json();
      if (!rows.length) {
        smsLogBody.innerHTML = `<tr><td colspan="4" class="muted">No messages sent yet.</td></tr>`;
        return;
      }
      smsLogBody.innerHTML = rows
        .map((r) => {
          const when = new Date(r.created_at).toLocaleString();
          const shortMsg = r.message.length > 60 ? r.message.slice(0, 60) + "…" : r.message;
          const recipients = r.to_number.split(",").map((n) => n.trim());
          const toCell =
            recipients.length > 1
              ? `<span title="${recipients.join(", ")}">${recipients.length} recipients</span>`
              : r.to_number;
          return `<tr>
            <td>${toCell}</td>
            <td>${shortMsg}</td>
            <td>${r.status === "sent" ? "✅ Sent" : "❌ Failed"}</td>
            <td>${when}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      console.warn("Failed to load SMS log", e);
    }
  }

  if (smsMessageEl) {
    smsMessageEl.addEventListener("input", () => {
      smsCharCountEl.textContent = smsMessageEl.value.length;
    });
  }

  if (btnSendSms) {
    btnSendSms.addEventListener("click", async () => {
      const recipients = parseRecipients();
      const validNumbers = recipients.filter((r) => r.valid).map((r) => r.e164);
      const message = smsMessageEl.value.trim();

      if (!validNumbers.length || !message) {
        setSmsResult("Enter at least one valid number and a message.", false);
        return;
      }
      if (recipients.length > validNumbers.length) {
        setSmsResult("Fix or remove the invalid number(s) highlighted above first.", false);
        return;
      }
      if (validNumbers.length > SMS_BULK_MAX_RECIPIENTS) {
        setSmsResult(`Too many recipients — max is ${SMS_BULK_MAX_RECIPIENTS} per send.`, false);
        return;
      }

      btnSendSms.disabled = true;
      setSmsResult(validNumbers.length > 1 ? `Sending to ${validNumbers.length}…` : "Sending…", true);
      try {
        const res = await fetch("api/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: validNumbers, message }),
        });
        const data = await res.json();
        if (res.ok && data.status === "sent") {
          setSmsResult(
            data.recipientCount > 1 ? `Queued to ${data.recipientCount} recipients.` : `Sent to ${validNumbers[0]}.`,
            true
          );
          smsToEl.value = "";
          smsMessageEl.value = "";
          smsCharCountEl.textContent = "0";
          renderRecipients();
        } else {
          setSmsResult(`Failed: ${data.detail || data.error || "unknown error"}`, false);
        }
      } catch (e) {
        setSmsResult(`Request failed: ${e.message}`, false);
      } finally {
        btnSendSms.disabled = false;
        loadSmsLog();
      }
    });
  }

  // ---------------------------------------------------------------------
  // DTMF pad
  // ---------------------------------------------------------------------
  function buildDtmfPad() {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
    dtmfPad.innerHTML = "";
    keys.forEach((k) => {
      const btn = document.createElement("button");
      btn.textContent = k;
      btn.addEventListener("click", () => {
        if (currentSession) currentSession.sendDTMF(k);
      });
      dtmfPad.appendChild(btn);
    });
  }
  buildDtmfPad();

  // ---------------------------------------------------------------------
  // Caller ID resolution
  //
  // Trunks commonly put "anonymous" (or a generic id like "s") in the SIP
  // From header while carrying the real calling number in a different
  // header. We check those in priority order before falling back to the
  // From header, so a genuinely-withheld number is the only case that
  // still shows as unknown.
  // ---------------------------------------------------------------------
  const NON_NUMBERS = new Set(["anonymous", "unknown", "unavailable", "restricted", "withheld", "s"]);

  function extractUserFromHeaderValue(value) {
    if (!value) return null;
    const match = value.match(/sip:([^@;>\s]+)|tel:([^;>\s]+)/i);
    return match ? match[1] || match[2] : null;
  }

  function getHeaderUser(request, name) {
    if (!request || typeof request.getHeader !== "function") return null;
    try {
      return extractUserFromHeaderValue(request.getHeader(name));
    } catch (e) {
      return null;
    }
  }

  function isRealNumber(candidate) {
    if (!candidate) return false;
    return !NON_NUMBERS.has(candidate.trim().toLowerCase());
  }

  function resolveCallerId(request, session) {
    const candidates = [
      getHeaderUser(request, "P-Asserted-Identity"),
      getHeaderUser(request, "Remote-Party-ID"),
      getHeaderUser(request, "Diversion"),
      session.remote_identity && session.remote_identity.uri && session.remote_identity.uri.user,
    ];

    const displayName = session.remote_identity && session.remote_identity.display_name;
    if (displayName && /^\+?[\d\s().-]{5,}$/.test(displayName.trim())) {
      candidates.push(displayName.trim());
    }

    return candidates.find(isRealNumber) || "Unknown / Withheld";
  }

  // ---------------------------------------------------------------------
  // ICE / NAT traversal
  //
  // Without a STUN server, WebRTC only gathers "host" ICE candidates (the
  // browser's private LAN address), which the PBX can't reach if the agent
  // is behind NAT. That produces one-way audio: the agent's outbound RTP
  // still gets out (it punches its own NAT hole once the agent talks), but
  // nothing lets the customer's inbound audio find its way back in, since
  // no reachable public candidate was ever offered. Used for BOTH outbound
  // calls and inbound answers - the two must match, or only one call
  // direction gets NAT traversal.
  // ---------------------------------------------------------------------
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  // ---------------------------------------------------------------------
  // Session wiring (shared between inbound and outbound calls)
  // ---------------------------------------------------------------------
  function attachSessionHandlers(session, direction, peer) {
    currentSession = session;
    sessionDirection = direction;
    sessionPeer = peer;

    session.on("peerconnection", (data) => {
      data.peerconnection.addEventListener("track", (event) => {
        remoteAudio.srcObject = event.streams[0];
      });
    });

    session.on("accepted", () => {
      stopRingtone();
      setStage("active");
      activeNumberEl.textContent = peer;
      startTimer();
    });

    session.on("confirmed", () => {
      stopRingtone();
      setStage("active");
      activeNumberEl.textContent = peer;
      if (!callStartedAt) startTimer();
    });

    session.on("failed", (e) => {
      stopRingtone();
      const elapsed = stopTimer();
      const status = direction === "inbound" ? "missed" : "failed";
      logCall(direction, peer, status, elapsed);
      resetToIdle();
    });

    session.on("ended", () => {
      stopRingtone();
      const elapsed = stopTimer();
      logCall(direction, peer, "answered", elapsed);
      resetToIdle();
    });
  }

  function resetToIdle() {
    currentSession = null;
    sessionDirection = null;
    sessionPeer = null;
    dtmfPad.classList.add("hidden");
    btnMute.classList.remove("active-state");
    btnHold.classList.remove("active-state");
    btnMute.textContent = "🎤 Mute";
    btnHold.textContent = "⏸ Hold";
    setStage("idle");
  }

  // ---------------------------------------------------------------------
  // JsSIP UA setup
  // ---------------------------------------------------------------------
  async function initSip() {
    if (new URLSearchParams(location.search).get("debug") === "1") {
      JsSIP.debug.enable("JsSIP:*");
    }

    const res = await fetch("api/config");
    const cfg = await res.json();

    serverLabelEl.textContent = cfg.server;
    if (smsSenderLabelEl) smsSenderLabelEl.textContent = cfg.smsSenderLabel;

    const socket = new JsSIP.WebSocketInterface(cfg.wsUrl);
    ua = new JsSIP.UA({
      sockets: [socket],
      uri: cfg.sipUri,
      authorization_user: cfg.authUser,
      password: cfg.password,
      display_name: cfg.displayName,
      register: true,
      session_timers: false,
    });

    window._ua = ua; // exposed for support/debugging (open console, inspect window._ua)

    ua.on("connecting", () => setRegStatus("pending", "Connecting…"));
    ua.on("connected", () => setRegStatus("pending", "Connected, registering…"));
    ua.on("disconnected", () => setRegStatus("bad", "Disconnected"));
    ua.on("registered", () => setRegStatus("ok", "Available"));
    ua.on("unregistered", () => setRegStatus("gray", "Unregistered"));
    ua.on("registrationFailed", (e) => setRegStatus("bad", `Registration failed: ${e.cause || ""}`));

    ua.on("newRTCSession", (data) => {
      const session = data.session;

      if (data.originator === "remote") {
        // Incoming call
        if (currentSession) {
          // Already on a call: politely reject the new one.
          session.terminate();
          return;
        }
        const peer = resolveCallerId(data.request, session);
        incomingNumberEl.textContent = peer;
        setStage("incoming");
        startRingtone();

        attachSessionHandlers(session, "inbound", peer);

        btnAccept.onclick = () => {
          session.answer({
            mediaConstraints: { audio: true, video: false },
            pcConfig: { iceServers: ICE_SERVERS },
          });
        };
        btnReject.onclick = () => {
          session.terminate();
        };
      }
    });

    ua.start();
  }

  // ---------------------------------------------------------------------
  // Outbound calling
  // ---------------------------------------------------------------------
  function placeCall(target) {
    if (!target) return;
    if (currentSession) return;

    const session = ua.call(target, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: ICE_SERVERS },
    });

    outgoingNumberEl.textContent = target;
    setStage("outgoing");
    attachSessionHandlers(session, "outbound", target);

    btnCancelOutgoing.onclick = () => session.terminate();
  }

  // ---------------------------------------------------------------------
  // UI events
  // ---------------------------------------------------------------------
  btnHangup.addEventListener("click", () => {
    if (currentSession) currentSession.terminate();
  });

  btnMute.addEventListener("click", () => {
    if (!currentSession) return;
    const muted = currentSession.isMuted().audio;
    if (muted) {
      currentSession.unmute({ audio: true });
      btnMute.classList.remove("active-state");
      btnMute.textContent = "🎤 Mute";
    } else {
      currentSession.mute({ audio: true });
      btnMute.classList.add("active-state");
      btnMute.textContent = "🎤 Muted";
    }
  });

  btnHold.addEventListener("click", () => {
    if (!currentSession) return;
    if (currentSession.isOnHold().local) {
      currentSession.unhold();
      btnHold.classList.remove("active-state");
      btnHold.textContent = "⏸ Hold";
    } else {
      currentSession.hold();
      btnHold.classList.add("active-state");
      btnHold.textContent = "▶ Resume";
    }
  });

  btnKeypad.addEventListener("click", () => {
    dtmfPad.classList.toggle("hidden");
  });

  dialpad.addEventListener("click", (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    dialInput.value += key;
  });

  btnClear.addEventListener("click", () => {
    dialInput.value = "";
  });

  btnCall.addEventListener("click", () => {
    placeCall(dialInput.value.trim());
  });

  dialInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") placeCall(dialInput.value.trim());
  });

  btnAvailable.addEventListener("click", () => {
    btnAvailable.classList.add("active");
    btnAway.classList.remove("active");
    if (ua && !ua.isRegistered()) ua.register();
  });

  btnAway.addEventListener("click", () => {
    btnAway.classList.add("active");
    btnAvailable.classList.remove("active");
    if (ua && ua.isRegistered()) ua.unregister();
  });

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      Object.values(views).forEach((v) => v.classList.add("hidden"));
      views[item.dataset.view].classList.remove("hidden");
      if (item.dataset.view === "history") loadCallHistory();
      if (item.dataset.view === "sms") {
        loadSmsLog();
        loadCallerDirectory();
      }
    });
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  setStage("idle");
  initSip().catch((e) => {
    console.error(e);
    setRegStatus("bad", `Setup failed: ${e.message || e}`);
  });
})();
