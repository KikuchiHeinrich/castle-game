import { bestHandCards, type GameAction, type PlayerView } from '../../shared/src/index';
export function decision(v:PlayerView,selected:string[],requested:number|null,escrow:number|null){
 const you=v.you,la=you.legalActions,pick=you.hand.filter(c=>selected.includes(c.id)),cards=[...you.battlefield,...pick];
 const defense=v.roundPhase==='defense_window',min=defense?pick.length:Math.max(0,v.maxBet-you.betTotal);
 const max=defense?you.chips:Math.min(you.chips,cards.length*v.settings.chipMultiplier-you.betTotal);
 const raw=defense?escrow:requested;
 const amount=Math.max(min,Math.min(Number.isFinite(raw)&&raw!==null?Math.floor(raw):min,Math.max(0,max)));
 let action:GameAction|null=null,label='选牌',reason='';
 if(v.phase==='gameover')label='对局结束';
 else if(v.roundPhase==='settlement')label='摊牌';
 else if(you.status==='out')label='旁观';
 else if(you.status==='folded')label='已弃牌';
 else if(you.status==='defended')label='已防守';
 else if(defense){
  if(la.canPassDefense&&!pick.length){label='不防守';action={t:'pass_defense'};}
  else if(la.canDeclareDefense&&pick.length){label='防守';if(max>=min)action={t:'declare_defense',cardIds:pick.map(c=>c.id),escrow:amount};else reason='筹码不足';}
  else label='等待';
 }else if(!la.isYourTurn)label='等待';
 else if(pick.length){
  label=you.battlefield.length?'加牌':'出牌';
  if(max<min)reason=you.chips<min?'筹码不足':`再选 ${Math.ceil((v.maxBet-you.betTotal-max)/v.settings.chipMultiplier)} 张`;
  else if(you.battlefield.length&&la.canAddCards)action={t:'add_cards',cardIds:pick.map(c=>c.id),betDelta:amount};
  else if(la.canPlay)action={t:'play',cardIds:pick.map(c=>c.id),bet:amount};
 }else if(la.canAddChips&&amount>0){label=min>0&&amount===min?'跟注':'加注';action={t:'add_chips',betDelta:amount};}
 else if(la.canAgree){label=you.agreeEnd?'取消同意':'同意摊牌';action={t:'agree_end',agree:!you.agreeEnd};}
 else if(you.battlefield.length&&max<min)reason=you.chips<min?'筹码不足':'需加牌';
 return{pick,cards,preview:bestHandCards(cards),min,max:Math.max(0,max),amount,action,label,reason,defense};
}

export function matchingSelection(v:PlayerView,typeRank:number):string[]|null{
 const hand=v.you.hand;
 for(let mask=1;mask<(1<<hand.length);mask++){
  const pick=hand.filter((_,i)=>mask&(1<<i));
  if(bestHandCards([...v.you.battlefield,...pick])?.hand.typeRank===typeRank)return pick.map(c=>c.id);
 }
 return null;
}
