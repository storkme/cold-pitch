// The mic tap (see initAudio in mic.js): passes the mic's samples to the page in blocks of 1024, stamped with the
// audio clock.

class Tap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0;}
process(inputs){const c=inputs[0]&&inputs[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===1024){this.port.postMessage({d:this.b,t:currentTime});this.b=new Float32Array(1024);this.n=0;}}}return true;}}
registerProcessor('tap',Tap);
