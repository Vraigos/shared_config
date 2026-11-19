// Cloudflare Worker: holds the GitHub token server side.
// It only ever CREATES files (never sends a sha), so GitHub itself refuses overwrites.
// It has no delete or update code path at all.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const reply = (status, message) =>
      new Response(JSON.stringify({ message }), {
        status,
        headers: { ...cors, "Content-Type": "application/json" }
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return reply(405, "post only");
    if (req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return reply(403, "origin not allowed");

    let body;
    try { body = await req.json(); } catch { return reply(400, "bad json"); }

    const { name, content } = body || {};
    if (typeof name !== "string" || !NAME_RE.test(name) || name.includes("..")) {
      return reply(400, "bad file name");
    }
    if (typeof content !== "string" || !content.length || !B64_RE.test(content)) {
      return reply(400, "bad content");
    }
    if (content.length > Math.ceil(MAX_BYTES * 4 / 3)) return reply(413, "file too big");

    const url = "https://api.github.com/repos/" + env.OWNER + "/" + env.REPO +
      "/contents/uploads/" + encodeURIComponent(name);

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + env.GITHUB_TOKEN,
        Accept: "application/vnd.github+json",
        "User-Agent": "gh-pages-uploader",
        "Content-Type": "application/json"
      },
      // no sha on purpose: GitHub rejects this if the file already exists
      body: JSON.stringify({ message: "upload " + name, content, branch: env.BRANCH })
    });

    if (res.status === 201) return reply(201, "uploaded");
    if (res.status === 422 || res.status === 409) return reply(409, "file already exists");
    return reply(502, "github error " + res.status);
  }
};
