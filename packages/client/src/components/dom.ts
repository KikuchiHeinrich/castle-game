export const html=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function text(el:Element|null,value:unknown){if(el&&el.textContent!==String(value??''))el.textContent=String(value??'');}
export function keyed(el:HTMLElement,key:string,render:()=>void){if(el.dataset.key!==key){el.dataset.key=key;render();}}
