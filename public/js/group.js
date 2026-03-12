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

  <iframe 
    id="frame-${cam.id}" 
    src="" 
    allow="autoplay; fullscreen"
    style="width:100%; height:100%; border:none;">
  </iframe>

  <div class="loading-overlay" id="loading-${cam.id}">Loading video...</div>

  <div class="rec-indicator" id="rec-${cam.id}" style="display:none;">
    ● REC
  </div>

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

  const frame  = document.getElementById(`frame-${cam.id}`);
  const loader = document.getElementById(`loading-${cam.id}`);

  const btnPreview = document.getElementById(`btn-preview-${cam.id}`);
  const btnStop    = document.getElementById(`btn-stop-${cam.id}`);
  const btnRec     = document.getElementById(`btn-rec-${cam.id}`);
  const btnStopRec = document.getElementById(`btn-stoprec-${cam.id}`);

  let showREC = false;
  const recIndicator = document.getElementById(`rec-${cam.id}`);

  function startCam() {

    loader.style.display = "flex";

    frame.src = `http://${location.hostname}:8889/cam${cam.id}`;

    setTimeout(()=>{
      loader.style.display = "none";
    },2000);

    btnPreview.disabled = true;
    btnStop.disabled = false;
  }

  function stopCam(){

    frame.src = "";

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
  btnRec.disabled = true;
  btnStopRec.disabled = false;
});

  btnStopRec.addEventListener("click", async () => {
  await fetch(`/stop-record/${cam.id}`);

    showREC = false;

  if(recIndicator){
    recIndicator.style.display = "none";
  }
  btnRec.disabled = false;
  btnStopRec.disabled = true;
    Swal.fire({
      icon:"info",
      title:"Recording stopped",
      timer:1300,
      showConfirmButton:false
    });

  });

}
  // kedip REC
  setInterval(() => { recBlink = !recBlink; }, 500);

  // detect offline
  setInterval(()=>{
  const frame = document.getElementById(`frame-${cam.id}`)
  if(frame && frame.contentWindow.location.href === "about:blank"){
    frame.src = `http://${location.hostname}:8889/cam${cam.id}`
    }
  },5000)

  

// init pertama kali
init();
