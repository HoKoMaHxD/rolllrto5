import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager,SerialQueue } from '../src/manager.js';
import { Store } from '../src/store.js';
import { gameComponents,controlComponents,shopPayload } from '../src/views.js';
import { commands } from '../src/commands.js';

function setup(t){
  const store=new Store(':memory:');let time=1000000;
  const config={name:'Test',maxPlayers:50,lobbyMs:20000,turnMs:20000,hideMs:20000,chairMs:10000,reverseMs:4000};
  const sent=[];
  const channel={id:'c',guild:{id:'g'},async send(payload){
    const msg={id:String(sent.length+1),payload,async edit(p){this.payload={...this.payload,...p};return this;}};sent.push(msg);return msg;
  }};
  const manager=new GameManager(store,config,{now:()=>time,payload:async g=>({components:gameComponents(g).slice(0,5)}),winner:async(g,stats)=>({content:g.winner?`winner:${g.winner}:${stats.wins}`:'no winner'})});
  t.after(()=>{for(const e of manager.games.values()){clearTimeout(e.timer);clearTimeout(e.repaint);}store.close();});
  const click=(e,user,action,value='',version=e.game.version)=>manager.click({channelId:'c',guildId:'g',id:e.game.id,version,action,value,user:{id:user,name:user},receivedAt:time,respond:async payload=>payload});
  return {manager,channel,store,sent,click,advance:ms=>{time+=ms;}};
}
test('serial queue preserves ordering across errors without blocking another channel',async()=>{
  const q=new SerialQueue(),order=[];
  const first=q.run('a',async()=>{await new Promise(r=>setTimeout(r,10));order.push(1);throw new Error('expected');});
  const second=q.run('a',async()=>{order.push(2);});const other=q.run('b',async()=>{order.push('b');});
  await Promise.allSettled([first,second,other]);assert.deepEqual(order,['b',1,2]);
});
test('simultaneous joins preserve order and do not reset lobby deadline',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');const deadline=e.game.deadline;
  await Promise.all(Array.from({length:50},(_,i)=>click(e,String(i+1),'join')));
  assert.equal(e.game.players.length,50);assert.equal(e.game.deadline,deadline);assert.equal(e.game.players[49].id,'50');
  await assert.rejects(()=>manager.start(channel,'hide','host'));await assert.rejects(()=>click(e,'1','join'));
});
test('simultaneous kicks from the same turn only eliminate one target',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');
  for(const id of ['1','2','3','4'])await click(e,id,'join');e.game.start();await manager.sync(e);
  const v=e.game.version,actor=e.game.actor,targets=e.game.alive().filter(p=>p.id!==actor);
  const result=await Promise.allSettled([click(e,actor,'kick',targets[0].id,v),click(e,actor,'kick',targets[1].id,v)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(e.game.alive().length,3);
});
test('deadline race rejects late action and eliminates timed-out actor',async t=>{
  const {manager,channel,click,advance}=setup(t),e=await manager.start(channel,'roulette','host');
  for(const id of ['1','2','3'])await click(e,id,'join');e.game.start();await manager.sync(e);
  const actor=e.game.actor,target=e.game.alive().find(p=>p.id!==actor).id;advance(20000);
  await assert.rejects(()=>click(e,actor,'kick',target));assert.equal(e.game.player(actor).alive,false);assert.equal(e.game.player(target).alive,true);
});
test('concurrent seat claims permit exactly one claimant',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'chairs','host');
  for(const id of ['1','2','3'])await click(e,id,'join');e.game.rng=n=>n-1;e.game.start();await manager.sync(e);
  const results=await Promise.allSettled([click(e,'1','chair','0'),click(e,'2','chair','0')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(e.game.seats.filter(Boolean).length,1);
});
test('50-player roulette splits components into legal messages; all player IDs are represented',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');
  for(let i=1;i<=50;i++)await click(e,String(i),'join');e.game.start();await manager.sync(e);
  for(const m of [e.main,e.extra,e.controls]){assert.ok(m);assert.ok(m.payload.components.length<=5);for(const r of m.payload.components)assert.ok(r.toJSON().components.length<=5);}
  assert.equal(gameComponents(e.game).flatMap(r=>r.toJSON().components).length,49);
});
test('shop has latest correct prices and serializable command definitions',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');
  const shop=shopPayload(e.game,'1');const fields=shop.embeds[0].toJSON().fields;
  assert.ok(fields[0].name.includes('2'));assert.ok(fields[1].name.includes('1'));assert.ok(fields[2].name.includes('10'));
  assert.ok(commands.find(c=>c.name==='اضافة').default_member_permissions);assert.equal(commands.find(c=>c.name==='اضافة').options[0].name,'نقاط');
});
test('hide board has 25 squares and an independent withdrawal control message',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'hide','host');await click(e,'1','join');await click(e,'2','join');e.game.start();await manager.sync(e);
  assert.equal(e.main.payload.components.length,5);assert.equal(controlComponents(e.game).length,1);
  assert.equal(e.main.payload.components.flatMap(r=>r.toJSON().components).length,25);
});
test('winner is rewarded once; finished game is released and buttons disabled',async t=>{
  const {manager,channel,click,store,sent}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');await click(e,'2','join');
  e.game.start();await manager.sync(e);const winner=e.game.actor,target=e.game.alive().find(p=>p.id!==winner).id;
  await click(e,winner,'kick',target);assert.equal(store.get('g',winner).wins,1);assert.equal(store.get('g',winner).points,1);
  assert.equal(manager.games.has('c'),false);assert.deepEqual(e.main.payload.components,[]);assert.match(sent.at(-1).payload.content,/winner:/);
  await manager.sync(e);assert.equal(store.get('g',winner).wins,1);assert.equal(sent.filter(m=>m.payload.content?.startsWith('winner:')).length,1);
});
test('only host/admin can stop, cancellation grants no rewards',async t=>{
  const {manager,channel,click,store}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');
  await assert.rejects(()=>manager.stop('c','other',false));await manager.stop('c','host',false);assert.equal(store.get('g','1').wins,0);
});
test('restart recovery clears stale components and keeps inventory and points',async t=>{
  const {manager,channel,click,store,sent}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');store.adjust('g','1',5,'admin');store.buy('g','1','reflect');
  clearTimeout(e.timer);clearTimeout(e.repaint);manager.games.clear();channel.isTextBased=()=>true;channel.messages={fetch:async id=>sent.find(m=>m.id===id)};
  await manager.recover({channels:{fetch:async()=>channel}});assert.deepEqual(e.main.payload.components,[]);assert.equal(store.get('g','1').points,3);assert.equal(store.get('g','1').reflect,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM active_messages').get().n,0);
});
