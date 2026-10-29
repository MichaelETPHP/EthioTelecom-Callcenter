const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../static/js/app.js'), 'utf8');
const iceCode = source.slice(source.indexOf('  function boundIceGathering('), source.indexOf('  // Incoming call alert'));

function setupIce() {
  const timers = new Map();
  let id = 0;
  const context = vm.createContext({
    setTimeout(fn, delay) { assert.equal(delay, 5000); timers.set(++id, fn); return id; },
    clearTimeout(key) { timers.delete(key); },
  });
  vm.runInContext(iceCode, context);
  const session = new EventEmitter();
  session.isEnded = () => false;
  context.boundIceGathering(session);
  return { session, timers };
}

test('blocked ICE server releases the SIP answer after five seconds, once', () => {
  const { session, timers } = setupIce();
  let sent = 0;
  const ready = () => { sent++; session.emit('sdp', { originator: 'local' }); };
  session.emit('icecandidate', { ready });
  session.emit('icecandidate', { ready });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(sent, 1);
  assert.equal(timers.size, 0);
});

for (const event of ['failed', 'ended', 'sdp']) {
  test(`${event} cancels pending ICE work`, () => {
    const { session, timers } = setupIce();
    session.emit('icecandidate', { ready() { assert.fail('stale answer'); } });
    session.emit(event, { originator: 'local' });
    assert.equal(timers.size, 0);
  });
}

// Exercise the actual incoming-session callback with a simulated SIP call.
const incomingCode = source.slice(source.indexOf('    ua.on("newRTCSession"'), source.indexOf('    ua.start();'));
function incomingCall(throws = false) {
  const session = {
    answers: 0, terminated: false,
    answer(options) { this.answers++; this.options = options; if (throws) throw Error('Microphone unavailable'); },
    isEnded() { return this.terminated; },
    terminate() { this.terminated = true; },
  };
  let handler;
  const context = vm.createContext({
    ua: { on(event, fn) { handler = fn; } },
    currentSession: null, currentCallId: null,
    crypto: { randomUUID: () => 'call-1' },
    iceServers: [{ urls: 'turn:relay.example:3478', username: 'agent', credential: 'test' }],
    resolveCallerId: () => '0912345678',
    attachSessionHandlers() {}, showIncomingCallAlert() {}, startHuntTimer() {},
    postToParentFrame() {}, toLocalPhoneFormat: p => p,
    clearHuntTimer() {}, stopRingtone() {}, stopTitleFlash() {}, closeIncomingCallNotification() {},
    setCallPhoneUrlParam() {}, hideCallError() {},
    popupBtnAccept: {}, popupBtnReject: {}, popupCallStatus: {},
    hideIncomingCallAlert() { assert.fail('Popup must remain visible until accepted'); },
    showCallError(message) { this.errorMessage = message; },
    resetToIdle() { this.reset = true; },
    handOffIncomingCall() {}, console: { error() {} },
  });
  // Arrow-free callbacks above do not rely on their receiver in the app.
  context.showCallError = message => { context.errorMessage = message; };
  context.resetToIdle = () => { context.reset = true; };
  vm.runInContext(incomingCode, context);
  handler({ originator: 'remote', session });
  return { session, context };
}

test('Answer passes the relay config and ignores duplicate clicks while connecting', () => {
  const { session, context } = incomingCall();
  context.popupBtnAccept.onclick();
  context.popupBtnAccept.onclick();
  assert.equal(session.answers, 1);
  assert.equal(session.options.pcConfig.iceServers[0].urls, 'turn:relay.example:3478');
  assert.equal(session.options.mediaConstraints.audio, true);
  assert.equal(context.popupBtnAccept.disabled, true);
  assert.match(context.popupCallStatus.textContent, /Answering/);
});

test('synchronous answer failure releases the SIP call and reports the error', () => {
  const { session, context } = incomingCall(true);
  context.popupBtnAccept.onclick();
  assert.equal(session.terminated, true);
  assert.equal(context.reset, true);
  assert.match(context.errorMessage, /Microphone unavailable/);
});
