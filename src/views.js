import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GAME_NAMES, ITEMS } from './config.js';
import { lobbyCard, rouletteCard, winnerCard } from './art.js';

const purple=0xa76acb;
export const mention=id=>`<@${id}>`;
const rows=buttons=>Array.from({length:Math.ceil(buttons.length/5)},(_,i)=>new ActionRowBuilder().addComponents(buttons.slice(i*5,i*5+5)));
const cid=(g,act,value='')=>`ag:${g.id}:${g.version}:${act}:${value}`;
const button=(g,act,label,style=ButtonStyle.Secondary,value='',disabled=false,emoji=null)=>{
  const b=new ButtonBuilder().setCustomId(cid(g,act,value)).setLabel(label).setStyle(style).setDisabled(disabled);
  if(emoji)b.setEmoji(emoji);return b;
};
const footer=g=>`الجولة ${g.round} • المتبقون ${g.alive().length}/${g.players.length}`;
const until=g=>`<t:${Math.ceil(g.deadline/1000)}:R>`;
const attachments=(buffer,name)=>[new AttachmentBuilder(buffer,{name})];
const lobbyCache=new Map();
export function gameComponents(g){
  let buttons=[];
  if(g.phase==='lobby'){
    buttons=[button(g,'join','دخول',ButtonStyle.Success,'',false,'➕'),button(g,'leave','خروج',ButtonStyle.Danger,'',false,'➖')];
    if(g.type==='roulette')buttons.push(button(g,'shop','المتجر',ButtonStyle.Secondary,'',false,'🛒'));
  } else if(g.phase==='turn') buttons=g.alive().filter(p=>p.id!==g.actor).map(p=>button(g,'kick',`${p.number} • ${p.name}`.slice(0,70),ButtonStyle.Secondary,p.id));
  else if(g.phase==='hiding'||g.phase==='seeking'){
    const hiding=g.phase==='hiding';
    buttons=Array.from({length:25},(_,i)=>{
      const n=i+1,open=!hiding&&g.opened.has(n);
      const emoji=hiding?null:(open?(process.env.REVEALED_EMOJI_ID||'👁️'):(process.env.HIDDEN_EMOJI_ID||'🙈'));
      return button(g,hiding?'hide':'seek',String(n),open?ButtonStyle.Success:ButtonStyle.Secondary,String(n),open,emoji);
    });
  }else if(g.phase==='chairs')buttons=g.seats.map((p,i)=>button(g,'chair',p?'محجوز':String(i+1),g.red?ButtonStyle.Danger:ButtonStyle.Success,String(i),Boolean(p)));
  else if(g.phase==='duel')buttons=Array.from({length:6},(_,i)=>button(g,'mine',g.picked.has(i+1)?'آمن':String(i+1),g.picked.has(i+1)?ButtonStyle.Success:ButtonStyle.Secondary,String(i+1),g.picked.has(i+1)));
  return rows(buttons);
}
export function controlComponents(g){
  if(['ended','cancelled','lobby'].includes(g.phase))return [];
  const controls=[button(g,'withdraw','انسحاب',ButtonStyle.Danger)];
  if(g.type==='roulette'){
    controls.push(button(g,'reveal','كشف',ButtonStyle.Secondary,'',false,'🔎'));
    const p=g.store.get(g.guild,g.actor);
    if(p.nuke>0)controls.push(button(g,'nuke','قنبلة نووية',ButtonStyle.Danger,'',false,'☢️'));
  }
  return rows(controls);
}
export function shopPayload(g,user){
  const p=g.store.get(g.guild,user);
  const embed=new EmbedBuilder().setColor(purple).setTitle('🛒 متجر الروليت')
    .setDescription(`رصيدك: **${p.points}** نقطة\nالأغراض تبقى معك حتى استخدامها، داخل هذا السيرفر.\nالشراء متاح للمشاركين أثناء التسجيل فقط.`)
    .addFields(Object.entries(ITEMS).map(([key,item])=>({name:`${item.emoji} ${item.name} — ${item.price} نقطة`,value:`تملك: **${p[key]}**\n${key==='reflect'?'تعكس طردًا واحدًا على المهاجم. لا تحمي من المهلة أو النووي.':key==='reveal'?'يكشف لك وحدك حاملي المرتدة الحاليين، مرة واحدة أثناء دورك.':'استخدمها أثناء دورك لإنهاء القيم والفوز.'}`})));
  return {embeds:[embed],components:rows(Object.entries(ITEMS).map(([key,item])=>button(g,'buy',`${item.name} • ${item.price}`,ButtonStyle.Primary,key)))};
}
export async function gamePayload(g,brand){
  const embed=new EmbedBuilder().setColor(purple).setTitle(GAME_NAMES[g.type]);
  let description='',files=[];
  if(g.phase==='lobby'){
    description=`المشاركين: **${g.players.length}** / ${g.settings.maxPlayers}\nيبدأ القيم ${until(g)}\nاضغط دخول للمشاركة. الأرقام تظهر بعد البداية.`;
    const key=`${g.type}:${brand}`;if(!lobbyCache.has(key))lobbyCache.set(key,lobbyCard(g.type,brand));
    files=attachments(await lobbyCache.get(key),'lobby.png');embed.setImage('attachment://lobby.png');
  }else if(g.phase==='turn'||g.phase==='reverse'){
    description=g.phase==='turn'?`🎯 ${mention(g.actor)} اختر لاعبًا لطرده.\nتنتهي المهلة ${until(g)}؛ عدم الاختيار يخرجك.`:`🎲 اختارت الروليت ${mention(g.actor)}\nسيخرج ${until(g)}.`;
    files=attachments(await rouletteCard(g),'roulette.png');embed.setImage('attachment://roulette.png');
  }else if(g.phase==='hiding')description=`🕵️ اختر رقمًا من **1 إلى 25** لتختبئ فيه بسرية.\nينتهي الاختباء ${until(g)}\nاختبأ **${g.alive().filter(p=>p.spot!==null).length}/${g.alive().length}** لاعب.\nيمكن لأكثر من لاعب الاختباء في نفس المربع.`;
  else if(g.phase==='seeking')description=`🕵️ الدور على ${mention(g.actor)} لكشف مربع.\nتنتهي المهلة ${until(g)}\n🙈 مخفي • 👁️ مفتوح\nكشف مربعك يخرجك وكل من اختبأ معك.`;
  else if(g.phase==='chairs'){
    embed.setColor(g.red?0xed4245:0x57f287);
    description=g.red?`🔴 **لا تضغط!**\nأي لاعب يضغط يخرج. انتظر حتى تنتهي الجولة ${until(g)}.`:`🟢 **اضغط واحجز كرسيك!**\n${g.seats.length} كرسي — ${g.alive().length} لاعب\nمن لا يحجز يخرج. تنتهي الجولة ${until(g)}.`;
  }else if(g.phase==='duel'){
    description=`💣 المواجهة: ${g.duel.map(mention).join(' ضد ')}\nالدور على ${mention(g.actor)}\nاختر رقمًا من **1 إلى 6**. لغم واحد فقط!\nتنتهي المهلة ${until(g)}`;
    const actor=g.player(g.actor);if(actor.avatar)embed.setThumbnail(actor.avatar);
  }else if(g.phase==='ended')description='انتهى القيم.';
  else description=g.cancelReason;
  if(g.notes.length&&g.phase!=='lobby')description+=`\n\n${g.notes.join('\n')}`;
  embed.setDescription(description.slice(0,4096));if(g.started)embed.setFooter({text:footer(g)});
  return {content:null,embeds:[embed],components:gameComponents(g).slice(0,5),attachments:[],files,allowedMentions:{parse:[],users:g.actor?[g.actor]:[]}};
}
export async function winPayload(g,stats,brand){
  if(!g.winner)return {content:'انتهى القيم بدون فائز؛ خرج جميع اللاعبين.',embeds:[],components:[],allowedMentions:{parse:[]}};
  const p=g.player(g.winner),file=await winnerCard(p,stats,brand);
  return {content:`🏆 ${mention(p.id)} فوز مستحق!\nنقاط الألعاب: **${stats.points}** | الفوزات: **${stats.wins}**\n+1 نقطة و+1 فوز`,
    files:attachments(file,'winner.png'),embeds:[new EmbedBuilder().setColor(purple).setImage('attachment://winner.png')],
    components:[],allowedMentions:{parse:[],users:[p.id]}};
}
