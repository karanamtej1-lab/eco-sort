// Eco-Sort, Phase 3: AI integration.
//
// Loads the Teachable Machine model once at page load, then, while the camera
// runs (camera:started / camera:stopped from app.js), classifies frames and
// drives the result card through its data-state hooks from Phase 1.

(() => {
  const MODEL_URL = "https://teachablemachine.withgoogle.com/models/HxZ5BimDn/";

  // Frames per second to classify. The label can't change faster than a person
  // can read it, so there's no point burning battery on 60 predictions/sec.
  const PREDICTIONS_PER_SECOND = 8;
  // Exponential moving average weight for each new frame (0..1). Lower = steadier
  // label, slower to react. 0.35 settles in ~1/2 second at 8 fps.
  const SMOOTHING = 0.35;
  // Below this smoothed confidence we say "Not sure" instead of guessing.
  // The model has no "nothing / background" class, so it always picks one of the
  // three bins; this threshold is what stops an empty scene reading as "Landfill".
  const CONFIDENCE_THRESHOLD = 0.6;
  // Classes that map to a bin (and a data-state colour in style.css).
  const BINS = new Set(["recycling", "compost", "landfill"]);

  const card = document.getElementById("resultCard");
  const label = document.getElementById("resultLabel");
  const fill = document.getElementById("confidenceFill");
  const confidenceText = document.getElementById("confidenceText");
  const hint = document.getElementById("resultHint");
  const legendPcts = new Map(
    [...document.querySelectorAll(".legend-pct")].map((el) => [el.dataset.class, el])
  );

  let model = null;
  let modelError = null;
  let loop = null;            // { video, timer } while running
  let smoothed = null;        // Map<className, probability>

  const toState = (className) => className.trim().toLowerCase();

  function render({ state, text, confidence, hintText }) {
    card.dataset.state = state;
    label.textContent = text;
    fill.style.width = confidence == null ? "0%" : `${Math.round(confidence * 100)}%`;
    confidenceText.textContent = confidence == null ? "—" : `${Math.round(confidence * 100)}%`;
    hint.textContent = hintText ?? "";
  }

  function renderLegend(probs) {
    for (const [cls, el] of legendPcts) {
      const p = probs?.get(cls);
      el.textContent = p == null ? "" : `${Math.round(p * 100)}%`;
    }
  }

  function renderIdle() {
    renderLegend(null);
    if (modelError) {
      render({ state: "idle", text: "Model unavailable", hintText: modelError });
    } else if (!model) {
      render({ state: "idle", text: "Waiting…", hintText: "Loading model…" });
    } else {
      render({ state: "idle", text: "Waiting…", hintText: "Start the camera and hold an item up to it." });
    }
  }

  async function loadModel() {
    renderIdle();
    try {
      if (!window.tmImage) throw new Error("Couldn't load the AI library. Check your connection and reload.");
      model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
      // Warm-up: the first prediction compiles WebGL shaders and can take ~1s.
      // Doing it now means the first real frame is instant.
      const blank = document.createElement("canvas");
      blank.width = blank.height = 224;
      await model.predict(blank);
      console.info("[Eco-Sort] Model loaded. Classes:", model.getClassLabels());
    } catch (err) {
      console.error("[Eco-Sort] Model failed to load:", err);
      modelError = err?.message || "Couldn't load the model. Check your connection and reload.";
    }
    // If the camera was started while we were loading, begin classifying now.
    if (loop) tick(); else renderIdle();
  }

  function update(predictions) {
    // Blend this frame into the running average so one odd frame can't flip the label.
    if (!smoothed) {
      smoothed = new Map(predictions.map((p) => [toState(p.className), p.probability]));
    } else {
      for (const p of predictions) {
        const key = toState(p.className);
        const prev = smoothed.get(key) ?? p.probability;
        smoothed.set(key, prev + SMOOTHING * (p.probability - prev));
      }
    }

    let best = null;
    for (const [cls, prob] of smoothed) if (!best || prob > best.prob) best = { cls, prob };
    const bestName = predictions.find((p) => toState(p.className) === best.cls).className;

    renderLegend(smoothed);
    if (!BINS.has(best.cls)) {
      // Any extra class (e.g. a "Nothing" / background class added in a retrain)
      // means no item is in view, so stay neutral rather than colouring the card.
      render({ state: "uncertain", text: "No item", confidence: null, hintText: "Hold an item up to the camera." });
    } else if (best.prob < CONFIDENCE_THRESHOLD) {
      render({
        state: "uncertain",
        text: "Not sure",
        confidence: best.prob,
        hintText: "Hold one item closer, centered, in good light.",
      });
    } else {
      render({
        state: best.cls,          // "recycling" | "compost" | "landfill" → CSS colours
        text: bestName,
        confidence: best.prob,
        hintText: "",
      });
    }
  }

  async function tick() {
    if (!loop || !model) return;
    const started = performance.now();
    const { video } = loop;
    try {
      // readyState >= 2 means a frame is actually decoded; before that videoWidth is 0.
      if (video.readyState >= 2 && video.videoWidth > 0) {
        update(await model.predict(video));
      }
    } catch (err) {
      console.error("[Eco-Sort] Prediction failed:", err);
    }
    if (!loop) return;         // camera stopped while we were predicting
    const wait = Math.max(0, 1000 / PREDICTIONS_PER_SECOND - (performance.now() - started));
    loop.timer = setTimeout(tick, wait);
  }

  document.addEventListener("camera:started", (e) => {
    smoothed = null;
    loop = { video: e.detail.video, timer: null };
    if (model) {
      render({ state: "uncertain", text: "Scanning…", confidence: null, hintText: "" });
      tick();
    } else {
      renderIdle(); // shows "Loading model…" or the load error
    }
  });

  document.addEventListener("camera:stopped", () => {
    if (loop) clearTimeout(loop.timer);
    loop = null;
    smoothed = null;
    renderIdle();
  });

  loadModel();
})();
