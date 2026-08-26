import { useCallback, useRef, useState } from "react";

type Cue = "tap" | "start" | "correct" | "finish";

export function useGameSound() {
  const [enabled, setEnabled] = useState(true);
  const contextRef = useRef<AudioContext | null>(null);

  const play = useCallback((cue: Cue) => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;
    if (context.state === "suspended") void context.resume();
    const notes = cue === "correct" ? [523, 659, 784] : cue === "start" ? [330, 440] : cue === "finish" ? [440, 330] : [560];
    const now = context.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === "tap" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.045, now + index * 0.08 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.15);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.08);
      oscillator.stop(now + index * 0.08 + 0.17);
    });
  }, [enabled]);

  return { enabled, toggle: () => setEnabled((value) => !value), play };
}
