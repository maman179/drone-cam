import Camera from "../model/cameras.js";
import { spawn } from "child_process";
import { WebSocketServer } from "ws";

const ffmpegMap = new Map();   // simpan proses ffmpeg
const wsMap = new Map();       // simpan websocket server per kamera

export async function refreshFfmpegStreams(globalWSS) {
  const cameras = await Camera.find();

  const dbIds = cameras.map(c => String(c.id));
  const runningIds = [...ffmpegMap.keys()].map(String);

  // 1️⃣ Hentikan kamera yang dihapus
  runningIds.forEach(id => {
    if (!dbIds.includes(id)) {
      console.log(`🛑 Kamera ID ${id} dihapus → stop ffmpeg`);
      stopStream(id);
    }
  });

  // 2️⃣ Start kamera baru atau yang berubah
  cameras.forEach(cam => {
    const camId = String(cam.id);

    const alreadyRunning = ffmpegMap.has(camId);

    if (!alreadyRunning) {
      console.log(`▶️ Start stream baru untuk kamera ${camId}`);
      startStream(cam, globalWSS);
      return;
    }
  });
}

export function startStream(cam, globalWSS) {
  const camId = String(cam.id);
  const rtspUrl = cam.rtsp;

  const ff = spawn("ffmpeg", [
    "-rtsp_transport", "tcp",
    "-i", rtspUrl,
    "-f", "mjpeg",
    "-q:v", "5",
    "pipe:1"
  ]);

  ffmpegMap.set(camId, ff);

  ff.stdout.on("data", chunk => {
    const wss = wsMap.get(camId);
    if (!wss) return;
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(chunk);
    });
  });

  ff.stderr.on("data", d => {
    console.log(`[ffmpeg ${camId}]`, d.toString());
  });

  ff.on("close", () => {
    console.log(`❌ ffmpeg untuk kamera ${camId} mati`);
    ffmpegMap.delete(camId);
  });

  // WebSocket untuk kamera ini
  const wss = new WebSocketServer({ noServer: true });
  wsMap.set(camId, wss);

  // router untuk upgrade websocket
  globalWSS.on("upgrade", (req, socket, head) => {
    if (req.url === `/stream/${camId}`) {
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws, req);
      });
    }
  });
}

export function stopStream(id) {
  const camId = String(id);

  if (ffmpegMap.has(camId)) {
    try {
      ffmpegMap.get(camId).kill("SIGKILL");
    } catch {}
    ffmpegMap.delete(camId);
  }

  if (wsMap.has(camId)) {
    const wss = wsMap.get(camId);
    wss.clients.forEach(c => c.close());
    wsMap.delete(camId);
  }
}
