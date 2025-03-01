export function OkResponse(data: object | undefined) {
  return new Response(JSON.stringify(data || 'OK'),
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