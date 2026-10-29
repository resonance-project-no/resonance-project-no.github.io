/* RESONANCE interactive viewer for synthetic breast MRI illustrations. */
(function () {
  'use strict';

  // USER-ADJUSTABLE SETTINGS
  var SETTINGS = {
    defaultMode: 'dce',
    defaultView: 'axial',
    defaultOpacity: 0.35,
    defaultBValue: 800,
    maximumPixelRatio: 1.6,
    breastSurfaceOpacity: 0.16,
    breastCropPaddingVoxels: 2,
    breastCropPosteriorPaddingVoxels: 0,
    lesionSurfaceOpacity: 1,
    unselectedLesionSurfaceOpacity: 0.72,
    lesionSurfaceEdgeWidth: 0.55,
    lesionLightDirection: [-0.35, 0.4, 1],
    rasterWidth: 1024,
    contrastShoulder: 205,
    contrastHighlightRange: 44,
    volumeElevation: 12,
    volumeRotation: 0,
    background: '#060e14',
    colors: ['#62e4c5', '#f0bc74', '#b6a5f4'],
    curves: [[0,160,125,100], [0,110,112,111], [0,70,110,150]],
    types: ['III', 'II', 'I'],
    curveLabels: ['Washout', 'Plateau', 'Persistent'],
    noise: {t1:9, dce:9, dwi:29, adc:17, subtraction:13, enhancement:13}
  };

  var source = null, sourceRef = null, activeDataRef = null;
  var imageCache = new Map(), surfaceCache = null;
  var canvasMetadata = new WeakMap();
  var TAU = Math.PI * 2;
  function clamp(v,a,b) { return Math.max(a,Math.min(b,v)); }
  function smooth(a,b,v) { var t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); }
  function rgba(hex,alpha) { var n=parseInt(hex.slice(1),16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')'; }
  function hash(x,y,z) {
    var n=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,144269503);
    n=Math.imul(n^(n>>>13),1274126177);
    return ((n^(n>>>16))>>>0)/4294967295;
  }
  function decode(value) {
    if (value instanceof Uint8Array) return value;
    var raw=atob(value), arr=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
    return arr;
  }
  function data() {
    var ref=activeDataRef||window.MRIDemoData;
    if(!ref) return null;
    if(source && ref===sourceRef) return source;
    sourceRef=ref;
    source={displayImages:ref.displayImages||null,displayPhaseAssets:ref.displayPhaseAssets||null,displaySourceAspect:ref.displaySourceAspect||null,hasAcquired3DData:ref.hasAcquired3DData,modality:ref.modality||'dce',minimumBaselineSignal:ref.minimumBaselineSignal==null?1:ref.minimumBaselineSignal,description:ref.description||'Procedural synthetic DCE-MRI',width:ref.width,height:ref.height,depth:ref.depth,spacing:ref.spacing||[1,1,1],
      volume:decode(ref.volume),phaseVolumes:(ref.phaseVolumes||[]).map(decode),breastMask:decode(ref.breastMask),lesionMask:decode(ref.lesionMask),synthetic:ref.synthetic===true,displayEffects:ref.simulateDisplayEffects===true,
      lesions:ref.lesions,defaultSlice:ref.defaultSlice==null?.5:ref.defaultSlice,
      surfacePoints:ref.surfacePoints||[],lesionSurfacePoints:ref.lesionSurfacePoints||[],lesionSurfaces:ref.lesionSurfaces||[],breastSurface:ref.breastSurface||null,signalVolumes:(ref.signalVolumes||[]).map(function(s){var bytes=decode(s);return new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);}),signalScale:ref.signalScale||1,kineticsTimesSeconds:ref.kineticsTimesSeconds||[]};
    var expected=source.width*source.height*source.depth;
    if(source.volume.length!==expected || source.breastMask.length!==expected || source.lesionMask.length!==expected || source.phaseVolumes.some(v=>v.length!==expected) || source.signalVolumes.some(v=>v.length!==expected)) throw new Error('Breast MRI viewer dimensions do not match its arrays.');
    imageCache.clear(); surfaceCache=null;
    return source;
  }
  function index(d,x,y,z) { return (z*d.height+y)*d.width+x; }
  function maskAt(d,arr,x,y,z) {
    if(x<0||y<0||z<0||x>d.width-1||y>d.height-1||z>d.depth-1) return 0;
    return arr[index(d,Math.round(x),Math.round(y),Math.round(z))];
  }
  function sample(d,x,y,z,volume) {
    if(x<0||y<0||z<0||x>d.width-1||y>d.height-1||z>d.depth-1) return 0;
    var x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z);
    var x1=Math.min(x0+1,d.width-1),y1=Math.min(y0+1,d.height-1),z1=Math.min(z0+1,d.depth-1);
    var fx=x-x0,fy=y-y0,fz=z-z0,v=volume||d.volume;
    var a=v[index(d,x0,y0,z0)]*(1-fx)+v[index(d,x1,y0,z0)]*fx;
    var b=v[index(d,x0,y1,z0)]*(1-fx)+v[index(d,x1,y1,z0)]*fx;
    var c=v[index(d,x0,y0,z1)]*(1-fx)+v[index(d,x1,y0,z1)]*fx;
    var e=v[index(d,x0,y1,z1)]*(1-fx)+v[index(d,x1,y1,z1)]*fx;
    return (a*(1-fy)+b*fy)*(1-fz)+(c*(1-fy)+e*fy)*fz;
  }
  function viewInfo(d,view) {
    var physical=[d.width*d.spacing[0],d.height*d.spacing[1],d.depth*d.spacing[2]];
    if(view==='coronal') return {view:view,cols:d.width,rows:d.depth,aspect:physical[0]/physical[2],axis:1,axes:[0,2],reverseY:true};
    if(view==='sagittal') return {view:view,cols:d.height,rows:d.depth,aspect:physical[1]/physical[2],axis:0,axes:[1,2],reverseY:true};
    return {view:'axial',cols:d.width,rows:d.height,aspect:physical[0]/physical[1],axis:2,axes:[0,1],reverseY:true};
  }
  // One global mask bounding box keeps image, contour and pointer geometry aligned.
  function breastPlaneCrop(d,vi) {
    if(!d.breastBounds) {
      var min=[d.width,d.height,d.depth],max=[-1,-1,-1],size=[d.width,d.height,d.depth];
      for(var z=0;z<d.depth;z++)for(var y=0;y<d.height;y++)for(var x=0;x<d.width;x++)if(d.breastMask[index(d,x,y,z)]) {
        min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],y);min[2]=Math.min(min[2],z);
        max[0]=Math.max(max[0],x);max[1]=Math.max(max[1],y);max[2]=Math.max(max[2],z);
      }
      d.breastBounds=max[0]<0?[[0,0,0],[1,1,1]]:[min.map(function(v,a){return clamp((v-.5)/Math.max(1,size[a]-1),0,1);}),max.map(function(v,a){return clamp((v+.5)/Math.max(1,size[a]-1),0,1);})];
    }
    var b=d.breastBounds,ax=vi.axes[0],ay=vi.axes[1],pad=SETTINGS.breastCropPaddingVoxels;
    var minU=clamp(b[0][ax]-pad/Math.max(1,vi.cols-1),0,1),maxU=clamp(b[1][ax]+pad/Math.max(1,vi.cols-1),0,1);
    var posteriorPad=vi.view==='axial'?SETTINGS.breastCropPosteriorPaddingVoxels:pad;
    var minV=clamp((vi.reverseY?1-b[1][ay]:b[0][ay])-pad/Math.max(1,vi.rows-1),0,1),maxV=clamp((vi.reverseY?1-b[0][ay]:b[1][ay])+posteriorPad/Math.max(1,vi.rows-1),0,1);
    return {minU:minU,maxU:maxU,minV:minV,maxV:maxV};
  }
  function planeTo3D(view,u,v,slice) {
    if(view==='coronal') return [u,slice,1-v];
    if(view==='sagittal') return [slice,u,1-v];
    return [u,1-v,slice];
  }
  function toPlane(view,p) {
    if(view==='coronal') return {u:p[0],v:1-p[2],depth:p[1]};
    if(view==='sagittal') return {u:p[1],v:1-p[2],depth:p[0]};
    return {u:p[0],v:1-p[1],depth:p[2]};
  }
  function defaultSlice(view) {
    var d=data(); if(!d) return .5;
    if(view==='coronal') return d.lesions.reduce(function(sum,l){return sum+l.center[1];},0)/d.lesions.length;
    if(view==='sagittal') return d.lesions[0].center[0];
    return d.defaultSlice;
  }
  function phaseValue(curve,phase) {
    var p=clamp(phase,0,3),a=Math.floor(p),b=Math.min(3,a+1),t=p-a;
    return curve[a]*(1-t)+curve[b]*t;
  }
  function offsetFor(o) {
    var drift=clamp(Number(o.drift)||0,0,1),phase=clamp(Number(o.phase)||0,0,3);
    return {u:Math.sin(phase*.91)*.029*drift,v:(Math.cos(phase*.78)-1)*.022*drift};
  }
  function getLesions(view,slice,options) {
    if(typeof view==='object') { options=view; slice=options.slice; view=options.view; }
    var d=data(); if(!d) return [];
    var o=options||{},vi=viewInfo(d,view||'axial');
    if(slice==null) slice=defaultSlice(vi.view);
    var offset=offsetFor(o),physical=[d.width*d.spacing[0],d.height*d.spacing[1],d.depth*d.spacing[2]];
    return d.lesions.map(function(l,i){
      var id=l.id||i+1,p=toPlane(vi.view,l.center),r=l.radii;
      var distance=(slice-p.depth)/r[vi.axis],factor=Math.sqrt(Math.max(0,1-distance*distance));
      var volume=4/3*Math.PI*r[0]*physical[0]*r[1]*physical[1]*r[2]*physical[2]/1000;
      return {id:id,center:l.center.slice(),radii:r.slice(),u:p.u+offset.u,v:p.v+offset.v,sourceU:p.u,sourceV:p.v,
        viewRadii:[r[vi.axes[0]]*factor,r[vi.axes[1]]*factor],depth:p.depth,depthDistance:distance,
        visible:Math.abs(distance)<=1,type:d.displayEffects?SETTINGS.types[id-1]:(l.type||'I'),typeLabel:d.displayEffects?SETTINGS.curveLabels[id-1]:(l.typeLabel||'Persistent'),
        curve:d.displayEffects?SETTINGS.curves[id-1].slice():(l.curve||[0,0,0,0]).slice(),color:SETTINGS.colors[id-1],
        patientSide:d.displayEffects?(l.center[0]<.5?'Right':'Left'):(l.side||'Breast'),volumeMl:d.displayEffects?volume:(l.volumeMl||volume),location:l.location||'',
        extentMm:l.extentMm||[],locationEstimated:l.locationEstimated!==false,diameterMm:l.extentMm?Math.max.apply(null,l.extentMm):2*Math.max(r[0]*physical[0],r[1]*physical[1],r[2]*physical[2])};
    });
  }
  function fit(canvas) {
    var rect=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width||canvas.width||640)),h=Math.max(1,Math.round(rect.height||canvas.height||480));
    var ratio=Math.min(window.devicePixelRatio||1,SETTINGS.maximumPixelRatio);
    var rw=Math.round(w*ratio),rh=Math.round(h*ratio);
    if(canvas.width!==rw||canvas.height!==rh) {canvas.width=rw;canvas.height=rh;}
    var ctx=canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0);
    return {ctx:ctx,width:w,height:h,ratio:ratio};
  }
  function planeMask(d,vi,slice,which,id) {
    var arr=which==='breast'?d.breastMask:d.lesionMask;
    var out=new Uint8Array(vi.cols*vi.rows);
    for(var y=0;y<vi.rows;y++) for(var x=0;x<vi.cols;x++) {
      var p=planeTo3D(vi.view,x/(vi.cols-1),y/(vi.rows-1),slice);
      var value=maskAt(d,arr,p[0]*(d.width-1),p[1]*(d.height-1),p[2]*(d.depth-1));
      out[y*vi.cols+x]=id==null?(value>0?1:0):(value===id?1:0);
    }
    return out;
  }
  // Marching-square segments use the same binary volume as the shaded surface.
  var CASES=[[],[[3,0]],[[0,1]],[[3,1]],[[1,2]],[[3,0],[1,2]],[[0,2]],[[3,2]],[[2,3]],[[0,2]],[[0,1],[2,3]],[[1,2]],[[3,1]],[[0,1]],[[3,0]],[]];
  function contourSegments(mask,w,h) {
    var seg=[];
    for(var y=0;y<h-1;y++) for(var x=0;x<w-1;x++) {
      var code=mask[y*w+x]|(mask[y*w+x+1]<<1)|(mask[(y+1)*w+x+1]<<2)|(mask[(y+1)*w+x]<<3);
      var list=CASES[code]; if(!list.length) continue;
      var points=[[x+.5,y],[x+1,y+.5],[x+.5,y+1],[x,y+.5]];
      for(var i=0;i<list.length;i++) seg.push([points[list[i][0]],points[list[i][1]]]);
    }
    return seg;
  }
  function imagePlane(d,vi,o,slice) {
    var mode=o.mode||SETTINGS.defaultMode;if(mode==='dce')mode='dce';
    if(['t1','t2','dce','dwi','adc','subtraction','enhancement'].indexOf(mode)<0)mode='t1';
    if(!d.displayEffects&&mode!==d.modality)throw new Error('The requested sequence does not match its image dataset.');
    var bValue=clamp(o.bValue==null?SETTINGS.defaultBValue:Number(o.bValue),0,2000);
    var highB=clamp((bValue-800)/600,0,1);
    var phase=clamp(o.phase==null?(mode==='dce'||mode==='subtraction'||mode==='enhancement'?2:0):Number(o.phase),0,3);
    var denoise=clamp(Number(o.denoise)||0,0,1),bias=clamp(Number(o.bias)||0,0,1),density=clamp(o.density==null?.5:Number(o.density),0,1);
    var offset=offsetFor({drift:o.drift,phase:phase});
    var key=[vi.view,slice.toFixed(4),mode,mode==='dwi'?bValue:0,phase.toFixed(3),denoise.toFixed(3),bias.toFixed(3),density.toFixed(3),offset.u.toFixed(4),offset.v.toFixed(4)].join(':');
    if(imageCache.has(key))return imageCache.get(key);
    if(d.displayImages&&vi.view==='axial'&&window.ReferenceIllustrations){
      var raster=document.createElement('canvas');raster.width=SETTINGS.rasterWidth;raster.height=Math.round(raster.width/(d.displaySourceAspect||vi.aspect));
      var rctx=raster.getContext('2d'),fallback=document.createElement('canvas');fallback.width=d.width;fallback.height=d.height;
      var fctx=fallback.getContext('2d'),raw=fctx.createImageData(d.width,d.height),vol=d.phaseVolumes.length?d.phaseVolumes[Math.round(phase)]:d.volume;
      for(var ri=0;ri<d.height;ri++)for(var ci=0;ci<d.width;ci++){var at=(ri*d.width+ci)*4,val=vol[(d.height-1-ri)*d.width+ci];raw.data[at]=raw.data[at+1]=raw.data[at+2]=val;raw.data[at+3]=255;}
      fctx.putImageData(raw,0,0);rctx.drawImage(fallback,0,0,raster.width,raster.height);imageCache.set(key,raster);
      var assetName=mode==='dce'?((d.displayPhaseAssets||[])[Math.round(phase)]||'phase-'+Math.round(phase)):mode;
      window.ReferenceIllustrations.getAsset(assetName).then(function(url){var image=new Image();image.onload=function(){rctx.clearRect(0,0,raster.width,raster.height);rctx.drawImage(image,0,0,raster.width,raster.height);window.dispatchEvent(new Event('resonance-images-ready'));};image.onerror=function(){console.error('Reference illustration failed to load: '+assetName);};image.src=url;}).catch(console.error);
      return raster;
    }

    var w=SETTINGS.rasterWidth,h=Math.max(1,Math.round(w/vi.aspect));
    var off=document.createElement('canvas');off.width=w;off.height=h;
    var cx=off.getContext('2d'),image=cx.createImageData(w,h),pixels=image.data;
    var enh=SETTINGS.curves.map(function(c){return phaseValue(c,phase)/100;});
    var tissueEnh=phaseValue([0,.07,.12,.14],phase);
    var activeVolume=d.phaseVolumes.length?d.phaseVolumes[Math.round(phase)]:d.volume;
    for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
      var u=x/(w-1)-offset.u,v=y/(h-1)-offset.v,p=planeTo3D(vi.view,u,v,slice);
      var vx=p[0]*(d.width-1),vy=p[1]*(d.height-1),vz=p[2]*(d.depth-1);
      var base=sample(d,vx,vy,vz,activeVolume),bm=maskAt(d,d.breastMask,vx,vy,vz),lm=maskAt(d,d.lesionMask,vx,vy,vz);
      var signal=base;
      if(!d.displayEffects){var kk=(y*w+x)*4,value=clamp(base,0,255);pixels[kk]=value;pixels[kk+1]=value;pixels[kk+2]=value;pixels[kk+3]=255;continue;}

      if(d.displayEffects&&bm)signal+=(density-.5)*(Math.max(0,base-28)*.8+smooth(48,150,base)*14);
      var lesion=0;
      if(d.displayEffects&&lm) {
        var definition=d.lesions[lm-1],r=definition.radii,c=definition.center;
        var norm=Math.sqrt(Math.pow((p[0]-c[0])/r[0],2)+Math.pow((p[1]-c[1])/r[1],2)+Math.pow((p[2]-c[2])/r[2],2));
        lesion=1-smooth(.8,1.08,norm);
      }
      // A shared synthetic signal model links the post-contrast image and
      // both derived views. The relative view is display-scaled, not a score.
      var baseline=signal;
      var delta=baseline*tissueEnh*(bm?1:.35)+(lm?enh[lm-1]*64*lesion:0);
      if(mode==='t1'||mode==='dce') {
        signal=baseline+delta;
      } else if(mode==='subtraction') {
        signal=delta;
      } else if(mode==='enhancement') {
        var percentEnhancement=100*delta/(Math.max(0,baseline)+12);
        signal=base>8?percentEnhancement*1.42:0;
      } else if(mode==='dwi') {
        signal=(signal*.49+Math.max(0,signal-91)*.17)*(1-highB*.38);
        if(lm)signal=signal*(1-lesion*.89)+([204,164,130][lm-1]+base*.12)*(1-highB*.09)*lesion*.89;
      } else if(mode==='adc') {
        signal=base>8?42+signal*.62:base;
        if(lm)signal=signal*(1-lesion*.9)+[29,49,66][lm-1]*lesion*.9;
      }
      // These adjustable effects are display simulations on the synthetic atlas.
      // Denoise removes added deterministic display noise; no algorithm is run.
      var shading=1+bias*((u-.5)*.91+(v-.5)*.32+.13*Math.sin(u*5+v*2));
      var amp=SETTINGS.noise[mode]*(1-denoise*.94)*(mode==='dwi'?1+highB*.12:1);
      var grain=(hash(x,y,Math.round(slice*701)+vi.axis*411)*2-1)+(hash(x+91,y+37,13)-.5)*.43;
      signal=signal*shading+grain*amp*(base>7?1:.12);
      // A common soft display shoulder preserves visible phase differences
      // in bright synthetic foci without changing the shared signal model.
      if((mode==='t1'||mode==='dce')&&signal>SETTINGS.contrastShoulder) {
        signal=SETTINGS.contrastShoulder+SETTINGS.contrastHighlightRange*(1-Math.exp(-(signal-SETTINGS.contrastShoulder)/SETTINGS.contrastHighlightRange));
      }
      signal=clamp(signal,0,249);
      var k=(y*w+x)*4;pixels[k]=signal;pixels[k+1]=signal;pixels[k+2]=signal;pixels[k+3]=255;
    }
    cx.putImageData(image,0,0); imageCache.set(key,off);
    if(imageCache.size>10)imageCache.delete(imageCache.keys().next().value);
    return off;
  }
  function draw(canvas,options) {
    var o=options||{},f=fit(canvas),ctx=f.ctx,w=f.width,h=f.height,d=data();
    ctx.clearRect(0,0,w,h);ctx.fillStyle=SETTINGS.background;ctx.fillRect(0,0,w,h);
    if(!d)return {ready:false};
    var vi=viewInfo(d,o.view||SETTINGS.defaultView),slice=clamp(o.slice==null?defaultSlice(vi.view):Number(o.slice),0,1);
    var crop=o.breastCrop?breastPlaneCrop(d,vi):{minU:0,maxU:1,minV:0,maxV:1};
    var cropWidth=Math.max(1e-6,crop.maxU-crop.minU),cropHeight=Math.max(1e-6,crop.maxV-crop.minV);
    var zoom=Number(o.zoom)||1,center=o.center||[(crop.minU+crop.maxU)/2,(crop.minV+crop.maxV)/2];
    // Preserve the existing detail zoom/center while fitting overview to its crop.
    var dw=Math.min(w/cropWidth,h*vi.aspect/cropHeight)*zoom,dh=dw/vi.aspect,dx=w/2-center[0]*dw,dy=h/2-center[1]*dh;
    var left=Math.max(0,dx+crop.minU*dw),top=Math.max(0,dy+crop.minV*dh),right=Math.min(w,dx+crop.maxU*dw),bottom=Math.min(h,dy+crop.maxV*dh);
    var viewport={x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
    ctx.save();ctx.beginPath();ctx.rect(viewport.x,viewport.y,viewport.width,viewport.height);ctx.clip();
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.save();ctx.globalAlpha=o.dimBase==null?1:o.dimBase;ctx.drawImage(imagePlane(d,vi,o,slice),dx,dy,dw,dh);ctx.restore();
    var effectivePhase=o.phase==null?(o.mode==='dce'||o.mode==='subtraction'||o.mode==='enhancement'?2:0):o.phase;
    var offset=offsetFor({drift:o.drift,phase:effectivePhase});
    var mask=o.mask||'none',opacity=clamp(o.opacity==null?SETTINGS.defaultOpacity:Number(o.opacity),0,1);
    var region=Number(o.region)||0,selected=Number(o.selected)||region;
    var drawBreast=mask==='breast'||mask==='all',drawLesion=mask==='lesion'||mask==='all';
    function overlay(which,id,color,strength) {
      var m=planeMask(d,vi,slice,which,id),off=document.createElement('canvas');off.width=vi.cols;off.height=vi.rows;
      var ox=off.getContext('2d'),im=ox.createImageData(vi.cols,vi.rows),rgb=parseInt(color.slice(1),16);
      for(var i=0;i<m.length;i++) if(m[i]) {var j=i*4;im.data[j]=(rgb>>16)&255;im.data[j+1]=(rgb>>8)&255;im.data[j+2]=rgb&255;im.data[j+3]=opacity*strength*255;}
      ox.putImageData(im,0,0);ctx.drawImage(off,dx+offset.u*dw,dy+offset.v*dh,dw,dh);
      var segments=contourSegments(m,vi.cols,vi.rows);ctx.beginPath();
      segments.forEach(function(s){ctx.moveTo(dx+(s[0][0]/(vi.cols-1)+offset.u)*dw,dy+(s[0][1]/(vi.rows-1)+offset.v)*dh);ctx.lineTo(dx+(s[1][0]/(vi.cols-1)+offset.u)*dw,dy+(s[1][1]/(vi.rows-1)+offset.v)*dh);});
      ctx.strokeStyle=rgba(color,which==='breast'?.7:Math.min(1,.55+strength*.4));ctx.lineWidth=which==='breast'?1:1.45;ctx.stroke();
    }
    if(drawBreast)overlay('breast',null,SETTINGS.colors[0],.43);
    if(drawLesion)d.lesions.forEach(function(l,i){var id=l.id||i+1;if(region&&region!==id)return;overlay('lesion',id,SETTINGS.colors[i],selected&&selected!==id?.35:1);});
    var lesions=getLesions(vi.view,slice,{phase:effectivePhase,drift:o.drift});
    if(drawLesion&&o.annotations!==false)lesions.forEach(function(l){
      if(!l.visible||(region&&region!==l.id))return;var px=dx+l.u*dw,py=dy+l.v*dh,r=Math.max(l.viewRadii[0]*dw,l.viewRadii[1]*dh);
      var bx=px+r+10,by=py-r-4;
      ctx.beginPath();ctx.arc(bx,by,8,0,TAU);ctx.fillStyle='#091a20';ctx.fill();ctx.strokeStyle=l.color;ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=l.color;ctx.font='600 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(l.id),bx,by+.3);
    });
    if(o.roi) {
      var ru=o.roi.u==null?o.roi.x:o.roi.u,rv=o.roi.v==null?o.roi.y:o.roi.v;
      if(Number.isFinite(ru)&&Number.isFinite(rv)) {
        var rx=dx+(ru+offset.u)*dw,ry=dy+(rv+offset.v)*dh,rr=(o.roi.radius||.055)*Math.min(dw,dh);
        ctx.beginPath();ctx.arc(rx,ry,rr,0,TAU);ctx.fillStyle='rgba(255,255,255,.025)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,.92)';ctx.lineWidth=1.1;ctx.stroke();
        ctx.beginPath();ctx.moveTo(rx-4,ry);ctx.lineTo(rx+4,ry);ctx.moveTo(rx,ry-4);ctx.lineTo(rx,ry+4);ctx.strokeStyle='rgba(255,255,255,.76)';ctx.stroke();
      }
    }
    ctx.restore();
    var orientation=vi.view==='axial'?['L','R','A','P']:vi.view==='coronal'?['L','R','S','I']:['P','A','S','I'];ctx.save();ctx.font='600 11px Arial';ctx.fillStyle='#d1e2e5';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(orientation[0],viewport.x+7,viewport.y+viewport.height/2);ctx.textAlign='right';ctx.fillText(orientation[1],viewport.x+viewport.width-7,viewport.y+viewport.height/2);ctx.textAlign='center';ctx.fillText(orientation[2],viewport.x+viewport.width/2,viewport.y+11);ctx.fillText(orientation[3],viewport.x+viewport.width/2,viewport.y+viewport.height-10);ctx.restore();
    var metadata={ready:true,view:vi.view,slice:slice,layout:{x:dx,y:dy,width:dw,height:dh},viewport:viewport,crop:crop,breastCrop:!!o.breastCrop,zoom:zoom,center:center,offset:offset,lesions:lesions,aspect:vi.aspect};
    canvasMetadata.set(canvas,metadata);return metadata;
  }
  function eventToROI(canvas,event) {
    var m=canvasMetadata.get(canvas);if(!m)return null;var r=canvas.getBoundingClientRect();
    var px=event.clientX-r.left,py=event.clientY-r.top,viewport=m.viewport||m.layout;
    if(px<viewport.x||py<viewport.y||px>viewport.x+viewport.width||py>viewport.y+viewport.height)return null;
    var u=(px-m.layout.x)/m.layout.width,v=(py-m.layout.y)/m.layout.height;
    if(u<0||u>1||v<0||v>1)return null;
    return {u:clamp(u-m.offset.u,0,1),v:clamp(v-m.offset.v,0,1)};
  }
  function surfaces(d) {
    if(surfaceCache)return surfaceCache;
    var points=d.surfacePoints.slice(),rings=[],bbox=[[1,1,1],[0,0,0]];
    if(!points.length) {
      for(var z=1;z<d.depth-1;z+=2)for(var y=1;y<d.height-1;y+=2)for(var x=1;x<d.width-1;x+=2) {
        var i=index(d,x,y,z);if(!d.breastMask[i])continue;
        if(!d.breastMask[index(d,x-1,y,z)]||!d.breastMask[index(d,x+1,y,z)]||!d.breastMask[index(d,x,y-1,z)]||!d.breastMask[index(d,x,y+1,z)]||!d.breastMask[index(d,x,y,z-1)]||!d.breastMask[index(d,x,y,z+1)])points.push([x/(d.width-1),y/(d.height-1),z/(d.depth-1)]);
      }
    }
    points.forEach(function(p){for(var a=0;a<3;a++){bbox[0][a]=Math.min(bbox[0][a],p[a]);bbox[1][a]=Math.max(bbox[1][a],p[a]);}});
    for(var layer=1;layer<d.depth;layer+=3) {
      var slice=layer/(d.depth-1),vi=viewInfo(d,'axial'),mask=planeMask(d,vi,slice,'breast');
      var seg=contourSegments(mask,d.width,d.height);
      rings.push({z:slice,segments:seg});
    }
    var enriched=points.map(function(p){
      var x=p[0]*(d.width-1),y=p[1]*(d.height-1),z=p[2]*(d.depth-1);
      var nx=maskAt(d,d.breastMask,x-1,y,z)-maskAt(d,d.breastMask,x+1,y,z);
      var ny=maskAt(d,d.breastMask,x,y-1,z)-maskAt(d,d.breastMask,x,y+1,z);
      var nz=maskAt(d,d.breastMask,x,y,z-1)-maskAt(d,d.breastMask,x,y,z+1);
      var norm=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      return {p:p,n:[nx/norm,ny/norm,nz/norm],signal:sample(d,x,y,z)};
    });
    surfaceCache={points:enriched,rings:rings,bbox:bbox};return surfaceCache;
  }
  function drawVolume(canvas,options) {
    var o=options||{},f=fit(canvas),ctx=f.ctx,w=f.width,h=f.height,d=data();
    ctx.clearRect(0,0,w,h);ctx.fillStyle=SETTINGS.background;ctx.fillRect(0,0,w,h);if(!d)return {ready:false};
    var geo=surfaces(d),selected=Number(o.selected||o.region)||0;
    var rotation=(o.rotation==null?SETTINGS.volumeRotation:Number(o.rotation))*Math.PI/180;
    var elevation=(o.elevation==null?SETTINGS.volumeElevation:Number(o.elevation))*Math.PI/180;
    var cs=Math.cos(rotation),sn=Math.sin(rotation),ce=Math.cos(elevation),se=Math.sin(elevation);
    var dims=[d.width*d.spacing[0],d.height*d.spacing[1],d.depth*d.spacing[2]],longest=Math.max.apply(null,dims);
    var center=geo.bbox[0].map(function(a,i){return (a+geo.bbox[1][i])/2;});
    function rotate(p) {
      var x=(p[0]-center[0])*dims[0]/longest,y=(p[1]-center[1])*dims[1]/longest,z=(p[2]-center[2])*dims[2]/longest;
      var xx=x*cs+z*sn,zz=-x*sn+z*cs;
      return {x:xx,y:y*ce-zz*se,z:y*se+zz*ce};
    }
    var bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
    for(var a=0;a<8;a++) {
      var p=rotate([geo.bbox[(a>>0)&1][0],geo.bbox[(a>>1)&1][1],geo.bbox[(a>>2)&1][2]]);
      bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);
    }
    var scale=Math.min(w*.86/(bounds.maxX-bounds.minX),h*.8/(bounds.maxY-bounds.minY));
    var midX=(bounds.minX+bounds.maxX)/2,midY=(bounds.minY+bounds.maxY)/2;
    function project(p) {var q=rotate(p);return {x:w*.5+(q.x-midX)*scale,y:h*.5-(q.y-midY)*scale,z:q.z};}
    function path3(points,closed) {ctx.beginPath();points.forEach(function(p,i){var q=project(p);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});if(closed)ctx.closePath();}
    // Surface points and cross-sections are sampled from breastMask itself.
    // No ellipsoid is used to substitute for the anatomy.
    var pts=geo.points.map(function(p){var q=project(p.p);q.source=p;return q;});pts.sort(function(a,b){return a.z-b.z;});
    if(d.breastSurface) {
      var projected=d.breastSurface.vertices.map(project);
      var faces=d.breastSurface.faces.map(function(face){return {face:face,depth:(projected[face[0]].z+projected[face[1]].z+projected[face[2]].z)/3};});
      faces.sort(function(a,b){return a.depth-b.depth;});
      faces.forEach(function(item){
        var face=item.face,a=projected[face[0]],b=projected[face[1]],c=projected[face[2]];
        var ab=[b.x-a.x,b.y-a.y,b.z-a.z],ac=[c.x-a.x,c.y-a.y,c.z-a.z];
        var light=clamp(Math.abs(ab[0]*ac[1]-ab[1]*ac[0])/(Math.hypot(ab[0],ab[1])*Math.hypot(ac[0],ac[1])+1e-5),0,1);
        if(d.breastSurface.normals) {
          var normal=[0,0,0];face.forEach(function(i){var n=d.breastSurface.normals[i];normal[0]+=n[0];normal[1]+=n[1];normal[2]+=n[2];});
          var nx=normal[0]*cs+normal[2]*sn,nz=-normal[0]*sn+normal[2]*cs,ny=normal[1]*ce-nz*se,viewZ=normal[1]*se+nz*ce;
          light=.25+.75*clamp(Math.abs(.25*nx+.35*ny+.9*viewZ)/(Math.hypot(nx,ny,viewZ)*Math.hypot(.25,.35,.9)+1e-9),0,1);
        }
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();
        ctx.fillStyle='rgba('+Math.round(111+light*49)+','+Math.round(164+light*43)+','+Math.round(171+light*42)+','+SETTINGS.breastSurfaceOpacity+')';ctx.fill();
      });
    } else {
      pts.forEach(function(q){
        var p=q.source,light=.5+.3*Math.abs(p.n[2]*ce-p.n[1]*se)+p.signal/255*.27;
        var value=Math.round(clamp(light,0,1)*115+49);
        ctx.fillStyle='rgba('+Math.round(value*.81)+','+value+','+Math.round(value*1.02)+',.055)';
        ctx.beginPath();ctx.arc(q.x,q.y,2.8,0,TAU);ctx.fill();
      });
      geo.rings.forEach(function(ring){
        ctx.beginPath();ring.segments.forEach(function(s){var a=project(planeTo3D('axial',s[0][0]/(d.width-1),s[0][1]/(d.height-1),ring.z)),b=project(planeTo3D('axial',s[1][0]/(d.width-1),s[1][1]/(d.height-1),ring.z));ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);});
        ctx.strokeStyle='rgba(145,214,207,.18)';ctx.lineWidth=.9;ctx.stroke();
      });
    }
    var contourScale=clamp(o.contourScale==null?1:Number(o.contourScale),.7,1.3);
    var lesionPositions=[];
    if(d.lesionSurfaces.length) {
      var triangles=[],light=SETTINGS.lesionLightDirection,lightLength=Math.hypot(light[0],light[1],light[2]);
      d.lesionSurfaces.forEach(function(mesh){
        var id=mesh.id,definition=d.lesions.find(function(l){return l.id===id;}),pivot=mesh.center||(definition&&definition.center)||[.5,.5,.5];
        var projected=mesh.vertices.map(function(p){return project(p.map(function(v,a){return pivot[a]+(v-pivot[a])*contourScale;}));});
        var normals=(mesh.normals||[]).map(function(n){
          // Stored normals are physical; compensate the existing N/(N-1) scene scale.
          var scenePhysical=mesh.normalSpace==='scene-physical';
          var nx=n[0]*(scenePhysical?1:(d.width-1)/d.width),ny=n[1]*(scenePhysical?1:(d.height-1)/d.height),nz=n[2]*(scenePhysical?1:(d.depth-1)/d.depth);
          var xx=nx*cs+nz*sn,zz=-nx*sn+nz*cs;return [xx,ny*ce-zz*se,ny*se+zz*ce];
        });
        var rgb=parseInt(SETTINGS.colors[id-1].slice(1),16),alpha=selected&&selected!==id?SETTINGS.unselectedLesionSurfaceOpacity:SETTINGS.lesionSurfaceOpacity;
        mesh.faces.forEach(function(face){
          var a=projected[face[0]],b=projected[face[1]],c=projected[face[2]],normal=[0,0,0];
          face.forEach(function(i){var n=normals[i]||[0,0,1];normal[0]+=n[0];normal[1]+=n[1];normal[2]+=n[2];});
          var length=Math.max(1e-8,Math.hypot(normal[0],normal[1],normal[2])),diffuse=Math.max(0,(normal[0]*light[0]+normal[1]*light[1]+normal[2]*light[2])/(length*lightLength));
          var shade=.48+.52*diffuse,highlight=22*Math.pow(Math.max(0,normal[2]/length),10);
          var red=Math.min(255,((rgb>>16)&255)*shade+highlight),green=Math.min(255,((rgb>>8)&255)*shade+highlight),blue=Math.min(255,(rgb&255)*shade+highlight);
          triangles.push({a:a,b:b,c:c,depth:(a.z+b.z+c.z)/3,fill:'rgba('+Math.round(red)+','+Math.round(green)+','+Math.round(blue)+','+alpha+')'});
        });
      });
      triangles.sort(function(a,b){return a.depth-b.depth;});
      triangles.forEach(function(t){ctx.beginPath();ctx.moveTo(t.a.x,t.a.y);ctx.lineTo(t.b.x,t.b.y);ctx.lineTo(t.c.x,t.c.y);ctx.closePath();ctx.fillStyle=t.fill;ctx.fill();
        // Same-color subpixel strokes close Canvas antialias seams without a mesh grid.
        ctx.strokeStyle=t.fill;ctx.lineWidth=SETTINGS.lesionSurfaceEdgeWidth;ctx.lineJoin='round';ctx.stroke();});
    } else if(d.displayEffects){
      d.lesions.forEach(function(l,i){
        var id=l.id||i+1,color=SETTINGS.colors[id-1],alpha=selected&&selected!==id?.33:1,sections=[];
        for(var k=0;k<=16;k++) {
          var zz=(k/16-.5)*2,rr=Math.sqrt(Math.max(0,1-zz*zz)),points=[];
          for(var j=0;j<=48;j++) {var angle=j/48*TAU;points.push([l.center[0]+Math.cos(angle)*l.radii[0]*rr*contourScale,l.center[1]+Math.sin(angle)*l.radii[1]*rr*contourScale,l.center[2]+zz*l.radii[2]*contourScale]);}
          sections.push({points:points,z:rotate([l.center[0],l.center[1],l.center[2]+zz*l.radii[2]*contourScale]).z});
        }
        sections.sort(function(a,b){return a.z-b.z;});sections.forEach(function(s){path3(s.points,true);ctx.fillStyle=rgba(color,.09*alpha);ctx.fill();ctx.strokeStyle=rgba(color,.62*alpha);ctx.lineWidth=.8;ctx.stroke();});
        for(var mer=0;mer<6;mer++) {
          var longitude=mer/6*TAU,line=[];
          for(var n=0;n<=32;n++){var angle=n/32*TAU;line.push([l.center[0]+Math.cos(longitude)*Math.sin(angle)*l.radii[0]*contourScale,l.center[1]+Math.sin(longitude)*Math.sin(angle)*l.radii[1]*contourScale,l.center[2]+Math.cos(angle)*l.radii[2]*contourScale]);}
          path3(line,false);ctx.strokeStyle=rgba(color,.38*alpha);ctx.lineWidth=.6;ctx.stroke();
        }
      });
    } else {
      (d.lesionSurfacePoints||[]).forEach(function(p){var id=p[3],color=SETTINGS.colors[id-1],alpha=selected&&selected!==id?.22:1,q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,1.5,0,TAU);ctx.fillStyle=rgba(color,alpha);ctx.fill();});
    }
    d.lesions.forEach(function(l,i){var id=l.id||i+1,q=project(l.center);lesionPositions.push({id:id,x:q.x/w,y:q.y/h,screenX:q.x,screenY:q.y,color:SETTINGS.colors[id-1]});});
    var view=o.view||'axial',vi=viewInfo(d,view),slice=clamp(o.slice==null?defaultSlice(view):Number(o.slice),0,1);
    if(o.plane===true) {
      var minU=geo.bbox[0][vi.axes[0]]-.025,maxU=geo.bbox[1][vi.axes[0]]+.025;
      var minV=vi.reverseY?1-geo.bbox[1][vi.axes[1]]-.025:geo.bbox[0][vi.axes[1]]-.025;
      var maxV=vi.reverseY?1-geo.bbox[0][vi.axes[1]]+.025:geo.bbox[1][vi.axes[1]]+.025;
      var plane=[[minU,minV],[maxU,minV],[maxU,maxV],[minU,maxV]].map(function(p){return planeTo3D(vi.view,p[0],p[1],slice);});
      path3(plane,true);ctx.fillStyle='rgba(108,224,207,.025)';ctx.fill();ctx.strokeStyle='rgba(130,227,211,.25)';ctx.lineWidth=.8;ctx.stroke();
      var active=contourSegments(planeMask(d,vi,slice,'breast'),vi.cols,vi.rows);ctx.beginPath();
      active.forEach(function(s){var p=project(planeTo3D(vi.view,s[0][0]/(vi.cols-1),s[0][1]/(vi.rows-1),slice)),q=project(planeTo3D(vi.view,s[1][0]/(vi.cols-1),s[1][1]/(vi.rows-1),slice));ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);});
      ctx.strokeStyle='rgba(137,231,215,.66)';ctx.lineWidth=1;ctx.stroke();
    }
    var definitions=getLesions('axial',d.defaultSlice),metrics=definitions.map(function(l){return {id:l.id,volumeMl:l.volumeMl*Math.pow(contourScale,3),diameterMm:l.diameterMm*contourScale};});
    return {ready:true,lesions:lesionPositions,metrics:metrics,view:vi.view,slice:slice};
  }
  // Return the saved lesion-mask label under a view coordinate, independently of curve type.
  function getLesionAt(view,u,v,slice) {
    var d=data();if(!d||!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)return 0;
    var vi=viewInfo(d,view||'axial'),p=planeTo3D(vi.view,u,v,slice==null?defaultSlice(vi.view):slice);
    return maskAt(d,d.lesionMask,p[0]*(d.width-1),p[1]*(d.height-1),p[2]*(d.depth-1));
  }
  function measureROI(view,u,v,slice,radius) {
    var d=data(),vi=viewInfo(d,view||'axial');if(!d.signalVolumes||d.signalVolumes.length!==4)return {valid:false,values:[0,0,0,0],reason:'Sampling data unavailable'};
    var rx=(radius||.055)*Math.min(1,1/vi.aspect),ry=(radius||.055)*Math.min(1,vi.aspect),signals=[[],[],[],[]];
    for(var y=0;y<vi.rows;y++)for(var x=0;x<vi.cols;x++){
      var uu=x/(vi.cols-1),vv=y/(vi.rows-1);if(Math.pow((uu-u)/rx,2)+Math.pow((vv-v)/ry,2)>1)continue;
      var p=planeTo3D(vi.view,uu,vv,slice),xx=Math.round(p[0]*(d.width-1)),yy=Math.round(p[1]*(d.height-1)),zz=Math.round(p[2]*(d.depth-1)),i=index(d,xx,yy,zz);
      if(!d.breastMask[i]||d.signalVolumes[0][i]*d.signalScale<d.minimumBaselineSignal)continue;
      for(var t=0;t<4;t++)signals[t].push(d.signalVolumes[t][i]*d.signalScale);
    }
    if(signals[0].length<8)return {valid:false,values:[0,0,0,0],reason:'Move the ring onto breast tissue'};
    function median(a){a.sort(function(x,y){return x-y;});var n=a.length,m=Math.floor(n/2);return n%2?a[m]:(a[m-1]+a[m])/2;}
    var medians=signals.map(median),values=medians.map(function(s){return 100*(s-medians[0])/medians[0];});
    var initial=values[1],delayed=100*(medians[3]-medians[1])/Math.max(medians[1],1e-6),type=initial<50?null:delayed>10?'I':delayed< -10?'III':'II';
    return {valid:true,values:values,signal:medians,voxels:signals[0].length,type:type,typeLabel:type==='I'?'Persistent':type==='II'?'Plateau':type==='III'?'Washout':'Below initial-enhancement threshold'};
  }
  function getDataInfo() {var d=data();return d?{width:d.width,height:d.height,depth:d.depth,spacing:d.spacing.slice(),defaultSlice:d.defaultSlice,synthetic:d.synthetic,kineticsTimesSeconds:d.kineticsTimesSeconds.slice(),description:d.description||'Breast MRI demonstration'}:{ready:false};}
  // Isolate a second image dataset without changing the segmentation/report case.
  function createDatasetViewer(ref) {
    var state={source:null,sourceRef:null,imageCache:new Map(),surfaceCache:null};
    function run(fn,args){
      var previous={source:source,sourceRef:sourceRef,imageCache:imageCache,surfaceCache:surfaceCache,ref:activeDataRef};
      source=state.source;sourceRef=state.sourceRef;imageCache=state.imageCache;surfaceCache=state.surfaceCache;activeDataRef=ref;
      try{return fn.apply(null,args);}finally{
        state={source:source,sourceRef:sourceRef,imageCache:imageCache,surfaceCache:surfaceCache};
        source=previous.source;sourceRef=previous.sourceRef;imageCache=previous.imageCache;surfaceCache=previous.surfaceCache;activeDataRef=previous.ref;
      }
    }
    var api={};
    Object.entries({draw:draw,measureROI:measureROI,getLesionAt:getLesionAt,eventToROI:eventToROI,getDataInfo:getDataInfo,getDefaultSlice:defaultSlice}).forEach(function(entry){api[entry[0]]=function(){return run(entry[1],arguments);};});
    return api;
  }
  window.BreastDemo={createDatasetViewer:createDatasetViewer,draw:draw,drawVolume:drawVolume,getLesions:getLesions,getDefaultSlice:defaultSlice,eventToROI:eventToROI,measureROI:measureROI,getDataInfo:getDataInfo,settings:SETTINGS};
})();
