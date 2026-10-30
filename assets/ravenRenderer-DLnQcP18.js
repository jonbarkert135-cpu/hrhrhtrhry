function _(r){if(r.byteLength<8||r.byteLength>512e3)throw new Error("Invalid sculpture");const a=new DataView(r),i=a.getUint32(0,!0),c=a.getUint32(4,!0);if(i<3||i>65535||c<3||c%3!==0||r.byteLength!==8+i*24+c*2)throw new Error("Invalid sculpture geometry");const d=new Float32Array(r,8,i*6),e=new Uint16Array(r,8+i*24,c);if(!d.every(s=>Number.isFinite(s)&&Math.abs(s)<=8)||!e.every(s=>s<i))throw new Error("Invalid sculpture coordinates");return{data:d,indices:e,count:c}}const U=`
attribute vec3 position;
attribute vec3 normal;
uniform float yaw;
uniform vec2 scale;
varying vec3 n;
void main() {
  float c=cos(yaw), s=sin(yaw);
  mat3 turn=mat3(c,0.,-s, 0.,1.,0., s,0.,c);
  vec3 p=turn*position;
  n=turn*normal;
  gl_Position=vec4(p.x*scale.x,p.y*scale.y,p.z*.22,1.);
}`,x=`
precision mediump float;
varying vec3 n;
uniform vec3 silver;
void main() {
  vec3 N=normalize(n);
  vec3 L=normalize(vec3(-.7,1.,1.4));
  vec3 R=normalize(vec3(1.,.3,-.4));
  float key=max(dot(N,L),0.);
  float rim=pow(1.-abs(N.z),3.);
  float spec=pow(max(dot(reflect(-L,N),vec3(0.,0.,1.)),0.),24.);
  float edge=pow(max(dot(N,R),0.),12.);
  float light=.035+key*.12+rim*.17+spec*.48+edge*.18;
  gl_FragColor=vec4(silver*light,1.);
}`;async function N(r,a){const i=await fetch("/hrhrhtrhry/brand/raven-sculpture.bin",{signal:a});if(!i.ok)throw new Error("Sculpture unavailable");const c=_(await i.arrayBuffer());a.throwIfAborted();const d=r.getContext("webgl",{alpha:!0,antialias:!0,powerPreference:"low-power"});if(d===null)throw new Error("WebGL unavailable");const e=d,s=[],g=[],n=e.createProgram();if(n===null)throw new Error("GPU unavailable");let u=0,w=!1,v=!1,m=!1,p=0,A=-.3;const y=new ResizeObserver(()=>b()),h=()=>{if(!m){m=!0,cancelAnimationFrame(u),y.disconnect(),a.removeEventListener("abort",h);for(const t of g)e.deleteBuffer(t);for(const t of s)e.deleteShader(t);e.deleteProgram(n)}};function S(t,l){const o=e.createShader(t);if(o===null)throw new Error("Shader unavailable");if(s.push(o),e.shaderSource(o,l),e.compileShader(o),!e.getShaderParameter(o,e.COMPILE_STATUS))throw new Error("Shader unavailable");return o}let R=null,L=null,T=null;function b(){if(m||a.aborted||e.isContextLost())return;const t=Math.min(768,Math.max(1,Math.round(r.clientWidth*Math.min(devicePixelRatio||1,1.5))));(r.width!==t||r.height!==t)&&(r.width=t,r.height=t),e.viewport(0,0,t,t),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.uniform1f(R,A),e.uniform2f(L,.61,.61),e.drawElements(e.TRIANGLES,c.count,e.UNSIGNED_SHORT,0)}function F(t){if(u=0,m||!w||v||a.aborted||e.isContextLost())return;const l=t-p;l>=1e3/30&&(A+=Math.min(l,80)*Math.PI/12e3,p=t,b()),u=requestAnimationFrame(F)}const P=()=>{cancelAnimationFrame(u),u=0,p=performance.now(),w&&!v&&!m&&(u=requestAnimationFrame(F))};try{if(e.attachShader(n,S(e.VERTEX_SHADER,U)),e.attachShader(n,S(e.FRAGMENT_SHADER,x)),e.linkProgram(n),!e.getProgramParameter(n,e.LINK_STATUS))throw new Error("Shader link failed");e.useProgram(n),R=e.getUniformLocation(n,"yaw"),L=e.getUniformLocation(n,"scale"),T=e.getUniformLocation(n,"silver");const t=(o,E)=>{const f=e.createBuffer();if(f===null)throw new Error("GPU buffer unavailable");g.push(f),e.bindBuffer(o,f),e.bufferData(o,E,e.STATIC_DRAW)};t(e.ARRAY_BUFFER,c.data),t(e.ELEMENT_ARRAY_BUFFER,c.indices);for(const[o,E]of[["position",0],["normal",12]]){const f=e.getAttribLocation(n,o);e.enableVertexAttribArray(f),e.vertexAttribPointer(f,3,e.FLOAT,!1,24,E)}e.enable(e.DEPTH_TEST);const l=getComputedStyle(r).color.match(/[\d.]+/g)?.slice(0,3).map(Number)??[237,240,245];return e.uniform3f(T,(l[0]??237)/255,(l[1]??240)/255,(l[2]??245)/255),e.clearColor(0,0,0,0),y.observe(r),a.addEventListener("abort",h,{once:!0}),b(),{setActive(o){w=o,P()},setPaused(o){v=o,P()},dispose:h}}catch(t){throw h(),t}}export{N as mountRaven};
