/** Editable native pixel source. Fixed feet and independently redrawn body/arms.
 *  画布 48×48；所有帧共用脚底基线与座位锚点，动作只改身体 / 手臂 / 帽饰等部件。 */

export const CELL = 48;
/** 单元格间隔：整数倍率缩放下相邻帧不互相渗色（图集、CSS、WAAPI 共用同一 pitch） */
export const GAP = 2;
export const PITCH = CELL + GAP;

export const CHARACTERS = [
  ['shirley','雪莉','#e8e3dc','#fff5df','#a3a1b5','#344865','#202d44','#dfb569','#699eca'],
  ['yan','小焰','#c74b45','#f3815b','#7c303a','#829295','#3c4852','#d9b165','#9f5140'],
  ['cang','小苍','#649ac4','#a3d0df','#345787','#3c5687','#253451','#e4c373','#315c87'],
  ['mo','小墨','#44404e','#776879','#282631','#67517b','#392d48','#b99a70','#9278b0'],
  ['sen','小森','#779355','#b7c681','#3c5e40','#547453','#304b3d','#dac078','#527449'],
  ['jin','小金','#d8ac55','#f4dc94','#a36f40','#91516d','#563447','#efc979','#ac515d'],
].map(([id,name,hair,light,shade,coat,dark,trim,eye])=>({id,name,hair,light,shade,coat,dark,trim,eye}));
export const MOTIONS = {
  idle:{start:0,durations:[650,430,570,610,480,620],loop:true,releaseMs:null},
  play:{start:6,durations:[90,60,70,80,90,90,70,70],loop:false,releaseMs:150},
  defend:{start:14,durations:[110,140,170,150],loop:false,releaseMs:110},
  fold:{start:18,durations:[100,150,160,150],loop:false,releaseMs:100},
  win:{start:22,durations:[100,100,140,140,120,120],loop:false,releaseMs:null},
};
export type Motion = keyof typeof MOTIONS;

/** 图集尺寸：列数取动作占用的最大列，行数取角色数 */
export const COLUMNS = Math.max(...Object.values(MOTIONS).map((m) => m.start + m.durations.length));
export const ROWS = CHARACTERS.length;

/** 坐姿接触点（脚底中心，逻辑像素）：头像框、名字、筹码、牌都挂在这条线上，不随呼吸漂移 */
export const ANCHORS = { foot: { x: 24, y: 44 } };

/** 每个动作每帧的"出牌手"落点：drawCharacter 与 releaseAnchor 共用同一张表，
 *  避免手臂关键帧与卡牌释放点各写一份常量而错位。 */
export const HAND_POS: Record<Motion, [number, number][]> = {
  idle:[[34,34],[34,33],[34,33],[34,33],[34,34],[34,34]],
  play:[[34,34],[32,29],[40,30],[41,31],[39,32],[37,32],[35,33],[34,34]],
  defend:[[34,34],[29,31],[27,30],[29,32]],
  fold:[[34,34],[36,35],[34,36],[33,35]],
  win:[[34,34],[36,26],[35,23],[36,24],[35,26],[34,34]],
};

/** 动作进行到 ms 毫秒时正在显示的帧序号 */
export function motionFrameAt(motion: Motion, ms: number): number {
  const spec = MOTIONS[motion];
  let acc = 0;
  for (let i = 0; i < spec.durations.length; i++) {
    acc += spec.durations[i];
    if (ms < acc) return i;
  }
  return spec.durations.length - 1;
}

/** 动作的卡牌释放点（逻辑像素）= 释放帧的手部中心；无释放帧返回 null */
export function releaseAnchor(motion: Motion): { x: number; y: number } | null {
  const spec = MOTIONS[motion];
  if (spec.releaseMs === null) return null;
  const [ax, ay] = HAND_POS[motion][motionFrameAt(motion, spec.releaseMs)];
  // 手部件绘制在 (ax-2, ay-1) 的 4×3 方块，中心即 (ax, ay+0.5)
  return { x: ax, y: ay + 0.5 };
}

export const RELEASE_ANCHORS = Object.fromEntries(
  (Object.keys(MOTIONS) as Motion[]).map((m) => [m, releaseAnchor(m)]),
) as Record<Motion, { x: number; y: number } | null>;

export function drawCharacter(id:string,motion:Motion,frame:number):(string|null)[][] {
  const c=CHARACTERS.find(c=>c.id===id)??CHARACTERS[0],g:(string|null)[][]=Array.from({length:48},()=>Array(48).fill(null));
  const O='#202633',S='#edc9a6',D='#c18f78',B='#4a3b38',P='#f4e7cd';
  const r=(x:number,y:number,w:number,h:number,v:string)=>{for(let yy=Math.max(0,y);yy<Math.min(48,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(48,x+w);xx++)g[yy][xx]=v;};
  const p=(pts:number[][],v:string)=>{for(let y=0;y<48;y++)for(let x=0;x<48;x++){let a=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y+.5)!==(yj>y+.5)&&x+.5<(xj-xi)*(y+.5-yi)/(yj-yi)+xi)a=!a;}if(a)g[y][x]=v;}};
  const idle=motion==='idle',dy=idle&&[1,2,3].includes(frame)?-1:0,hy=idle&&[2,3].includes(frame)?-1:motion==='fold'&&frame>0?1:0;
  // 头发 / 帽饰 / 围巾比头部滞后一帧：呼吸体现的是身体与附属物的相对变化，而不是整张图平移
  const hyHat=idle?[0,0,0,-1,-1,0][frame]:hy;
  const lag=idle?[0,0,1,1,1,0][frame]:frame%2,lean=motion==='play'&&frame>1&&frame<5?1:0,Y=28+dy,happy=motion==='win'&&frame>0&&frame<5;
  p([[17,27],[31,27],[36+lag,40],[28,39],[24,41],[13-lag,39]],c.dark);
  r(19,37,4,5,c.coat);r(27,37,4,5,c.dark);r(17,42,6,2,B);r(27,42,6,2,B);r(18,41,5,1,c.trim);r(27,41,5,1,c.trim);
  if(id==='shirley'||id==='jin'){
    p([[12,14+hyHat],[15,14+hyHat],[15,26],[11-lag,34],[7-lag,32],[10,23]],c.hair);
    p([[33,14+hyHat],[36,15+hyHat],[38,25],[41+lag,32],[36,35],[33,27]],c.hair);
    r(10,18+hyHat,2,10,c.shade);r(36,21+hyHat,2,8,c.shade);r(11,13+hyHat,5,3,c.dark);r(33,14+hyHat,5,3,c.dark);r(8,29,2,3,c.light);
  }else if(id==='cang'||id==='sen')p([[14,17+dy],[34,17+dy],[34,26],[39+lag,34],[32,33],[31,24],[16,26],[14,31],[11,29]],c.shade);
  r(18+lean,Y,14,10,c.coat);r(27+lean,Y+1,5,9,c.dark);p([[18+lean,Y],[24+lean,Y+3],[21+lean,Y+7],[17+lean,Y+6]],c.trim);r(23+lean,Y+3,2,7,c.dark);r(18,37,14,2,B);r(23,37,3,2,c.trim);
  if(id==='yan'){r(19+lean,Y+3,10,5,c.light);r(21+lean,Y+4,5,1,P);r(19,Y+8,12,2,c.dark);}
  if(id==='jin'||id==='shirley'){p([[18,34],[32,34],[34,40],[29,39],[25,40],[20,39],[16,40]],c.coat);r(18,38,14,1,c.trim);}
  if(id==='mo'){p([[15,Y],[30,Y+1],[34+lag,38],[24,35],[14,38]],c.coat);r(26,Y+3,2,2,c.trim);}
  if(id==='sen'){r(27,Y+1,2,8,B);r(26,Y+2,2,2,c.trim);}
  r(15+lean,13+hyHat,19,11,c.hair);r(17+lean,17+hy,15,10,S);r(18+lean,26+hy,12,2,D);r(15+lean,15+hyHat,3,10,c.shade);r(32+lean,17+hyHat,2,8,c.shade);r(18+lean,13+hyHat,12,4,c.hair);r(18+lean,12+hyHat,5,3,c.light);
  p([[17+lean,15+hyHat],[30+lean,15+hyHat],[29+lean,20+hyHat],[26+lean,18+hyHat],[24+lean,21+hy],[22+lean,18+hyHat],[19+lean,20+hyHat]],c.hair);
  if(happy){r(20+lean,21+hy,3,1,O);r(27+lean,21+hy,3,1,O);r(21+lean,20+hy,1,1,O);r(28+lean,20+hy,1,1,O);}else{r(20+lean,20+hy,3,1,O);r(27+lean,20+hy,3,1,O);r(20+lean,21+hy,2,3,c.eye);r(27+lean,21+hy,2,3,id==='shirley'?'#b45d68':c.eye);r(20+lean,21+hy,1,1,P);r(27+lean,21+hy,1,1,P);}r(24+lean,25+hy,happy?2:1,1,D);
  if(id==='yan'){
    p([[12+lean,15+hyHat],[15+lean,12+hyHat],[14+lean,8+hyHat],[20+lean,10+hyHat],[22+lean,6+hyHat],[27+lean,9+hyHat],[31+lean,7+hyHat],[32+lean,12+hyHat],[36+lean,13+hyHat],[33+lean,16+hyHat],[34+lean,19+hyHat],[30+lean,18+hyHat],[28+lean,16+hyHat],[26+lean,19+hyHat],[23+lean,16+hyHat],[20+lean,19+hyHat],[18+lean,16+hyHat],[14+lean,19+hyHat]],c.hair);r(19+lean,11+hyHat,4,2,c.light);r(26+lean,10+hyHat,3,2,c.light);r(16,Y,18,3,c.hair);p([[16,Y+1],[20,Y+3],[13-lag,Y+8],[8-lag,Y+5],[12,Y+4]],c.shade);
  }else if(id==='cang'){
    p([[9+lean,16+hyHat],[16+lean,13+hyHat],[23+lean,3+hyHat],[31+lean,6+hyHat],[35+lean,11+hyHat],[32+lean,12+hyHat],[39+lean,17+hyHat],[34+lean,19+hyHat],[17+lean,17+hyHat],[10+lean,19+hyHat]],c.coat);p([[18+lean,12+hyHat],[23+lean,5+hyHat],[25+lean,7+hyHat],[22+lean,13+hyHat]],c.dark);p([[15+lean,14+hyHat],[33+lean,14+hyHat],[36+lean,16+hyHat],[13+lean,16+hyHat]],c.trim);r(29+lean,9+hyHat,2,5,c.trim);r(27+lean,11+hyHat,6,1,c.trim);
  }else if(id==='sen'){
    p([[10+lean,15+hyHat],[17+lean,11+hyHat],[28+lean,10+hyHat],[34+lean,14+hyHat],[37+lean,16+hyHat],[29+lean,18+hyHat],[16+lean,16+hyHat],[11+lean,18+hyHat]],c.dark);r(18+lean,13+hyHat,14,2,c.trim);p([[27+lean,12+hyHat],[30+lean,5+hyHat],[35+lean,6+hyHat],[32+lean,12+hyHat]],c.hair);r(31+lean,8+hyHat,1,4,c.light);r(32+lean,13+hyHat,3,3,P);r(33+lean,14+hyHat,1,1,c.trim);
  }else if(id==='mo'){
    p([[12+lean,18+hyHat],[14+lean,11+hyHat],[25+lean,7+hyHat],[34+lean,12+hyHat],[36+lean,24+hyHat],[32+lean,27+hyHat],[32+lean,17+hyHat],[25+lean,13+hyHat],[18+lean,17+hyHat],[16+lean,27+hyHat],[12+lean,25+hyHat]],c.coat);p([[16+lean,12+hyHat],[25+lean,9+hyHat],[32+lean,13+hyHat],[26+lean,12+hyHat],[18+lean,17+hyHat]],c.dark);p([[18+lean,16+hyHat],[25+lean,15+hyHat],[23+lean,24+hyHat],[18+lean,24+hyHat]],c.hair);r(29+lean,13+hyHat,1,4,c.trim);r(28+lean,14+hyHat,3,1,c.trim);
  }else if(id==='shirley'){r(16+lean,8+hyHat,17,5,c.dark);r(18+lean,6+hyHat,13,3,c.coat);r(16+lean,12+hyHat,18,2,c.trim);r(23+lean,8+hyHat,3,3,c.trim);r(22+lean,9+hyHat,5,1,c.trim);r(19,Y,2,2,c.trim);r(29,Y,2,2,c.trim);
  }else if(id==='jin'){p([[18+lean,11+hyHat],[17+lean,6+hyHat],[21+lean,8+hyHat],[24+lean,4+hyHat],[27+lean,8+hyHat],[31+lean,6+hyHat],[30+lean,12+hyHat]],c.trim);r(24+lean,7+hyHat,2,3,c.coat);r(19+lean,11+hyHat,10,1,c.light);r(16,Y,4,3,P);r(30,Y,3,3,P);}
  r(14+lean,Y+2,4,6,c.coat);r(14+lean,Y+7,4,3,D);
  const hand=HAND_POS[motion][Math.min(Math.max(frame,0),HAND_POS[motion].length-1)],ax=hand[0],ay=hand[1];
  p([[30+lean,Y+2],[34+lean,Y+2],[ax,ay-2],[ax-2,ay+2],[31,Y+7]],c.dark);r(ax-2,ay-1,4,3,S);
  // 手里捏着的牌：出牌动作到释放帧（play 第 2 帧 = 150ms）就不再握牌，与卡牌起飞对齐
  if(idle||(motion==='play'&&frame<motionFrameAt('play',MOTIONS.play.releaseMs!))){const x=idle?31+lean:ax,y=idle?Y+1:ay-5;r(x,y,4,6,P);r(x+1,y+1,2,4,c.dark);}
  const out=g.map(row=>[...row]);for(let y=0;y<48;y++)for(let x=0;x<48;x++)if(!g[y][x]&&[g[y-1]?.[x],g[y+1]?.[x],g[y]?.[x-1],g[y]?.[x+1]].some(Boolean))out[y][x]=O;
  return out;
}
