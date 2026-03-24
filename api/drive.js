export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

const SA_EMAIL = process.env.SA_EMAIL;
const SA_KEY = process.env.SA_KEY;
const FOLDER_ID = process.env.FOLDER_ID;

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const action = req.query.action;

  try {
    if (action === "health") {
      return res.status(200).json({ status: "ok", folder: FOLDER_ID });
    }

    const token = await getToken();

    // ✅ SAVE EXCEL FILE
    if (action === "save" && req.method === "POST") {
      const { fileName, fileBase64 } = req.body;

      if (!fileName || !fileBase64) {
        return res.status(400).json({ error: "fileName and fileBase64 required" });
      }

      // Remove base64 prefix if present
      const base64Data = fileBase64.replace(/^data:.*;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // Step 1: Create file metadata
      const metadata = {
        name: fileName,
        parents: [FOLDER_ID],
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };

      const metaRes = await fetch(`${DRIVE_API}/files`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
      });

      const metaData = await metaRes.json();
      if (!metaData.id) {
        return res.status(500).json({ error: "Metadata creation failed", metaData });
      }

      // Step 2: Upload content
      const uploadRes = await fetch(
        `${UPLOAD_API}/files/${metaData.id}?uploadType=media`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
          body: buffer,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return res.status(500).json({ error: "Upload failed", details: err });
      }

      return res.status(200).json({ success: true, id: metaData.id });
    }

    // LIST FILES
    if (action === "list") {
      const q = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed=false`);
      const r = await fetch(
        `${DRIVE_API}/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // DELETE
    if (action === "delete" && req.method === "POST") {
      const { id } = req.body;
      await fetch(`${DRIVE_API}/files/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: "Unknown action" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// 🔐 TOKEN FUNCTION (same but safe)
async function getToken() {
  const pem = process.env.SA_KEY.replace(/\\n/g, "\n");

  const { createSign } = await import("crypto");

  const now = Math.floor(Date.now() / 1000);

  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claims}`);

  const signature = sign.sign(pem, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const jwt = `${header}.${claims}.${signature}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await resp.json();

  if (!data.access_token) {
    throw new Error("Auth failed: " + JSON.stringify(data));
  }

  return data.access_token;
}

function b64u(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
