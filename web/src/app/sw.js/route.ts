export function GET() {
  return new Response("", {
    headers: { "content-type": "application/javascript" },
  });
}

