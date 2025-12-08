async function init() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  const streamId = window.location.pathname.split("/")[2]; 
  // ambil dari URL: /stream/:streamId/preview

  // ✅ fetch camera berdasarkan streaming ID
  const res = await fetch(`/api/stream/${streamId}/cameras?time=${Date.now()}`, { cache: "no-store" });
  const cams = await res.json();

  if (res.status !== 200 || cams.error) {
    grid.innerHTML = `<h4 class="text-center text-danger">HLS ERROR atau kamera tidak ditemukan</h4>`;
    return;
  }

  cams.forEach(cam => {
    const card = document.createElement("div");
    card.className = "cam";

    card.innerHTML = `
      <div class="cam-card">
        <div class="cam-header">
          <span class="badge bg-info text-dark">Camera: ${cam.name}</span>
          <span class="text-light small"> [${cam.serialNumber || ''}]</span>
        </div>

        <div class="canvas-wrap">
          <canvas id="canvas-${cam.id}"></canvas>
          <div class="loading-overlay" id="loading-${cam.id}">Loading video...</div>
        </div>

        <div class="actions">
          <button id="btn-preview-${cam.id}"><i class="bi bi-play-fill"></i> ON</button>
          <button id="btn-stop-${cam.id}" disabled><i class="bi bi-stop-circle-fill"></i> OFF</button>
          <button id="btn-rec-${cam.id}"><i class="bi bi-record-circle-fill"></i> Rec</button>
          <button id="btn-stoprec-${cam.id}" disabled><i class="bi bi-stop-circle"></i> Stop</button>
        </div>
      </div>
    `;

    grid.appendChild(card);
    setupCamera(cam);
  });
}

function setupCamera(cam) {
  const canvas = document.getElementById(`canvas-${cam.id}`);
  const loader = document.getElementById(`loading-${cam.id}`);
  const ctx    = canvas.getContext("2d");

  const btnPreview = document.getElementById(`btn-preview-${cam.id}`);
  const btnStop    = document.getElementById(`btn-stop-${cam.id}`);
  const btnRec     = document.getElementById(`btn-rec-${cam.id}`);
  const btnStopRec = document.getElementById(`btn-stoprec-${cam.id}`);

  let ws = null;
  let showREC = false;
  let lastFrameTime = 0;
  let recBlink = true;
  let reconnectTimer = null;

  function startWS() {
    if (ws) return;
    loader.style.display = "flex";
    ws = new WebSocket(`ws://${location.host}/stream/${cam.id}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      btnPreview.disabled = true;
      btnStop.disabled = false;
      btnRec.disabled = false;
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    };

    ws.onmessage = msg => {
      lastFrameTime = Date.now();
      loader.style.display = "none";
      const blob = new Blob([msg.data], { type: "image/jpeg" });
      createImageBitmap(blob).then(bmp => {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        if (showREC && recBlink) {
          ctx.font = "22px Arial";
          ctx.fillText("🔴 REC", canvas.width - 90, 30);
        }
        bmp.close();
      });
    };

    ws.onclose = () => {
      loader.style.display = "flex";
      btnPreview.disabled = false;
      btnStop.disabled = true;
      btnRec.disabled = true;
      btnStopRec.disabled = true;
      ws = null;
      if (!reconnectTimer) reconnectTimer = setInterval(startWS, 2000);
    };
  }

  function stopWS() { ws?.close(); ws = null; }

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
    await fetch(`/stop-record/${cam.id}`);
    showREC = false;
    btnRec.disabled = false;
    btnStopRec.disabled = true;
    Swal.fire({ icon: "info", title: "Recording stopped", timer: 1300, showConfirmButton: false });
  });

  // kedip REC
  setInterval(() => { recBlink = !recBlink; }, 500);

  // detect offline
  setInterval(() => {
    if (!ws) return;
    if (Date.now() - lastFrameTime > 3000) loader.style.display = "flex";
  }, 1000);
}

// init pertama kali
init();
