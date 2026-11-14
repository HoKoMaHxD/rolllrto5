import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, GAME_NAMES } from './config.js';

GlobalFonts.registerFromPath(path.join(ROOT,'assets/fonts/NotoKufiArabic-Bold.ttf'),'ArenaArabic');
GlobalFonts.registerFromPath(path.join(ROOT,'assets/fonts/DejaVuSans.ttf'),'ArenaLatin');
const purple='#ba7be7', ink='#19191f', white='#f5f0fa';
let bgPromise;
const avatarCache=new Map();
const clean=s=>String(s||'Player').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'');
function text(ctx,s,x,y,size=34,color=white,maxWidth=900,align='center') {
  s=clean(s); ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline='middle';
  ctx.direction=/[\u0600-\u06ff]/.test(s)?'rtl':'ltr';
  ctx.font=`bold ${size}px ArenaArabic, ArenaLatin`;
  while(ctx.measureText(s).width>maxWidth&&size>14){size--;ctx.font=`bold ${size}px ArenaArabic, ArenaLatin`;}
  // Keep extreme Unicode names inside their boxes even at the smallest font.
  while(ctx.measureText(s).width>maxWidth&&s.length>2) s=s.slice(0,-2)+'…';
  ctx.fillText(s,x,y); ctx.direction='ltr';
}
function box(ctx,x,y,w,h,r=20,fill='#24222c',stroke='#40334c') {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
}
async function base(w,h) {
  const canvas=createCanvas(w,h),ctx=canvas.getContext('2d'); ctx.fillStyle=ink;ctx.fillRect(0,0,w,h);
  if(!bgPromise){const p=path.join(ROOT,'assets/ribbons.png');bgPromise=existsSync(p)?loadImage(p).catch(()=>null):Promise.resolve(null);}
  const bg=await bgPromise;
  if(bg) ctx.drawImage(bg,0,0,w,h);
  return {canvas,ctx};
}
async function avatar(url) {
  if(!url)return null;
  if(avatarCache.has(url))return avatarCache.get(url);
  const p=(async()=>{
    try{
      const u=new URL(url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))return null;
      const res=await fetch(url,{signal:AbortSignal.timeout(4000),redirect:'error'});
      if(!res.ok || Number(res.headers.get('content-length')||0)>2000000)return null;
      const chunks=[];let size=0;for await(const part of res.body){size+=part.length;if(size>2000000)return null;chunks.push(part);}
      return await loadImage(Buffer.concat(chunks));
    }catch{return null;}
  })();avatarCache.set(url,p);if(avatarCache.size>200)avatarCache.delete(avatarCache.keys().next().value);return p;
}
async function portrait(ctx,p,x,y,r) {
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
  const img=await avatar(p.avatar);
  if(img){const s=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,x-r,y-r,r*2,r*2);}
  else{const g=ctx.createLinearGradient(x-r,y-r,x+r,y+r);g.addColorStop(0,'#73459b');g.addColorStop(1,'#2f1d4b');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);text(ctx,Array.from(clean(p.name)).slice(0,2).join(''),x,y,r*.7,white,r*1.6);}
  ctx.restore();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=purple;ctx.lineWidth=5;ctx.stroke();
}
function icon(ctx,type,x,y,scale=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.shadowColor='#a568d3';ctx.shadowBlur=25;
  const gradient=ctx.createLinearGradient(-150,-140,150,140);gradient.addColorStop(0,'#dfb9fa');gradient.addColorStop(.35,'#76518c');gradient.addColorStop(1,'#251330');
  ctx.fillStyle=gradient;ctx.strokeStyle='#e8d4f8';ctx.lineWidth=5;
  if(type==='roulette'||type==='reverse'){
    ctx.beginPath();ctx.arc(0,0,145,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
    for(let i=0;i<10;i++){ctx.save();ctx.rotate(i*Math.PI/5);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-138);ctx.strokeStyle=i%2?'#f4e2fc':'#9362b0';ctx.lineWidth=2;ctx.stroke();ctx.restore();}
    ctx.beginPath();ctx.arc(0,0,38,0,Math.PI*2);ctx.fillStyle='#23152e';ctx.fill();ctx.stroke();
    text(ctx,type==='reverse'?'↶':'R',0,0,44,purple,70);
    ctx.beginPath();ctx.moveTo(0,-114);ctx.lineTo(-20,-160);ctx.lineTo(20,-160);ctx.closePath();ctx.fillStyle=white;ctx.fill();
  } else if(type==='hide'){
    ctx.beginPath();ctx.ellipse(0,-15,162,38,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-103,-25);ctx.lineTo(-88,-135);ctx.quadraticCurveTo(0,-100,88,-135);ctx.lineTo(105,-25);ctx.closePath();ctx.fill();ctx.stroke();
    box(ctx,-100,-47,200,25,8,'#291537',null);ctx.shadowBlur=0;
    for(const cx of [-60,60]){ctx.beginPath();ctx.arc(cx,70,49,0,Math.PI*2);ctx.fillStyle='#b286c8';ctx.fill();ctx.strokeStyle='#6b457e';ctx.lineWidth=12;ctx.stroke();}
    ctx.beginPath();ctx.moveTo(-12,61);ctx.quadraticCurveTo(0,47,12,61);ctx.stroke();
  } else if(type==='chairs'){
    box(ctx,-112,-145,224,240,58,'#ede8f1','#ffffff');
    box(ctx,-120,35,240,84,24,'#bcb5c4','#ffffff');
    box(ctx,-153,-22,55,151,25,'#f8f4fa','#d6cbdc');box(ctx,98,-22,55,151,25,'#f8f4fa','#d6cbdc');
    box(ctx,-64,-35,128,105,25,'#b271df','#d6a1fa');
    ctx.shadowBlur=0;ctx.fillStyle='#797080';ctx.fillRect(-108,126,22,49);ctx.fillRect(87,126,22,49);
  }else{
    for(const [yy,rx,ry,c] of [[63,159,65,'#4f3a60'],[24,153,65,'#bdb4cc'],[-5,142,63,'#634b78'],[-37,111,52,'#e5d9ef']]){ctx.beginPath();ctx.ellipse(0,yy,rx,ry,0,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();ctx.stroke();}
    ctx.beginPath();ctx.ellipse(0,-56,64,29,0,0,Math.PI*2);ctx.fillStyle='#c788ef';ctx.fill();ctx.stroke();
    for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(-105+i*53,68,8,0,Math.PI*2);ctx.fillStyle='#cb82fa';ctx.fill();}
  }
  ctx.restore();
}
export async function lobbyCard(type,brand='Arena Games') {
  const {canvas,ctx}=await base(1200,700);
  text(ctx,brand.toUpperCase(),600,52,23,'#9b86ac',800);
  text(ctx,GAME_NAMES[type],600,150,70,white,1050);
  icon(ctx,type,600,390,1.02);
  text(ctx,'ادخل التحدي • آخر لاعب يفوز',600,632,26,'#ddc4ee',950);
  return canvas.toBuffer('image/png');
}
export async function rouletteCard(game) {
  const players=game.alive(),n=players.length,height=Math.max(1080,380+Math.ceil(n/2)*56);
  const {canvas,ctx}=await base(1600,height);
  ctx.fillStyle='rgba(18,16,24,.52)';ctx.fillRect(0,0,1600,height);
  text(ctx,GAME_NAMES[game.type],800,80,57,white,1450);
  const actor=game.player(game.actor);text(ctx,game.type==='reverse'?'اختارت الروليت:':'الدور على:',440,182,30,'#c6abcF',700);
  text(ctx,actor?.name||'—',440,240,39,white,740);
  const cx=440,cy=665,r=320,step=Math.PI*2/n,idx=players.findIndex(p=>p.id===game.actor);
  const offset=-Math.PI/2-(idx+.5)*step;
  for(let i=0;i<n;i++){
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,offset+i*step,offset+(i+1)*step);ctx.closePath();
    ctx.fillStyle=i===idx?'#ad6bd4':i%2?'#422650':'#2f1d40';ctx.fill();ctx.strokeStyle='#9e72b3';ctx.lineWidth=2;ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(offset+(i+.5)*step);
    text(ctx,n>30?String(players[i].number):`${players[i].number} • ${Array.from(clean(players[i].name)).slice(0,11).join('')}`,r*.64,0,Math.min(25,160/n+16),white,r*.55);ctx.restore();
  }
  ctx.beginPath();ctx.arc(cx,cy,72,0,Math.PI*2);ctx.fillStyle='#1a1521';ctx.fill();ctx.strokeStyle=purple;ctx.lineWidth=5;ctx.stroke();
  text(ctx,String(n),cx,cy-12,45,white,110);text(ctx,'لاعب',cx,cy+35,20,purple,110);
  ctx.beginPath();ctx.moveTo(cx,cy-r+22);ctx.lineTo(cx-23,cy-r-28);ctx.lineTo(cx+23,cy-r-28);ctx.closePath();ctx.fillStyle=white;ctx.fill();
  const rowH=56,rows=Math.ceil(n/2);
  for(let i=0;i<n;i++){
    const p=players[i],col=Math.floor(i/rows),row=i%rows,x=825+col*365,y=300+row*rowH;
    box(ctx,x,y,345,47,12,p.id===game.actor?'#673e80':'#25212f',p.id===game.actor?'#d9a5fa':'#40314e');
    text(ctx,String(p.number),x+30,y+24,22,purple,45);
    text(ctx,p.name,x+195,y+24,23,white,260);
  }
  text(ctx,'الأرقام حسب ترتيب الدخول',1185,height-32,23,'#a995ba',690);
  return canvas.toBuffer('image/png');
}
export async function winnerCard(player,stats,brand='Arena Games') {
  const {canvas,ctx}=await base(1200,960);
  text(ctx,brand.toUpperCase(),600,49,22,'#9e85b3',900);
  // Crown above the actual winner's Discord avatar.
  ctx.save();ctx.translate(750,133);ctx.rotate(.27);const g=ctx.createLinearGradient(-80,-90,80,30);g.addColorStop(0,'#6d388b');g.addColorStop(1,'#ecc5ff');ctx.fillStyle=g;
  ctx.beginPath();ctx.moveTo(-77,24);ctx.lineTo(-95,-66);ctx.lineTo(-43,-36);ctx.lineTo(0,-100);ctx.lineTo(43,-36);ctx.lineTo(95,-66);ctx.lineTo(77,24);ctx.closePath();ctx.fill();ctx.restore();
  await portrait(ctx,player,600,330,177);
  text(ctx,'فوز مستحق !!',600,575,42,'#d3a2ef',1000);
  box(ctx,300,629,600,73,21,'#100c15','#a46cc7');text(ctx,player.name,600,668,39,white,555);
  box(ctx,40,782,1120,126,32,'#242329','#3c3645');
  text(ctx,`نقاط الألعاب: ${stats.points}  |  الفوزات: ${stats.wins}`,600,846,36,white,1040);
  return canvas.toBuffer('image/png');
}
