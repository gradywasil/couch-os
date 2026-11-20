/**
 * Taps every Web Audio graph that plays to speakers so host game audio can be
 * cast to the /tv receiver over WebRTC, without muting or altering local
 * playback on the host.
 *
 * How it works:
 * - `AudioNode.prototype.connect` is patched. Whenever a node connects to an
 *   `AudioDestinationNode` of a realtime AudioContext, it is also connected to
 *   a per-context `MediaStreamAudioDestinationNode` (the "tap").
 * - Every tap stream is mixed in a single dedicated mixer AudioContext whose
 *   output track is stable for the lifetime of the page. WebRTC senders can
 *   hold onto that one track: games that create new AudioContexts (emulator
 *   relaunch, arcade engine swap) are picked up automatically with no
 *   renegotiation or `replaceTrack` churn.
 * - `disconnect(destination)` is mirrored so a node unplugged from speakers is
 *   also unplugged from the tap (no "ghost" audio reaching the TV).
 */

type ConnectFn = typeof AudioNode.prototype.connect;
type DisconnectFn = typeof AudioNode.prototype.disconnect;

interface ContextTap {
  dest: MediaStreamAudioDestinationNode;
  mixSource: MediaStreamAudioSourceNode | null;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

class WebAudioTap {
  private installed = false;
  private origConnect: ConnectFn | null = null;
  private origDisconnect: DisconnectFn | null = null;
  private taps = new WeakMap<BaseAudioContext, ContextTap>();
  private lastGameCtx: AudioContext | null = null;

  private mixCtx: AudioContext | null = null;
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  private gestureHooked = false;

  install(): void {
    if (this.installed || typeof AudioNode === 'undefined') return;
    const origConnect = AudioNode.prototype.connect;
    const origDisconnect = AudioNode.prototype.disconnect;
    this.origConnect = origConnect;
    this.origDisconnect = origDisconnect;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tap = this;

    const patchedConnect = function (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      outputIndex?: number,
    ) {
      // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-explicit-any
      const res = (origConnect as any).apply(this, arguments);
      try {
        if (tap.isSpeakerDestination(destination, this.context)) {
          const ctxTap = tap.ensureContextTap(this.context as AudioContext);
          if (ctxTap) {
            (origConnect as (d: AudioNode, o?: number, i?: number) => AudioNode).call(
              this,
              ctxTap.dest,
              outputIndex ?? 0,
              0,
            );
          }
        }
      } catch {
        // Never break game audio if tapping fails
      }
      return res;
    };

    const patchedDisconnect = function (this: AudioNode) {
      // eslint-disable-next-line prefer-rest-params
      const args = arguments;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (origDisconnect as any).apply(this, args);
      try {
        const target = args[0] as unknown;
        if (target && tap.isSpeakerDestination(target, this.context)) {
          const ctxTap = tap.taps.get(this.context);
          if (ctxTap) {
            if (typeof args[1] === 'number') {
              (origDisconnect as (d: AudioNode, o: number, i?: number) => void).call(
                this,
                ctxTap.dest,
                args[1] as number,
                0,
              );
            } else {
              (origDisconnect as (d: AudioNode) => void).call(this, ctxTap.dest);
            }
          }
        }
      } catch {
        // Node was not connected to the tap (InvalidAccessError) — ignore
      }
      return res;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AudioNode.prototype as any).connect = patchedConnect;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AudioNode.prototype as any).disconnect = patchedDisconnect;
    this.installed = true;
  }

  private isSpeakerDestination(
    destination: unknown,
    ctx: BaseAudioContext,
  ): boolean {
    return (
      typeof AudioDestinationNode !== 'undefined' &&
      destination instanceof AudioDestinationNode &&
      typeof AudioContext !== 'undefined' &&
      ctx instanceof AudioContext &&
      ctx !== this.mixCtx
    );
  }

  private ensureContextTap(ctx: AudioContext): ContextTap | null {
    const existing = this.taps.get(ctx);
    if (existing) {
      this.lastGameCtx = ctx;
      return existing;
    }
    if (ctx.state === 'closed') return null;

    const dest = ctx.createMediaStreamDestination();
    const ctxTap: ContextTap = { dest, mixSource: null };
    this.taps.set(ctx, ctxTap);
    this.lastGameCtx = ctx;

    this.routeIntoMixer(ctxTap);

    const onState = () => {
      if (ctx.state === 'closed') {
        ctx.removeEventListener('statechange', onState);
        try {
          ctxTap.mixSource?.disconnect();
        } catch {
          // ignore
        }
        ctxTap.mixSource = null;
        if (this.lastGameCtx === ctx) this.lastGameCtx = null;
      }
    };
    ctx.addEventListener('statechange', onState);
    return ctxTap;
  }

  private routeIntoMixer(ctxTap: ContextTap): void {
    const mixer = this.ensureMixer();
    if (!mixer || !this.mixDest || ctxTap.mixSource) return;
    try {
      const src = mixer.createMediaStreamSource(ctxTap.dest.stream);
      src.connect(this.mixDest);
      ctxTap.mixSource = src;
    } catch {
      // ignore
    }
  }

  private ensureMixer(): AudioContext | null {
    if (this.mixCtx && this.mixCtx.state !== 'closed') return this.mixCtx;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      this.mixCtx = new Ctor({ latencyHint: 'interactive' });
      this.mixDest = this.mixCtx.createMediaStreamDestination();
      this.resumeMixer();
      this.hookGestureResume();
    } catch {
      this.mixCtx = null;
      this.mixDest = null;
    }
    return this.mixCtx;
  }

  private resumeMixer(): void {
    const ctx = this.mixCtx;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  /**
   * Browsers start AudioContexts created outside a user gesture suspended.
   * A suspended mixer outputs silence, so resume it on the next interaction.
   */
  private hookGestureResume(): void {
    if (this.gestureHooked || typeof window === 'undefined') return;
    this.gestureHooked = true;
    const onGesture = () => {
      this.resumeMixer();
      if (this.mixCtx?.state === 'running') {
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        this.gestureHooked = false;
      }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  /**
   * Returns the single stable mixed audio track (created on first call).
   * The track is owned by the tap: callers must never `stop()` it.
   */
  getAudioTracks(): MediaStreamTrack[] {
    this.ensureMixer();
    this.resumeMixer();
    return this.mixDest ? this.mixDest.stream.getAudioTracks() : [];
  }

  /** Most recently tapped game AudioContext (not the internal mixer). */
  getContext(): AudioContext | null {
    return this.lastGameCtx;
  }

  uninstall(): void {
    if (!this.installed) return;
    if (this.origConnect) AudioNode.prototype.connect = this.origConnect;
    if (this.origDisconnect) AudioNode.prototype.disconnect = this.origDisconnect;
    this.installed = false;
  }
}

export const webAudioTap = new WebAudioTap();
