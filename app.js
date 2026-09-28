// Eco-Sort, Phase 2: webcam integration.
//
// Owns the camera lifecycle (start, stop, errors) and announces it with
// "camera:started" / "camera:stopped" events on document, so Phase 3's
// prediction loop can subscribe without reaching into this file.

(() => {
  const video = document.getElementById("webcam");
  const frame = document.getElementById("cameraFrame");
  const button = document.getElementById("toggleCamera");
  const buttonLabel = button.querySelector(".btn-label");
  const statusText = document.getElementById("cameraStatus");
  const hintText = document.getElementById("cameraHint");

  const DEFAULT_STATUS = statusText.textContent;
  const DEFAULT_HINT = hintText.innerHTML;

  let stream = null;

  // Prefer the rear camera on phones (you point it at trash, not your face);
  // laptops with only a front camera fall back to it automatically.
  const CONSTRAINTS = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  };

  function setButton(running, busy = false) {
    button.disabled = busy;
    button.setAttribute("aria-pressed", String(running));
    buttonLabel.textContent = busy ? "Starting…" : running ? "Stop camera" : "Start camera";
  }

  function showMessage(status, hint, isError) {
    statusText.textContent = status;
    hintText.textContent = hint;
    frame.dataset.error = String(isError);
  }

  function resetMessage() {
    statusText.textContent = DEFAULT_STATUS;
    hintText.innerHTML = DEFAULT_HINT;
    frame.dataset.error = "false";
  }

  function describeError(err) {
    switch (err && err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return ["Camera access was blocked", "Allow camera access in your browser's address bar, then try again."];
      case "NotFoundError":
      case "OverconstrainedError":
        return ["No camera found", "Connect a camera or try a different device."];
      case "NotReadableError":
      case "AbortError":
        return ["Camera is busy", "Another app may be using it. Close that app and try again."];
      default:
        return ["Couldn't start the camera", (err && err.message) || "Something went wrong. Please try again."];
    }
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showMessage(
        "Camera not available here",
        "Open this page over https:// or from localhost to use the camera.",
        true
      );
      return;
    }

    setButton(false, true);
    try {
      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      video.srcObject = stream;
      await video.play();

      const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
      // Desktop webcams often omit facingMode; treat them as front-facing.
      frame.dataset.facing = settings.facingMode === "environment" ? "environment" : "user";
      frame.dataset.active = "true";
      resetMessage();
      setButton(true);

      // If the camera disappears (unplugged, permission revoked), reset the UI.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopCamera);

      document.dispatchEvent(new CustomEvent("camera:started", { detail: { video } }));
    } catch (err) {
      console.error("[Eco-Sort] Camera error:", err);
      stopTracks();
      setButton(false);
      showMessage(...describeError(err), true);
    }
  }

  function stopTracks() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  function stopCamera() {
    const wasRunning = stream !== null;
    stopTracks();
    frame.dataset.active = "false";
    setButton(false);
    if (wasRunning) document.dispatchEvent(new CustomEvent("camera:stopped"));
  }

  button.addEventListener("click", () => {
    if (stream) stopCamera();
    else startCamera();
  });

  // Release the camera (and its indicator light) when leaving the page.
  window.addEventListener("pagehide", stopCamera);
})();
