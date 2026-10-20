import atlasUrl from '../assets/characters/atlas.png';
import { CELL,PITCH,COLUMNS,ROWS,CHARACTERS,MOTIONS,RELEASE_ANCHORS,type Motion } from '../art/characters';
import { TimerRegistry,type TimerHandle } from '../pending';
export type Mood='happy'|'neutral'|'serious'|'surprised';
export const ALL_CHARS=CHARACTERS,SHIRLEY=CHARACTERS[0],PLAYER_CHARS=CHARACTERS.slice(1),AVATAR_NAME='教官 · 雪莉';
export const ATLAS_URL=atlasUrl;
export const charById=(id:string)=>CHARACTERS.find(c=>c.id===id)??SHIRLEY;
/** phase 用"座位 / 身份"这类实例键：同一个人物坐在两个座位上不会同步起伏 */
export function avatarSVG(id:string,_mood:Mood='neutral',px=2,phase?:string|number):string{
 const c=charById(id),row=CHARACTERS.indexOf(c),scale=Math.max(1,Math.round(px)),key=phase??row;
 // 内联只写"默认倍率"，最终倍率交给 CSS 的 --avatar-scale：
 // 样式表（含手机媒体查询）因此能覆盖它，而 CSS 背景、WAAPI 帧偏移与锚点读的仍是同一个最终值。
 return `<span class="pixel-avatar" data-character="${c.id}" data-scale="${scale}" role="img" aria-label="${c.name}" style="--avatar-default-scale:${scale};--atlas-row:${row};--breath-period:${breathPeriod(key).toFixed(3)}s;--breath-delay:${breathDelay(key).toFixed(3)}s"><span class="avatar-shadow"></span><span class="avatar-idle sprite-frame" style="background-image:url('${atlasUrl}')"></span><span class="avatar-action sprite-frame" style="background-image:url('${atlasUrl}')"></span></span>`;
}
/** 稳定散列到 0..1：同一个键永远是同一个相位，不同键互不相同 */
function phaseHash(key:string|number|undefined,fallback:number):number{
 const text=key===undefined||key===''?String(fallback):String(key);
 let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return ((h>>>0)%997)/997;
}
const GOLDEN=.6180339887;
/**
 * 实例相位 0..1（键相同则恒定，DOM 重挂 / 重渲染都不变）。
 * 座位号这类数字键按黄金分割分层：相邻座位的起点至少错开约半周期，
 * 同一个人物坐在两个座位上绝不会同步起伏；字符串键用散列，任意稳定标识都可以。
 */
function phaseOf(key:string|number|undefined,fallback:number):number{
 if(typeof key==='number'&&Number.isFinite(key))return (key*GOLDEN+.13+.09*phaseHash(`n${key}`,fallback))%1;
 return phaseHash(key,fallback);
}
export const breathPhase=(key:string|number|undefined,fallback=0)=>phaseOf(key,fallback);
/** 呼吸周期 3.15–3.57s：各实例只有轻微周期差，整桌不会同时上下动 */
export const breathPeriod=(key:string|number|undefined,fallback=0)=>3.15+.42*phaseOf(key,fallback);
/** 呼吸起始相位：负延迟让每个实例从不同帧开始，幅度不超过一个周期 */
export const breathDelay=(key:string|number|undefined,fallback=0)=>-(phaseOf(key,fallback)*3.57);

/** 图集几何（pitch / 列 / 行）从源模块注入 CSS 变量，CSS 与 WAAPI 不会再各写一份常量 */
if(typeof document!=='undefined'){const s=document.documentElement.style;s.setProperty('--atlas-pitch',String(PITCH));s.setProperty('--atlas-columns',String(COLUMNS));s.setProperty('--atlas-rows',String(ROWS));}

const asAvatar=(element:HTMLElement|null)=>element?.matches('.pixel-avatar')?element:element?.querySelector<HTMLElement>('.pixel-avatar')??null;
/** 元素自身的整数倍率：读计算后的 --avatar-scale（媒体查询可覆盖），CSS 与 WAAPI 因此永远同倍率 */
const localScale=(avatar:HTMLElement)=>{
 const fromCss=Number.parseFloat(getComputedStyle(avatar).getPropertyValue('--avatar-scale'));
 return Math.max(1,Math.round(Number.isFinite(fromCss)&&fromCss>0?fromCss:Number(avatar.dataset.scale)||2));
};
export function reducedMotion(){return document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;}
const actors=new Map<HTMLElement,()=>void>();
const confirmTimers=new TimerRegistry();
const confirmHandles=new Map<HTMLElement,TimerHandle>();
const CONFIRM_MS=240;
export function cancelAvatarActions(){
 for(const cancel of [...actors.values()])cancel();
 for(const avatar of [...confirmHandles.keys()])clearConfirm(avatar);
 confirmTimers.cancelAll();
 // 兜底：任何没登记到表里的确认样式也在这里收干净，退出场景不留金框或标签
 for(const el of document.querySelectorAll<HTMLElement>('.avatar-confirm')){el.classList.remove('avatar-confirm');delete el.dataset.confirm;}
}
/** 收掉某个头像上的短确认：撤样式并让等待中的 Promise 立刻结束（只走这一处） */
function clearConfirm(avatar:HTMLElement){
 const handle=confirmHandles.get(avatar);
 if(handle===undefined)return;
 confirmHandles.delete(avatar);
 confirmTimers.cancel(handle);
}
/** 减弱动态：不出动作帧，但给一个清晰的短确认（文字标签 + 金色描边，无位移） */
function confirmAction(avatar:HTMLElement,motion:Exclude<Motion,'idle'>){
 clearConfirm(avatar);
 avatar.classList.add('avatar-confirm');avatar.dataset.confirm=CONFIRM_LABEL[motion];delete avatar.dataset.action;
 return new Promise<void>(resolve=>{
  let settled=false;
  const finish=()=>{if(settled)return;settled=true;confirmHandles.delete(avatar);avatar.classList.remove('avatar-confirm');delete avatar.dataset.confirm;resolve();};
  confirmHandles.set(avatar,confirmTimers.set(CONFIRM_MS,finish));
 });
}
const CONFIRM_LABEL:Record<Exclude<Motion,'idle'>,string>={play:'出牌',defend:'防守',fold:'弃牌',win:'胜利'};
export function playAvatar(element:HTMLElement|null,motion:Exclude<Motion,'idle'>):Promise<void>{
 const avatar=asAvatar(element);
 if(!avatar)return Promise.resolve();
 actors.get(avatar)?.();
 if(reducedMotion())return confirmAction(avatar,motion);
 const layer=avatar.querySelector<HTMLElement>('.avatar-action')!,spec=MOTIONS[motion],duration=spec.durations.reduce((a,b)=>a+b,0);avatar.dataset.action=motion;
 const scale=localScale(avatar);
 let elapsed=0;const keys:Keyframe[]=spec.durations.map((hold,i)=>{const k={backgroundPositionX:`${-(spec.start+i)*PITCH*scale}px`,offset:elapsed/duration,easing:'steps(1,end)'};elapsed+=hold;return k;});
 keys.push({backgroundPositionX:`${-(spec.start+spec.durations.length-1)*PITCH*scale}px`,offset:1});
 const animation=layer.animate(keys,{duration,fill:'forwards'});
 return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;actors.delete(avatar);animation.cancel();delete avatar.dataset.action;resolve();};actors.set(avatar,finish);animation.finished.then(finish,finish);});
}
/** 屏幕几何：每逻辑像素占多少 CSS 像素（含祖先 transform 的缩放），以及内容框原点（去掉边框） */
function avatarMetrics(avatar:HTMLElement){
 const r=avatar.getBoundingClientRect(),cs=getComputedStyle(avatar);
 const bl=Number.parseFloat(cs.borderLeftWidth)||0,bt=Number.parseFloat(cs.borderTopWidth)||0,br=Number.parseFloat(cs.borderRightWidth)||0;
 const inner=r.width-bl-br;
 return {unit:inner>0?inner/CELL:localScale(avatar),x:r.left+bl,y:r.top+bt};
}
/** 屏幕上每逻辑像素占多少个 CSS 像素：不需要完整矩形时用它（例如验收页对比 1x / 2x） */
export function avatarUnit(element:HTMLElement|null):number|null{
 const avatar=asAvatar(element);
 return avatar?avatarMetrics(avatar).unit:null;
}
/** 出牌手释放点：与图集里该动作释放帧绘制的手部同一坐标（art/characters.ts 的 HAND_POS） */
export function avatarHandRect(element:HTMLElement|null,motion:Motion='play'):DOMRect|null{
 const avatar=asAvatar(element);if(!avatar)return null;
 const m=avatarMetrics(avatar),a=RELEASE_ANCHORS[motion]??RELEASE_ANCHORS.play??{x:34,y:34};
 return new DOMRect(m.x+a.x*m.unit-4,m.y+a.y*m.unit-5,8,10);
}
/** 教学局里电脑对手固定用雪莉（教官）形象：只改外观，不动玩法 */
export function shownAvatar(p:{avatar:string;isBot:boolean},tutorial:boolean):string{
 return tutorial&&p.isBot?SHIRLEY.id:p.avatar;
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{document.documentElement.classList.toggle('page-hidden',document.hidden);if(document.hidden)cancelAvatarActions();});
