import { createSignal, onCleanup, type Accessor } from 'solid-js';
import {
  getSpeechRecognitionConstructor, mergeSpeechTranscript, readSpeechTranscript, speechRecognitionErrorMessage,
  type SpeechRecognitionLike,
} from '../../lib/speechRecognition';

export function createSpeechInput(options: {
  input: Accessor<string>;
  updateInput: (text: string) => void;
  updateTextarea: (text: string) => void;
  focus: () => void;
}) {
  const [isListening, setIsListening] = createSignal(false);
  const [isStarting, setIsStarting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let recognition: SpeechRecognitionLike | undefined;

  const cancel = () => {
    const active = recognition;
    recognition = undefined;
    if (active) {
      active.onstart = null; active.onresult = null; active.onerror = null; active.onend = null;
      try { active.abort(); } catch { /* already stopped */ }
    }
    setIsListening(false); setIsStarting(false);
  };
  const supported = () => typeof window !== 'undefined' && !!getSpeechRecognitionConstructor(window);
  const start = () => {
    const Recognition = typeof window !== 'undefined' ? getSpeechRecognitionConstructor(window) : undefined;
    if (!Recognition) { setError('Voice input is not supported in this browser'); return; }
    cancel(); setError(null);
    const baseInput = options.input();
    const instance = new Recognition();
    recognition = instance;
    instance.continuous = true; instance.interimResults = true; instance.lang = navigator.language || 'en-US';
    instance.onstart = () => { if (recognition === instance) { setIsStarting(false); setIsListening(true); } };
    instance.onresult = (event) => {
      if (recognition !== instance) return;
      const text = mergeSpeechTranscript(baseInput, readSpeechTranscript(event.results));
      options.updateInput(text); options.updateTextarea(text);
    };
    instance.onerror = (event) => { if (recognition === instance) { const message = speechRecognitionErrorMessage(event.error); if (message) setError(message); } };
    instance.onend = () => {
      if (recognition !== instance) return;
      recognition = undefined; setIsStarting(false); setIsListening(false); requestAnimationFrame(options.focus);
    };
    setIsStarting(true);
    try { instance.start(); } catch { recognition = undefined; setIsStarting(false); setError('Could not start voice input'); }
  };
  const stop = () => {
    const active = recognition;
    if (!active) return;
    setIsStarting(false);
    try { active.stop(); } catch { cancel(); }
  };
  const toggle = () => isListening() || isStarting() ? stop() : start();
  const resetError = () => setError(null);
  onCleanup(cancel);
  return { isListening, isStarting, error, supported, start, stop, toggle, cancel, resetError };
}
