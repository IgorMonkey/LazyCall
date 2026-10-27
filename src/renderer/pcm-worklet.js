class CallMePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.round(sampleRate / 10));
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === "flush") {
        this.send();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  send() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    let energy = 0;
    for (const v of samples) energy += v * v;
    this.port.postMessage({ samples, rms: Math.sqrt(energy / samples.length) }, [samples.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let v = 0;
      for (const channel of channels) v += channel[i];
      this.buffer[this.offset++] = v / channels.length;
      if (this.offset === this.buffer.length) this.send();
    }
    return true;
  }
}
registerProcessor("callme-pcm", CallMePcm);
