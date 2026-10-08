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

  const incomingCallPopup = $("incomingCallPopup");
  const popupIncomingNumberEl = $("popupIncomingNumber");
  const popupBtnAccept = $("popupBtnAccept");
  const popupBtnReject = $("popupBtnReject");

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
  const btnEnableAudio = $("btnEnableAudio");

  const navItems = document.querySelectorAll(".nav-item");
  const views = {
    phone: $("view-phone"),
    sms: $("view-sms"),
    bulk: $("view-bulk"),
    history: $("view-history"),
    developers: $("view-developers"),
  };
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

  const bulkBatchSizeLabelEl = $("bulkBatchSizeLabel");
  const bulkContactsFilterEl = $("bulkContactsFilter");
  const bulkContactsListEl = $("bulkContactsList");
  const bulkContactsCountEl = $("bulkContactsCount");
  const btnBulkLoadAll = $("btnBulkLoadAll");
  const bulkToEl = $("bulkTo");
  const bulkRecipientCountEl = $("bulkRecipientCount");
  const bulkMessageEl = $("bulkMessage");
  const bulkCharCountEl = $("bulkCharCount");
  const btnSendBulkSms = $("btnSendBulkSms");
  const bulkResultEl = $("bulkResult");
  const bulkProgressEl = $("bulkProgress");
  const bulkProgressFillEl = $("bulkProgressFill");
  const bulkProgressLabelEl = $("bulkProgressLabel");

  const developerView = $("view-developers");
  const developerApiBaseEl = $("developerApiBase");
  const developerMobileBaseEl = $("developerMobileBase");
  const developerMobileBaseTopEl = $("developerMobileBaseTop");
  const developerCodeEl = $("developerCode");
  const authTestCodeEl = $("authTestCode");
  const statusCodeEl = $("statusCode");

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
  let savedContacts = []; // [{id, name, phone, valid}], from /api/contacts
  let smsBulkMaxRecipients = 100; // overwritten from /api/config once it loads

  function initializeDeveloperDocs() {
    if (!developerView) return;
    const configuredApiBase = developerView.dataset.apiBase.trim();
    const apiBase = (configuredApiBase || `${window.location.origin}/sms-api/3rdparty/v1`).replace(/\/$/, "");
    const configuredMobileBase = developerView.dataset.mobileBase.trim();
    const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const mobileBase = configuredMobileBase || (localHost
      ? window.location.origin
      : `${window.location.protocol}//sms.${window.location.hostname}`);
    developerApiBaseEl.textContent = apiBase;
    developerMobileBaseEl.textContent = mobileBase.replace(/\/$/, "");
    developerMobileBaseTopEl.textContent = mobileBase.replace(/\/$/, "");
    statusCodeEl.textContent = `curl "${apiBase}/messages/MESSAGE_ID" \\\n+  -u "$SMS_API_USER:$SMS_API_PASSWORD"`;
    authTestCodeEl.textContent = `curl -i "${apiBase}/devices" \\\n+  -u "$SMS_API_USER:$SMS_API_PASSWORD"`;

    const snippets = {
      curl: `curl -X POST "${apiBase}/messages" \\\n+  -u "$SMS_API_USER:$SMS_API_PASSWORD" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"textMessage":{"text":"Hello from my app"},"phoneNumbers":["+251911234567"]}'`,
      javascript: `// Node.js server code. Keep credentials out of browser JavaScript.\nconst credentials = Buffer.from(\n  process.env.SMS_API_USER + ":" + process.env.SMS_API_PASSWORD\n).toString("base64");\n\nconst response = await fetch("${apiBase}/messages", {\n  method: "POST",\n  headers: {\n    Authorization: "Basic " + credentials,\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    textMessage: { text: "Hello from my JavaScript server" },\n    phoneNumbers: ["+251911234567"]\n  })\n});\n\nif (!response.ok) throw new Error(await response.text());\nconsole.log(await response.json());`,
      nextjs: `// app/api/send-sms/route.ts\nimport { NextResponse } from "next/server";\n\nexport async function POST(request: Request) {\n  const { phoneNumber, message } = await request.json();\n  const credentials = Buffer.from(\n    process.env.SMS_API_USER + ":" + process.env.SMS_API_PASSWORD\n  ).toString("base64");\n\n  const response = await fetch("${apiBase}/messages", {\n    method: "POST",\n    headers: {\n      Authorization: "Basic " + credentials,\n      "Content-Type": "application/json"\n    },\n    body: JSON.stringify({\n      textMessage: { text: message },\n      phoneNumbers: [phoneNumber]\n    })\n  });\n\n  const data = await response.json();\n  return NextResponse.json(data, { status: response.status });\n}`,
      sveltekit: `// src/routes/api/send-sms/+server.ts\nimport { json } from "@sveltejs/kit";\nimport { SMS_API_USER, SMS_API_PASSWORD } from "$env/static/private";\n\nexport async function POST({ request, fetch }) {\n  const { phoneNumber, message } = await request.json();\n  const credentials = btoa(SMS_API_USER + ":" + SMS_API_PASSWORD);\n\n  const response = await fetch("${apiBase}/messages", {\n    method: "POST",\n    headers: {\n      Authorization: "Basic " + credentials,\n      "Content-Type": "application/json"\n    },\n    body: JSON.stringify({\n      textMessage: { text: message },\n      phoneNumbers: [phoneNumber]\n    })\n  });\n\n  return json(await response.json(), { status: response.status });\n}`,
      python: `import os\nimport requests\n\nresponse = requests.post(\n    "${apiBase}/messages",\n    auth=(os.environ["SMS_API_USER"], os.environ["SMS_API_PASSWORD"]),\n    json={\n        "textMessage": {"text": "Hello from my app"},\n        "phoneNumbers": ["+251911234567"],\n    },\n    timeout=15,\n)\nresponse.raise_for_status()\nprint(response.json())`,
      php: `$payload = json_encode([\n  'textMessage' => ['text' => 'Hello from my app'],\n  'phoneNumbers' => ['+251911234567'],\n]);\n\n$ch = curl_init('${apiBase}/messages');\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_POSTFIELDS => $payload,\n  CURLOPT_HTTPHEADER => ['Content-Type: application/json'],\n  CURLOPT_USERPWD => getenv('SMS_API_USER') . ':' . getenv('SMS_API_PASSWORD'),\n  CURLOPT_RETURNTRANSFER => true,\n]);\n$response = curl_exec($ch);\nif (curl_getinfo($ch, CURLINFO_HTTP_CODE) !== 202) {\n  throw new RuntimeException($response);\n}\necho $response;`,
    };

    authTestCodeEl.textContent = authTestCodeEl.textContent.replace(/\n\+/g, "\n");
    statusCodeEl.textContent = statusCodeEl.textContent.replace(/\n\+/g, "\n");
    Object.keys(snippets).forEach((key) => {
      snippets[key] = snippets[key].replace(/\n\+/g, "\n");
    });

    function showSnippet(language) {
      developerCodeEl.textContent = snippets[language];
      document.querySelectorAll(".code-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.language === language);
      });
    }

    document.querySelectorAll(".code-tab").forEach((tab) => {
      tab.addEventListener("click", () => showSnippet(tab.dataset.language));
    });
    document.querySelectorAll(".copy-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = $(button.dataset.copyTarget);
        try {
          await navigator.clipboard.writeText(target.textContent);
          const original = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = original; }, 1400);
        } catch (_) {
          button.textContent = "Select and copy";
        }
      });
    });
    const docsLinks = Array.from(document.querySelectorAll(".docs-index a"));
    const docsSections = docsLinks.map((link) => $(link.hash.slice(1))).filter(Boolean);
    const docsObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      docsLinks.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
    }, { root: document.querySelector(".main"), rootMargin: "-15% 0px -65%", threshold: [0, 0.25, 0.6] });
    docsSections.forEach((section) => docsObserver.observe(section));
    showSnippet("curl");
  }

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
  let audioUnlocked = false;
  let toneGeneration = 0;

  // Browsers only allow sound after a user gesture. Any click or key press
  // primes audio, and the visible button lets an agent do this explicitly.
  async function unlockAudio() {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx.state === "suspended") await sharedAudioCtx.resume();
    audioUnlocked = sharedAudioCtx.state === "running";
    if (audioUnlocked && btnEnableAudio) {
      btnEnableAudio.classList.add("enabled");
      btnEnableAudio.innerHTML = '<span class="dot dot-green"></span> Call sounds enabled';
    }
    requestNotificationPermission();
    return audioUnlocked;
  }
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
  if (btnEnableAudio) btnEnableAudio.addEventListener("click", unlockAudio);

  // If the tab (or whole browser) is minimized/backgrounded when a call
  // comes in, the AudioContext itself keeps producing sound just fine —
  // browsers don't mute a tab that's actively playing audio — but a
  // suspended context (e.g. before the first user gesture on this page
  // load) needs resuming once we're back in the foreground.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
  });

  // ---------------------------------------------------------------------
  // Desktop notification — so a minimized/backgrounded browser still shows
  // "this number is calling" even though the in-page popup isn't visible.
  // ---------------------------------------------------------------------
  function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  let incomingCallNotification = null;

  function showIncomingCallNotification(peer) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      incomingCallNotification = new Notification("Incoming call", {
        body: `${peer} is calling`,
        icon: "static/img/favicon-64.png",
        tag: "incoming-call",
        requireInteraction: true,
        silent: true, // our own WebAudio ringtone is the sound; avoid doubling up
      });
      incomingCallNotification.onclick = () => {
        window.focus();
        closeIncomingCallNotification();
      };
    } catch (e) {
      console.warn("Failed to show incoming call notification", e);
    }
  }

  function closeIncomingCallNotification() {
    if (incomingCallNotification) {
      incomingCallNotification.close();
      incomingCallNotification = null;
    }
  }

  // ---------------------------------------------------------------------
  // Title flash — a visible "someone is calling" cue in the browser tab /
  // taskbar even when the window is minimized or another tab has focus.
  // ---------------------------------------------------------------------
  const originalDocumentTitle = document.title;
  let titleFlashInterval = null;

  function startTitleFlash(peer) {
    stopTitleFlash();
    const ringingLabel = `📞 Incoming: ${peer}`;
    let showRinging = true;
    document.title = ringingLabel;
    titleFlashInterval = setInterval(() => {
      showRinging = !showRinging;
      document.title = showRinging ? ringingLabel : originalDocumentTitle;
    }, 1000);
  }

  function stopTitleFlash() {
    if (titleFlashInterval) {
      clearInterval(titleFlashInterval);
      titleFlashInterval = null;
    }
    document.title = originalDocumentTitle;
  }

  async function startLocalTone(kind) {
    stopRingtone();
    const generation = toneGeneration;
    try {
      await unlockAudio();
    } catch (error) {
      console.warn("Browser blocked call audio", error);
      return;
    }
    if (!audioUnlocked || generation !== toneGeneration) return;

    const ctx = sharedAudioCtx;
    const incoming = kind === "incoming";
    const frequencies = incoming ? [440, 480] : [425];
    const onSeconds = incoming ? 2 : 1;
    const offSeconds = 4;
    const level = incoming ? 0.2 : 0.14;
    const cycleSeconds = onSeconds + offSeconds;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const oscillators = frequencies.map((frequency) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
      return oscillator;
    });

    function scheduleCycle(startTime) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(level, startTime + 0.025);
      gain.gain.setValueAtTime(level, startTime + onSeconds - 0.025);
      gain.gain.linearRampToValueAtTime(0, startTime + onSeconds);
    }

    // Schedule several minutes of ring cycles up front on the Web Audio
    // clock (not the main-thread timer). Chrome/Firefox throttle
    // setInterval in a minimized/backgrounded tab, which used to risk
    // skipped or delayed rings; pre-scheduling means the audio keeps
    // playing correctly on time even if the "topping up" timer below
    // itself runs late.
    const LOOKAHEAD_CYCLES = 20; // ~2 minutes of ring at the default cadence
    let scheduledUntil = ctx.currentTime + 0.03;
    for (let i = 0; i < LOOKAHEAD_CYCLES; i++) {
      scheduleCycle(scheduledUntil);
      scheduledUntil += cycleSeconds;
    }
    const timerId = setInterval(() => {
      while (scheduledUntil < ctx.currentTime + cycleSeconds * LOOKAHEAD_CYCLES) {
        scheduleCycle(scheduledUntil);
        scheduledUntil += cycleSeconds;
      }
    }, cycleSeconds * 1000);
    ringtoneNodes = { oscillators, gain, timerId, kind };
  }

  function startRingtone() { startLocalTone("incoming"); }
  function startRingback() { startLocalTone("ringback"); }

  function stopRingtone() {
    toneGeneration += 1;
    if (ringtoneNodes) {
      clearInterval(ringtoneNodes.timerId);
      try {
        const now = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;
        ringtoneNodes.gain.gain.cancelScheduledValues(now);
        ringtoneNodes.gain.gain.setValueAtTime(0, now);
        ringtoneNodes.oscillators.forEach((oscillator) => oscillator.stop());
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
  // Bulk SMS — same message to a large, freely-editable list of numbers.
  // Recipients and message both stay plain-text/editable right up until
  // Send; "saved contacts" only ever adds to that list, never locks it.
  // ---------------------------------------------------------------------
  async function loadContacts() {
    try {
      const res = await fetch("api/contacts");
      savedContacts = await res.json();
    } catch (e) {
      console.warn("Failed to load saved contacts", e);
      savedContacts = [];
    }
    renderContactsPicker();
  }

  function renderContactsPicker() {
    const filter = bulkContactsFilterEl.value.trim().toLowerCase();
    const visible = filter
      ? savedContacts.filter((c) => c.phone.toLowerCase().includes(filter))
      : savedContacts;

    bulkContactsCountEl.textContent = savedContacts.length ? `${savedContacts.length} saved` : "";

    if (!savedContacts.length) {
      bulkContactsListEl.innerHTML = `<div class="muted picker-empty">No saved contacts yet.</div>`;
      return;
    }
    if (!visible.length) {
      bulkContactsListEl.innerHTML = `<div class="muted picker-empty">No matches.</div>`;
      return;
    }

    bulkContactsListEl.innerHTML = "";
    visible.forEach((c) => {
      const row = document.createElement("div");
      row.className = c.valid ? "picker-row" : "picker-row invalid-row";

      const number = document.createElement("span");
      number.className = "picker-number";
      number.textContent = c.name ? `${c.name} — ${c.phone}` : c.phone;

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "picker-add-btn";
      addBtn.textContent = "+ Add";
      addBtn.addEventListener("click", () => addNumbersToBulkRecipients([c.phone]));

      row.append(number, addBtn);
      bulkContactsListEl.appendChild(row);
    });
  }

  function addNumbersToBulkRecipients(phones) {
    const existing = bulkToEl.value
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const merged = new Set(existing);
    phones.forEach((p) => merged.add(p));
    bulkToEl.value = Array.from(merged).join("\n");
    renderBulkRecipientSummary();
  }

  function parseBulkRecipients() {
    const tokens = bulkToEl.value
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

  function renderBulkRecipientSummary() {
    const recipients = parseBulkRecipients();
    const validCount = recipients.filter((r) => r.valid).length;
    const invalidCount = recipients.length - validCount;

    bulkRecipientCountEl.classList.toggle("hidden", recipients.length === 0);
    bulkRecipientCountEl.classList.toggle("has-invalid", invalidCount > 0);
    bulkRecipientCountEl.textContent =
      invalidCount > 0
        ? `${validCount} valid • ${invalidCount} invalid`
        : `${validCount} recipient${validCount === 1 ? "" : "s"}`;

    btnSendBulkSms.textContent = validCount > 0 ? `Send bulk SMS to ${validCount}` : "Send bulk SMS";
    return recipients;
  }

  function setBulkResult(message, ok) {
    bulkResultEl.textContent = message;
    bulkResultEl.className = `sms-result ${ok ? "ok" : "fail"}`;
  }

  function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }

  if (bulkToEl) bulkToEl.addEventListener("input", renderBulkRecipientSummary);
  if (bulkContactsFilterEl) bulkContactsFilterEl.addEventListener("input", renderContactsPicker);

  if (btnBulkLoadAll) {
    btnBulkLoadAll.addEventListener("click", () => {
      addNumbersToBulkRecipients(savedContacts.filter((c) => c.valid).map((c) => c.phone));
    });
  }

  if (bulkMessageEl) {
    bulkMessageEl.addEventListener("input", () => {
      bulkCharCountEl.textContent = bulkMessageEl.value.length;
    });
  }

  if (btnSendBulkSms) {
    btnSendBulkSms.addEventListener("click", async () => {
      const recipients = parseBulkRecipients();
      const validNumbers = recipients.filter((r) => r.valid).map((r) => r.e164);
      const invalidCount = recipients.length - validNumbers.length;
      const message = bulkMessageEl.value.trim();

      if (!validNumbers.length || !message) {
        setBulkResult("Add at least one valid number and a message.", false);
        return;
      }
      if (invalidCount > 0) {
        setBulkResult(`Fix or remove ${invalidCount} invalid number(s) first.`, false);
        return;
      }

      const batches = chunkArray(validNumbers, smsBulkMaxRecipients);
      btnSendBulkSms.disabled = true;
      bulkProgressEl.classList.remove("hidden");
      bulkProgressFillEl.style.transform = "scaleX(0)";
      setBulkResult("", true);

      let sentCount = 0;
      let failedBatches = 0;
      for (let i = 0; i < batches.length; i++) {
        bulkProgressLabelEl.textContent = `Sending batch ${i + 1} of ${batches.length} (${batches[i].length} numbers)…`;
        try {
          const res = await fetch("api/sms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: batches[i], message }),
          });
          const data = await res.json();
          if (res.ok && data.status === "sent") {
            sentCount += batches[i].length;
          } else {
            failedBatches += 1;
          }
        } catch (e) {
          failedBatches += 1;
        }
        bulkProgressFillEl.style.transform = `scaleX(${(i + 1) / batches.length})`;
      }
      bulkProgressLabelEl.textContent = "Done.";

      if (failedBatches === 0) {
        setBulkResult(
          `Sent to ${sentCount} recipients across ${batches.length} batch${batches.length === 1 ? "" : "es"}.`,
          true
        );
      } else {
        setBulkResult(
          `Sent to ${sentCount} recipients, but ${failedBatches} of ${batches.length} batch(es) failed — check the SMS tab's log for details.`,
          false
        );
      }

      btnSendBulkSms.disabled = false;
      setTimeout(() => bulkProgressEl.classList.add("hidden"), 1500);
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

    return candidates.find(isRealNumber) || "Unknown number";
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
  // Incoming call alert — the in-page popup, desktop notification, and
  // title flash all get shown together and torn down together.
  // ---------------------------------------------------------------------
  function showIncomingCallAlert(peer) {
    incomingNumberEl.textContent = peer;
    popupIncomingNumberEl.textContent = peer;
    incomingCallPopup.classList.remove("hidden");
    setStage("incoming");
    startRingtone();
    startTitleFlash(peer);
    if (document.hidden) showIncomingCallNotification(peer);
  }

  function hideIncomingCallAlert() {
    incomingCallPopup.classList.add("hidden");
    stopTitleFlash();
    closeIncomingCallNotification();
  }

  // If the agent switches to another browser tab (or minimizes the window)
  // partway through ringing, still surface a notification.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && sessionDirection === "inbound" && !incomingCallPopup.classList.contains("hidden")) {
      showIncomingCallNotification(sessionPeer);
    }
  });

  // ---------------------------------------------------------------------
  // Session wiring (shared between inbound and outbound calls)
  // ---------------------------------------------------------------------
  function attachSessionHandlers(session, direction, peer) {
    currentSession = session;
    sessionDirection = direction;
    sessionPeer = peer;

    session.on("peerconnection", (data) => {
      data.peerconnection.addEventListener("track", (event) => {
        // The PBX may provide real early media (carrier ringback or an
        // announcement). Prefer it over our locally generated ringback.
        if (direction === "outbound") stopRingtone();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch((error) => {
          console.warn("Remote call audio was blocked", error);
          if (btnEnableAudio) {
            btnEnableAudio.classList.remove("enabled");
            btnEnableAudio.innerHTML = '<span class="dot dot-yellow"></span> Enable call sounds';
          }
        });
      });
    });

    session.on("accepted", () => {
      stopRingtone();
      hideIncomingCallAlert();
      remoteAudio.play().catch(() => {});
      setStage("active");
      activeNumberEl.textContent = peer;
      startTimer();
    });

    session.on("confirmed", () => {
      stopRingtone();
      hideIncomingCallAlert();
      remoteAudio.play().catch(() => {});
      setStage("active");
      activeNumberEl.textContent = peer;
      if (!callStartedAt) startTimer();
    });

    session.on("failed", (e) => {
      stopRingtone();
      hideIncomingCallAlert();
      const elapsed = stopTimer();
      const status = direction === "inbound" ? "missed" : "failed";
      logCall(direction, peer, status, elapsed);
      resetToIdle();
    });

    session.on("ended", () => {
      stopRingtone();
      hideIncomingCallAlert();
      const elapsed = stopTimer();
      logCall(direction, peer, "answered", elapsed);
      resetToIdle();
    });
  }

  function resetToIdle() {
    currentSession = null;
    sessionDirection = null;
    sessionPeer = null;
    hideIncomingCallAlert();
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
    if (cfg.smsBulkMaxRecipients) {
      smsBulkMaxRecipients = cfg.smsBulkMaxRecipients;
      if (bulkBatchSizeLabelEl) bulkBatchSizeLabelEl.textContent = smsBulkMaxRecipients;
    }

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
        attachSessionHandlers(session, "inbound", peer);
        showIncomingCallAlert(peer);

        const acceptCall = () => {
          stopRingtone();
          hideIncomingCallAlert();
          session.answer({
            mediaConstraints: { audio: true, video: false },
            pcConfig: { iceServers: ICE_SERVERS },
          });
        };
        const rejectCall = () => {
          stopRingtone();
          hideIncomingCallAlert();
          session.terminate();
        };

        btnAccept.onclick = acceptCall;
        btnReject.onclick = rejectCall;
        popupBtnAccept.onclick = acceptCall;
        popupBtnReject.onclick = rejectCall;
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
    startRingback();

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
      if (item.dataset.view === "bulk") loadContacts();
    });
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  setStage("idle");
  initializeDeveloperDocs();
  initSip().catch((e) => {
    console.error(e);
    setRegStatus("bad", `Setup failed: ${e.message || e}`);
  });
})();
