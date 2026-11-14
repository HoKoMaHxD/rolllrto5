import { randomInt, randomUUID } from 'node:crypto';

const DEFAULTS = { maxPlayers:50,lobbyMs:20000,turnMs:20000,hideMs:20000,chairMs:10000,reverseMs:4000 };
export class Game {
  constructor({ type, guild, channel, host, store, settings={}, rng=n=>randomInt(n), id=randomUUID() }) {
    if (!['roulette','hide','chairs','mines','reverse'].includes(type)) throw new Error('لعبة غير معروفة.');
    Object.assign(this,{type,guild,channel,host,store,rng,id,settings:{...DEFAULTS,...settings}});
    this.players=[]; this.phase='lobby'; this.version=0; this.duration=this.settings.lobbyMs;
    this.deadline=0; this.round=0; this.actor=null; this.winner=null; this.notes=[]; this.turnBag=[];
  }
  alive() { return this.players.filter(p=>p.alive); }
  player(id) { return this.players.find(p=>p.id===id); }
  requirePlayer(id) { const p=this.player(id); if(!p?.alive) throw new Error('أنت غير مشارك في هذا القيم أو خرجت منه.'); return p; }
  check(version) { if(this.phase==='ended'||this.phase==='cancelled') throw new Error('انتهى هذا القيم.'); if(version!==this.version) throw new Error('انتهى هذا الدور؛ استخدم الأزرار الجديدة.'); }
  stage(phase,duration) { this.phase=phase; this.version++; this.duration=duration; this.deadline=0; }
  choose(list) { return list[this.rng(list.length)]; }
  note(text) { this.notes.push(text); this.notes=this.notes.slice(-3); }
  add(profile) {
    if(this.phase!=='lobby') throw new Error('بدأ القيم وانتهى وقت الدخول.');
    if(this.player(profile.id)) throw new Error('أنت داخل القيم بالفعل.');
    if(this.players.length>=this.settings.maxPlayers) throw new Error('اكتمل العدد.');
    this.players.push({...profile,alive:true,number:null,spot:null});
  }
  remove(id) {
    if(this.phase!=='lobby') return this.withdraw(id);
    const p=this.player(id); if(!p) throw new Error('أنت غير مسجل.');
    this.players=this.players.filter(p=>p.id!==id);
  }
  buy(id,item) { if(this.type!=='roulette'||this.phase!=='lobby') throw new Error('المتجر متاح أثناء تسجيل الروليت العادي فقط.'); this.requirePlayer(id); return this.store.buy(this.guild,id,item); }
  start() {
    if(this.phase!=='lobby') return;
    if(this.players.length<2) { this.cancel('أُلغي القيم لعدم اكتمال لاعبين على الأقل.'); return; }
    // Discord's interaction timestamp preserves click order even if acknowledgments arrive out of order.
    this.players.sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));
    this.players.forEach((p,i)=>{p.number=i+1;}); this.started=true;
    if(this.type==='hide') { this.opened=new Set(); this.stage('hiding',this.settings.hideMs); }
    else this.next();
  }
  cancel(reason='أُلغي القيم بواسطة الإدارة.') { this.winner=null; this.cancelReason=reason; this.stage('cancelled',0); }
  finishIfNeeded() {
    if(!this.started) return false;
    const alive=this.alive();
    if(alive.length>1) return false;
    this.winner=alive[0]?.id || null; this.stage('ended',0); return true;
  }
  nextActor() {
    const alive=this.alive(); this.turnBag=this.turnBag.filter(id=>alive.some(p=>p.id===id));
    if(!this.turnBag.length){
      this.turnBag=alive.map(p=>p.id);
      for(let i=this.turnBag.length-1;i>0;i--){const j=this.rng(i+1);[this.turnBag[i],this.turnBag[j]]=[this.turnBag[j],this.turnBag[i]];}
    }
    return this.turnBag.pop();
  }
  next() {
    if(this.finishIfNeeded()) return;
    this.round++;
    if(this.type==='roulette'||this.type==='hide') { this.actor=this.nextActor(); this.stage(this.type==='hide'?'seeking':'turn',this.settings.turnMs); }
    else if(this.type==='reverse') { this.actor=this.choose(this.alive()).id; this.stage('reverse',this.settings.reverseMs); }
    else if(this.type==='chairs') {
      // Red rounds never occur twice in a row; the next green round guarantees progress.
      this.red=this.red?false:this.rng(100)<35;
      this.seats=Array.from({length:this.alive().length-1},()=>null);
      this.stage('chairs',this.settings.chairMs);
    } else if(this.type==='mines') {
      const alive=this.alive(); const survivor=alive.find(p=>p.id===this.survivor);
      const a=survivor || this.choose(alive), b=this.choose(alive.filter(p=>p.id!==a.id));
      this.duel=[a.id,b.id]; this.actor=this.choose(this.duel); this.bomb=this.rng(6)+1; this.picked=new Set();
      this.stage('duel',this.settings.turnMs);
    }
  }
  kill(id,reason) { const p=this.player(id); if(!p?.alive) return; p.alive=false; this.note(`<@${id}> ${reason}`); }
  turn(id) { this.requirePlayer(id); if(this.actor!==id) throw new Error('هذا ليس دورك.'); }
  kick(id,target) {
    if(this.phase!=='turn') throw new Error('الطرد غير متاح الآن.');
    this.turn(id); this.requirePlayer(target); if(id===target) throw new Error('لا تستطيع طرد نفسك؛ استخدم انسحاب.');
    if(this.store.consume(this.guild,target,'reflect')) this.kill(id,`انطرد بسبب مرتدة <@${target}> 🛡️`);
    else this.kill(target,`انطرد بواسطة <@${id}>.`);
    this.next();
  }
  reveal(id) {
    if(this.phase!=='turn') throw new Error('الكشف متاح في دورك في الروليت فقط.');
    this.turn(id);
    if(!this.store.consume(this.guild,id,'reveal')) throw new Error('لا تملك كشفًا. اشترِه من المتجر بنقطة أثناء التسجيل.');
    return this.alive().filter(p=>this.store.get(this.guild,p.id).reflect>0).map(p=>p.id);
  }
  nuke(id) {
    if(this.phase!=='turn') throw new Error('النووي متاح في دورك في الروليت فقط.');
    this.turn(id); if(!this.store.consume(this.guild,id,'nuke')) throw new Error('لا تملك قنبلة نووية.');
    this.alive().filter(p=>p.id!==id).forEach(p=>{p.alive=false;}); this.note(`☢️ <@${id}> استخدم القنبلة النووية!`); this.finishIfNeeded();
  }
  hide(id,spot) {
    if(this.phase!=='hiding') throw new Error('انتهت مهلة الاختباء.'); this.requirePlayer(id);
    if(!Number.isInteger(spot)||spot<1||spot>25) throw new Error('المربع غير صالح.');
    this.player(id).spot=spot;
    if(this.alive().every(p=>p.spot!==null)) this.next();
  }
  seek(id,spot) {
    if(this.phase!=='seeking') throw new Error('الكشف غير متاح الآن.'); this.turn(id);
    if(!Number.isInteger(spot)||spot<1||spot>25||this.opened.has(spot)) throw new Error('هذا المربع مفتوح أو غير صالح.');
    this.opened.add(spot);
    const victims=this.alive().filter(p=>p.spot===spot);
    for(const p of victims) this.kill(p.id,`انكشف في المربع ${spot} وخرج 👁️`);
    if(!victims.length) this.note(`المربع ${spot} فارغ.`);
    this.next();
  }
  chair(id,seat) {
    if(this.phase!=='chairs') throw new Error('الجولة غير متاحة.'); this.requirePlayer(id);
    if(!Number.isInteger(seat)||seat<0||seat>=this.seats.length||this.seats[seat]) throw new Error('هذا الكرسي محجوز أو غير صالح.');
    if(this.seats.includes(id)) throw new Error('حجزت كرسيك بالفعل.');
    this.seats[seat]=id;
    if(this.red){ this.kill(id,'ضغط على الأحمر وخرج 🔴'); this.finishIfNeeded(); }
    else if(this.seats.every(Boolean)){
      for(const p of this.alive()) if(!this.seats.includes(p.id)) this.kill(p.id,'لم يحجز كرسيًا وخرج.');
      this.next();
    }
  }
  mine(id,number) {
    if(this.phase!=='duel') throw new Error('المواجهة غير متاحة الآن.'); this.turn(id);
    if(!Number.isInteger(number)||number<1||number>6||this.picked.has(number)) throw new Error('هذا الرقم مكشوف أو غير صالح.');
    this.picked.add(number);
    if(number===this.bomb) { this.kill(id,`اختار اللغم رقم ${number} وانفجر 💣`); this.survivor=this.duel.find(x=>x!==id); this.next(); }
    else { this.note(`<@${id}> اختار ${number} وكان آمنًا.`); this.actor=this.duel.find(x=>x!==id); this.stage('duel',this.settings.turnMs); }
  }
  withdraw(id) {
    if(this.phase==='lobby')throw new Error('استخدم زر خروج أثناء التسجيل.');
    this.requirePlayer(id);
    if(['ended','cancelled'].includes(this.phase)) throw new Error('انتهى القيم.');
    this.kill(id,'انسحب من القيم.');
    if(this.finishIfNeeded()) return;
    if(this.phase==='hiding') { if(this.alive().every(p=>p.spot!==null)) this.next(); }
    else if(this.phase==='chairs') {
      // A withdrawal removes a participant; restart with the correct number of seats.
      this.next();
    } else if(this.phase==='duel'&&this.duel.includes(id)) { this.survivor=this.duel.find(x=>x!==id); this.next(); }
    else if(this.actor===id) this.next();
  }
  timeout(version) {
    if(version!==this.version || ['ended','cancelled'].includes(this.phase)) return false;
    if(this.phase==='lobby') this.start();
    else if(this.phase==='hiding') { for(const p of this.alive()) if(p.spot===null) this.kill(p.id,'لم يختبئ في الوقت المحدد.'); this.next(); }
    else if(this.phase==='chairs') {
      if(!this.red) for(const p of this.alive()) if(!this.seats.includes(p.id)) this.kill(p.id,'انتهى الوقت دون حجز كرسي.');
      this.next();
    } else {
      this.kill(this.actor,this.phase==='reverse'?'اختارته الروليت العكسية وخرج.':'انتهت مهلة اختياره وخرج ⏱️');
      if(this.phase==='duel') this.survivor=this.duel.find(x=>x!==this.actor);
      this.next();
    }
    return true;
  }
}
