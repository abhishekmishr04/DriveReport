
export const config = {
  runtime: 'nodejs'
};
const SA_EMAIL = process.env.SA_EMAIL;
const SA_KEY = process.env.SA_KEY;
const FOLDER_ID = process.env.FOLDER_ID;
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API= "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// CORS headers
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).json({});
  }

  // Set CORS headers on every response
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const action = req.query.action;

  try {
    if (action === "health") {
      return res.status(200).json({ status: "ok", folder: FOLDER_ID });
    }

    const token = await getToken();

    if (action === "list") {
      const q = encodeURIComponent(
        `'${FOLDER_ID}' in parents and mimeType='application/json' and trashed=false`
      );
      const r = await fetch(
        `${DRIVE_API}/files?q=${q}&orderBy=modifiedTime+desc&fields=files(id,name,modifiedTime,size)&pageSize=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === "save" && req.method === "POST") {
      const { fileName, data } = req.body;
      if (!fileName || !data) return res.status(400).json({ error: "fileName and data required" });

      const meta = JSON.stringify({ name: fileName, mimeType: "application/json", parents: [FOLDER_ID] });
      const cont = JSON.stringify(data);
      const bnd  = "dsr_boundary_2025";
      const body =
        `--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${bnd}\r\nContent-Type: application/json\r\n\r\n${cont}\r\n` +
        `--${bnd}--`;

      const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary="${bnd}"`
        },
        body
      });
      const result = await r.json();
      if (!result.id) return res.status(500).json({ error: "Save failed: " + JSON.stringify(result) });
      return res.status(200).json(result);
    }

    if (action === "load") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return res.status(500).json({ error: `Load failed ${r.status}` });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === "delete" && req.method === "POST") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await fetch(`${DRIVE_API}/files/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: "Unknown action: " + action });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function getToken() {
  const pem = SA_KEY.replace(/\\n/g, "\n");
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const raw = Buffer.from(b64, "base64");
  const { createSign } = await import("crypto");

  const now    = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({
    iss:   SA_EMAIL,
    sub:   SA_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600
  }));

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claims}`);
  const sig = sign.sign({ key: pem, format: "pem" }, "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const jwt = `${header}.${claims}.${sig}`;

  const resp = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const data = await resp.json();
  if (!data.access_token) throw new Error("Auth failed: " + JSON.stringify(data));
  return data.access_token;
}

function b64u(str) {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
