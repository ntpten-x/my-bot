import {createRequire} from "node:module";
import {JSDOM} from "jsdom";
import {expect,it} from "vitest";
const scrape=createRequire(import.meta.url)("../../extension/scrape.js");
function doc(inner:string){
  const dom=new JSDOM(`<body><header><div role="progressbar"></div></header><main role="main"><div role="feed">${inner}</div></main></body>`,{pretendToBeVisual:true});
  for(const node of dom.window.document.querySelectorAll("*")) node.getBoundingClientRect=()=>({top:10,bottom:30,left:10,right:30,width:20,height:20,x:10,y:10,toJSON(){return{};}});
  return dom.window.document;
}
it("ignores page chrome, hidden spinners, sidebars and media loading inside posts",()=>{
  const page=doc('<article role="article"><div role="progressbar"></div><div role="status">No more posts</div></article><aside role="complementary"><div role="progressbar"></div></aside><div hidden><div role="progressbar"></div></div><div role="progressbar" style="display:none"></div>');
  expect(scrape.feedStatus(page,"group")).toEqual({loading:false,endOfFeed:false});
});
it("recognizes a visible feed loader, explicit end and busy feed container",()=>{
  const page=doc('<article role="article">synthetic</article><div id="loader" role="progressbar"></div><div role="status">No more posts</div>');
  expect(scrape.feedStatus(page,"group")).toEqual({loading:true,endOfFeed:true});
  page.querySelector('#loader')!.remove();
  expect(scrape.feedStatus(page,"group").loading).toBe(false);
  page.querySelector('[role="feed"]')!.setAttribute('aria-busy','true');
  expect(scrape.feedStatus(page,"group").loading).toBe(true);
});
it("selects a nested scroll container instead of always scrolling the document",()=>{
  const page=doc('<div id="scroll" style="overflow-y:auto"><article role="article">synthetic</article></div>');
  const container=page.querySelector('#scroll')!;
  Object.defineProperties(container,{scrollHeight:{value:3000},clientHeight:{value:600}});
  expect(scrape.scrollRoot(page,"group")).toBe(container);
  const empty=doc('');
  expect(scrape.scrollRoot(empty,"group")).toBe(empty.documentElement);
});
