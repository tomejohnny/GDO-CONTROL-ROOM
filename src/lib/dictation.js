import { toast } from "./ui.js";

// Dettatura vocale per una textarea, via Web Speech API del browser
// (Chrome/Edge — Firefox e Safari non la supportano nativamente: il
// pulsante si nasconde da solo quando l'API non c'è, invece di rompersi).
export function attachDictation(textareaId, buttonId) {
  const textarea = document.getElementById(textareaId);
  const button = document.getElementById(buttonId);
  if (!textarea || !button) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.style.display = "none";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "it-IT";
  recognition.continuous = true;
  recognition.interimResults = false;

  let recording = false;
  let baseValue = "";

  function stop() {
    recording = false;
    button.classList.remove("recording");
    button.textContent = "🎤";
    try { recognition.stop(); } catch { /* già ferma */ }
  }

  recognition.addEventListener("result", event => {
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
    }
    if (!finalText) return;
    const separator = baseValue && !/\s$/.test(baseValue) ? " " : "";
    baseValue = baseValue + separator + finalText.trim();
    textarea.value = baseValue;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Il riconoscimento si interrompe da solo dopo una pausa nel parlato: se
  // l'utente non ha cliccato stop nel frattempo, lo si riavvia in automatico
  // cosi' la dettatura prosegue senza bisogno di ricliccare il microfono.
  recognition.addEventListener("end", () => {
    if (recording) {
      try { recognition.start(); } catch { /* già in avvio */ }
    }
  });

  recognition.addEventListener("error", event => {
    stop();
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      toast("Microfono non autorizzato dal browser.", "error");
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      toast("Dettatura interrotta.", "error");
    }
  });

  button.addEventListener("click", () => {
    if (recording) {
      stop();
      return;
    }
    baseValue = textarea.value;
    recording = true;
    button.classList.add("recording");
    button.textContent = "⏹";
    try { recognition.start(); } catch { /* già in avvio */ }
  });
}
