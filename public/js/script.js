  
async function init() {
  const res = await fetch(`/api/cameras?time=${Date.now()}`, { cache: "no-store" });
  const cams = await res.json();
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  cams.forEach(cam => {
    const card = document.createElement("div");
    card.className = "cam";

    card.innerHTML = `
  <h3>${cam.name} [${cam.account} : ${cam.serialNumber}]</h3>

  <div class="canvas-wrap">
    <canvas id="canvas-${cam.id}"></canvas>
    <div class="loading-overlay" id="loading-${cam.id}">Loading video...</div>
  </div>

  <div class="actions">
    <button id="btn-preview-${cam.id}"><i class="bi bi-play-fill"> ON</i></button>
    <button id="btn-stop-${cam.id}" disabled><i class="bi bi-stop-circle-fill"> OFF</i> </button>
    <button id="btn-rec-${cam.id}"><i class="bi bi-record-circle-fill"> Rec</i></button>
    <button id="btn-stoprec-${cam.id}" disabled><i class="bi bi-stop-circle"> Stop</i></button>
  </div>
`;
    grid.appendChild(card);
    setupCamera(cam);
  });
}

async function scanCameras() {
  Swal.fire({
    title: "Scanning kamera...",
    didOpen: () => Swal.showLoading(),
    allowOutsideClick: false
  });

  const res = await fetch("/scan");
  const data = await res.json();

  Swal.close();

  Swal.fire({
    icon: "success",
    title: `${data.length} kamera ditemukan`,
    timer: 1500,
    showConfirmButton: false
  });

  init(); // 🔄 reload grid
}

function setupCamera(cam) {
  const canvas  = document.getElementById(`canvas-${cam.id}`);
  const loader  = document.getElementById(`loading-${cam.id}`);
  const ctx     = canvas.getContext("2d");

  const btnPreview  = document.getElementById(`btn-preview-${cam.id}`);
  const btnStop     = document.getElementById(`btn-stop-${cam.id}`);
  const btnRec      = document.getElementById(`btn-rec-${cam.id}`);
  const btnStopRec  = document.getElementById(`btn-stoprec-${cam.id}`);

  let ws = null;
  let showREC = false;
  let lastFrameTime = 0;
  let reconnectTimer = null;

  // --- RENDER FRAME ---
  async function handleFrame(buffer) {
    loader.style.display = "none";
    lastFrameTime = Date.now();
    let recBlink = true;
    setInterval(() => {
      recBlink = !recBlink;
      }, 500); // 500ms kedip
    

    try {
      const blob = new Blob([buffer], { type: "image/jpeg" });
      const bmp = await createImageBitmap(blob);

      // Resize canvas
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;

      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();

if (showREC) {
  ctx.font = "24px Arial";
  ctx.fillStyle = "red";

  // Tulisan REC
  ctx.fillText("REC", canvas.width - 60, 30);

  // Titik merah berkedip
  if (recBlink) {
    ctx.beginPath();
    ctx.arc(canvas.width - 80, 22, 6, 0, Math.PI * 2); // posisi & ukuran titik
    ctx.fill();
  }
}
    } catch (e) {}
  }

  // --- DETECT OFFLINE ---
  setInterval(() => {
    if (!ws) return;
    if (Date.now() - lastFrameTime > 3000) {
      loader.style.display = "flex"; // kamera mati
    }
  }, 1000);


  // --- START WS ---
  function startWS() {
    if (ws) return;

    loader.style.display = "flex";

    ws = new WebSocket(`ws://${location.host}/stream/${cam.id}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      btnPreview.disabled = true;
      btnStop.disabled = false;
      btnRec.disabled = false;

      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (msg) => handleFrame(msg.data);

    ws.onerror = () => {
      loader.style.display = "flex";
    };

    ws.onclose = () => {
      loader.style.display = "flex";
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      btnPreview.disabled = false;
      btnStop.disabled = true;
      btnRec.disabled = true;

      ws = null;

      // AUTO RECONNECT
      if (!reconnectTimer) {
        reconnectTimer = setInterval(() => startWS(), 2000);
      }
    };
  }

  function stopWS() {
    if (ws) ws.close();
    ws = null;
  }

  // --- BUTTON EVENT ---
  btnPreview.addEventListener("click", startWS);
  btnStop.addEventListener("click", stopWS);

  btnRec.addEventListener("click", async () => {
    await fetch(`/start-record/${cam.id}`);

    showREC = true;
    btnRec.disabled = true;
    btnStopRec.disabled = false;

    Swal.fire({ icon: "success", title: "Recording started", timer: 1000, showConfirmButton: false });
  });

  btnStopRec.addEventListener("click", async () => {
    const r = await fetch(`/stop-record/${cam.id}`);
    const json = await r.json();

    showREC = false;
    btnRec.disabled = false;
    btnStopRec.disabled = true;

    Swal.fire({
      icon: "info",
      title: "Recording stopped",
      text: json.file || "",
      timer: 1500,
      showConfirmButton: false
    });
  });
}

init();
