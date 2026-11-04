// ReelTale "Say your choice": an AudioWorklet that hands the microphone's samples (mono, at the audio context's
// rate) to the page in blocks of 1024 frames. Loaded by src/features/story/voice/webRecorder.ts from this site's
// own origin, so the CSP's script-src 'self' covers it. It keeps nothing and sends nothing anywhere else.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let at = 0;
      while (at < channel.length) {
        const take = Math.min(channel.length - at, this.block.length - this.filled);
        this.block.set(channel.subarray(at, at + take), this.filled);
        this.filled += take;
        at += take;
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block.slice());
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('reeltale-pcm-capture', PcmCapture);
