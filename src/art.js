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
async function portrait(ctx,p,x,y,r,border=null) {
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
  const img=await avatar(p.avatar);
  if(img){const s=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,x-r,y-r,r*2,r*2);}
  else{const g=ctx.createLinearGradient(x-r,y-r,x+r,y+r);g.addColorStop(0,border?'#403a34':'#73459b');g.addColorStop(1,border?'#191613':'#2f1d4b');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);text(ctx,Array.from(clean(p.name)).slice(0,2).join(''),x,y,r*.7,white,r*1.6);}
  ctx.restore();
  const rim=ctx.createLinearGradient(x-r,y+r,x+r,y-r);
  rim.addColorStop(0,'#201824');rim.addColorStop(.35,'#41284c');rim.addColorStop(.55,'#9e61b7');rim.addColorStop(.7,'#e6b3f4');rim.addColorStop(1,'#45274e');
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=border||rim;ctx.lineWidth=border?2:4;ctx.stroke();
}
const templates=new Map();
function template(name) {
  if(!templates.has(name))templates.set(name,loadImage(path.join(ROOT,'assets/cards',`${name}.png`)));
  return templates.get(name);
}

export async function lobbyCard(type) {
  const card=type==='roulette'?'roulette-lobby':type==='reverse'?'roulette':type;
  const source=await template(card);
  const canvas=createCanvas(source.width*2,source.height*2);
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  ctx.drawImage(source,0,0);
  if(type==='reverse'){
    ctx.fillStyle='#1a191e';
    ctx.fillRect(19,10,100,43);
    text(ctx,'روليت',65,18,25,white,97);
    text(ctx,'عكسي',65,43,19,white,97);
  }
  return canvas.toBuffer('image/png');
}
export async function rouletteCard(game) {
  if(game.type==='roulette')return regularRouletteWheel(game);
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

async function regularRouletteWheel(game) {
  const size=408;
  const canvas=createCanvas(size,size);
  const ctx=canvas.getContext('2d');
  const center=size/2;
  const radius=196;
  const players=game.alive();
  const slice=2*Math.PI/players.length;
  const selected=players.findIndex(player=>player.id===game.actor);
  const offset=-(selected+.5)*slice;

  ctx.save();
  ctx.translate(center,center);
  for(const [index,player] of players.entries()){
    const start=offset+index*slice;
    const angle=start+slice/2;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,radius,start,start+slice);
    ctx.closePath();
    ctx.fillStyle=index%2?'#897156':'#e5dcc4';
    ctx.fill();
    ctx.lineWidth=3.4;
    ctx.strokeStyle='#10100e';
    ctx.stroke();

    ctx.save();
    const radialDistance=127;
    ctx.translate(Math.cos(angle)*radialDistance,Math.sin(angle)*radialDistance);
    ctx.rotate(angle+(Math.cos(angle)<0?Math.PI:0));
    // Scale the text to stay inside narrow wedges without dropping player names.
    const wedgeScale=Math.min(1,slice*3.9);
    ctx.scale(1,wedgeScale);
    text(ctx,player.name,0,0,players.length>28?13:14,'#15120f',119);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0,0,radius,0,Math.PI*2);
  ctx.strokeStyle='#0b0b0a';
  ctx.lineWidth=4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(42,-14);
  ctx.lineTo(64,0);
  ctx.lineTo(42,14);
  ctx.closePath();
  ctx.fillStyle='#eee9dc';
  ctx.fill();
  ctx.restore();

  await portrait(ctx,players[selected],center,center,50,'#eee9dc');
  return canvas.toBuffer('image/png');
}
export async function winnerCard(player,stats) {
  const source=await template('winner');
  const canvas=createCanvas(source.width*2,source.height*2);
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  ctx.drawImage(source,0,0);
  await portrait(ctx,player,375,150,98);
  text(ctx,player.name,374,329,20,'#f7f5fa',214);
  text(ctx,`نقاط الألعاب: ${stats.points}  |  الفوزات: ${stats.wins}`,683,425,19,'#f2eff5',635,'right');
  return canvas.toBuffer('image/png');
}
