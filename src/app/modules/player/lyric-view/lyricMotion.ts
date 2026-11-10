const SCROLL_DURATION_MS = 1200;
const MOTION_DRIFT_MS = 200;

export function sampleLyricSpring(position: number, velocity: number, seconds: number, frequency = 10, damping = frequency * .9) {
  const angular = Math.sqrt(frequency * frequency - damping * damping);
  const phase = angular * Math.max(0, seconds);
  const decay = Math.exp(-damping * Math.max(0, seconds));
  const momentum = (velocity + damping * position) / angular;
  return {
    position: decay * (position * Math.cos(phase) + momentum * Math.sin(phase)),
    velocity: decay * (velocity * Math.cos(phase) - (damping * momentum + angular * position) * Math.sin(phase)),
  };
}

const scrollSamples = Array.from({ length: 97 }, (_, index) => {
  const offset = index / 96;
  return { offset, position: index === 96 ? 0 : sampleLyricSpring(1, 0, offset * 1.2).position,
    velocity: index === 96 ? 0 : sampleLyricSpring(0, 1, offset * 1.2).position };
});

export function createLyricScrollFrames(position: number, velocity: number): Keyframe[] {
  return scrollSamples.map(sample => ({ offset: sample.offset, translate: `0 ${position * sample.position + velocity * sample.velocity}px` }));
}

const characterFrames = new Map<string, Keyframe[]>();
const springProgress = (seconds: number, response: number) => {
  const phase = 2 * Math.PI * Math.max(0, seconds) / response;
  return 1 - (1 + phase) * Math.exp(-phase);
};

export function createLyricWordMotion(text: string, durationMs: number, count: number, index: number, background = false) {
  const textCount = Array.from(text.trim()).length;
  const sustained = !background && durationMs > 1000 && textCount > 0 && textCount <= 7
    && !/[\u0590-\u08ff\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/u.test(text);
  if (!sustained) return { frames: [], duration: 0, delay: 0, character: false };
  const duration = Math.max(.001, durationMs / 1000);
  const hold = 2 * duration / Math.max(1, count);
  const response = Math.min(3, duration);
  const spanSeconds = hold + response * 2;
  const delay = (index + 1) * Math.min(durationMs / Math.max(1, count) * .35, 350);
  const strength = Math.min(1, duration - 1);
  const key = `${durationMs}:${count}:${index}`;
  let frames = characterFrames.get(key);
  if (!frames) {
    const samples = 60;
    frames = Array.from({ length: samples + 1 }, (_, frame) => {
      const offset = frame / samples;
      const seconds = spanSeconds * offset;
      const envelope = frame === samples ? 0 : springProgress(seconds, response) * (1 - springProgress(seconds - hold, response));
      const swell = strength * envelope;
      const x = (index - (count - 1) / 2) * .05 * swell;
      return { offset, transform: `translate(${x}em, ${-2.5 * swell}px) scale(${1 + .1 * swell})` };
    });
    if (characterFrames.size >= 64) characterFrames.delete(characterFrames.keys().next().value!);
    characterFrames.set(key, frames);
  }
  return { frames, duration: spanSeconds * 1000, delay, character: true };
}

export interface LyricEffect {
  animation: Animation | null;
  settled: boolean;
}

export function syncLyricEffect(effect: LyricEffect, element: HTMLElement, frames: Keyframe[], duration: number,
  elapsed: number, advancing: boolean, force: boolean, property: 'transform' | 'maskPosition') {
  if (elapsed < 0) {
    effect.animation?.cancel();
    effect.animation = null;
    effect.settled = false;
    const initial = frames[0]?.[property];
    if (typeof initial === 'string') element.style[property] = initial;
    return;
  }
  if (elapsed >= duration) {
    effect.animation?.cancel();
    effect.animation = null;
    effect.settled = true;
    const final = frames.at(-1)?.[property];
    if (typeof final === 'string' && element.style[property] !== final) element.style[property] = final;
    return;
  }
  if (effect.settled && !force) return;
  if (!effect.animation) {
    effect.settled = false;
    effect.animation = element.animate(frames, { duration, easing: 'linear', fill: 'both' });
    effect.animation.currentTime = elapsed;
    const animation = effect.animation;
    animation.onfinish = () => {
      if (effect.animation !== animation) return;
      const final = frames.at(-1)?.[property];
      if (typeof final === 'string') element.style[property] = final;
      animation.cancel();
      effect.animation = null;
      effect.settled = true;
    };
  } else if (force || Math.abs(Number(effect.animation.currentTime) - elapsed) > MOTION_DRIFT_MS) {
    effect.animation.currentTime = elapsed;
  }
  if (advancing && effect.animation.playState !== 'running') effect.animation.play();
  else if (!advancing && effect.animation.playState !== 'paused') effect.animation.pause();
}

export function createLyricScrollMotion() {
  const motions = new Map<HTMLElement, { animation: Animation; position: number; velocity: number; delay: number }>();
  const clear = () => {
    for (const [element, motion] of motions) {
      motion.animation.cancel();
      element.style.removeProperty('will-change');
    }
    motions.clear();
  };
  return {
    clear,
    retarget(delta: number, focus: number, lines: Array<{ element: HTMLElement; index: number; layoutTop: number; height: number }>, scrollTop: number, height: number) {
      const cascading = motions.size > 0;
      const poses = lines.map(line => {
        const motion = motions.get(line.element);
        const elapsed = motion ? Number(motion.animation.currentTime ?? 0) : 0;
        const pose = motion ? sampleLyricSpring(motion.position, motion.velocity, Math.max(0, elapsed - motion.delay) / 1000) : { position: 0, velocity: 0 };
        const steps = delta >= 0 ? line.index - focus : focus - line.index;
        const delay = motion ? Math.max(0, motion.delay - elapsed) : cascading ? 0 : Math.max(0, Math.min(4, steps)) * 50;
        return { ...line, position: pose.position + delta, velocity: pose.velocity, delay, moving: Boolean(motion) };
      });
      clear();
      for (const pose of poses) {
        const sweptStart = Math.min(scrollTop, scrollTop - delta) - 200;
        const sweptEnd = Math.max(scrollTop, scrollTop - delta) + height + 200;
        if (Math.abs(pose.index - focus) > 20 || (!pose.moving && (pose.layoutTop + pose.height < sweptStart || pose.layoutTop > sweptEnd))
          || (Math.abs(pose.position) < .1 && Math.abs(pose.velocity) < .1)) continue;
        const animation = pose.element.animate(createLyricScrollFrames(pose.position, pose.velocity),
          { duration: SCROLL_DURATION_MS, delay: pose.delay, easing: 'linear', fill: 'both' });
        pose.element.style.willChange = 'translate';
        motions.set(pose.element, { animation, position: pose.position, velocity: pose.velocity, delay: pose.delay });
        animation.onfinish = () => {
          if (motions.get(pose.element)?.animation !== animation) return;
          animation.cancel();
          pose.element.style.removeProperty('will-change');
          motions.delete(pose.element);
        };
      }
    },
  };
}
