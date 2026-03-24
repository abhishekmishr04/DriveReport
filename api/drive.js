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

  console.log("Incoming body:", req.body);

  let { fileName, fileBase64 } = req.body || {};

  // ✅ fallback support (VERY IMPORTANT FIX)
  // if frontend accidentally sends "data" instead of fileBase64
  if (!fileBase64 && req.body?.data) {
    console.log("Using fallback: data → fileBase64");
    fileBase64 = req.body.data;
  }

  if (!fileName) {
    fileName = "DSR-Report.xlsx"; // default name
  }

  if (!fileBase64) {
    return res.status(400).json({
      error: "fileBase64 missing",
      received: req.body
    });
  }

  let buffer;

  try {
    // ✅ handle both pure base64 and data URL
    const base64Data = fileBase64.includes("base64,")
      ? fileBase64.split("base64,")[1]
      : fileBase64;

    buffer = Buffer.from(base64Data, "base64");

    if (!buffer || buffer.length === 0) {
      throw new Error("Empty buffer");
    }

  } catch (e) {
    return res.status(400).json({
      error: "Invalid base64 format",
      details: e.message
    });
  }

  // Step 1: metadata
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
    return res.status(500).json({
      error: "Metadata creation failed",
      metaData
    });
  }

  // Step 2: upload
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
    const errText = await uploadRes.text();
    return res.status(500).json({
      error: "Upload failed",
      details: errText
    });
  }

  return res.status(200).json({
    success: true,
    fileId: metaData.id
  });
}
