import { useCallback, useRef, useMemo, useState } from 'react';

/**
 * Audio alert system for SCADA medical operations.
 * Uses Web Audio API to generate tones for different alert types.
 * No external audio files required — pure synthesized sounds.
 */
export default function useAudioAlerts() {
  const audioCtxRef = useRef(null);
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.5);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  /**
   * Play a tone sequence.
   * @param {Array<{freq: number, duration: number, type?: OscillatorType}>} notes
   * @param {number} [vol] - Override volume (0-1)
   */
  const playToneSequence = useCallback((notes, vol) => {
    if (!enabled) return;
    try {
      const ctx = getAudioContext();
      const gainNode = ctx.createGain();
      gainNode.gain.value = vol ?? volume;
      gainNode.connect(ctx.destination);

      let startTime = ctx.currentTime;

      for (const note of notes) {
        const osc = ctx.createOscillator();
        osc.type = note.type || 'sine';
        osc.frequency.value = note.freq;
        osc.connect(gainNode);
        osc.start(startTime);
        osc.stop(startTime + note.duration);

        // Envelope for smooth attack/release
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(vol ?? volume, startTime + 0.02);
        gainNode.gain.linearRampToValueAtTime(0, startTime + note.duration - 0.02);

        startTime += note.duration + 0.05;
      }
    } catch {
      // Audio context unavailable — silently fail
    }
  }, [enabled, volume, getAudioContext]);

  // === Domain-specific alert sounds ===

  /** Cabin arrived at destination — pleasant chime */
  const playCabinArrived = useCallback(() => {
    playToneSequence([
      { freq: 784, duration: 0.12, type: 'sine' },   // G5
      { freq: 988, duration: 0.12, type: 'sine' },   // B5
      { freq: 1175, duration: 0.2, type: 'sine' },   // D6
    ]);
  }, [playToneSequence]);

  /** STAT specimen — urgent attention required */
  const playStatAlert = useCallback(() => {
    playToneSequence([
      { freq: 880, duration: 0.15, type: 'square' },  // A5
      { freq: 0, duration: 0.08, type: 'sine' },      // pause
      { freq: 880, duration: 0.15, type: 'square' },  // A5
      { freq: 0, duration: 0.08, type: 'sine' },      // pause
      { freq: 1175, duration: 0.3, type: 'square' },  // D6 — higher pitch hold
    ]);
  }, [playToneSequence]);

  /** Emergency stop — alarming tone */
  const playEStopAlarm = useCallback(() => {
    playToneSequence([
      { freq: 440, duration: 0.2, type: 'sawtooth' },
      { freq: 880, duration: 0.2, type: 'sawtooth' },
      { freq: 440, duration: 0.2, type: 'sawtooth' },
      { freq: 880, duration: 0.3, type: 'sawtooth' },
    ]);
  }, [playToneSequence]);

  /** Dispatch confirmation — quick confirmation beep */
  const playDispatchConfirm = useCallback(() => {
    playToneSequence([
      { freq: 523, duration: 0.08, type: 'sine' },   // C5
      { freq: 659, duration: 0.12, type: 'sine' },   // E5
    ]);
  }, [playToneSequence]);

  /** Error sound — low attention tone */
  const playError = useCallback(() => {
    playToneSequence([
      { freq: 330, duration: 0.15, type: 'triangle' },
      { freq: 262, duration: 0.25, type: 'triangle' },
    ]);
  }, [playToneSequence]);

  return useMemo(() => ({
    enabled,
    setEnabled,
    volume,
    setVolume,
    playCabinArrived,
    playStatAlert,
    playEStopAlarm,
    playDispatchConfirm,
    playError,
  }), [
    enabled,
    volume,
    playCabinArrived,
    playStatAlert,
    playEStopAlarm,
    playDispatchConfirm,
    playError,
  ]);
}
