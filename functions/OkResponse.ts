export function OkResponse() {
  return new Response(JSON.stringify('OK'),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
}

export function response(status, body) {
  return new Response(body || '', { status });
}