# SMS API documentation

Use the SMS API to send messages from any server-side application through your own Android phone and SIM card.

## Production endpoints

| Purpose | URL |
| --- | --- |
| REST API | `https://ethiotelecom.zmichael.click/sms-api/3rdparty/v1` |
| Android phone registration | `https://sms.ethiotelecom.zmichael.click` |

The registration URL is entered in the Android application. The REST API URL is used by your backend.

## How it works

1. Your backend submits an authenticated REST request.
2. The platform validates and queues the message.
3. The registered Android phone receives the job.
4. The phone sends the SMS through its own SIM and carrier.

The platform does not charge an API fee. The SIM owner is responsible for carrier fees, carrier limits, recipient consent, and local messaging laws. Recipients see the SIM number as the sender.

## Quick start

### 1. Install and register the Android phone

Install [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway/releases). Select **Cloud Server** and enter `https://sms.ethiotelecom.zmichael.click`. Allow SMS permission and exclude the application from Android battery optimization.

### 2. Save the generated credentials

On first registration the server returns a generated `login` and `password`. The login is usually a six-character uppercase ID. It is not the SIM phone number.

```env
SMS_API_BASE=https://ethiotelecom.zmichael.click/sms-api/3rdparty/v1
SMS_API_USER=YOUR_GENERATED_LOGIN
SMS_API_PASSWORD=YOUR_GENERATED_PASSWORD
```

Keep these values on your backend. Never include them in browser JavaScript, a public Git repository, or a client-side environment variable.

### 3. Verify authentication

```bash
curl -i "$SMS_API_BASE/devices" \
  -u "$SMS_API_USER:$SMS_API_PASSWORD"
```

HTTP `200` confirms the credentials. HTTP `401` means the Basic authorization header is missing or the credentials are incorrect.

### 4. Send a message

```bash
curl -X POST "$SMS_API_BASE/messages" \
  -u "$SMS_API_USER:$SMS_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"textMessage":{"text":"Hello from my application"},"phoneNumbers":["+251911234567"]}'
```

A valid request returns HTTP `202 Accepted`. This means the message was queued; it does not yet guarantee carrier delivery.

## Authentication

The API accepts HTTP Basic authentication and scoped JWT bearer tokens. Basic authentication is the simplest option for a private server-to-server integration.

```http
Authorization: Basic base64(login:password)
```

Use the generated registration `login` and `password`. Do not use the SIM phone number, phone device token, private registration token, or call-center login.

For production systems with multiple services, exchange Basic credentials for a short-lived JWT using `POST /auth/token`. Sending requires `messages:send`; reading a status requires `messages:read`.

## Send a message

`POST /messages`

### Request headers

| Header | Required | Value |
| --- | --- | --- |
| `Authorization` | Yes | Basic credentials or Bearer token |
| `Content-Type` | Yes | `application/json` |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `phoneNumbers` | `string[]` | Yes | Recipients in E.164 format, such as `+251911234567` |
| `textMessage.text` | `string` | Yes | SMS message content |
| `deviceId` | `string` | No | Selects one phone; otherwise an eligible device is selected |
| `simNumber` | `integer` | No | Selects a SIM slot on a dual-SIM phone |
| `withDeliveryReport` | `boolean` | No | Requests a carrier delivery report when supported |
| `scheduleAt` | RFC 3339 datetime | No | Schedules the message for a future time |
| `ttl` | `integer` | No | Message lifetime in seconds |
| `id` | `string` | No | Caller-supplied idempotency identifier |

### Minimal request

```json
{
  "textMessage": {"text": "Your verification code is 482913"},
  "phoneNumbers": ["+251911234567"]
}
```

### Multiple recipients

```json
{
  "textMessage": {"text": "The office will close at 4 PM today."},
  "phoneNumbers": ["+251911234567", "+251922345678"],
  "withDeliveryReport": true
}
```

## Message status

`GET /messages/{id}`

```bash
curl "$SMS_API_BASE/messages/MESSAGE_ID" \
  -u "$SMS_API_USER:$SMS_API_PASSWORD"
```

The response includes the message `id`, selected `deviceId`, processing `state`, timestamps, and content when available.

## List messages

`GET /messages` supports `from`, `to`, `state`, `deviceId`, `limit`, `offset`, `includeContent`, and `sort` query parameters.

```bash
curl "$SMS_API_BASE/messages?limit=20&sort=-created_at" \
  -u "$SMS_API_USER:$SMS_API_PASSWORD"
```

## Devices

`GET /devices` returns only the phones registered to the authenticated account. Use it to test credentials and obtain a `deviceId`.

## Cancel a message

`DELETE /messages/{id}` cancels a message only while it is pending.

## Error reference

| Status | Meaning | Recovery |
| --- | --- | --- |
| `400` | Invalid JSON, content, or phone number | Validate the body and use E.164 numbers |
| `401` | Missing or incorrect credentials | Use the generated registration `login` and `password` |
| `403` | JWT lacks the required scope | Issue a token with the appropriate scope |
| `404` | Message or device not found | Verify the ID and authenticated account |
| `409` | Supplied message ID already exists | Reuse the result or send with a new ID |
| `429` | Request limit exceeded | Retry later with exponential backoff |
| `503` | No eligible online device or queue capacity | Bring the phone online and retry with backoff |

## Framework integration

The in-app **Developers** documentation includes copy-ready examples for cURL, server-side JavaScript, Next.js, SvelteKit, Python, and PHP. Next.js and SvelteKit integrations use server routes so API credentials never enter the browser bundle.

## Production checklist

- Store credentials in server-side environment variables.
- Validate E.164 numbers before sending.
- Protect and rate-limit your own public endpoints.
- Save the returned message ID and monitor its state.
- Retry temporary network and `503` failures with exponential backoff.
- Keep the Android phone connected and exempt from battery optimization.
- Monitor carrier balance and sending limits.
- Send only to recipients who consented.
