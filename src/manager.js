import { Game } from './engine.js';
import { gamePayload,gameComponents,controlComponents,shopPayload,winPayload } from './views.js';

export class SerialQueue {
  constructor(){this.tails=new Map();}
  run(key,fn){
    const next=(this.tails.get(key)||Promise.resolve()).then(fn);
    const tail=next.catch(()=>{});this.tails.set(key,tail);
    tail.finally(()=>{if(this.tails.get(key)===tail)this.tails.delete(key);});
    return next;
  }
}
export class GameManager {
  constructor(store,config,{payload=gamePayload,winner=winPayload,now=()=>Date.now()}={}){
    this.store=store;this.config=config;this.queue=new SerialQueue();this.games=new Map();this.now=now;
    this.payload=payload;this.winnerPayload=winner;
    store.db.exec('CREATE TABLE IF NOT EXISTS active_messages (game TEXT PRIMARY KEY, channel TEXT, main TEXT, controls TEXT, extra TEXT)');
  }
  remember(e){this.store.db.prepare('INSERT OR REPLACE INTO active_messages(game,channel,main,controls,extra) VALUES(?,?,?,?,?)').run(e.game.id,e.channel.id,e.main?.id||null,e.controls?.id||null,e.extra?.id||null);}
  forget(e){clearTimeout(e.timer);clearTimeout(e.repaint);if(this.games.get(e.channel.id)===e)this.games.delete(e.channel.id);this.store.db.prepare('DELETE FROM active_messages WHERE game=?').run(e.game.id);}
  scheduleSync(e){
    if(e.repaint)return;
    e.repaint=setTimeout(()=>{
      e.repaint=null;
      this.queue.run(e.channel.id,async()=>{if(this.games.get(e.channel.id)===e)await this.sync(e);}).catch(error=>this.fail(e,error));
    },450);
    e.repaint.unref?.();
  }
  async start(channel,type,host){
    return this.queue.run(channel.id,async()=>{
      if(this.games.has(channel.id))throw new Error('يوجد قيم شغال في هذا الروم. انتظر نهايته أو استخدم /ايقاف.');
      const game=new Game({type,guild:channel.guild.id,channel:channel.id,host,store:this.store,settings:this.config});
      const e={game,channel,main:null,controls:null,extra:null,timer:null};this.games.set(channel.id,e);
      try{await this.sync(e);}catch(error){await this.fail(e,error);throw error;}
      return e;
    });
  }
  async sync(e){
    clearTimeout(e.repaint);e.repaint=null;
    const g=e.game;
    if(['ended','cancelled'].includes(g.phase)){
      clearTimeout(e.timer);
      // Commit the result before doing network I/O. Repeated calls cannot award twice.
      const stats=g.winner?this.store.reward(g.id,g.guild,g.winner):null;
      try{
        if(e.main)await e.main.edit({components:[]});
        if(e.controls)await e.controls.edit({components:[]});
        if(e.extra)await e.extra.edit({components:[]});
        if(!e.announced){
          const payload=g.phase==='ended'?await this.winnerPayload(g,stats,this.config.name):{content:g.cancelReason,allowedMentions:{parse:[]}};
          await e.channel.send(payload);e.announced=true;
        }
      }finally{this.forget(e);}
      return;
    }
    if(!g.deadline)g.deadline=this.now()+g.duration;
    const payload=await this.payload(g,this.config.name);
    // Membership updates reuse the existing banner instead of reuploading a PNG for every click.
    if(e.main&&g.phase==='lobby'&&e.renderedVersion===g.version){delete payload.files;delete payload.attachments;}
    if(e.main)await e.main.edit(payload);else e.main=await e.channel.send(payload);
    e.renderedVersion=g.version;
    this.remember(e);
    const extraRows=gameComponents(g).slice(5,10);
    if(extraRows.length){
      const extra={content:'بقية الخيارات',components:extraRows,allowedMentions:{parse:[]}};
      if(e.extra)await e.extra.edit(extra);else e.extra=await e.channel.send(extra);
      this.remember(e);
    }else if(e.extra)await e.extra.edit({content:'—',components:[]});
    const components=controlComponents(g);
    if(components.length){
      const controls={content:'خيارات القيم',components,allowedMentions:{parse:[]}};
      if(e.controls)await e.controls.edit(controls);else e.controls=await e.channel.send(controls);
      this.remember(e);
    }
    clearTimeout(e.timer);
    const version=g.version;
    e.timer=setTimeout(()=>{this.queue.run(e.channel.id,async()=>{
      if(this.games.get(e.channel.id)!==e||g.version!==version)return;
      if(g.timeout(version))await this.sync(e);
    }).catch(error=>this.fail(e,error));},Math.max(1,g.deadline-this.now()));
    e.timer.unref?.();
  }
  async fail(e,error){
    console.error('[GAME_ERROR]',error.code||error.name); // Never log tokens or interaction objects.
    this.forget(e);
    for(const m of [e.main,e.controls,e.extra])if(m)await m.edit({components:[]}).catch(()=>{});
    const message=e.game.winner?'تعذر عرض بطاقة الفوز؛ احتُسبت نقطة الفوز والفوزة.':'توقف القيم بسبب خطأ في إرسال الرسائل. راجع صلاحيات البوت وسجل الاستضافة.';
    await e.channel.send({content:message,allowedMentions:{parse:[]}}).catch(()=>{});
  }
  async click({channelId,guildId,id,version,action,value,user,receivedAt,respond}){
    return this.queue.run(channelId,async()=>{
      const e=this.games.get(channelId);
      if(!e||e.game.id!==id||e.game.guild!==guildId)throw new Error('انتهى هذا القيم أو أُعيد تشغيل البوت.');
      const g=e.game;
      // A late request must not beat an expired timer that is still in the event queue.
      if(g.deadline && receivedAt>=g.deadline){g.timeout(g.version);try{await this.sync(e);}catch(error){await this.fail(e,error);}throw new Error('انتهت مهلة هذا الدور.');}
      g.check(version);
      let response='تم.',dirty=true;
      switch(action){
        case 'join':g.add({...user,joinedAt:receivedAt});response=`دخلت القيم. المشاركين: ${g.players.length}. رقمك يظهر بعد البداية.`;break;
        case 'leave':g.remove(user.id);response='خرجت من التسجيل.';break;
        case 'shop':g.requirePlayer(user.id);if(g.phase!=='lobby'||g.type!=='roulette')throw new Error('المتجر مغلق.');await respond(shopPayload(g,user.id));return;
        case 'buy':g.buy(user.id,value);await respond({...shopPayload(g,user.id),content:'تم الشراء ✅'});return;
        case 'kick':g.kick(user.id,value);break;
        case 'withdraw':g.withdraw(user.id);response='انسحبت من القيم.';break;
        case 'reveal':{
          const ids=g.reveal(user.id);response=ids.length?`🔎 معهم مرتدة الآن: ${ids.map(x=>`<@${x}>`).join('، ')}\nتم استهلاك كشف واحد.`:'🔎 لا يوجد لاعب متبقٍ معه مرتدة. تم استهلاك كشف واحد.';dirty=false;break;
        }
        case 'nuke':g.nuke(user.id);response='☢️ استخدمت القنبلة النووية!';break;
        case 'hide':g.hide(user.id,Number(value));response=`اختبأت في المربع ${value}. اختيارك سري.`;break;
        case 'seek':g.seek(user.id,Number(value));break;
        case 'chair':g.chair(user.id,Number(value));response=g.player(user.id).alive?'حجزت كرسيك ✅':'ضغطت الأحمر وخرجت 🔴';break;
        case 'mine':g.mine(user.id,Number(value));break;
        default:throw new Error('زر غير معروف.');
      }
      // Result persistence must not depend on the ephemeral confirmation succeeding.
      if(g.winner)this.store.reward(g.id,g.guild,g.winner);
      await respond({content:response,embeds:[],components:[],allowedMentions:{parse:[]}});
      if(dirty){
        if(g.version===version)this.scheduleSync(e);
        else try{await this.sync(e);}catch(error){await this.fail(e,error);}
      }
    });
  }
  async stop(channelId,userId,admin){
    return this.queue.run(channelId,async()=>{
      const e=this.games.get(channelId);if(!e)throw new Error('لا يوجد قيم شغال هنا.');
      if(!admin&&e.game.host!==userId)throw new Error('الإيقاف لصاحب القيم أو الإدارة فقط.');
      e.game.cancel();await this.sync(e);
    });
  }
  async recover(client){
    // In-progress rounds are cancelled on restart, but stats and inventory survive.
    for(const row of this.store.db.prepare('SELECT * FROM active_messages').all()){
      try{
        const channel=await client.channels.fetch(row.channel);
        if(channel?.isTextBased()){
          for(const id of [row.main,row.controls,row.extra].filter(Boolean)){
            try{const m=await channel.messages.fetch(id);await m.edit({components:[]});}catch{}
          }
          await channel.send({content:'أُعيد تشغيل البوت؛ أُلغي القيم السابق. النقاط والفوزات والأغراض محفوظة. ابدأ قيمًا جديدًا.',allowedMentions:{parse:[]}});
        }
      }catch(error){console.error('[RECOVER]',error.code||error.name);}
      this.store.db.prepare('DELETE FROM active_messages WHERE game=?').run(row.game);
    }
  }
  async shutdown(){
    await Promise.all([...this.games.values()].map(e=>this.queue.run(e.channel.id,async()=>{e.game.cancel('توقف البوت؛ أُلغي القيم. النقاط والفوزات والأغراض محفوظة.');await this.sync(e).catch(error=>this.fail(e,error));})));
  }
}
