import { describe, expect, it } from 'vitest';
import {
  mergeSpeechTranscript,
  readSpeechTranscript,
  speechRecognitionErrorMessage,
  type SpeechRecognitionResultListLike,
} from './speechRecognition';

function results(...segments: string[]): SpeechRecognitionResultListLike {
  const list = segments.map((transcript) => Object.assign(
    [{ transcript }],
    { isFinal: true },
  ));
  return Object.assign(list, { length: list.length }) as SpeechRecognitionResultListLike;
}

describe('speech recognition helpers', () => {
  it('collects transcript segments and ignores blank alternatives', () => {
    expect(readSpeechTranscript(results(' hello ', '', 'world'))).toBe('hello world');
  });

  it('appends dictation without smashing it into an existing draft', () => {
    expect(mergeSpeechTranscript('fix the tests', 'please')).toBe('fix the tests please');
    expect(mergeSpeechTranscript('fix the tests ', 'please')).toBe('fix the tests please');
    expect(mergeSpeechTranscript('', '  new prompt  ')).toBe('new prompt');
  });

  it('maps microphone errors to useful messages and ignores deliberate aborts', () => {
    expect(speechRecognitionErrorMessage('not-allowed')).toBe('Microphone permission denied');
    expect(speechRecognitionErrorMessage('audio-capture')).toBe('No microphone was found');
    expect(speechRecognitionErrorMessage('aborted')).toBeNull();
    expect(speechRecognitionErrorMessage('mystery')).toBe('Voice input failed');
  });
});
