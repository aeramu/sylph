export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function getSpeechRecognitionConstructor(scope: Window): SpeechRecognitionConstructor | undefined {
  const speechWindow = scope as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

export function readSpeechTranscript(results: SpeechRecognitionResultListLike): string {
  const segments: string[] = [];
  for (let index = 0; index < results.length; index++) {
    const transcript = results[index]?.[0]?.transcript?.trim();
    if (transcript) segments.push(transcript);
  }
  return segments.join(' ');
}

export function mergeSpeechTranscript(base: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return base;
  if (!base) return spoken;
  return `${base}${/\s$/.test(base) ? '' : ' '}${spoken}`;
}

export function speechRecognitionErrorMessage(error: string): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied';
    case 'audio-capture':
      return 'No microphone was found';
    case 'no-speech':
      return 'No speech detected';
    case 'network':
      return 'Voice recognition is unavailable';
    case 'language-not-supported':
      return 'This language is not supported';
    default:
      return 'Voice input failed';
  }
}
