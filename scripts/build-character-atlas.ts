import { mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
// 显式带扩展名：Node 24 的类型剥离（type stripping）不会做无扩展名解析，
// 这样 `node scripts/build-character-atlas.ts` 与 `npx tsx scripts/build-character-atlas.ts` 都能直接跑。
import { CELL,GAP,PITCH,COLUMNS,ROWS,CHARACTERS,MOTIONS,ANCHORS,RELEASE_ANCHORS,drawCharacter,type Motion } from '../packages/client/src/art/characters.ts';
const width=COLUMNS*PITCH,height=ROWS*PITCH,rgba=Buffer.alloc(width*height*4);let svg='';
for(const [row,c] of CHARACTERS.entries())for(const [state,spec]of Object.entries(MOTIONS))for(let i=0;i<spec.durations.length;i++){
 const pixels=drawCharacter(c.id,state as Motion,i),x0=(spec.start+i)*PITCH,y0=row*PITCH;
 pixels.forEach((line,y)=>line.forEach((color,x)=>{if(!color)return;const at=((y0+y)*width+x0+x)*4;rgba[at]=parseInt(color.slice(1,3),16);rgba[at+1]=parseInt(color.slice(3,5),16);rgba[at+2]=parseInt(color.slice(5,7),16);rgba[at+3]=255;}));
 for(let y=0;y<CELL;y++)for(let x=0;x<CELL;){const fill=pixels[y][x];let end=x+1;while(end<CELL&&pixels[y][end]===fill)end++;if(fill)svg+=`<rect x="${x0+x}" y="${y0+y}" width="${end-x}" height="1" fill="${fill}"/>`;x=end;}
}
function crc32(b:Buffer){let c=-1;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^-1)>>>0;}
function chunk(t:string,d:Buffer){const n=Buffer.from(t),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(d.length);crc.writeUInt32BE(crc32(Buffer.concat([n,d])));return Buffer.concat([size,n,d,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)rgba.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
const dir=new URL('../packages/client/src/assets/characters/',import.meta.url);mkdirSync(dir,{recursive:true});
writeFileSync(new URL('atlas.png',dir),png);writeFileSync(new URL('atlas.svg',dir),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">${svg}</svg>`);
writeFileSync(new URL('atlas.json',dir),JSON.stringify({cell:CELL,gap:GAP,pitch:PITCH,columns:COLUMNS,rows:ROWS,foot:ANCHORS.foot,release:RELEASE_ANCHORS,characters:CHARACTERS.map((c,row)=>({id:c.id,name:c.name,row})),motions:MOTIONS},null,2)+'\n');
console.log(`${CHARACTERS.length} characters × ${COLUMNS} frames → ${width}×${height}（cell ${CELL} + gap ${GAP}）, ${png.length} bytes`);

// 验收页运行时：把生产模块（art/characters.ts + components/pixelAvatar.ts）打成浏览器可用的 ESM。
// 页面因此测的是实机代码与实机帧数据，而不是另一份手写副本。
const acceptance=new URL('../docs/ui-rebuild/acceptance/',import.meta.url);
mkdirSync(acceptance,{recursive:true});
void build({
  entryPoints:[fileURLToPath(new URL('acceptance-runtime.js',acceptance))],
  outfile:fileURLToPath(new URL('avatar-runtime.js',acceptance)),
  bundle:true,format:'esm',target:'es2020',platform:'browser',
  loader:{'.png':'file'},assetNames:'[name]',logLevel:'warning',allowOverwrite:true,
}).then(()=>console.log('验收页运行时 → docs/ui-rebuild/acceptance/avatar-runtime.js'))
 .catch((error)=>{console.error('验收页运行时打包失败：',error.message);process.exitCode=1;});
