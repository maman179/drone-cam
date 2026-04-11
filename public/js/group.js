async function init() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  const streamId = window.location.pathname.split("/")[2]; 
  
  // ✅ fetch camera berdasarkan streaming ID
  const res = await fetch(`/api/stream/${streamId}/cameras?time=${Date.now()}`, { cache: "no-store" });
  const cams = await res.json();

    cams.forEach(cam => {
    const card = document.createElement("div");
    card.className = "cam";

    card.innerHTML = `
      <div class="cam-card">
        <div class="cam-header">
          <span class="badge bg-info text-dark">${cam.name}</span>
          <span class="esp-status" id="esp-status-${cam.id}">⚪ Unknown
        </div>

        <div class="canvas-wrap">

  <iframe 
    id="frame-${cam.id}" 
    src="" 
    allow="autoplay; fullscreen"
    style="width:100%; height:100%; border:none;">
  </iframe>

  <div class="loading-overlay" id="loading-${cam.id}">Loading video...</div>

  <div class="rec-indicator" id="rec-${cam.id}" style="display:none;">
    REC
  </div>

  <!-- LIVE indicator -->
  <div class="live-indicator" id="live-${cam.id}" style="display:none;">
  📡 LANGSUNG
</div>

</div>

        <div class="actions">
          <button id="btn-preview-${cam.id}"><i class="bi bi-play-fill"></i>ON CAM</button>
          <button id="btn-stop-${cam.id}" disabled><i class="bi bi-stop-circle-fill"></i> OFF CAM</button>
          <button id="btn-rec-${cam.id}" disabled><i class="bi bi-record-circle-fill"></i> Rec</button>
          <button id="btn-stoprec-${cam.id}" disabled><i class="bi bi-stop-circle"></i> Stop</button>
          <button id="btn-espon-${cam.id}" disabled>🔌 POMPA ON</button>
          <button id="btn-espoff-${cam.id}" disabled>⚡ POMPA OFF</button>
        </div>
      </div>
    `;

    grid.appendChild(card);
    setupCamera(cam,card);
  });
}

async function updateESPStatus(cam) {
  try {
    const res = await fetch(`/api/esp/status?ip=${cam.ip_esp}`);
    const data = await res.json();

    const el = document.getElementById(`esp-status-${cam.id}`);
    const btnOn  = document.getElementById(`btn-espon-${cam.id}`);
    const btnOff = document.getElementById(`btn-espoff-${cam.id}`);

    if (!el || !btnOn || !btnOff) return;

    if (data.relay === "on") {
      el.innerHTML = "🟢 POMPA SANYO ON";

      btnOn.disabled = true;
      btnOff.disabled = false;

    } else if (data.relay === "off") {
      el.innerHTML = "⚫ POMPA SANYO OFF";

      btnOn.disabled = false;
      btnOff.disabled = true;

    } else {
      el.innerHTML = "🔴 SOCKET HANGUP";

      btnOn.disabled = true;
      btnOff.disabled = true;
    }

  } catch (err) {
    console.error(err);
  }
}

function setupCamera(cam,card) {

const frame  = card.querySelector(`#frame-${cam.id}`);
const loader = card.querySelector(`#loading-${cam.id}`);
const liveIndicator = card.querySelector(`#live-${cam.id}`);

const btnPreview = card.querySelector(`#btn-preview-${cam.id}`);
const btnStop    = card.querySelector(`#btn-stop-${cam.id}`);
const btnRec     = card.querySelector(`#btn-rec-${cam.id}`);
const btnStopRec = card.querySelector(`#btn-stoprec-${cam.id}`);
const btnEspOn   = card.querySelector(`#btn-espon-${cam.id}`);
const btnEspOff  = card.querySelector(`#btn-espoff-${cam.id}`);

setInterval(() => {
  updateESPStatus(cam);
}, 2000);


  // kedip REC
  setInterval(() => { recBlink = !recBlink; }, 500);

  // detect offline 
  setInterval(()=>{
  const frame = document.getElementById(`frame-${cam.id}`)
  if(frame && frame.contentWindow.location.href === "about:blank"){
    frame.src = `http://${location.hostname}:8889/cam${cam.id}`
    }
  },5000)

  let showREC = false;
  const recIndicator = document.getElementById(`rec-${cam.id}`);

  function startCam() {

    loader.style.display = "flex";
    frame.src = `http://${location.hostname}:8889/cam${cam.id}`;

    setTimeout(()=>{
      loader.style.display = "none";
    },2000);

    if (liveIndicator){
      liveIndicator.style.display = "flex";
    }
    btnPreview.disabled = true;
    btnStop.disabled = false;
    btnRec.disabled = false;
    btnEspOn.disabled = false;
    btnEspOff.disabled = true;
  }

  function stopCam(){

    frame.src = "";

      if (liveIndicator){
        liveIndicator.style.display = "none";
      }

    btnPreview.disabled = false;
    btnStop.disabled = true;

  }

  btnPreview.addEventListener("click", startCam);
  btnStop.addEventListener("click", stopCam);
  btnRec.addEventListener("click", async () => {
  await fetch(`/start-record/${cam.id}`);
  
  showREC = true;

  if(recIndicator){
    recIndicator.style.display = "flex";
  }
  
  liveIndicator.style.display = "none";
  btnRec.disabled = true;
  btnStopRec.disabled = false;
});

  btnStopRec.addEventListener("click", async () => {
  await fetch(`/stop-record/${cam.id}`);

    showREC = false;

  if(recIndicator){
    recIndicator.style.display = "none";
  }

  liveIndicator.style.display = "flex";
  btnRec.disabled = false;
  btnStopRec.disabled = true;
    Swal.fire({
      icon:"info",
      title:"Recording stopped",
      timer:1300,
      showConfirmButton:false
    });
  });

  btnEspOn.addEventListener("click", async () => {
  try {
        fetch(`/api/esp/on?ip=${cam.ip_esp}`);
        updateESPStatus(cam);

    Swal.fire({
      icon: "success",
      title: "SANYO ON",
      timer: 1000,
      showConfirmButton: false
    });
  } catch (err) {
    console.error(err);
  }
  btnEspOn.disabled = true;
  btnEspOff.disabled = false;
});

btnEspOff.addEventListener("click", async () => {
  try {
    fetch(`/api/esp/off?ip=${cam.ip_esp}`);
    updateESPStatus(cam);

    Swal.fire({
      icon: "warning",
      title: "SANYO OFF",
      timer: 1000,
      showConfirmButton: false
    });
  } catch (err) {
    console.error(err);
  }
  btnEspOn.disabled = false;
  btnEspOff.disabled = true;
});

}
  
// init pertama kali
init();
