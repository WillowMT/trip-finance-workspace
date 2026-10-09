export interface Env {
  DB: D1Database;
}

const landingPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Trip finance workspace</title></head>
  <body>
    <main>
      <h1>Trip finance workspace</h1>
      <p>Create a workspace to share one editable finance ledger with your group.</p>
      <button type="button">Create shared workspace</button>
    </main>
  </body>
</html>`;

export default {
  fetch(request: Request, _env: Env, _ctx: ExecutionContext): Response {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(landingPage, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
