export function OkResponse(data?: object | undefined) {
  return new Response(JSON.stringify(data || 'OK'),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
}

// Always emit JSON with an explicit Content-Type. A string body with no
// Content-Type defaults to `text/plain;charset=UTF-8` in the Workers runtime,
// which the Forge bridge (`invokeRemote`) rejects *before* reading the body —
// masking the real error behind a generic content-type complaint. Wrapping the
// message in JSON keeps every error response parseable by the client. The body
// is always a string today (callers pass status/error text); `{ error }` is the
// stable shape clients can read.
export function response(status, body) {
  return new Response(JSON.stringify({ error: body || '' }),
    {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
}