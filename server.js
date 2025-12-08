import express from "express";
import Swal from "sweetalert2";
import mongoose from "mongoose";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import connectDB from "./utils/db.js";
import Camera from "./model/cameras.js";
import User from "./model/users.js";
import Streaming from "./model/streamings.js";
import Group from "./model/groups.js";
import getNextSequence from "./helpers/getNextSequence.js";
import { refreshFfmpegStreams } from "./helpers/ffmpegManagerX.js";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import expressLayouts from "express-ejs-layouts";
import methodOverride from "method-override";
import { body, validationResult, check } from "express-validator";
import os from "os";
import onvif from "node-onvif";
import { title } from "process";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import session from "express-session";
import dotenv from "dotenv";
import streaming from "./model/streamings.js";
dotenv.config(); // load .env

// 🔹 Inisialisasi Express
const app = express();

// 🔹 Koneksi ke MongoDB
connectDB();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Config flash message
app.use(cookieParser("secret"));
app.use(
  session({
    cookie: { 
      maxAge: 1000 * 60 * 60,
      secure : false
   },
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);

app.use(flash());
app.use("/hls", express.static("public/hls"));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.set("view engine", "ejs"); // 🔹 perbaiki 'view engines' → 'view engine'
app.use(expressLayouts);
app.use(express.static("public"));
app.set("layout", "layouts/main-layouts");

// ====== AUTH MIDDLEWARE ======
function authRequired(req, res, next) {
  if (!req.session.user) 
    return res.redirect("/login");
  next();
}

//Route Home.ejs
app.get("/", authRequired, async (req, res) => {
  try {
    const streams = await Streaming.find({
      userId: req.session.user.id
    }).populate({
    path: "groups",
    populate: { path: "cameras" }
  });

    res.render("home.ejs", {
      layout: "layouts/main-layouts.ejs",
      title: "Home",
      streams,
      user: req.session.user.username,
      msg1: req.flash("msg1"),
      msg2: req.flash("msg2"),
    });

    console.log("STREAMS:", streams);
    console.log("SESSION USER:", req.session.user);

  } catch (err) {
    console.error("ERROR HOME:", err);
    res.send("Internal server error");
  }
});


// app.get('/home', authRequired, async(req, res) => {
//  const groups = await Group.find({ userId: req.session.user.id })
//   .populate("cameras"); // biar kamera ikut tampil
//    res.render("home.ejs", {
//     layout: "layouts/main-layouts.ejs",
//     title: "Home",
//     groups,
//     user: req.session.user.username,
//     msg: req.flash("msg")
//   });
//   console.log(groups);
//   console.log("SESSION USER:", req.session.user);
// })

app.get("/live", authRequired, async (req, res) => {
  const cameras=await Camera.find({account : req.session.user.username});
  res.render('index.ejs', {
    layout:"layouts/main-layouts.ejs",
    title:"Live Streaming",
    cameras,
    user: req.session.username
  });
})

app.get('/list', authRequired, async (req, res) => {
   const cameras=await Camera.find({account : req.session.user.username});
  //  await refreshFfmpegStreams(globalWSS);
   res.render('camera.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'Devices List',
     cameras,
     user: req.session.username, 
     msg: req.flash('msg'),
     error: req.flash('error'),
  });
})

app.get('/videos', authRequired, (req, res) => { 
  res.render('video.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'Directori Videos',
     user: req.session.username
  });
})

app.get('/about', authRequired, (req, res) => {
   res.render('about.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'About Us',
     user: req.session.username
  });
})


// 📁 Folder untuk menyimpan hasil rekaman
const RECORDS_DIR = path.join(__dirname, "records");

app.use('/records', express.static(RECORDS_DIR));

// STATIC FILES
app.use('/records', express.static(path.join(process.cwd(), 'records')));

// Pastikan folder "records" ada, kalau belum maka buat otomatis
function getUserRecordFolder(username) {
  const folder = path.join(RECORDS_DIR, username);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}
  
// Fungsi untuk parse RTSP URL
function parseRtsp(rtspUrl) {
  try {
    const u = new URL(rtspUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: parseInt(u.port) || 554,
      path: u.pathname,
      segments: parts,
      streamType: parts[0] || null,
      streamName: parts[1] || null,
      username: u.username || null,
      password: u.password || null,
    };
  } catch (err) {
    console.warn("Gagal parse RTSP:", rtspUrl);
    return null;
  }
}

async function loadCameras() {
  try {
    const cameras = await Camera.find();
    console.log("📸 Kamera dari database:", cameras);
    return cameras;
  } catch (err) {
    console.error("❌ Gagal load kamera dari database:", err);
    return [];
  }
}

// load Cameras
const cameras = await loadCameras();
const wssEvents = new WebSocketServer({ noServer: true });

// Keep maps
let ffmpegMap = {};   // FFmpeg per camera
let wssMap = {};      // WebSocketServer per camera
const recordMap = {};   // FFmpeg recorder per camera

export async function reloadFFmpeg() {
  console.log("♻️ Reloading FFmpeg pipelines...");

  // 1. stop semua ffmpeg lama
  for (const id in ffmpegMap) {
    try {
      console.log("⛔ Stopping FFmpeg for ID:", id);
      ffmpegMap[id].kill("SIGKILL");
    } catch (e) {}
  }

  ffmpegMap = {};
  wssMap = {};

  // 2. ambil kamera terbaru
  const cameras = await Camera.find().sort({ id: 1 });

  // 3. MULAI ulang pipeline untuk setiap kamera
  for (const cam of cameras) {
    startCameraPipeline(cam);
  }

  console.log("✅ Semua kamera di-reload");
}

// reload camera group
export async function reloadFFmpegByGroup(groupId) {
  console.log("♻️ Reloading FFmpeg pipelines for Group:", groupId);

  // 1. Ambil group + daftar cameraID nya
  const group = await Group.findById(groupId).populate("cameras");
  if (!group) {
    console.log("❌ Group not found");
    return;
  }

  // 2. Stop hanya kamera yang ada di group ini
  for (const cam of group.cameras) {
    const camId = cam._id.toString();
    if (ffmpegMap[camId]) {
      try {
        console.log("⛔ Stopping FFmpeg for camera:", camId);
        ffmpegMap[camId].kill("SIGKILL");
      } catch (e) {}
      delete ffmpegMap[camId];
    }
  }

  // 3. Start ulang pipeline hanya kamera dalam group
  for (const cam of group.cameras) {
    startCameraPipeline(cam);
    console.log("✅ Pipeline started for:", cam._id);
  }
}

// ============================================================
// 1 CAMERA = 1 FFmpeg + 1 WebSocketServer
// ============================================================
function startCameraPipeline(cam) {

  if (ffmpegMap[cam.id]) return; // sudah berjalan

  // BUAT WebSocketServer khusus kamera ini
  const wss = new WebSocketServer({ noServer: true });
  wssMap[cam.id] = wss;
  

  wss.on("connection", (ws) => {
    console.log(`🔌 Client terhubung ke kamera ${cam.id}`);
  });

  // FFmpeg → MJPEG
  const args = [
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-i", cam.rtsp1,
    "-an",
    "-f", "mjpeg",
    "-q:v", "5",
    "-r", "15",
    "-"
  ];

  console.log(`🎞️ Start FFmpeg ${cam.id}: ffmpeg ${args.join(" ")}`);

  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  ffmpegMap[cam.id] = ff;

  ff.stderr.on("data", d => {
    const s = d.toString();
    if (!s.includes("frame="))
      console.log(`[ffmpeg ${cam.id}]`, s.trim());
  });

  ff.on("close", () => {
    console.log(`⛔ FFmpeg kamera ${cam.id} berhenti`);
    delete ffmpegMap[cam.id];
  });

  // KIRIM FRAME HANYA KE CLIENT KAMERA INI
  ff.stdout.on("data", chunk => {
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        try { client.send(chunk); } catch(e) {}
      }
    });
  });
}

// Start semua kamera
cameras.forEach(cam => startCameraPipeline(cam));


// ============================================================
// HTTP Server + Upgrade WS
// ============================================================
const server = app.listen(PORT, () =>
  console.log(`Server running: http://localhost:${PORT}`)
);

server.on("upgrade", (req, socket, head) => {

  // Events WS
  if (req.url === "/events") {
    wssEvents.handleUpgrade(req, socket, head, ws => {
      wssEvents.emit("connection", ws, req);
    });
  }

  // Stream WS untuk kamera
  else if (req.url.startsWith("/stream/")) {
    const camId = req.url.split("/stream/")[1];

    if (wssMap[camId]) {
      wssMap[camId].handleUpgrade(req, socket, head, ws => {
        wssMap[camId].emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  else socket.destroy();
});

app.get("/start-record/:id", async (req, res) => {
  const id = req.params.id;

  // ambil info user login dari session
  const user = req.session.user;
  if (!user) return res.status(401).send("Unauthorized");

  const cam = await Camera.findOne({ id: id });
  if (!cam) return res.status(404).send("Camera not found");

  if (recordMap[id]) return res.status(400).send("Recording already running");

  // folder khusus user
  const userFolder = getUserRecordFolder(user.username);

  // file khusus user
  const filename = `record_${id}_${Date.now()}.ts`;
  const filepath = path.join(userFolder, filename);

  const args = [
    "-rtsp_transport", "tcp",
    "-i", cam.rtsp,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    filepath
  ];

  console.log(`🎥 Start recording ${cam.name} --> ${user.username}/${filename}`);

  const rec = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
  recordMap[id] = { proc: rec, file: filename, filepath, user: user.username };

  rec.stderr.on("data", d => {
    const line = d.toString();
    if (line.includes("frame=")) console.log(`[ffmpeg ${id}] ${line.trim()}`);
  });

  rec.on("close", (code, sig) => {
    console.log(`Recording ${cam.name} stopped (code=${code}, sig=${sig})`);
    delete recordMap[id];
  });
  res.json({ message: "Sedang merekam...", file: filename });
});


// API: stop recording
app.get("/stop-record/:id", (req, res) => {
  const id = req.params.id;
  const recObj = recordMap[id];
  if (!recObj) return res.status(400).send("Tidak ada proses rekaman");

  console.log(`🛑 Stop recording ${id}`);

  try {
    recObj.proc.stdin.write('q');
  } catch (err) {
    console.error("stdin write failed:", err);
    try {
      recObj.proc.kill("SIGINT");
    } catch (e) {}
  }

  recObj.proc.on("close", () => {
    const inputFile = recObj.filepath;
    const outputFile = inputFile.replace(".ts", ".mp4");

    console.log(`🎞️ Konversi ${inputFile} → ${outputFile}`);

    const conv = spawn("ffmpeg", [
      "-i", inputFile,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outputFile
    ]);

    conv.stderr.on("data", d => console.log(`[convert] ${d.toString().trim()}`));

    conv.on("close", (code) => {
      console.log(`✅ Konversi selesai (code=${code})`);
      res.json({
        message: "Rekaman selesai dan sudah dikonversi ke MP4",
        file: path.basename(outputFile)
      });
    });
  });
});


// ====== LOGIN ======
app.get("/login", (req, res) => {
  res.render("login.ejs", { 
    layout:"layouts/auth-layouts.ejs",
    title:"Login",
    cameras,
    user: req.session.username,
    msg:req.flash('msg1'), 
    error: req.flash('error') 
  });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: req.body.email });
  
  if (!user) {
    req.flash("error", "Email tidak terdftar, Silakan Registrasi");
    console.log('Email tidak terdaftar');
    return res.redirect("/login");
  } 

  const match = await bcrypt.compare(req.body.password, user.password);
  
  if (!match) {
    req.flash("error", "Password salah");
    console.log("Password salah");
    return res.redirect("/login");
  }

  // ✔ SET SESSION DISINI
  req.session.user = {
  id: user._id,
  username: user.username,
  email: user.email
};
  req.flash("msg1", `Selamat datang`, req.session.username);
  console.log("SESSION SET:", req.session);   // <-- CEK DISINI
  res.redirect("/");
});

// ====== REGISTER ======
app.get("/register", (req, res) => {
  res.render("register.ejs", {
    layout : "layouts/auth-layouts.ejs",
    title:"Registrasi",
    msg:req.flash('msg'),
    error: req.flash('error'), 
  });     
});
app.post("/register", [
  body('username').custom(async (value) => {
    const duplikat= await User.findOne({ username: value });
    if(duplikat) {
      throw new Error('Username sudah ada');
    }
    return true;
  }),

  body('email').custom(async (value) => {
    const duplikat= await User.findOne({ email: value });
    if(duplikat) {
      throw new Error('Email sudah terdaftar');
    }
    return true;
  }),
], async (req, res) => {

  const errors = validationResult(req);   // <--- ini yang dipakai

  if (!errors.isEmpty()) {
    return res.render("register.ejs", {
      layout: "layouts/auth-layouts.ejs",
      title: "Registrasi",
      errors: errors.array(),   // <--- kirim sebagai "errors"
      old: req.body             // <--- supaya input tetap terisi
    });
  }

  try {
    let hash = await bcrypt.hash(req.body.password, 10);
    await User.create({
      username: req.body.username,
      email:    req.body.email,
      password: hash,
    });

    req.flash("msg", "Registrasi sukses, silahkan login");
    res.redirect("/login");

  } catch (err) {
    req.flash("msg", "Gagal menyimpan data");
    res.redirect("/register");
  }
});

// ====== LOGOUT ======
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.log(err);
      return res.redirect('/');
    }
    res.clearCookie('connect.sid'); // Hapus cookie session
    res.redirect('/login');
  });
});




// ============================
// 🔍 SCAN Kamera dengan progress
// ============================
let scanning = false; // status global sementara
let scanProgress = 0;

app.get("/scan", async (req, res) => {
  if (scanning) 
  return res.json({ status: "busy" });

  scanning = true;
  scanProgress = 0;
  console.log("🔍 Memulai scan kamera ONVIF...");

  const username = "admin";
  const password = "admin123";

  try {
    const existingCameras = await Camera.find();
    const foundDevices = [];

    // Simulasi progress update tiap detik (selama 30 detik)
    const progressInterval = setInterval(() => {
      if (scanProgress < 100) {
        scanProgress += 100 / 30; // Naik tiap detik
      }
    }, 1000);

    const devices = await new Promise((resolve) => {
      const list = [];
      let finished = false;

      const start = onvif.startProbe()
        .then(devs => {
          if (Array.isArray(devs)) list.push(...devs);
        })
        .catch(err => console.warn("⚠️ startProbe error:", err.message));

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          console.log("⏱️ Timeout 30 detik tercapai, hentikan scan.");
          resolve(list);
        }
      }, 30000);

      start.finally(() => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve(list);
        }
      });
    });

    // console.log(`📸 Ditemukan ${devices.length} perangkat`);
    req.flash(`msg`,`Scan Complete, ditemukan ${devices.length} perangkat`);

    clearInterval(progressInterval);
    scanProgress = 100;

    // Proses hasil
    for (const cam of devices) {
      if (!cam.xaddrs || cam.xaddrs.length === 0) continue;

      let ipAddress = "unknown";
      try {
        const parsed = new URL(cam.xaddrs[0]);
        ipAddress = parsed.hostname;
      } catch {}
      const exist = await Camera.findOne({ account : req.session.user.username });
      if (exist) continue;

      const device = new onvif.OnvifDevice({
        xaddr: cam.xaddrs[0],
        user: username,
        pass: password,
      });

      try {
        await device.init();
        const info = device.getInformation();
        const profilesResponse = await device.services.media.getProfiles();
        const profiles = profilesResponse.data.GetProfilesResponse.Profiles;
        const profileToken1 = profiles[0].$.token;
        const profileToken2 = profiles[1].$.token;
        
        const uriResponse1 = await device.services.media.getStreamUri({
          ProfileToken: profileToken1,
          Protocol: "RTSP",
        }); 
        
        const uriResponse2 = await device.services.media.getStreamUri({
          ProfileToken: profileToken2,
          Protocol: "RTSP",
        }); 

        const uri = uriResponse1.data.GetStreamUriResponse.MediaUri.Uri;
        const uri1 = uriResponse2.data.GetStreamUriResponse.MediaUri.Uri;
        console.log (uri);
        console.log (uri1);

        let port = "unknown";
        let stream = "unknown";
        let rec ="unknown";
      try {
        const parsed1 = new URL(uri);// rekam
        const parsed2 = new URL(uri1);// streaming
        port = parsed1.port;
        rec = parsed1.pathname;
        stream = parsed2.pathname;
        
      } catch {}

        const rtspRecord = `rtsp://${username}:${password}@${ipAddress}:${port}${rec}`;
        const rtspPreview = `rtsp://${username}:${password}@${ipAddress}:${port}${stream}`;
        const account = req.session.user.username;
        const cameraId = await getNextSequence("cameraId");
        await new Camera({
          id: cameraId,
          name: cam.name || info.Model || "ONVIF Camera",
          ip: ipAddress,
          port: port,
          username,
          password,
          manufacturer: info.Manufacturer,
          model: info.Model,
          firmwareVersion: info.FirmwareVersion,
          serialNumber: info.SerialNumber,
          rtsp: rtspRecord,
          rtsp1: rtspPreview,
          account: account
        }).save();

        console.log(`✅ Simpan kamera baru: ${ipAddress}`);
      } catch (e) {
        console.warn(`⚠️ Gagal ambil info ${ipAddress}:`, e.message);
      }
    }

    scanning = false;
    // res.json({ status: "done" });
    const cameras=await Camera.find({account : req.session.user.username});
    await reloadFFmpeg();  
    res.render('camera.ejs', {
      layout: 'layouts/main-layouts.ejs',
      title: 'List Camera',
      msg: req.flash('msg'),
      error: req.flash('error'),
      cameras
    });
  } catch (err) {
    console.error("❌ Error scan:", err.message);
    scanning = false;
    res.status(500).json({ error: err.message });
  }
});

// Endpoint untuk progress polling
app.get("/scan-status", (req, res) => {
  res.json({ scanning : true, progress: 35 });
});

app.get('/add-streaming', async(req, res) => {
 const cameras = await Camera.find({ account: req.session.user.username });
  res.render('add-streaming.ejs',{
     layout: 'layouts/main-layouts.ejs',
     title:'Add-Streaming',
     cameras,
     user: req.session.username,
     msg:req.flash('msg')
  });
})

// app.post("/save-groups", async (req, res) => {
//   const { name, description, cameras } = req.body;
  
//   const group = new Group({
//     name,
//     description,
//     cameras: Array.isArray(cameras) ? cameras : [cameras],
//     userId: req.session.user.id   // <- gunakan ID user dari session
//   });

//   await group.save();
//   res.redirect("/");
// });

app.post("/save-streaming", async (req, res) => {
  const { name, location, groups } = req.body;

  // Filter nilai null / undefined / empty
  const groupsList = (Array.isArray(groups) ? groups : [groups])
    .filter(id => id && id.trim() !== "");

  const streaming = new Streaming({
    name,
    location,
    groups: groupsList,
    userId: req.session.user.id
  });

  await streaming.save();
  res.redirect("/");
});


app.delete("/stream/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // Hapus streaming
    const resultStream = await Streaming.deleteOne({ _id: id });

    if (resultStream.deletedCount === 0) {
      return res.status(404).json({ error: "Stream not found" });
    }

    // Hapus group yang terkait streaming ini
    await Group.deleteMany({ streamId: id });

    res.json({ success: true, message: "Stream and related groups deleted" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// tampil add-stream-group.ejs
app.get("/stream/:id/add-group", authRequired, async (req, res) => {
  const stream = await Streaming.findById(req.params.id);
  const cameras = await Camera.find({ account: req.session.user.username });

  res.render("streaming-detail.ejs", {
    stream,
    cameras,
    layout: "layouts/main-layouts.ejs",
    title: "Tambah Group",
    msg: req.flash('msg2'),
  });
   
});

app.post("/stream/:id/add-group", authRequired, async (req, res) => {
  try {
    const streamId = req.params.id;
    const { name, description, cameraIds } = req.body;

    // Pastikan cameraIds dalam bentuk array
    const camArray = Array.isArray(cameraIds) ? cameraIds : [cameraIds];

    // 1. Buat Group baru
    const newGroup = await Group.create({
      name,
      description,
      cameras: camArray,
      userId: req.session.user.id
    });

    // 2. Tambahkan Group ke Streaming
    await Streaming.findByIdAndUpdate(streamId, {
      $push: { groups: newGroup._id }
    });
    await reloadFFmpeg();
    req.flash("msg2", "Group berhasil dibuat dan kamera ditambahkan!");
    res.redirect(`/`);

  } catch (error) {
    console.error(error);
    req.flash("msg", "Terjadi kesalahan.");
    res.redirect(`/`);
  }
});

// End-point ADD Manual Camera
app.get('/camera/add-manual', (req, res) => {
  res.render('add-camera-manual.ejs', {
    layout: 'layouts/main-layouts.ejs',
    title: 'Add Camera',
    msg: req.flash('msg'),
    error: req.flash('error')
  });
});

// 🔹 Route tambah Camera-manual
app.post('/camera/add', [ 
  body('name').custom(async (value) => {
    const duplikat=await Camera.findOne({name : value });
    if(duplikat) {
      throw new Error('Camera Sudah ada');
    }
    return true;
  }),
  body('ip').custom(async (value) => {
    const duplikat=await Camera.findOne({ip : value });
    if(duplikat) {
      throw new Error('IP address sudah ada');
    }
    return true;
  }),
  
], async (req, res) => {
  try {
  const errors=validationResult(req);
  if(!errors.isEmpty()) {
    req.flash('error',"Camera Sudah ada");
    res.render('add-camera-manual.ejs', {
      layout: 'layouts/main-layouts.ejs',
      title: 'Add Camera',
      msg: req.flash('msg'),
      error: req.flash('error')
    });
  } else {
    // 🔹 Ambil data dari form
    const { name, ip, port, username, password, path_stream, path_rec } = req.body;

    // 🔹 Buat RTSP otomatis
    const rtsp1 = `rtsp://${username}:${password}@${ip}:${port}${path_stream}`;
    const rtsp = `rtsp://${username}:${password}@${ip}:${port}${path_rec}`;
    const id = await getNextSequence("cameraId");
    const account = req.session.user.username;

    // 🔹 Gabungkan jadi satu objek kamera
    const newCamera = { id, name, ip, port, username, password, rtsp, rtsp1, account };

    // 🔹 Simpan ke MongoDB
    const result = await Camera.insertMany([newCamera]);
    await reloadFFmpeg(); 
    req.flash('msg','Data Berhasil disimpan');
    res.redirect('/list');
  }
  } catch (error) {
    req.flash('error','Data Gagal disimpan');
  }
});

// ADD Camera via scan
app.get('/camera/add/:id', async (req, res) => {
  const camera=await Camera.findOne({name : req.params.id});
  if (!camera) {
    return res.status(404).send("Camera not found");
  }
  res.render('add-camera.ejs', {
    layout: 'layouts/main-layouts.ejs',
    title: 'Add Camera',
    camera
  });
});

// proses tambah data camera
app.post('/camera', [
  body('name').custom((value) => {
    const duplikat = cekDuplikat(value);
    if (duplikat) {
      throw new Error('Camera sudah ada');
    }
    return true;
  }),
  body('ip').custom((value) => {
    const duplikat = cekDuplikatip(value);
    if (duplikat) {
      throw new Error('IP camera sudah ada');
    }
    return true;
  })
  ],(req, res) => {
 const errors = validationResult(req);
  if (!errors.isEmpty()) {
   req.flash('error', 'Camera Sudah Ada');
    res.redirect('/list');
  } else {
    // 🔹 Ambil data dari form
    const { id_camera, protocol, rec, preview, name, ip, port, username, password, SerialNumber, FirmwareVersion } = req.body;

    // 🔹 Buat format RTSP otomatis
       
    const rtsp = `${protocol}://${username}:${password}@${ip}:${port}${rec}`;
    const rtsp1 = `${protocol}://${username}:${password}@${ip}:${port}${preview}`;

    // 🔹 Gabungkan jadi satu objek camera
    const newCamera = {id_camera, name, ip, username, password, SerialNumber, FirmwareVersion, rtsp, rtsp1};

    // 🔹 Simpan data ke JSON / DB
    addCamera(newCamera);

    req.flash('msg', 'Data kamera berhasil disimpan!');
    res.redirect('/list');
  }
});

//halaman Ubah data Camera
app.get('/camera/edit/:name', async (req,res)=>{
const camera=await Camera.findOne({name : req.params.name});
  res.render('edit-camera.ejs',{
    layout: 'layouts/main-layouts.ejs',
    title:'Edit Data Camera',
    camera
  });
});

//proses ubah data camera
app.put('/camera/update',
[ 
  body('name').custom(async(value,{req}) => {
    const duplikat=await Camera.findOne({name : value});
    if(value !== req.body.oldNama && duplikat) {
      throw new Error('Nama Camera Sudah ada');
    }
    return true;
  }),
  body('ip').custom(async (value, { req }) => {
  const duplikat = await Camera.findOne({ ip: value });
  if (value !== req.body.oldIp && duplikat) {
    throw new Error('IP Camera sudah ada!');
  }
  return true;
}),
], async (req,res)=>{
  const errors=validationResult(req);
  if(!errors.isEmpty()) {
    res.render('edit-camera.ejs', {
      title : 'Form Edit Data Camera',
      layout: 'layouts/main-layouts.ejs',
      errors: errors.array(),
      camera: req.body,
    });
  } else {
  try {
    const { name, ip, port, username, password } = req.body;

    // 🔹 Buat ulang RTSP otomatis
    const rtsp1 = `rtsp://${username}:${password}@${ip}:${port}/tcp/av0_1`;
    const rtsp = `rtsp://${username}:${password}@${ip}:${port}/tcp/av0_0`;

    // 🔹 Update data di MongoDB
    await Camera.findByIdAndUpdate(req.body._id, {
      name,
      ip,
      port,
      username,
      password,
      rtsp,
      rtsp1,
    });
    await reloadFFmpeg();   
    req.flash("msg", "Data Kamera Berhasil Diperbarui!");
    res.redirect("/live");
  } catch (error) {
    req.flash("error", "Gagal update kamera: " + error.message);
    res.redirect("/live");
  }
  }
});

app.delete("/camera/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await Camera.deleteOne({ id: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Camera not found" });
    }

    await reloadFFmpeg();
    res.json({ success: true, message: "Camera deleted" });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// camera berdasarkan stream
app.get("/api/stream/:streamId/cameras", async (req, res) => {
  try {
    const userId = req.session.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const stream = await Streaming.findOne({ _id: req.params.streamId, userId })
      .populate({
        path: "groups",
        populate: { path: "cameras" }
      });

    if (!stream) return res.status(404).json({ error: "Streaming not found" });

    // ✅ Ambil semua cameras dari tiap group dalam stream ini
    const cameras = stream.groups.flatMap(g => g.cameras);
    return res.json(cameras);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// preview camera streaming + group
app.get("/stream/:streamId/preview", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const streamId = req.params.streamId;
    const userId = req.session.user.id;

    const stream = await Streaming.findOne({ _id: streamId, userId: userId })
      .populate({
        path: "groups",
        populate: { path: "cameras" }
      });

    if (!stream) {
      return res.render("preview-stream", {
        layout: "layouts/main-layouts",
        title: "Preview Stream",
        stream: null,
        error: "Stream tidak ditemukan"
      });
    }

    // 🔥 TIDAK reload ffmpeg di sini, biarkan 1 pipeline per kamera
    res.render("preview-stream", {
      layout: "layouts/main-layouts",
      title: "Preview Stream",
      stream,
      error: null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// view data group dalam streaming
app.get("/view/:id", async (req, res) => {
  const Stream = await Streaming.findById(req.params.id);
  res.render("view-streaming", {
        layout: "layouts/main-layouts",
        title: "Detail Group",
        Stream,
        msg: req.flash("msg")
      });
});

//hapus group dalam streaming
app.post("/view/group/delete/:streamId", async (req, res) => {
  const streamId = req.params.streamId;
  const groupId = req.body.groupId.trim();

  await Streaming.updateOne(
    { _id: streamId },
    { $pull: { groups: new mongoose.Types.ObjectId(groupId) } }
  );
  req.flash('msg','Group Berhasil dihapus');
  res.redirect("/view/" + streamId);
});


// hapus streaming 
app.delete("/stream/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const stream = await Streaming.findById(id).populate("groups");

    if (!stream) {
      return res.status(404).json({ error: "Stream tidak ditemukan" });
    }

    // hapus semua group yg ada dalam streaming ini
    for (const g of stream.groups) {
      await Group.deleteOne({ _id: g._id });
    }

    // hapus streaming nya
    await Streaming.deleteOne({ _id: id });

    res.json({ success: true });

  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});


// app.get("/api/cameras", async (req, res) => {
//   if (!req.session.user) {
//     return res.status(401).json({ error: "Unauthorized" });
//   }
//   const username = req.session.user.username;
//   const cameras = await Camera.find({ account: username });
//   res.json(cameras);
// });

// // cameras berdasarkan group
// app.get("/api/cameras", async (req, res) => {
//   if (!req.session.user) {
//     return res.status(401).json({ error: "Unauthorized" });
//   }

//   const userId = req.session.user.id;

//   // Ambil group milik user login & populate cameras
//   const groups = await Group.find({ userId }).populate("cameras");

//   let cameras = [];
//   groups.forEach(g => {
//     cameras.push(...g.cameras.map(cam => ({
//       ...cam.toObject(),
//       groupName: g.name // sisipkan nama group ke setiap kamera
//     })));
//   });

//   res.json(cameras);
// });


// API Download Videos
app.get("/download/:filename", (req, res) => {
  const file = req.params.filename;
  const filePath = path.join(RECORDS_DIR, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File tidak ditemukan" });
  }

  res.download(filePath, file, (err) => {
    if (err) {
      // Jangan kirim response kedua kali jika sudah dikirim sebelumnya
      if (!res.headersSent) {
        console.error("Gagal download:", err.message);
        return res.status(500).json({ error: "Gagal mengunduh file" });
      }
    }
  });
});

// Endpoint untuk mendapatkan daftar video
app.get("/api/videos", (req, res) => {
  const username = req.session.user.username;
  if (!username) {
    return res.status(401).json({ error: "not login" });
  }
  const userDir = path.join(RECORDS_DIR, username);
  if (!fs.existsSync(userDir)) {
    return res.json([]);
  }
  const files = fs.readdirSync(userDir)
    .filter(f => f.endsWith(".mp4"))
    .sort((a, b) => fs.statSync(path.join(userDir, b)).mtime - fs.statSync(path.join(userDir, a)).mtime);

  res.json(files);
});

// ✅ API untuk hapus file video
app.delete("/api/videos/:user/:file", (req, res) => {
  const loggedUser = req.session.user.username;
  const reqUser = req.params.user;

  // Cek jika user hanya boleh hapus punyanya sendiri
  if (loggedUser !== reqUser) {
    return res.status(403).json({ error: "forbidden" });
  }

  const filePath = path.join(RECORDS_DIR, reqUser, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlinkSync(filePath);
  res.json({ success: true });
});



app.get("/records/:user/:file", (req, res) => {
  const filePath = path.join(RECORDS_DIR, req.params.user, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }
  res.sendFile(path.resolve(filePath));
});


// halaman detail contact
app.get('/camera/:id', async(req, res) => {
  const camera= await Camera.findOne({ id : req.params.id })
   res.render('detail.ejs',{
     layout: 'layouts/main-layouts.ejs',
    title:'Detail Camera',
    camera
    });
})

// === Ambil IP Lokal ===
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
// === START SERVER ===
app.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`🚀 Server running at:`);
  console.log(` -> http://localhost:${PORT}`);
  console.log(` -> http://${ip}:${PORT}  (🌐 akses dari HP dalam satu WiFi)`);
});

}
